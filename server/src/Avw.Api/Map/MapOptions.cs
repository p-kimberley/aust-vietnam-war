using Microsoft.Extensions.Options;

namespace Avw.Api.Map;

/// <summary>
/// Runtime map catalogue served to the browser. Basemaps, terrain and overlays are configuration rather than code
/// so a provider can be swapped (a different tile server, a new GeoServer layer) without a release.
/// </summary>
public sealed class MapOptions
{
    public const string Section = "Map";

    public double[] Center { get; set; } = [107.17, 10.55];
    public double Zoom { get; set; } = 8;

    public List<BasemapOption> Basemaps { get; set; } = [];
    public List<OverlayOption> Overlays { get; set; } = [];

    /// <summary>Leave unset when no elevation source is available; the 3D switch is then hidden.</summary>
    public TerrainOption? Terrain { get; set; }
}

public sealed class BasemapOption
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";

    /// <summary>
    /// An absolute http(s) URL of a MapLibre/Mapbox style JSON, for example a TileServer GL <c>/styles/{id}/style.json</c>.
    /// Leave empty for a basemap that is plain raster tiles with no style of its own (for example satellite imagery) and set
    /// <see cref="Tiles"/> instead; the map is then given a minimal style built from them.
    /// </summary>
    public string Style { get; set; } = "";

    /// <summary>XYZ raster tile templates, used only when <see cref="Style"/> is empty.</summary>
    public string[] Tiles { get; set; } = [];

    public int TileSize { get; set; } = 256;
    public string? Attribution { get; set; }

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

/// <summary>A raster-dem elevation source: either a TileJSON <see cref="Url"/> or explicit <see cref="Tiles"/> templates.</summary>
public sealed class TerrainOption
{
    public string? Url { get; set; }
    public string[] Tiles { get; set; } = [];

    /// <summary><c>terrarium</c> (Mapzen/AWS tiles) or <c>mapbox</c> (Mapbox Terrain-RGB encoding).</summary>
    public string Encoding { get; set; } = "terrarium";

    public int TileSize { get; set; } = 256;
    public int MaxZoom { get; set; } = 15;
    public double Exaggeration { get; set; } = 1.5;
    public string? Attribution { get; set; }
}

/// <summary>
/// Fails at startup, with a message that says what to change, rather than serving a catalogue the map cannot use.
/// The map library cannot load <c>mapbox://</c> URLs, so a leftover one is the most likely mistake.
/// </summary>
public sealed class MapOptionsValidator : IValidateOptions<MapOptions>
{
    public ValidateOptionsResult Validate(string? name, MapOptions o)
    {
        var errors = new List<string>();

        if (o.Basemaps.Count == 0)
        {
            errors.Add("Map:Basemaps must contain at least one basemap.");
        }

        foreach (var b in o.Basemaps)
        {
            if (string.IsNullOrWhiteSpace(b.Id) || string.IsNullOrWhiteSpace(b.Name))
            {
                errors.Add("Every Map:Basemaps entry needs an id and a name.");
            }

            var hasStyle = IsHttpUrl(b.Style);
            var hasTiles = b.Tiles.Length > 0 && b.Tiles.All(t => IsHttpUrl(t.Replace("{", "%7B").Replace("}", "%7D")));
            if (!string.IsNullOrEmpty(b.Style) && !hasStyle)
            {
                errors.Add($"Map:Basemaps '{b.Id}' style must be an absolute http(s) URL, not '{b.Style}'. "
                           + "mapbox:// styles cannot be loaded; host the style on a tile server instead.");
            }
            else if (!hasStyle && !hasTiles)
            {
                errors.Add($"Map:Basemaps '{b.Id}' needs a style (an absolute http(s) URL) or one or more absolute http(s) Tiles templates.");
            }
        }

        AddDuplicates(errors, "Map:Basemaps", o.Basemaps.Select(b => b.Id));
        AddDuplicates(errors, "Map:Overlays", o.Overlays.Select(v => v.Id));

        foreach (var v in o.Overlays)
        {
            if (v.Tiles.Length == 0 || v.Tiles.Any(t => !IsHttpUrl(t.Replace("{", "%7B").Replace("}", "%7D"))))
            {
                errors.Add($"Map:Overlays '{v.Id}' needs one or more absolute http(s) tile URLs.");
            }
        }

        if (o.Terrain is { } t)
        {
            var hasUrl = IsHttpUrl(t.Url);
            var hasTiles = t.Tiles.Length > 0 && t.Tiles.All(x => IsHttpUrl(x.Replace("{", "%7B").Replace("}", "%7D")));
            if (!hasUrl && !hasTiles)
            {
                errors.Add("Map:Terrain needs an absolute http(s) Url (TileJSON) or Tiles templates.");
            }

            if (t.Encoding is not ("terrarium" or "mapbox"))
            {
                errors.Add($"Map:Terrain:Encoding must be 'terrarium' or 'mapbox', not '{t.Encoding}'.");
            }
        }

        return errors.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(errors);
    }

    private static bool IsHttpUrl(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https";

    private static void AddDuplicates(List<string> errors, string section, IEnumerable<string> ids)
    {
        foreach (var dup in ids.GroupBy(i => i, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1))
        {
            errors.Add($"{section} has more than one entry with id '{dup.Key}'.");
        }
    }
}
