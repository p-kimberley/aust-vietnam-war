namespace Avw.Data.Entities;

/// <summary>
/// A point of interest on the Battle Map: a fire support base, patrol base or landing zone. Reference data imported from
/// the legacy site, which keeps the legacy id so links stay stable.
/// </summary>
public class Poi
{
    public int Id { get; set; }

    /// <summary>Short code: <c>FSB</c>, <c>FSPB</c>, <c>LZ</c>, <c>Base</c> or <c>Other</c>.</summary>
    public string Type { get; set; } = "";

    public string Name { get; set; } = "";

    /// <summary>Whether the map shows it. Some legacy rows are kept for reference only.</summary>
    public bool Visible { get; set; }

    public int? Established { get; set; }

    /// <summary>Plain-text history. The legacy field held HTML, including images from external hosts; it is reduced to text on import.</summary>
    public string? Details { get; set; }

    public double Lat { get; set; }
    public double Lon { get; set; }
}
