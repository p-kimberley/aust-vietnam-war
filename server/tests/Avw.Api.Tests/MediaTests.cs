using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Avw.Api.Cms;
using Avw.Api.Media;
using Avw.Data;
using Avw.Data.Entities;
using ImageMagick;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Avw.Api.Tests;

internal static class TestImages
{
    public static byte[] Make(MagickFormat format, int width, int height, MagickColor? color = null, Action<MagickImage>? tweak = null)
    {
        using var image = new MagickImage(color ?? MagickColors.SteelBlue, (uint)width, (uint)height);
        tweak?.Invoke(image);
        image.Format = format;
        return image.ToByteArray();
    }

    public static byte[] Jpeg(int width = 800, int height = 600) => Make(MagickFormat.Jpeg, width, height);
}

public sealed class MediaProcessorTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "avw-media-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try
        {
            Directory.Delete(_dir, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    private MediaOptions Options(Action<MediaOptions>? tweak = null)
    {
        var o = new MediaOptions { RootPath = Path.Combine(_dir, "media"), ScratchPath = Path.Combine(_dir, "scratch") };
        tweak?.Invoke(o);
        return o;
    }

    private static MediaProcessor Processor(MediaOptions o) => new(Microsoft.Extensions.Options.Options.Create(o));

    private static Task<ProcessedImage> Run(MediaProcessor p, byte[] bytes) => p.ProcessAsync(new MemoryStream(bytes), default);

    private static MagickImage Read(MediaOptions o, ProcessedImage image) => new(Path.Combine(o.RootPath, image.RelativePath));

    [Fact]
    public async Task Shrinks_a_large_photo_to_fit_the_box_and_stores_it_under_its_hash_with_a_thumbnail()
    {
        var o = Options();
        using var p = Processor(o);

        var result = await Run(p, TestImages.Jpeg(4000, 3000));

        Assert.Equal((1440, 1080), (result.Width, result.Height));
        Assert.Equal(64, result.Sha256.Length);
        var stored = Path.Combine(o.RootPath, result.RelativePath);
        Assert.Equal(result.Sha256, Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(stored))));
        Assert.Equal(result.ByteSize, new FileInfo(stored).Length);
        using var thumb = new MagickImage(Path.Combine(o.RootPath, result.Sha256[..2], $"{result.Sha256}-480.jpg"));
        Assert.Equal((480u, 360u), (thumb.Width, thumb.Height));
        Assert.Equal(MagickFormat.Jpeg, Read(o, result).Format);
    }

    [Fact]
    public async Task Never_enlarges_a_small_picture()
    {
        var o = Options();
        using var p = Processor(o);

        var result = await Run(p, TestImages.Jpeg(300, 200));

        Assert.Equal((300, 200), (result.Width, result.Height));
    }

    [Fact]
    public async Task Turns_a_png_with_transparency_into_a_jpeg_with_a_white_background()
    {
        var o = Options();
        using var p = Processor(o);
        var png = TestImages.Make(MagickFormat.Png, 50, 50, MagickColors.Transparent);

        var result = await Run(p, png);

        using var image = Read(o, result);
        Assert.Equal(MagickFormat.Jpeg, image.Format);
        var pixel = image.GetPixels().GetPixel(10, 10).ToColor()!;
        Assert.True(pixel.R > 240 && pixel.G > 240 && pixel.B > 240, $"transparent pixels should be white, got {pixel}");
    }

    [Fact]
    public async Task Applies_the_camera_orientation_and_removes_the_exif_data()
    {
        var o = Options();
        using var p = Processor(o);
        var upright = TestImages.Make(MagickFormat.Jpeg, 200, 100, null, image =>
        {
            var exif = new ExifProfile();
            exif.SetValue(ExifTag.Orientation, (ushort)6);              // "rotate 90° to view", so it should come out portrait
            exif.SetValue(ExifTag.Make, "TestCam");
            image.SetProfile(exif);
            image.Orientation = OrientationType.RightTop;               // ImageMagick keeps the EXIF tag in step with this property when writing
        });

        var result = await Run(p, upright);

        Assert.Equal((100, 200), (result.Width, result.Height));
        using var image = Read(o, result);
        Assert.Null(image.GetExifProfile());
        Assert.Equal(OrientationType.Undefined, image.Orientation);
    }

    [Fact]
    public async Task Uploading_the_same_picture_again_gives_the_same_file()
    {
        var o = Options();
        using var p = Processor(o);
        var bytes = TestImages.Jpeg();

        var first = await Run(p, bytes);
        var second = await Run(p, bytes);

        Assert.Equal(first.Sha256, second.Sha256);
        Assert.Single(Directory.GetFiles(Path.Combine(o.RootPath, first.Sha256[..2]), "*-480.jpg"));
    }

    [Theory]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>")]
    [InlineData("<html><body>not a picture</body></html>")]
    [InlineData("GIF89a-not-supported-at-launch")]
    [InlineData("push graphic-context\nviewbox 0 0 640 480\nfill 'url(https://example.com/x.jpg)'\npop graphic-context")]
    [InlineData("tiny")]
    public async Task Refuses_anything_that_is_not_a_jpeg_png_or_webp_whatever_it_is_called(string content)
    {
        using var p = Processor(Options());

        var e = await Assert.ThrowsAsync<MediaException>(() => Run(p, System.Text.Encoding.UTF8.GetBytes(content)));

        Assert.Equal(MediaError.UnsupportedType, e.Error);
    }

    [Fact]
    public async Task Refuses_an_empty_upload()
    {
        using var p = Processor(Options());

        var e = await Assert.ThrowsAsync<MediaException>(() => Run(p, []));

        Assert.Equal(MediaError.UnsupportedType, e.Error);
    }

    [Fact]
    public async Task Refuses_a_file_that_looks_like_a_jpeg_but_is_not_one()
    {
        using var p = Processor(Options());
        var fake = new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }.Concat(Enumerable.Repeat((byte)7, 500)).ToArray();

        var e = await Assert.ThrowsAsync<MediaException>(() => Run(p, fake));

        Assert.Equal(MediaError.Corrupt, e.Error);
    }

    [Fact]
    public async Task Stops_reading_at_the_size_cap_and_leaves_nothing_behind()
    {
        var o = Options(x => x.MaxUploadBytes = 2000);
        using var p = Processor(o);
        var big = TestImages.Make(MagickFormat.Jpeg, 800, 600, null, i => i.AddNoise(NoiseType.Gaussian));

        var e = await Assert.ThrowsAsync<MediaException>(() => Run(p, big));

        Assert.Equal(MediaError.TooLarge, e.Error);
        Assert.Empty(Directory.GetDirectories(Path.Combine(o.ScratchPath, "incoming")));
        Assert.Empty(Directory.EnumerateFiles(o.RootPath, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Refuses_a_picture_with_too_many_pixels_before_decoding_it()
    {
        using var p = Processor(Options(x => x.MaxSourcePixels = 10_000));

        var e = await Assert.ThrowsAsync<MediaException>(() => Run(p, TestImages.Jpeg(200, 200)));

        Assert.Equal(MediaError.TooLarge, e.Error);
    }

    [Fact]
    public async Task Turns_extra_uploads_away_while_all_the_slots_are_busy_and_frees_them_afterwards()
    {
        var o = Options(x => x.MaxConcurrentUploads = 1);
        using var p = Processor(o);
        var stream = new GatedStream(TestImages.Jpeg());
        var slow = p.ProcessAsync(stream, default);
        await stream.Started.Task;

        var e = await Assert.ThrowsAsync<MediaException>(() => Run(p, TestImages.Jpeg()));
        Assert.Equal(MediaError.Busy, e.Error);

        stream.Release.SetResult();
        await slow;
        Assert.NotNull(await Run(p, TestImages.Jpeg()));
    }

    [Fact]
    public async Task Leaves_no_scratch_or_temporary_files_after_success()
    {
        var o = Options();
        using var p = Processor(o);

        await Run(p, TestImages.Jpeg());

        Assert.Empty(Directory.GetDirectories(Path.Combine(o.ScratchPath, "incoming")));
        Assert.Empty(Directory.GetFiles(Path.Combine(o.RootPath, ".incoming")));
    }

    /// <summary>A stream that hands over its first read only when told to, to hold an upload "in progress".</summary>
    private sealed class GatedStream(byte[] bytes) : MemoryStream(bytes)
    {
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            Started.TrySetResult();
            await Release.Task;
            return await base.ReadAsync(buffer, cancellationToken);
        }
    }
}

public sealed class MediaEndpointTests : IDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };
    private readonly ApiFactory _factory = new();

    public void Dispose() => _factory.Dispose();

    private HttpClient Client() => _factory.CreateClient(new() { AllowAutoRedirect = false });

    private HttpRequestMessage Upload(string? role, long uid, byte[] bytes, string fileName = "photo.jpg", string? caption = null, bool csrf = true)
    {
        var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(file, "file", fileName);
        if (caption is not null)
        {
            form.Add(new StringContent(caption), "caption");
        }

        var req = new HttpRequestMessage(HttpMethod.Post, "/api/studio/media") { Content = form };
        Act(req, role, uid, csrf);
        return req;
    }

    private static void Act(HttpRequestMessage req, string? role, long uid, bool csrf = true)
    {
        if (role is not null)
        {
            req.Headers.Add("X-Test-User", "Test User");
            req.Headers.Add("X-Test-Uid", uid.ToString());
            req.Headers.Add("X-Test-Roles", role);
        }

        if (csrf)
        {
            req.Headers.Add("X-Requested-With", "avw");
        }
    }

    private void SeedUsers()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AvwDbContext>();
        if (!db.Users.Any())
        {
            db.Users.AddRange(new AppUser { Id = 1, Subject = "a", DisplayName = "Ann Author" }, new AppUser { Id = 2, Subject = "b", DisplayName = "Bo Author" }, new AppUser { Id = 3, Subject = "e", DisplayName = "Ed Editor" });
            db.SaveChanges();
        }
    }

    private async Task<MediaView> Ok(HttpResponseMessage res, HttpStatusCode expected = HttpStatusCode.Created)
    {
        Assert.Equal(expected, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<MediaView>(Json))!;
    }

    [Fact]
    public async Task An_authors_upload_waits_for_approval_and_is_then_served_with_forever_caching()
    {
        SeedUsers();
        var http = Client();

        var m = await Ok(await http.SendAsync(Upload("author", 1, TestImages.Jpeg(), caption: "  A patrol  ")));

        Assert.Equal((MediaStatus.Pending, "A patrol", true, 800, 600), (m.Status, m.Caption, m.Mine, m.Width, m.Height));
        Assert.Matches("^/media/[0-9a-f]{2}/[0-9a-f]{64}\\.jpg$", m.Url);
        var file = await http.GetAsync(m.Url);
        Assert.Equal((HttpStatusCode.OK, "image/jpeg"), (file.StatusCode, file.Content.Headers.ContentType!.MediaType));
        Assert.Contains("immutable", file.Headers.CacheControl!.ToString());
        Assert.Equal("nosniff", file.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal(HttpStatusCode.OK, (await http.GetAsync(m.ThumbUrl)).StatusCode);
    }

    [Fact]
    public async Task An_editors_upload_is_approved_at_once_and_the_same_picture_is_one_row()
    {
        SeedUsers();
        var http = Client();
        var bytes = TestImages.Jpeg();

        var first = await Ok(await http.SendAsync(Upload("editor", 3, bytes)));
        var again = await Ok(await http.SendAsync(Upload("author", 1, bytes)));

        Assert.Equal(MediaStatus.Approved, first.Status);
        Assert.Equal(first.Id, again.Id);
        Assert.Equal(MediaStatus.Approved, again.Status);                       // it was already approved; a second uploader does not demote it
        Assert.False(again.Mine);
    }

    [Fact]
    public async Task Only_an_editor_can_approve_or_reject()
    {
        SeedUsers();
        var http = Client();
        var m = await Ok(await http.SendAsync(Upload("author", 1, TestImages.Jpeg())));

        var asAuthor = new HttpRequestMessage(HttpMethod.Post, $"/api/studio/media/{m.Id}/status") { Content = JsonContent.Create(new MediaStatusRequest(MediaStatus.Approved), options: Json) };
        Act(asAuthor, "author", 1);
        Assert.Equal(HttpStatusCode.Forbidden, (await http.SendAsync(asAuthor)).StatusCode);

        var asEditor = new HttpRequestMessage(HttpMethod.Post, $"/api/studio/media/{m.Id}/status") { Content = JsonContent.Create(new MediaStatusRequest(MediaStatus.Approved), options: Json) };
        Act(asEditor, "editor", 3);
        Assert.Equal(MediaStatus.Approved, (await Ok(await http.SendAsync(asEditor), HttpStatusCode.OK)).Status);
    }

    [Fact]
    public async Task Shows_authors_their_own_uploads_and_the_approved_ones_but_not_other_peoples_pending_ones()
    {
        SeedUsers();
        var http = Client();
        var mine = await Ok(await http.SendAsync(Upload("author", 1, TestImages.Make(MagickFormat.Jpeg, 100, 100, MagickColors.Red))));
        var theirs = await Ok(await http.SendAsync(Upload("author", 2, TestImages.Make(MagickFormat.Jpeg, 100, 100, MagickColors.Green))));
        var approved = await Ok(await http.SendAsync(Upload("editor", 3, TestImages.Make(MagickFormat.Jpeg, 100, 100, MagickColors.Blue))));

        async Task<long[]> Ids(string role, long uid)
        {
            var req = new HttpRequestMessage(HttpMethod.Get, "/api/studio/media");
            Act(req, role, uid);
            var page = (await (await http.SendAsync(req)).Content.ReadFromJsonAsync<Paged<MediaView>>(Json))!;
            return page.Items.Select(i => i.Id).Order().ToArray();
        }

        Assert.Equal(new[] { mine.Id, approved.Id }.Order(), await Ids("author", 1));
        Assert.Equal(new[] { mine.Id, theirs.Id, approved.Id }.Order(), await Ids("editor", 3));
    }

    [Fact]
    public async Task Rejects_uploads_that_are_not_pictures_or_that_are_missing_the_header_or_the_login()
    {
        SeedUsers();
        var http = Client();

        var notPicture = await http.SendAsync(Upload("author", 1, "<svg onload=alert(1)>"u8.ToArray(), "evil.jpg"));
        Assert.Equal(HttpStatusCode.BadRequest, notPicture.StatusCode);
        Assert.Equal("file", JsonDocument.Parse(await notPicture.Content.ReadAsStringAsync()).RootElement.GetProperty("field").GetString());

        Assert.Equal(HttpStatusCode.Forbidden, (await http.SendAsync(Upload("author", 1, TestImages.Jpeg(), csrf: false))).StatusCode);
        Assert.NotEqual(HttpStatusCode.Created, (await http.SendAsync(Upload(null, 0, TestImages.Jpeg()))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await http.SendAsync(Upload("member", 1, TestImages.Jpeg()))).StatusCode);
    }

    [Fact]
    public async Task Answers_413_when_the_picture_is_over_the_limit()
    {
        using var factory = new ApiFactory { Extra = { ["Media:MaxUploadBytes"] = "3000" } };
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AvwDbContext>();
            db.Users.Add(new AppUser { Id = 1, Subject = "a", DisplayName = "Ann" });
            db.SaveChanges();
        }

        var big = TestImages.Make(MagickFormat.Jpeg, 800, 600, null, i => i.AddNoise(NoiseType.Gaussian));
        var form = new MultipartFormDataContent { { new ByteArrayContent(big), "file", "big.jpg" } };
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/studio/media") { Content = form };
        Act(req, "author", 1);

        var res = await factory.CreateClient().SendAsync(req);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, res.StatusCode);
    }

    [Fact]
    public async Task Never_serves_temporary_files_or_anything_outside_the_media_folder()
    {
        SeedUsers();
        var http = Client();
        await Ok(await http.SendAsync(Upload("editor", 3, TestImages.Jpeg())));
        var options = _factory.Services.GetRequiredService<IOptions<MediaOptions>>().Value;
        File.WriteAllText(Path.Combine(options.RootPath, ".incoming", "abc123"), "partial");

        Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync("/media/.incoming/abc123")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync("/media/../scratch/incoming")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync("/media/zz/" + new string('0', 64) + ".jpg")).StatusCode);
    }

    [Fact]
    public async Task Readiness_includes_a_check_that_both_volumes_can_be_written()
    {
        var res = await Client().GetAsync("/api/health/ready");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var options = _factory.Services.GetRequiredService<IOptions<MediaOptions>>().Value;
        Assert.NotEmpty(Directory.GetFiles(options.RootPath, ".avw-health-*"));
        Assert.NotEmpty(Directory.GetFiles(options.ScratchPath, ".avw-health-*"));
    }

    [Fact]
    public async Task A_picture_can_be_used_as_an_articles_featured_image_only_once_approved()
    {
        SeedUsers();
        var http = Client();
        var pending = await Ok(await http.SendAsync(Upload("author", 1, TestImages.Jpeg())));
        using var scope = _factory.Services.CreateScope();
        var svc = ActivatorUtilities.CreateInstance<ArticleService>(scope.ServiceProvider);
        var author = new Actor(1, false);

        var input = new ArticleInput("Story", null, null, "<p>x</p>", null, pending.Id, false, null, 0, null, null, null, 0);
        var refused = await svc.CreateAsync(ContentKind.Article, input, author, default);
        Assert.Equal("featuredMediaId", refused.Field);

        var approve = new HttpRequestMessage(HttpMethod.Post, $"/api/studio/media/{pending.Id}/status") { Content = JsonContent.Create(new MediaStatusRequest(MediaStatus.Approved), options: Json) };
        Act(approve, "editor", 3);
        await http.SendAsync(approve);
        Assert.True((await svc.CreateAsync(ContentKind.Article, input, author, default)).Ok);
    }
}
