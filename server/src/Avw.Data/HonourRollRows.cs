using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Avw.Data.Entities;

namespace Avw.Data;

/// <summary>A person as the legacy nominal roll (the <c>avw_nomroll</c> index in Elasticsearch) records them. Only read, to import the roll.</summary>
public sealed record NomRollRecord(
    [property: JsonPropertyName("ServiceNumber")] string? ServiceNumber,
    [property: JsonPropertyName("FirstName")] string? FirstName,
    [property: JsonPropertyName("SecondName")] string? SecondName,
    [property: JsonPropertyName("ThirdName")] string? ThirdName,
    [property: JsonPropertyName("LastName")] string? LastName,
    [property: JsonPropertyName("Rank")] string? Rank,
    [property: JsonPropertyName("Branch")] string? Branch,
    [property: JsonPropertyName("NationalService")] bool? NationalService,
    [property: JsonPropertyName("Birth")] NomRollBirth? Birth,
    [property: JsonPropertyName("Death")] NomRollDeath? Death,
    [property: JsonPropertyName("Tours")] List<NomRollTour>? Tours);

public sealed record NomRollBirth(
    [property: JsonPropertyName("Date")] string? Date, [property: JsonPropertyName("Place")] string? Place,
    [property: JsonPropertyName("State")] string? State, [property: JsonPropertyName("Country")] string? Country);

public sealed record NomRollDeath([property: JsonPropertyName("Date")] string? Date);

public sealed record NomRollTour(
    [property: JsonPropertyName("Unit")] string? Unit, [property: JsonPropertyName("StartDate")] string? StartDate,
    [property: JsonPropertyName("EndDate")] string? EndDate);

/// <summary>A tour of duty as the roll table holds it (in JSON): the names are those the API answers with.</summary>
public sealed record RollTour(string? Unit, string? Start, string? End);

/// <summary>
/// The rules that turn a record of the legacy roll into a row of the <c>honour_roll</c> table, which is where the roll lives from then on,
/// and the small pieces of them that searching the table needs: which words there are in a name, and how ranks are ordered.
/// </summary>
public static class HonourRollRows
{
    public const string Army = "Army";
    public const string Navy = "Navy";
    public const string AirForce = "Air Force";

    /// <summary>The services in the order they are offered.</summary>
    public static readonly string[] Services = [Army, Navy, AirForce];

    // The legacy roll holds no field for the service, so it is read from the corps and the rank. The corps is the surer of the two: it is
    // set for those who served at sea or in the air on the same forms as the Army's, and is not for ranks such as Lieutenant that
    // more than one service has.
    private static readonly HashSet<string> NavyCorps = new(StringComparer.OrdinalIgnoreCase)
    {
        "Seaman", "Naval Airman", "Electrical", "Supplementary List Seaman Branch",
    };

    private static readonly HashSet<string> AirForceCorps = new(StringComparer.OrdinalIgnoreCase) { "General Duties" };

    private static readonly Regex AirForceRank = new(
        @"aircraft(wo)?man|pilot officer|flying officer|flight (lieutenant|sergeant)|squadron leader|wing commander|group captain|air (commodore|vice|marshal)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex NavyRank = new(
        @"seaman|sub-lieutenant|lieutenant-commander|petty officer|commander|midshipman|coxswain|stoker|electrician|artificer|chief (writer|steward)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex Qualifier = new(@"^\((temporary|acting)\)\s*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex NotWord = new(@"[^\p{L}\p{N}]+", RegexOptions.CultureInvariant);

    /// <summary>Which service someone belonged to, or <c>null</c> when neither the corps nor the rank was recorded.</summary>
    public static string? ServiceOf(string? rank, string? corps)
    {
        if (corps is not null && NavyCorps.Contains(corps))
        {
            return Navy;
        }

        if (corps is not null && AirForceCorps.Contains(corps))
        {
            return AirForce;
        }

        if (rank is not null && AirForceRank.IsMatch(rank))
        {
            return AirForce;
        }

        if (rank is not null && NavyRank.IsMatch(rank))
        {
            return Navy;
        }

        return rank is null && corps is null ? null : Army;
    }

    /// <summary>The words in some text: lower case, split at anything that is not a letter or a digit.</summary>
    public static string[] Words(string? text) => NotWord.Split((text ?? "").Trim().ToLowerInvariant()).Where(w => w.Length > 0).Distinct().ToArray();

    /// <summary>Ranks sort without their "(Temporary)" or "(Acting)", so Captain and (Temporary) Captain sit together.</summary>
    public static string RankSortKey(string rank) => Qualifier.Replace(rank, "");

    /// <summary>The row for a record, or <c>null</c> when it is not of someone who died (this is the roll of those who did) or has no service number.</summary>
    public static HonourRollPerson? From(NomRollRecord s)
    {
        var death = TryParseDate(s.Death?.Date);
        var number = s.ServiceNumber?.Trim() ?? "";
        if (death is null || number.Length == 0)
        {
            return null;
        }

        var rank = Clean(s.Rank);
        var corps = Clean(s.Branch);
        var given = string.Join(' ', new[] { s.FirstName, s.SecondName, s.ThirdName }.Where(n => !string.IsNullOrWhiteSpace(n)).Select(n => Tidy(n!.Trim())));
        var family = string.IsNullOrWhiteSpace(s.LastName) ? "" : CultureInfo.InvariantCulture.TextInfo.ToTitleCase(s.LastName.Trim().ToLowerInvariant());
        var sortName = family.Length == 0 ? given : given.Length == 0 ? family : $"{family}, {given}";
        var tours = (s.Tours ?? []).Select(t => new RollTour(Clean(t.Unit), Clean(t.StartDate), Clean(t.EndDate))).ToList();

        return new HonourRollPerson
        {
            ServiceNumber = Cap(number, 32)!,
            Name = Cap($"{given} {family}".Trim(), 300)!,
            SortName = Cap(sortName, 300)!,
            SortKey = Cap(sortName.ToLowerInvariant(), 300)!,
            Rank = Cap(rank, 100),
            Corps = Cap(corps, 150),
            Service = ServiceOf(rank, corps),
            BirthDate = TryParseDate(s.Birth?.Date),
            DeathDate = death,
            BirthPlace = Cap(Clean(s.Birth?.Place), 150),
            BirthState = Cap(Clean(s.Birth?.State), 100),
            BirthCountry = Cap(Clean(s.Birth?.Country), 100),
            NationalService = s.NationalService,
            Tours = JsonSerializer.Serialize(tours),
            SearchText = Cap(" " + string.Join(' ', Words($"{given} {family} {number}")) + " ", 500)!,
        };
    }

    /// <summary>Reads <c>2026-09-20</c>, <c>2026-09-20T01:02:03</c> and the roll's <c>20/09/2026</c> forms; anything else is no date.</summary>
    public static DateOnly? TryParseDate(string? text)
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

    /// <summary>A name held wholly in capitals ("DENNIS ERIC") is set in the usual way ("Dennis Eric"); one already in mixed case is left as it is.</summary>
    private static string Tidy(string name) => name.Any(char.IsLower) ? name : CultureInfo.InvariantCulture.TextInfo.ToTitleCase(name.ToLowerInvariant());

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string? Cap(string? value, int length) => value is { } v && v.Length > length ? v[..length] : value;
}
