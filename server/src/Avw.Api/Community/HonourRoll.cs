using System.Linq.Expressions;
using System.Text.Json;
using Avw.Api.Media;
using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Avw.Api.Community;

/// <summary>
/// One line of the honour roll: who they were and when they died. <c>Name</c> reads naturally ("James Mungo White"); <c>SortName</c> is
/// the way a roll is written ("White, James Mungo").
/// </summary>
public sealed record HonourSummary(
    string ServiceNumber,
    string Name,
    string? Rank,
    string? Branch,
    DateOnly? Birth,
    DateOnly? Death,
    int? AgeAtDeath,
    string? PortraitUrl,
    string? SortName = null);

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

/// <summary>What to restrict the roll to. A blank value is no restriction; each value is matched as a whole.</summary>
public sealed record HonourFilter(string? Service = null, string? Rank = null, string? Corps = null)
{
    public static readonly HonourFilter None = new();
}

/// <summary>One choice in a drop-down, and how many people it would leave.</summary>
public sealed record HonourFacetOption(string Value, int Count);

/// <summary>
/// The choices for each drop-down. Each is counted with the other two filters and the search text applied but not its own, so
/// choosing Navy leaves only the Navy's ranks and corps, and the service list still shows what the others would give.
/// </summary>
public sealed record HonourFacets(
    IReadOnlyList<HonourFacetOption> Services, IReadOnlyList<HonourFacetOption> Ranks, IReadOnlyList<HonourFacetOption> Corps);

public sealed record HonourPage(IReadOnlyList<HonourSummary> Items, long Total, int Page, int PageSize, HonourFacets? Facets = null);

/// <summary>People on the nominal roll who died in service.</summary>
public interface IHonourRollSource
{
    /// <summary>The roll by surname, restricted by the words typed and the filter, with the drop-down choices if asked for.</summary>
    Task<HonourPage> SearchAsync(string? text, HonourFilter filter, bool withFacets, int page, int pageSize, CancellationToken ct);

    /// <summary>One person by service number, or <c>null</c> if the roll has nobody with that number who died.</summary>
    Task<HonourPerson?> GetAsync(string serviceNumber, CancellationToken ct);

    Task<IReadOnlyList<HonourSummary>> GetManyAsync(IReadOnlyCollection<string> serviceNumbers, CancellationToken ct);
}

/// <summary>
/// The roll as MySQL holds it (imported by <c>Avw.Migrator import-roll</c>): names are found with the full-text index, and the database does the
/// sorting, filtering, counting and paging, so nothing is kept in the application and Elasticsearch is not asked at all.
/// </summary>
public sealed class HonourRollStore(AvwDbContext db, IOptions<MediaOptions> media) : IHonourRollSource
{
    public const int MaxPageSize = 50;

    /// <summary>More words than this in a search are ignored, so a pasted paragraph cannot build an enormous query.</summary>
    public const int MaxSearchWords = 8;

    /// <summary>
    /// The words to look for in what a person typed: in lower case, split at anything that is not a letter or a digit (so
    /// <c>MC DONALD-SMITH</c> is three words, as it is in the index), and no more than <see cref="MaxSearchWords"/> of them.
    /// </summary>
    public static IReadOnlyList<string> SearchWords(string? text) => HonourRollRows.Words(text).Take(MaxSearchWords).ToList();

    public async Task<HonourPage> SearchAsync(string? text, HonourFilter filter, bool withFacets, int page, int pageSize, CancellationToken ct)
    {
        page = Math.Clamp(page, 1, 200);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);
        var named = Named(SearchWords(text));
        var found = Restrict(named, filter, Facet.None);

        var total = await found.CountAsync(ct);
        var rows = await found.OrderBy(p => p.SortKey).ThenBy(p => p.ServiceNumber).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return new HonourPage(rows.Select(ToSummary).ToList(), total, page, pageSize, withFacets ? await FacetsAsync(named, filter, ct) : null);
    }

    public async Task<HonourPerson?> GetAsync(string serviceNumber, CancellationToken ct)
    {
        var number = serviceNumber.Trim();
        var row = await db.HonourRoll.AsNoTracking().FirstOrDefaultAsync(p => p.ServiceNumber == number, ct);
        if (row is null)
        {
            return null;
        }

        var summary = ToSummary(row);
        return new HonourPerson(
            summary.ServiceNumber, summary.Name, summary.Rank, summary.Branch, summary.Birth, summary.Death, summary.AgeAtDeath, summary.PortraitUrl,
            HonourRollRows.Place(row.BirthPlace), HonourRollRows.Place(row.BirthState), HonourRollRows.Place(row.BirthCountry), row.NationalService, Tours(row.Tours), [], 0);
    }

    public async Task<IReadOnlyList<HonourSummary>> GetManyAsync(IReadOnlyCollection<string> serviceNumbers, CancellationToken ct)
    {
        if (serviceNumbers.Count == 0)
        {
            return [];
        }

        var wanted = serviceNumbers.ToList();
        var rows = await db.HonourRoll.AsNoTracking().Where(p => wanted.Contains(p.ServiceNumber)).ToListAsync(ct);
        return rows.Select(ToSummary).OrderBy(p => p.Death).ThenBy(p => p.Name).ToList();
    }

    // ---- searching

    /// <summary>
    /// The people each of whose words starts a word of a name or of the service number, so "will smi" finds William Smith with the words
    /// in different names. Words the full-text index can hold are found with it; a shorter word (at least three letters are indexed) or a
    /// stop word such as "will" is looked for in the text itself, which at about 520 people costs nothing.
    /// </summary>
    private IQueryable<HonourRollPerson> Named(IReadOnlyList<string> words)
    {
        // The in-memory database used by tests has no full-text index, so there every word is looked for in the text.
        var indexed = db.Database.IsRelational() ? words.Where(SearchTerms.CanBeIndexed).ToList() : [];
        IQueryable<HonourRollPerson> query = db.HonourRoll;
        if (indexed.Count > 0)
        {
            var boolean = string.Join(' ', indexed.Select(w => $"+{w}*"));      // only letters and digits, so no operator can be typed in
            query = db.HonourRoll.FromSql($"SELECT * FROM honour_roll WHERE MATCH(SearchText) AGAINST ({boolean} IN BOOLEAN MODE)");
        }

        foreach (var word in words.Except(indexed))
        {
            var startOfAWord = " " + word;
            query = query.Where(p => p.SearchText.Contains(startOfAWord));
        }

        return query.AsNoTracking();
    }

    // ---- filtering

    private enum Facet { None, Service, Rank, Corps }

    private static string? Chosen(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static IQueryable<HonourRollPerson> Restrict(IQueryable<HonourRollPerson> query, HonourFilter filter, Facet skip)
    {
        var service = Chosen(filter.Service);
        var rank = Chosen(filter.Rank);
        var corps = Chosen(filter.Corps);
        // A service in any case is the service ("air force"); anything else is left to find nobody.
        service = HonourRollRows.Services.FirstOrDefault(s => string.Equals(s, service, StringComparison.OrdinalIgnoreCase)) ?? service;
        if (skip != Facet.Service && service is not null)
        {
            query = query.Where(p => p.Service == service);
        }

        if (skip != Facet.Rank && rank is not null)
        {
            query = query.Where(p => p.Rank == rank);
        }

        if (skip != Facet.Corps && corps is not null)
        {
            query = query.Where(p => p.Corps == corps);
        }

        return query;
    }

    private async Task<HonourFacets> FacetsAsync(IQueryable<HonourRollPerson> named, HonourFilter filter, CancellationToken ct)
    {
        async Task<List<HonourFacetOption>> Count(Facet facet, Expression<Func<HonourRollPerson, string?>> field, string? chosen, IComparer<string> order)
        {
            var groups = await Restrict(named, filter, facet).Select(field).Where(v => v != null).GroupBy(v => v!)
                .Select(g => new { Value = g.Key, Count = g.Count() }).ToListAsync(ct);
            var options = groups.ToDictionary(g => g.Value, g => g.Count, StringComparer.OrdinalIgnoreCase);
            if (Chosen(chosen) is { } picked && !options.ContainsKey(picked))
            {
                options[picked] = 0;                            // a choice already made stays in its list, even when nothing is left under it
            }

            return options.OrderBy(o => o.Key, order).Select(o => new HonourFacetOption(o.Key, o.Value)).ToList();
        }

        var byRank = Comparer<string>.Create((a, b) =>
        {
            var c = StringComparer.InvariantCultureIgnoreCase.Compare(HonourRollRows.RankSortKey(a), HonourRollRows.RankSortKey(b));
            return c != 0 ? c : a.Length != b.Length ? a.Length - b.Length : StringComparer.InvariantCultureIgnoreCase.Compare(a, b);      // the plain rank before its temporary or acting one
        });
        var byService = Comparer<string>.Create((a, b) => Array.IndexOf(HonourRollRows.Services, a) - Array.IndexOf(HonourRollRows.Services, b));
        return new HonourFacets(
            await Count(Facet.Service, p => p.Service, filter.Service, byService),
            await Count(Facet.Rank, p => p.Rank, filter.Rank, byRank),
            await Count(Facet.Corps, p => p.Corps, filter.Corps, StringComparer.InvariantCultureIgnoreCase));
    }

    // ---- shaping

    private HonourSummary ToSummary(HonourRollPerson p) =>
        new(p.ServiceNumber, p.Name, p.Rank, p.Corps, p.BirthDate, p.DeathDate,
            p.BirthDate is not null && p.DeathDate is not null ? Analytics.Charts.AgeOn(p.BirthDate.Value, p.DeathDate.Value) : null, PortraitFor(p.ServiceNumber), p.SortName);

    private static List<HonourTour> Tours(string json)
    {
        try
        {
            return (JsonSerializer.Deserialize<List<RollTour>>(json) ?? []).Select(t => new HonourTour(t.Unit, t.Start, t.End)).ToList();
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>The portrait's address, if a file for this service number has been put in the media folder's <c>portraits</c> folder.</summary>
    private string? PortraitFor(string serviceNumber) =>
        serviceNumber.Length > 0 && serviceNumber.All(c => char.IsLetterOrDigit(c) || c is '-' or '_')
        && File.Exists(Path.Combine(media.Value.RootPath, "portraits", serviceNumber + ".jpg"))
            ? $"/media/portraits/{serviceNumber}.jpg"
            : null;
}
