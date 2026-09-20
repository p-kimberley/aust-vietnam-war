using System.Net.Http.Json;
using System.Text.Json;
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
    // Elasticsearch field names are case-sensitive (`DTG`, not `dtg`), so request bodies must not be re-cased.
    private static readonly JsonSerializerOptions RequestJson = new() { PropertyNamingPolicy = null };

    private static readonly string[] Fields =
    [
        "DTG", "Location", "Fr_Force_Present", "Total_Fr_Cas", "En_Force", "Total_En_Cas", "Series", "Operation",
        "Unit_Task", "Mine_Incid", "Fr_Units",
    ];

    public async Task<ContactSet> GetAllAsync(CancellationToken ct)
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

        using var res = await http.PostAsJsonAsync($"{Uri.EscapeDataString(o.ContactsIndex)}/_search", body, RequestJson, ct);
        await EnsureSuccessAsync(res, ct);
        var page = await res.Content.ReadFromJsonAsync<SearchResponse>(ct)
                   ?? throw new InvalidOperationException("Elasticsearch returned an empty response.");

        if (page.Hits.Total.Value > page.Hits.Hits.Count)
        {
            // Not silent: a truncated map would look complete. Raise MaxContacts (bounded by index.max_result_window)
            // or move this source to search_after paging.
            logger.LogWarning("Contact index holds {Total} documents but only {Returned} were returned",
                page.Hits.Total.Value, page.Hits.Hits.Count);
        }

        var contacts = new List<ContactRecord>(page.Hits.Hits.Count);
        var units = new Dictionary<int, UnitInfo>();
        foreach (var hit in page.Hits.Hits)
        {
            var s = hit.Source;
            if (s.Location is null || !int.TryParse(hit.Id, out var id) || s.Dtg is null)
            {
                logger.LogWarning("Skipping contact {Id}: missing id, date or location", hit.Id);
                continue;
            }

            // Hidden units are never exposed, as a filter choice or otherwise.
            var involved = (s.FrUnits ?? []).Where(u => u.Hidden != true).ToList();
            foreach (var u in involved)
            {
                units.TryAdd(u.Id, new UnitInfo(u.Id, u.Parent, u.Title, u.ShortTypeName, u.ShortName, u.LongName, u.Path));
            }

            contacts.Add(new ContactRecord(
                id, s.Dtg, s.Location.Lat, s.Location.Lon,
                s.FrForce, s.TotalFrCas, s.EnForce, s.TotalEnCas,
                involved.Select(u => u.Id).ToArray(),
                Clean(s.Operation), Clean(s.Task), Clean(s.Series), s.MineIncident is null ? null : s.MineIncident != 0));
        }

        return new ContactSet(contacts, [.. units.Values]);
    }

    public async Task<int[]> SearchAsync(string text, CancellationToken ct)
    {
        var o = options.Value;
        var body = new
        {
            size = o.MaxContacts,
            _source = false,
            query = new
            {
                @bool = new
                {
                    // Every word must appear, in any order. The text travels as a JSON string value, never as query syntax.
                    must = new { match = new { Description_of_Incident = new { query = text, @operator = "and" } } },
                    filter = new { exists = new { field = "Location" } },
                },
            },
        };

        using var res = await http.PostAsJsonAsync($"{Uri.EscapeDataString(o.ContactsIndex)}/_search", body, RequestJson, ct);
        await EnsureSuccessAsync(res, ct);
        var page = await res.Content.ReadFromJsonAsync<SearchIds>(ct)
                   ?? throw new InvalidOperationException("Elasticsearch returned an empty response.");
        return page.Hits.Hits.Select(h => int.TryParse(h.Id, out var id) ? id : 0).Where(id => id > 0).ToArray();
    }

    // Highlight markers are control characters that cannot occur in a report, so the excerpt can be split on them safely
    // and no markup ever reaches the client.
    private const char MatchStart = '';
    private const char MatchEnd = '';
    private const int ExcerptLength = 140;

    public async Task<FindResult> FindAsync(string text, int limit, CancellationToken ct)
    {
        var o = options.Value;
        var body = new
        {
            size = limit,
            track_total_hits = true,
            _source = new[] { "DTG", "Description_of_Incident" },
            query = new
            {
                @bool = new
                {
                    must = new { match = new { Description_of_Incident = new { query = text, @operator = "and" } } },
                    filter = new { exists = new { field = "Location" } },
                },
            },
            highlight = new
            {
                fields = new
                {
                    Description_of_Incident = new
                    {
                        fragment_size = ExcerptLength,
                        number_of_fragments = 1,
                        pre_tags = new[] { MatchStart.ToString() },
                        post_tags = new[] { MatchEnd.ToString() },
                    },
                },
            },
        };

        using var res = await http.PostAsJsonAsync($"{Uri.EscapeDataString(o.ContactsIndex)}/_search", body, RequestJson, ct);
        await EnsureSuccessAsync(res, ct);
        var page = await res.Content.ReadFromJsonAsync<FindResponse>(ct)
                   ?? throw new InvalidOperationException("Elasticsearch returned an empty response.");

        var hits = new List<ContactHit>();
        foreach (var h in page.Hits.Hits)
        {
            if (!int.TryParse(h.Id, out var id) || h.Source?.Dtg is null)
            {
                continue;
            }

            var fragment = h.Highlight?.Description?.FirstOrDefault();
            var snippet = fragment is not null
                ? SplitSnippet(fragment)
                : [new SnippetPart(Excerpt(h.Source.Description), false)];
            hits.Add(new ContactHit(id, h.Source.Dtg, snippet));
        }

        return new FindResult([.. hits], page.Hits.Total.Value);
    }

    private static string Excerpt(string? text)
    {
        var t = text?.Trim() ?? "";
        return t.Length <= ExcerptLength ? t : t[..ExcerptLength] + "…";
    }

    /// <summary>Splits an excerpt on the highlight markers into plain and matched parts.</summary>
    internal static SnippetPart[] SplitSnippet(string fragment)
    {
        var parts = new List<SnippetPart>();
        var match = false;
        var start = 0;
        for (var i = 0; i <= fragment.Length; i++)
        {
            if (i < fragment.Length && fragment[i] != MatchStart && fragment[i] != MatchEnd)
            {
                continue;
            }

            if (i > start)
            {
                parts.Add(new SnippetPart(fragment[start..i], match));
            }

            if (i < fragment.Length)
            {
                match = fragment[i] == MatchStart;
            }

            start = i + 1;
        }

        return [.. parts];
    }

    private sealed record FindResponse(FindHits Hits);

    private sealed record FindHits(Total Total, List<FindHit> Hits);

    private sealed record FindHit(
        [property: JsonPropertyName("_id")] string Id,
        [property: JsonPropertyName("_source")] FindSource? Source,
        [property: JsonPropertyName("highlight")] FindHighlight? Highlight);

    private sealed record FindSource(
        [property: JsonPropertyName("DTG")] string? Dtg,
        [property: JsonPropertyName("Description_of_Incident")] string? Description);

    private sealed record FindHighlight([property: JsonPropertyName("Description_of_Incident")] List<string>? Description);

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

        await EnsureSuccessAsync(res, ct);
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

    /// <summary>Throws with Elasticsearch's own error text, which says which field or privilege was the problem.</summary>
    private static async Task EnsureSuccessAsync(HttpResponseMessage res, CancellationToken ct)
    {
        if (res.IsSuccessStatusCode)
        {
            return;
        }

        var text = await res.Content.ReadAsStringAsync(ct);
        throw new HttpRequestException(
            $"Elasticsearch returned {(int)res.StatusCode}: {(text.Length > 500 ? text[..500] : text)}", null, res.StatusCode);
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
        [property: JsonPropertyName("Fr_Units")] List<UnitDoc>? FrUnits,
        [property: JsonPropertyName("Fr_Force_Present")] int FrForce,
        [property: JsonPropertyName("En_Force")] int EnForce,
        [property: JsonPropertyName("Fr_KIA")] int FrKia,
        [property: JsonPropertyName("Fr_WIA")] int FrWia,
        [property: JsonPropertyName("En_KIA")] int EnKia,
        [property: JsonPropertyName("En_WIA")] int EnWia,
        [property: JsonPropertyName("Description_of_Incident")] string? Description,
        [property: JsonPropertyName("Archival_Source_Data")] string? ArchivalSource,
        [property: JsonPropertyName("Source_Hyperlink")] string? SourceHyperlink);

    private sealed record UnitDoc(
        [property: JsonPropertyName("_id")] int Id,
        [property: JsonPropertyName("Parent")] int? Parent,
        [property: JsonPropertyName("Title")] string? Title,
        [property: JsonPropertyName("ShortTypeName")] string? ShortTypeName,
        [property: JsonPropertyName("ShortDisplayName")] string? ShortName,
        [property: JsonPropertyName("LongDisplayName")] string? LongName,
        [property: JsonPropertyName("Path")] string? Path,
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
        [property: JsonPropertyName("Series")] string? Series,
        [property: JsonPropertyName("Operation")] string? Operation,
        [property: JsonPropertyName("Unit_Task")] string? Task,
        [property: JsonPropertyName("Mine_Incid")] int? MineIncident,
        [property: JsonPropertyName("Fr_Units")] List<UnitDoc>? FrUnits);

    private sealed record SearchIds(SearchIdHits Hits);

    private sealed record SearchIdHits(List<SearchIdHit> Hits);

    private sealed record SearchIdHit([property: JsonPropertyName("_id")] string Id);

    private sealed record GeoPoint(double Lat, double Lon);

}
