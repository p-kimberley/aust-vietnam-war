namespace Avw.Api.Media;

/// <summary>
/// Where a picture lives below the media root, and the address it is served from. Uploaded and imported pictures share one pool,
/// named by content hash and spread over folders by the hash's first two hex characters: <c>uploads/ab/abcdef….jpg</c>, with the
/// thumbnail beside it as <c>abcdef…-480.jpg</c>. Other top-level folders (such as <c>portraits</c>) are placed by hand.
/// </summary>
public static class MediaPaths
{
    public const string UploadsFolder = "uploads";
    public const int DefaultThumbnailWidth = 480;

    /// <summary>The folder below the media root that holds a picture and its thumbnail, with forward slashes.</summary>
    public static string Folder(string sha256) => $"{UploadsFolder}/{sha256[..2]}";

    public static string Image(string sha256) => $"{Folder(sha256)}/{sha256}.jpg";

    public static string Thumbnail(string sha256, int width = DefaultThumbnailWidth) => $"{Folder(sha256)}/{sha256}-{width}.jpg";

    public static string ImageUrl(string sha256) => "/media/" + Image(sha256);

    public static string ThumbnailUrl(string sha256, int width = DefaultThumbnailWidth) => "/media/" + Thumbnail(sha256, width);
}
