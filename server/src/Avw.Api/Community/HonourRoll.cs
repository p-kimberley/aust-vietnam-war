using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Avw.Api.Analytics;
using Avw.Api.Map;
using Avw.Api.Media;
using Microsoft.Extensions.Options;

namespace Avw.Api.Community;

/// <summary>One line of the honour roll: who they were and when they died.</summary>
public sealed record HonourSummary(
    string ServiceNumber,
    string Name,
    string? Rank,
    string? Branch,
    DateOnly? Birth,
    DateOnly? Death,
    int? AgeAtDeath,
    string? PortraitUrl);

public sealed record HonourTour(string? Unit, string? Start, string? End);

public sealed record HonourPerson(
    string ServiceNumber,
    string Name,
    string? Rank,
    string? Branch,
    DateOnly? Birth,
    DateOnly? Death,
    int? AgeAtDeath,
    string? PortraitUrl,
    string? BirthPlace,
    string? BirthState,
    string? BirthCountry,
    bool? NationalService,
    IReadOnlyList<HonourTour> Tours,
    IReadOnlyList<int> Incidents,
    int Tributes);

public sealed record HonourPage(IReadOnlyList<HonourSummary> Items, long Total, int Page, int PageSize);

/// <summary>People on the nominal roll who died in service, as recorded in Elasticsearch.</summary>
public interface IHonourRollSource
{
    Task<HonourPage> SearchAsync(string? text, int page, int pageSize, CancellationToken ct);

    /// <summary>One person by service number, or <c>null</c> if the roll has nobody with that number who died.</summary>
    Task<HonourPerson?> GetAsync(string serviceNumber, CancellationToken ct);

    Task<IReadOnlyList<HonourSummary>> GetManyAsync(IReadOnlyCollection<string> serviceNumbers, CancellationToken ct);
}

public sealed class ElasticsearchHonourRoll(
    HttpClient http, IOptions<ElasticsearchOptions> options, IOptions<MediaOptions> media) : IHonourRollSource
{
    private static readonly JsonSerializerOptions RequestJson = new() { PropertyNamingPolicy = null };
    private static readonly string[] NameFields = ["FirstName", "SecondName", "ThirdName", "LastName", "ServiceNumber"];

    public const int MaxPageSize = 50;

    public async Task<HonourPage> SearchAsync(string? text, int page, int pageSize, CancellationToken ct)
    {
        page = Math.Clamp(page, 1, 200);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);
        var must = new List<object> { new { exists = new { field = "Death.Date" } } };
        if (!string.IsNullOrWhiteSpace(text))
        {
            must.Add(new { multi_match = new { query = text.Trim(), fields = NameFields, type = "cross_fields", @operator = "and" } });
        }

        var body = new
        {
            from = (page - 1) * pageSize,
            size = pageSize,
            track_total_hits = true,
            query = new { @bool = new { must } },
            sort = new object[] { new Dictionary<string, string> { ["Death.Date"] = "asc" }, new Dictionary<string, string> { ["ServiceNumber.keyword"] = "asc" } },
        };

        var res = await SearchRawAsync(body, ct);
        return new HonourPage(res.Hits.Hits.Select(h => ToSummary(h.Source)).ToList(), res.Hits.Total.Value, page, pageSize);
    }

    public async Task<HonourPerson?> GetAsync(string serviceNumber, CancellationToken ct)
    {
        var res = await SearchRawAsync(new { size = 1, query = ByServiceNumber([serviceNumber]) }, ct);
        var s = res.Hits.Hits.FirstOrDefault()?.Source;
        if (s is null || s.Death?.Date is null)
        {
            return null;
        }

        var summary = ToSummary(s);
        return new HonourPerson(
            summary.ServiceNumber, summary.Name, summary.Rank, summary.Branch, summary.Birth, summary.Death, summary.AgeAtDeath, summary.PortraitUrl,
            Clean(s.Birth?.Place), Clean(s.Birth?.State), Clean(s.Birth?.Country), s.NationalService,
            (s.Tours ?? []).Select(t => new HonourTour(Clean(t.Unit), Clean(t.StartDate), Clean(t.EndDate))).ToList(), [], 0);
    }

    public async Task<IReadOnlyList<HonourSummary>> GetManyAsync(IReadOnlyCollection<string> serviceNumbers, CancellationToken ct)
    {
        if (serviceNumbers.Count == 0)
        {
            return [];
        }

        var res = await SearchRawAsync(new { size = Math.Min(serviceNumbers.Count, 200), query = ByServiceNumber(serviceNumbers) }, ct);
        return res.Hits.Hits.Select(h => ToSummary(h.Source)).OrderBy(p => p.Death).ThenBy(p => p.Name).ToList();
    }

    private static object ByServiceNumber(IEnumerable<string> numbers) =>
        new { @bool = new { filter = new object[] { new { terms = new Dictionary<string, string[]> { ["ServiceNumber.keyword"] = numbers.ToArray() } }, new { exists = new { field = "Death.Date" } } } } };

    private async Task<SearchResult> SearchRawAsync(object body, CancellationToken ct)
    {
        using var res = await http.PostAsJsonAsync($"{Uri.EscapeDataString(options.Value.PersonnelIndex)}/_search", body, RequestJson, ct);
        if (!res.IsSuccessStatusCode)
        {
            var detail = await res.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException($"Elasticsearch answered {(int)res.StatusCode}: {(detail.Length > 300 ? detail[..300] : detail)}");
        }

        return await res.Content.ReadFromJsonAsync<SearchResult>(ct) ?? throw new InvalidOperationException("Elasticsearch returned an empty response.");
    }

    private HonourSummary ToSummary(PersonSource s)
    {
        var birth = ElasticsearchAnalyticsSource.TryParseDate(s.Birth?.Date);
        var death = ElasticsearchAnalyticsSource.TryParseDate(s.Death?.Date);
        var sn = s.ServiceNumber?.Trim() ?? "";
        return new HonourSummary(sn, DisplayName(s), Clean(s.Rank), Clean(s.Branch), birth, death,
            birth is not null && death is not null ? Analytics.Charts.AgeOn(birth.Value, death.Value) : null, PortraitFor(sn));
    }

    /// <summary>The portrait's address, if a file for this service number has been put in the media folder's <c>portraits</c> folder.</summary>
    private string? PortraitFor(string serviceNumber) =>
        serviceNumber.Length > 0 && serviceNumber.All(c => char.IsLetterOrDigit(c) || c is '-' or '_')
        && File.Exists(Path.Combine(media.Value.RootPath, "portraits", serviceNumber + ".jpg"))
            ? $"/media/portraits/{serviceNumber}.jpg"
            : null;

    public static string DisplayName(PersonSource s)
    {
        var given = string.Join(' ', new[] { s.FirstName, s.SecondName, s.ThirdName }.Where(n => !string.IsNullOrWhiteSpace(n)).Select(n => n!.Trim()));
        var family = string.IsNullOrWhiteSpace(s.LastName) ? "" : CultureInfo.InvariantCulture.TextInfo.ToTitleCase(s.LastName.Trim().ToLowerInvariant());
        return $"{given} {family}".Trim();
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    // ---- response shapes

    private sealed record Total([property: JsonPropertyName("value")] long Value);

    private sealed record Hit([property: JsonPropertyName("_source")] PersonSource Source);

    private sealed record HitList([property: JsonPropertyName("total")] Total Total, [property: JsonPropertyName("hits")] List<Hit> Hits);

    private sealed record SearchResult([property: JsonPropertyName("hits")] HitList Hits);

    public sealed record PersonSource(
        [property: JsonPropertyName("ServiceNumber")] string? ServiceNumber,
        [property: JsonPropertyName("FirstName")] string? FirstName,
        [property: JsonPropertyName("SecondName")] string? SecondName,
        [property: JsonPropertyName("ThirdName")] string? ThirdName,
        [property: JsonPropertyName("LastName")] string? LastName,
        [property: JsonPropertyName("Rank")] string? Rank,
        [property: JsonPropertyName("Branch")] string? Branch,
        [property: JsonPropertyName("NationalService")] bool? NationalService,
        [property: JsonPropertyName("Birth")] BirthSource? Birth,
        [property: JsonPropertyName("Death")] DeathSource? Death,
        [property: JsonPropertyName("Tours")] List<TourSource>? Tours);

    public sealed record BirthSource(
        [property: JsonPropertyName("Date")] string? Date, [property: JsonPropertyName("Place")] string? Place,
        [property: JsonPropertyName("State")] string? State, [property: JsonPropertyName("Country")] string? Country);

    public sealed record DeathSource([property: JsonPropertyName("Date")] string? Date);

    public sealed record TourSource(
        [property: JsonPropertyName("Unit")] string? Unit, [property: JsonPropertyName("StartDate")] string? StartDate,
        [property: JsonPropertyName("EndDate")] string? EndDate);
}
