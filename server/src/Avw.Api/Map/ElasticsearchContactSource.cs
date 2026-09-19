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
