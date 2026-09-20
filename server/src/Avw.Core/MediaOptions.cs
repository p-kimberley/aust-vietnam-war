namespace Avw.Api.Media;

/// <summary>Where uploaded images live and how they are processed. See docs/rebuild-plan.md, section 6.</summary>
public sealed class MediaOptions
{
    public const string Section = "Media";

    /// <summary>Final images, served at <c>/media</c>. In the cluster this is the shared (ReadWriteMany) volume.</summary>
    public string RootPath { get; set; } = "data/media";

    /// <summary>Uploads and working copies. In the cluster this is the pod's own volume.</summary>
    public string ScratchPath { get; set; } = "data/scratch";

    public long MaxUploadBytes { get; set; } = 25 * 1024 * 1024;

    /// <summary>Uploads processed at once in this pod. Others are turned away with 503 rather than filling the scratch volume.</summary>
    public int MaxConcurrentUploads { get; set; } = 4;

    /// <summary>The largest picture kept. Bigger ones are shrunk to fit inside this box (never enlarged).</summary>
    public int MaxWidth { get; set; } = 1920;

    public int MaxHeight { get; set; } = 1080;
    public int JpegQuality { get; set; } = 80;
    public int ThumbnailWidth { get; set; } = 480;

    /// <summary>Refuses pictures with more pixels than this before decoding them, so a tiny file cannot expand to gigabytes.</summary>
    public long MaxSourcePixels { get; set; } = 100_000_000;
}
