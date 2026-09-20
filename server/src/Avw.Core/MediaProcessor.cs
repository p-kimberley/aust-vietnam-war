using System.Security.Cryptography;
using ImageMagick;
using Microsoft.Extensions.Options;

namespace Avw.Api.Media;

public enum MediaError
{
    TooLarge,
    UnsupportedType,
    Corrupt,
    Busy,
}

public sealed class MediaException(MediaError error, string message) : Exception(message)
{
    public MediaError Error { get; } = error;
}

/// <summary>A processed picture that is now in the media folder.</summary>
public sealed record ProcessedImage(string Sha256, int Width, int Height, long ByteSize)
{
    /// <summary>Path below the media root, for example <c>ab/abcdef….jpg</c>.</summary>
    public string RelativePath => $"{Sha256[..2]}/{Sha256}.jpg";
}

/// <summary>
/// Turns an uploaded file into the final image. Follows docs/rebuild-plan.md section 6: stream to scratch under a hard
/// size cap, identify the format from the file's own bytes, decode with that format only, straighten and strip it,
/// shrink it, encode it as JPEG, name it by its content hash and move it into the media folder with a rename so a
/// reader never sees half a file.
/// </summary>
public sealed class MediaProcessor : IDisposable
{
    private readonly MediaOptions _options;
    private readonly SemaphoreSlim _gate;

    static MediaProcessor()
    {
        // Backstops against decompression bombs, on top of the pixel-count check made before decoding.
        ResourceLimits.Width = 30_000;
        ResourceLimits.Height = 30_000;
        ResourceLimits.Memory = 512UL * 1024 * 1024;
        ResourceLimits.Thread = 2;
    }

    public MediaProcessor(IOptions<MediaOptions> options)
    {
        _options = options.Value;
        _gate = new SemaphoreSlim(Math.Max(1, _options.MaxConcurrentUploads));
        Directory.CreateDirectory(Incoming);
        Directory.CreateDirectory(Path.Combine(_options.RootPath, ".incoming"));
    }

    private string Incoming => Path.Combine(_options.ScratchPath, "incoming");

    public async Task<ProcessedImage> ProcessAsync(Stream upload, CancellationToken ct)
    {
        if (!_gate.Wait(0, CancellationToken.None))
        {
            throw new MediaException(MediaError.Busy, "The server is busy with other uploads. Try again in a moment.");
        }

        var work = Path.Combine(Incoming, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        try
        {
            var source = Path.Combine(work, "source.part");
            await CopyWithCapAsync(upload, source, ct);
            var format = Identify(source);

            var main = Path.Combine(work, "main.jpg");
            var thumb = Path.Combine(work, "thumb.jpg");
            var (width, height) = await Task.Run(() => Encode(source, format, main, thumb), ct);

            var sha = await HashAsync(main, ct);
            var size = new FileInfo(main).Length;
            var folder = Path.Combine(_options.RootPath, sha[..2]);
            Directory.CreateDirectory(folder);
            Publish(main, Path.Combine(folder, $"{sha}.jpg"));
            Publish(thumb, Path.Combine(folder, $"{sha}-{_options.ThumbnailWidth}.jpg"));
            return new ProcessedImage(sha, width, height, size);
        }
        finally
        {
            _gate.Release();
            TryDelete(work);
        }
    }

    private async Task CopyWithCapAsync(Stream input, string path, CancellationToken ct)
    {
        await using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true);
        var buffer = new byte[81920];
        long total = 0;
        int read;
        while ((read = await input.ReadAsync(buffer, ct)) > 0)
        {
            total += read;
            if (total > _options.MaxUploadBytes)
            {
                throw new MediaException(MediaError.TooLarge, $"Pictures can be at most {_options.MaxUploadBytes / (1024 * 1024)} MB.");
            }

            await output.WriteAsync(buffer.AsMemory(0, read), ct);
        }

        if (total == 0)
        {
            throw new MediaException(MediaError.UnsupportedType, "The file is empty.");
        }
    }

    /// <summary>The format according to the file's first bytes. The name and content type the browser sent are never trusted.</summary>
    internal static MagickFormat Identify(string path)
    {
        Span<byte> head = stackalloc byte[12];
        using (var f = File.OpenRead(path))
        {
            if (f.Read(head) < 12)
            {
                throw Unsupported();
            }
        }

        if (head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF)
        {
            return MagickFormat.Jpeg;
        }

        if (head[..8].SequenceEqual((ReadOnlySpan<byte>)[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
        {
            return MagickFormat.Png;
        }

        if (head[..4].SequenceEqual("RIFF"u8) && head[8..12].SequenceEqual("WEBP"u8))
        {
            return MagickFormat.WebP;
        }

        throw Unsupported();
    }

    private static MediaException Unsupported() => new(MediaError.UnsupportedType, "Upload a JPEG, PNG or WebP picture.");

    private (int Width, int Height) Encode(string source, MagickFormat format, string main, string thumb)
    {
        // Decoding is pinned to the detected format, so a file cannot talk ImageMagick into a different (riskier) decoder.
        var settings = new MagickReadSettings { Format = format };
        try
        {
            var info = new MagickImageInfo();
            info.Read(new FileInfo(source), settings);
            if ((long)info.Width * info.Height > _options.MaxSourcePixels)
            {
                throw new MediaException(MediaError.TooLarge, "That picture has too many pixels.");
            }

            using var image = new MagickImage(source, settings);
            image.AutoOrient();
            if (image.ColorSpace is not (ColorSpace.sRGB or ColorSpace.Gray))
            {
                image.TransformColorSpace(ColorProfiles.SRGB);
            }

            image.ColorAlpha(MagickColors.White);                 // transparent areas become white: JPEG has no alpha
            image.Strip();                                        // EXIF (including GPS), comments and profiles
            image.Resize(new MagickGeometry($"{_options.MaxWidth}x{_options.MaxHeight}>"));
            var width = (int)image.Width;
            var height = (int)image.Height;

            Save(image, main);
            using var small = image.Clone();
            small.Resize(new MagickGeometry($"{_options.ThumbnailWidth}x>"));
            Save(small, thumb);
            return (width, height);
        }
        catch (MagickException)
        {
            throw new MediaException(MediaError.Corrupt, "That file could not be read as a picture.");
        }
    }

    private void Save(IMagickImage<byte> image, string path)
    {
        image.Format = MagickFormat.Jpeg;
        image.Quality = (uint)_options.JpegQuality;
        image.Settings.Interlace = Interlace.Plane;                        // progressive: shows a rough picture while it loads
        image.Write(path);
    }

    private static async Task<string> HashAsync(string path, CancellationToken ct)
    {
        await using var f = File.OpenRead(path);
        return Convert.ToHexStringLower(await SHA256.HashDataAsync(f, ct));
    }

    /// <summary>
    /// Copies to a temporary name on the media volume, then renames into place. The rename is atomic on one filesystem, and
    /// the name is the content hash, so an existing file is already identical and is left alone.
    /// </summary>
    private void Publish(string from, string to)
    {
        if (File.Exists(to))
        {
            return;
        }

        var temp = Path.Combine(_options.RootPath, ".incoming", Guid.NewGuid().ToString("N"));
        File.Copy(from, temp);
        try
        {
            File.Move(temp, to, overwrite: false);
        }
        catch (IOException) when (File.Exists(to))
        {
            File.Delete(temp);                                    // another upload of the same picture won the race
        }
    }

    private static void TryDelete(string directory)
    {
        try
        {
            Directory.Delete(directory, recursive: true);
        }
        catch (IOException)
        {
            // A leftover here is swept later; it must not turn a finished upload into an error.
        }
    }

    public void Dispose() => _gate.Dispose();
}
