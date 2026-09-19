namespace Avw.Api.Map;

/// <summary>
/// Runtime map catalogue served to the browser. Basemaps, terrain and overlays are configuration rather than code
/// so a provider can be swapped (Mapbox to MapLibre tiles, a new GeoServer layer) without a release.
/// </summary>
public sealed class MapOptions
{
    public const string Section = "Map";

    /// <summary>A public (<c>pk.</c>) Mapbox token. Never a secret token: it is sent to every visitor.</summary>
    public string? MapboxToken { get; set; }

    public double[] Center { get; set; } = [107.17, 10.55];
    public double Zoom { get; set; } = 8;

    public List<BasemapOption> Basemaps { get; set; } = [];
    public List<OverlayOption> Overlays { get; set; } = [];
    public TerrainOption? Terrain { get; set; }
}

public sealed class BasemapOption
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";

    /// <summary>A style URL (<c>mapbox://styles/...</c> or https).</summary>
    public string Style { get; set; } = "";

    public bool Default { get; set; }
}

public sealed class OverlayOption
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";

    /// <summary>XYZ raster tile templates, for example a GeoServer WMTS or WMS URL.</summary>
    public string[] Tiles { get; set; } = [];

    public int TileSize { get; set; } = 256;
    public string? Attribution { get; set; }
    public double Opacity { get; set; } = 1;
}

public sealed class TerrainOption
{
    /// <summary>A raster-dem source URL, for example <c>mapbox://mapbox.mapbox-terrain-dem-v1</c>.</summary>
    public string Source { get; set; } = "";

    public double Exaggeration { get; set; } = 1.5;
}
