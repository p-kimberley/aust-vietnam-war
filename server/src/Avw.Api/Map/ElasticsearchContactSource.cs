using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace Avw.Api.Map;

/// <summary>
/// Reads the whole contact index in one request. Only the fields the map needs are requested, so the response stays
/// small even though every contact is fetched.
/// </summary>
public sealed class ElasticsearchContactSource(
    HttpClient http, IOptions<ElasticsearchOptions> options, ILogger<ElasticsearchContactSource> logger) : IContactSource
{
    private static readonly string[] Fields =
    [
        "DTG", "Location", "Fr_Force_Present", "Total_Fr_Cas", "En_Force", "Total_En_Cas", "Fr_Units._id",
    ];

    public async Task<IReadOnlyList<ContactSummary>> GetAllAsync(CancellationToken ct)
    {
        var o = options.Value;
        var body = new
        {
            size = o.MaxContacts,
            track_total_hits = true,
            _source = Fields,
            sort = new object[] { new { DTG = "asc" }, new { _doc = "asc" } },
            query = new { exists = new { field = "Location" } },
        };

        using var res = await http.PostAsJsonAsync($"{Uri.EscapeDataString(o.ContactsIndex)}/_search", body, ct);
        res.EnsureSuccessStatusCode();
        var page = await res.Content.ReadFromJsonAsync<SearchResponse>(ct)
                   ?? throw new InvalidOperationException("Elasticsearch returned an empty response.");

        if (page.Hits.Total.Value > page.Hits.Hits.Count)
        {
            // Not silent: a truncated map would look complete. Raise MaxContacts (bounded by index.max_result_window)
            // or move this source to search_after paging.
            logger.LogWarning("Contact index holds {Total} documents but only {Returned} were returned",
                page.Hits.Total.Value, page.Hits.Hits.Count);
        }

        var list = new List<ContactSummary>(page.Hits.Hits.Count);
        foreach (var hit in page.Hits.Hits)
        {
            var s = hit.Source;
            if (s.Location is null || !int.TryParse(hit.Id, out var id) || s.Dtg is null)
            {
                logger.LogWarning("Skipping contact {Id}: missing id, date or location", hit.Id);
                continue;
            }

            list.Add(new ContactSummary(
                id, s.Dtg, s.Location.Lat, s.Location.Lon,
                s.FrForce, s.TotalFrCas, s.EnForce, s.TotalEnCas,
                s.FrUnits?.Select(u => u.Id).ToArray() ?? []));
        }

        return list;
    }

    private static readonly string[] DetailFields =
    [
        "DTG", "Location", "Grid_Ref", "Operation", "Unit_Task", "Fr_Units", "Fr_Force_Present", "En_Force",
        "Fr_KIA", "Fr_WIA", "En_KIA", "En_WIA", "Description_of_Incident", "Archival_Source_Data", "Source_Hyperlink",
    ];

    public async Task<ContactDetail?> GetAsync(int id, CancellationToken ct)
    {
        var o = options.Value;
        var path = $"{Uri.EscapeDataString(o.ContactsIndex)}/_doc/{id}?_source_includes={string.Join(',', DetailFields)}";

        using var res = await http.GetAsync(path, ct);
        if (res.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }

        res.EnsureSuccessStatusCode();
        var doc = await res.Content.ReadFromJsonAsync<DocResponse>(ct);
        if (doc is not { Found: true, Source: { } s } || s.Location is null || s.Dtg is null)
        {
            return null;
        }

        return new ContactDetail(
            id, s.Dtg, s.Location.Lat, s.Location.Lon,
            Clean(s.GridRef), Clean(s.Operation), Clean(s.UnitTask),
            (s.FrUnits ?? [])
                .Where(u => u.Hidden != true)
                .Select(u => new ContactUnit(u.Id, u.ShortName ?? u.LongName ?? "Unknown", u.LongName ?? u.ShortName ?? "Unknown"))
                .OrderBy(u => u.ShortName, StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            s.FrForce, s.EnForce, s.FrKia, s.FrWia, s.EnKia, s.EnWia,
            Clean(s.Description), Clean(s.ArchivalSource), HttpUrlOrNull(s.SourceHyperlink));
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>The link is rendered as an anchor by the client, so anything but http(s) (for example <c>javascript:</c>) is dropped here.</summary>
    private static string? HttpUrlOrNull(string? value) =>
        Uri.TryCreate(value?.Trim(), UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" ? uri.AbsoluteUri : null;

    private sealed record DocResponse(
        bool Found,
        [property: JsonPropertyName("_source")] DetailSource? Source);

    private sealed record DetailSource(
        [property: JsonPropertyName("DTG")] string? Dtg,
        [property: JsonPropertyName("Location")] GeoPoint? Location,
        [property: JsonPropertyName("Grid_Ref")] string? GridRef,
        [property: JsonPropertyName("Operation")] string? Operation,
        [property: JsonPropertyName("Unit_Task")] string? UnitTask,
        [property: JsonPropertyName("Fr_Units")] List<DetailUnit>? FrUnits,
        [property: JsonPropertyName("Fr_Force_Present")] int FrForce,
        [property: JsonPropertyName("En_Force")] int EnForce,
        [property: JsonPropertyName("Fr_KIA")] int FrKia,
        [property: JsonPropertyName("Fr_WIA")] int FrWia,
        [property: JsonPropertyName("En_KIA")] int EnKia,
        [property: JsonPropertyName("En_WIA")] int EnWia,
        [property: JsonPropertyName("Description_of_Incident")] string? Description,
        [property: JsonPropertyName("Archival_Source_Data")] string? ArchivalSource,
        [property: JsonPropertyName("Source_Hyperlink")] string? SourceHyperlink);

    private sealed record DetailUnit(
        [property: JsonPropertyName("_id")] int Id,
        [property: JsonPropertyName("ShortDisplayName")] string? ShortName,
        [property: JsonPropertyName("LongDisplayName")] string? LongName,
        [property: JsonPropertyName("Hidden")] bool? Hidden);

    private sealed record SearchResponse(HitsEnvelope Hits);

    private sealed record HitsEnvelope(Total Total, List<Hit> Hits);

    private sealed record Total(long Value);

    private sealed record Hit(
        [property: JsonPropertyName("_id")] string Id,
        [property: JsonPropertyName("_source")] Source Source);

    private sealed record Source(
        [property: JsonPropertyName("DTG")] string? Dtg,
        [property: JsonPropertyName("Location")] GeoPoint? Location,
        [property: JsonPropertyName("Fr_Force_Present")] int FrForce,
        [property: JsonPropertyName("Total_Fr_Cas")] int TotalFrCas,
        [property: JsonPropertyName("En_Force")] int EnForce,
        [property: JsonPropertyName("Total_En_Cas")] int TotalEnCas,
        [property: JsonPropertyName("Fr_Units")] List<UnitRef>? FrUnits);

    private sealed record GeoPoint(double Lat, double Lon);

    private sealed record UnitRef([property: JsonPropertyName("_id")] int Id);
}
