namespace Avw.Data.Entities;

public enum MediaStatus
{
    Pending,
    Approved,
    Rejected,
}

/// <summary>
/// Metadata for a final processed image. The file itself lives on the shared media volume at
/// <c>aa/&lt;sha256&gt;.jpg</c>; content-hash names make files immutable.
/// </summary>
public class MediaAsset
{
    public long Id { get; set; }

    /// <summary>Lower-case hex SHA-256 of the processed file. Unique, so re-uploads are no-ops.</summary>
    public string Sha256 { get; set; } = "";

    public string ContentType { get; set; } = "image/jpeg";
    public int Width { get; set; }
    public int Height { get; set; }
    public long ByteSize { get; set; }
    public string? Caption { get; set; }
    public string? Credit { get; set; }
    public MediaStatus Status { get; set; }
    public long UploadedById { get; set; }
    public AppUser UploadedBy { get; set; } = null!;
    public DateTime CreatedUtc { get; set; }
}
