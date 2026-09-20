using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Avw.Api.Map;
using Microsoft.Extensions.Options;

namespace Avw.Api.Analytics;

/// <summary>
/// Reads the contacts and the nominal roll for the charts. The contacts come in one request, as for the map. The roll
/// (tens of thousands of people) is read with the scroll API, in pages, and released afterwards.
/// </summary>
/// <remarks>
/// The charts are computed here rather than by Elasticsearch aggregations because the cluster maps <c>Weapon_Effects</c> as a
/// plain object, so per-weapon figures cannot be aggregated correctly there, and because there is no hour-of-day field.
/// </remarks>
public sealed class ElasticsearchAnalyticsSource(
    HttpClient http, IOptions<ElasticsearchOptions> options, ILogger<ElasticsearchAnalyticsSource> logger) : IAnalyticsSource
{
    private static readonly JsonSerializerOptions RequestJson = new() { PropertyNamingPolicy = null };
    private const int ScrollPageSize = 5000;
    private const string ScrollKeepAlive = "1m";

    private static readonly string[] IncidentFields =
    [
        "DTG", "Fr_KIA", "Fr_WIA", "En_KIA", "En_WIA", "Total_Fr_Cas", "Total_En_Cas", "Unit_Task", "Fired_First",
        "Weapon_Effects.Weapon.Name", "Weapon_Effects.Weapon.Category", "Weapon_Effects.Actor", "Weapon_Effects.Engagement_Range",
        "Weapon_Effects.Rounds_Fired", "Weapon_Effects.Affected_Asset.Casualties",
    ];

    private static readonly string[] PersonFields = ["Birth.Date", "Death.Date", "Branch", "Tours.StartDate"];

    public async Task<IReadOnlyList<IncidentRow>> LoadIncidentsAsync(CancellationToken ct)
    {
        var o = options.Value;
        var body = new
        {
            size = o.MaxContacts,
            track_total_hits = true,
            _source = IncidentFields,
            sort = new object[] { new { DTG = "asc" }, new { _doc = "asc" } },
            query = new { exists = new { field = "DTG" } },
        };

        using var res = await http.PostAsJsonAsync($"{Uri.EscapeDataString(o.ContactsIndex)}/_search", body, RequestJson, ct);
        await EnsureSuccessAsync(res, ct);
        var page = await res.Content.ReadFromJsonAsync<Page<IncidentSource>>(ct) ?? throw new InvalidOperationException("Elasticsearch returned an empty response.");
        if (page.Hits.Total.Value > page.Hits.Hits.Count)
        {
            logger.LogWarning("Contact index holds {Total} documents but only {Returned} were read for the charts", page.Hits.Total.Value, page.Hits.Hits.Count);
        }

        var rows = new List<IncidentRow>(page.Hits.Hits.Count);
        foreach (var hit in page.Hits.Hits)
        {
            var s = hit.Source;
            if (!int.TryParse(hit.Id, out var id) || !TryParseDateTime(s.Dtg, out var dtg))
            {
                continue;
            }

            rows.Add(new IncidentRow(id, dtg, s.FrKia, s.FrWia, s.EnKia, s.EnWia, s.FrCas, s.EnCas, Clean(s.Task), Clean(s.FiredFirst),
                (s.Effects ?? []).Select(e => new WeaponEffectRow(
                    Clean(e.Weapon?.Name), Clean(e.Weapon?.Category), Clean(e.Actor), e.Range, e.Rounds, e.Asset?.Casualties ?? 0)).ToArray()));
        }

        return rows;
    }

    public async Task<IReadOnlyList<PersonRow>> LoadPeopleAsync(CancellationToken ct)
    {
        var o = options.Value;
        var people = new List<PersonRow>();
        string? scrollId = null;
        try
        {
            var first = new { size = ScrollPageSize, _source = PersonFields, sort = new object[] { "_doc" }, query = new { match_all = new { } } };
            using var res = await http.PostAsJsonAsync($"{Uri.EscapeDataString(o.PersonnelIndex)}/_search?scroll={ScrollKeepAlive}", first, RequestJson, ct);
            await EnsureSuccessAsync(res, ct);
            var page = await res.Content.ReadFromJsonAsync<ScrollPage>(ct) ?? throw new InvalidOperationException("Elasticsearch returned an empty response.");
            scrollId = page.ScrollId;
            while (page.Hits.Hits.Count > 0)
            {
                people.AddRange(page.Hits.Hits.Select(h => ToPerson(h.Source)));
                using var next = await http.PostAsJsonAsync("_search/scroll", new { scroll = ScrollKeepAlive, scroll_id = scrollId }, RequestJson, ct);
                await EnsureSuccessAsync(next, ct);
                page = await next.Content.ReadFromJsonAsync<ScrollPage>(ct) ?? throw new InvalidOperationException("Elasticsearch returned an empty response.");
                scrollId = page.ScrollId ?? scrollId;
            }
        }
        finally
        {
            await ClearScrollAsync(scrollId);
        }

        return people;
    }

    private async Task ClearScrollAsync(string? scrollId)
    {
        if (scrollId is null)
        {
            return;
        }

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Delete, "_search/scroll") { Content = JsonContent.Create(new { scroll_id = scrollId }, options: RequestJson) };
            using var res = await http.SendAsync(req, CancellationToken.None);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            // The scroll expires by itself after a minute; releasing it early is a courtesy to the cluster.
            logger.LogDebug(ex, "Could not clear the scroll");
        }
    }

    private static PersonRow ToPerson(PersonSource s) => new(
        TryParseDate(s.Birth?.Date),
        TryParseDate(s.Death?.Date),
        Clean(s.Branch),
        (s.Tours ?? []).Select(t => TryParseDate(t.StartDate)).Where(d => d is not null).Select(d => d!.Value).ToArray());

    /// <summary>Reads <c>2026-09-20</c>, <c>2026-09-20T01:02:03</c> and the roll's <c>20/09/2026</c> forms; anything else is no date.</summary>
    internal static DateOnly? TryParseDate(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var t = text.Trim();
        return DateOnly.TryParseExact(t, ["yyyy-MM-dd", "d/M/yyyy", "dd/MM/yyyy"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
            ? d
            : t.Length >= 10 && DateOnly.TryParseExact(t[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var iso) ? iso : null;
    }

    private static bool TryParseDateTime(string? text, out DateTime value) =>
        DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out value);

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static async Task EnsureSuccessAsync(HttpResponseMessage res, CancellationToken ct)
    {
        if (!res.IsSuccessStatusCode)
        {
            var detail = await res.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException($"Elasticsearch answered {(int)res.StatusCode}: {(detail.Length > 300 ? detail[..300] : detail)}");
        }
    }

    // ---- response shapes

    private sealed record Total([property: JsonPropertyName("value")] long Value);

    private sealed record Hit<T>([property: JsonPropertyName("_id")] string Id, [property: JsonPropertyName("_source")] T Source);

    private sealed record HitList<T>(
        [property: JsonPropertyName("total")] Total Total, [property: JsonPropertyName("hits")] List<Hit<T>> Hits);

    private sealed record Page<T>([property: JsonPropertyName("hits")] HitList<T> Hits);

    private sealed record ScrollPage(
        [property: JsonPropertyName("_scroll_id")] string? ScrollId, [property: JsonPropertyName("hits")] HitList<PersonSource> Hits);

    private sealed record IncidentSource(
        [property: JsonPropertyName("DTG")] string? Dtg,
        [property: JsonPropertyName("Fr_KIA")] int FrKia,
        [property: JsonPropertyName("Fr_WIA")] int FrWia,
        [property: JsonPropertyName("En_KIA")] int EnKia,
        [property: JsonPropertyName("En_WIA")] int EnWia,
        [property: JsonPropertyName("Total_Fr_Cas")] int FrCas,
        [property: JsonPropertyName("Total_En_Cas")] int EnCas,
        [property: JsonPropertyName("Unit_Task")] string? Task,
        [property: JsonPropertyName("Fired_First")] string? FiredFirst,
        [property: JsonPropertyName("Weapon_Effects")] List<EffectSource>? Effects);

    private sealed record EffectSource(
        [property: JsonPropertyName("Weapon")] WeaponSource? Weapon,
        [property: JsonPropertyName("Actor")] string? Actor,
        [property: JsonPropertyName("Engagement_Range")] int Range,
        [property: JsonPropertyName("Rounds_Fired")] int Rounds,
        [property: JsonPropertyName("Affected_Asset")] AssetSource? Asset);

    private sealed record WeaponSource([property: JsonPropertyName("Name")] string? Name, [property: JsonPropertyName("Category")] string? Category);

    private sealed record AssetSource([property: JsonPropertyName("Casualties")] int Casualties);

    private sealed record PersonSource(
        [property: JsonPropertyName("Birth")] DateHolder? Birth,
        [property: JsonPropertyName("Death")] DateHolder? Death,
        [property: JsonPropertyName("Branch")] string? Branch,
        [property: JsonPropertyName("Tours")] List<TourSource>? Tours);

    private sealed record DateHolder([property: JsonPropertyName("Date")] string? Date);

    private sealed record TourSource([property: JsonPropertyName("StartDate")] string? StartDate);
}
