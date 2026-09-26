using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Avw.Features;

/// <summary>
/// Reads, for every contact on the map, who did what: the report's units, its own words for them (which name the unit in contact
/// first), its unit task, and its support fields. The API's contact list does not carry these, so they are read from the contacts index here, in
/// pages, read-only.
/// </summary>
public static class ContactRoles
{
    private static readonly string[] Fields =
        ["Fr_Units", "Fr_Units_Involved", "Unit_Task", "Arty_Incid", "No_Arty_Mor_Strikes", "Artillery", "Arty_Mor_in_Spt", "APCs", "Tanks", "Air_Support"];

    public static async Task<IReadOnlyDictionary<int, ContactRole>> ReadAsync(HttpClient http, string index, CancellationToken ct)
    {
        var roles = new Dictionary<int, ContactRole>();
        object[]? after = null;
        while (true)
        {
            var body = new Dictionary<string, object>
            {
                ["size"] = 2000,
                ["sort"] = new[] { new { _doc = "asc" } },
                ["_source"] = Fields,
                ["query"] = new { exists = new { field = "Location" } },
            };
            if (after is not null)
            {
                body["search_after"] = after;
            }

            using var response = await http.PostAsJsonAsync($"{index}/_search", body, ct);
            response.EnsureSuccessStatusCode();
            var page = await response.Content.ReadFromJsonAsync<Page>(ct) ?? throw new InvalidOperationException("Empty answer from Elasticsearch.");
            if (page.Hits.Hits.Count == 0)
            {
                return roles;
            }

            foreach (var hit in page.Hits.Hits)
            {
                var s = hit.Source;
                roles[int.Parse(hit.Id)] = new ContactRole(
                    s.FrUnits?.Select(u => u.Id).ToList() ?? [],
                    s.Involved,
                    string.IsNullOrWhiteSpace(s.UnitTask) ? null : s.UnitTask.Trim(),
                    Yes(s.ArtyIncid) || Number(s.Strikes) > 0,
                    Yes(s.Artillery) || Yes(s.ArtyInSupport),
                    Number(s.Apcs) > 0,
                    Number(s.Tanks) > 0,
                    Yes(s.AirSupport));
            }

            after = page.Hits.Hits[^1].Sort;
        }
    }

    // The index holds these as 0 and 1, but not always as numbers.
    private static double Number(JsonElement? e) => e switch
    {
        { ValueKind: JsonValueKind.Number } n => n.GetDouble(),
        { ValueKind: JsonValueKind.String } s when double.TryParse(s.GetString(), out var d) => d,
        { ValueKind: JsonValueKind.True } => 1,
        _ => 0,
    };

    private static bool Yes(JsonElement? e) => Number(e) > 0;

    private sealed record Page([property: JsonPropertyName("hits")] HitList Hits);

    private sealed record HitList([property: JsonPropertyName("hits")] List<Hit> Hits);

    private sealed record Hit(
        [property: JsonPropertyName("_id")] string Id,
        [property: JsonPropertyName("_source")] Source Source,
        [property: JsonPropertyName("sort")] object[] Sort);

    private sealed record Source(
        [property: JsonPropertyName("Fr_Units")] List<UnitRef>? FrUnits,
        [property: JsonPropertyName("Fr_Units_Involved")] string? Involved,
        [property: JsonPropertyName("Unit_Task")] string? UnitTask,
        [property: JsonPropertyName("Arty_Incid")] JsonElement? ArtyIncid,
        [property: JsonPropertyName("No_Arty_Mor_Strikes")] JsonElement? Strikes,
        [property: JsonPropertyName("Artillery")] JsonElement? Artillery,
        [property: JsonPropertyName("Arty_Mor_in_Spt")] JsonElement? ArtyInSupport,
        [property: JsonPropertyName("APCs")] JsonElement? Apcs,
        [property: JsonPropertyName("Tanks")] JsonElement? Tanks,
        [property: JsonPropertyName("Air_Support")] JsonElement? AirSupport);

    private sealed record UnitRef([property: JsonPropertyName("_id")] int Id);
}
