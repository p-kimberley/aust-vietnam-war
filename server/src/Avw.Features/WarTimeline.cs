using System.Globalization;
using Avw.Api.Map;

namespace Avw.Features;

// The War Timeline's facts (content/features/war-timeline/facts.json): what the contacts show, month by month and operation by
// operation, for the narratives to be written from and the page to show. Every figure here is worked out from the data; nothing is
// typed by hand. See docs/war-timeline-plan.md.

/// <param name="Months">Every month with a contact, in order.</param>
/// <param name="Operations">The operations with enough contacts for a place of their own on the timeline (see
/// <see cref="WarTimelineBuilder.OperationMinContacts"/>), in order of their first contact.</param>
/// <param name="Routine">The names recorded as operations that are really continuing activities (patrolling the Task Force's area,
/// long-range patrols, unknown), counted in their months, not as operations.</param>
/// <param name="Phases">The war's phases (phases.csv), each with its figures and its Battle Map link.</param>
public sealed record TimelineFacts(
    string From, string To, int Contacts, IReadOnlyList<PhaseFacts> Phases, IReadOnlyList<MonthFacts> Months,
    IReadOnlyList<OperationTimeline> Operations, IReadOnlyList<TimelineUnit> Units, IReadOnlyList<string> Routine);

/// <summary>A unit with a history, as the timeline names it.</summary>
/// <param name="MapUnits">The Battle Map's unit filter for exactly the unit's units (with those nested under it, without those
/// left out): node ids, each meaning the node and everything under it, or, with a <c>!</c> after it, the node alone.</param>
/// <param name="Recorded">How many contacts the Battle Map shows for that filter: the contacts as recorded. It differs from the
/// unit's count where contacts filed against the wrong unit were put right (see the unit histories), which a filter cannot do.</param>
public sealed record TimelineUnit(string Slug, string Short, string Title, string Arm, int UnitId, string MapUnits, int Contacts, int Recorded);

/// <summary>A phase of the war, as phases.csv sets it out: its dates, and the units or data series it is about, if it is about some.</summary>
/// <param name="Units">The history units it is about (their slugs); empty where it is about the whole force.</param>
/// <param name="Series">The data series it is about (the Battle Map's "Data source": 1ATF, or 1RAR for 1 RAR's tour with the US
/// 173rd Airborne Brigade), or null for all.</param>
public sealed record PhaseRow(string Slug, string Title, string From, string To, IReadOnlyList<string> Units, string? Series);

/// <param name="Contacts">Its contacts, as the timeline counts them (its units' after corrections); <paramref name="Recorded"/> as
/// the Battle Map link shows them.</param>
/// <param name="MapUrl">The Battle Map over its dates, with its units and data series.</param>
public sealed record PhaseFacts(
    string Slug, string Title, string From, string To, IReadOnlyList<string> UnitSlugs, string? Series, int Contacts, int Recorded,
    Casualties Casualties, IReadOnlyList<TaskCount> Tasks, IReadOnlyList<UnitCount> Units, IReadOnlyList<OperationCount> Operations,
    string MapUrl, string Fingerprint = "");

/// <param name="Month"><c>yyyy-MM</c>.</param>
/// <param name="Operations">The operations with contacts this month, largest first (with those too small for a place of their own).</param>
/// <param name="Routine">This month's contacts in continuing activities, not operations.</param>
/// <param name="Unassigned">This month's contacts with no operation recorded.</param>
/// <param name="MapUrl">The Battle Map over the month.</param>
/// <param name="Fingerprint">Of the figures a narrative is written from (see <see cref="WarTimelineBuilder.Fingerprint"/>).</param>
public sealed record MonthFacts(
    string Month, int Contacts, Casualties Casualties, IReadOnlyList<TaskCount> Tasks, IReadOnlyList<UnitCount> Units,
    IReadOnlyList<OperationCount> Operations, int Routine, int Unassigned, IReadOnlyList<TimelineContact> Notable, string MapUrl,
    string Fingerprint = "");

/// <param name="Slug">The operation's address on the timeline.</param>
/// <param name="Recorded">The names the record gives it (its spellings, and names it shared: see operations.csv).</param>
/// <param name="From">The first day (<c>yyyy-MM-dd</c>) of its main run of contacts; <paramref name="To"/> the last. A run ends where
/// <see cref="WarTimelineBuilder.RunGapDays"/> pass without a contact, so a name used again much later, or mistyped, does not
/// stretch it.</param>
/// <param name="Outside">Its contacts outside that run, counted in its figures but not its dates (to check).</param>
/// <param name="MapUrl">The Battle Map filtered to the operation.</param>
public sealed record OperationTimeline(
    string Slug, string Name, IReadOnlyList<string> Recorded, string From, string To, int Outside, int Contacts, Casualties Casualties,
    IReadOnlyList<TaskCount> Tasks, IReadOnlyList<UnitCount> Units, IReadOnlyList<TimelineContact> Notable, string MapUrl,
    string Fingerprint = "");

public sealed record Casualties(int FrKia, int FrWia, int EnKia, int EnWia);

public sealed record TaskCount(string Task, int Contacts);

/// <param name="Led">How many of them the unit (or one of its own) was the unit in contact.</param>
public sealed record UnitCount(string Slug, int Contacts, int Led);

/// <param name="Slug">The operation's slug where it has a place of its own on the timeline, else null.</param>
public sealed record OperationCount(string Name, string? Slug, int Contacts);

/// <param name="Unit">The history unit in contact (its slug), or null where it is none of them.</param>
/// <param name="UnitLabel">The unit in contact, as the Battle Map's unit tree names it.</param>
/// <param name="Summary">The report in plain English (the index's <c>Incident_Summary</c>), or null where there is none.</param>
public sealed record TimelineContact(
    int Id, string Date, string? Unit, string UnitLabel, string? Task, string? Operation, Casualties Casualties, string? Summary,
    string MapUrl);

/// <param name="aliases">The operations' names by the names the record gives them (operations.csv), compared without case; a name
/// not there is its own.</param>
/// <param name="recorded">The contacts as recorded (before the unit histories' corrections): what the Battle Map filters.</param>
/// <param name="phases">The war's phases (phases.csv), in order.</param>
public sealed class WarTimelineBuilder(
    UnitsTable table, FactSheetBuilder facts, FilterCatalogue catalogue, IReadOnlyDictionary<string, string> aliases,
    IReadOnlyList<ContactSummary> recorded, IReadOnlyList<PhaseRow> phases)
{
    /// <summary>
    /// An operation gets a place of its own on the timeline from this many contacts, or from these casualties (so a short, costly
    /// one such as Long Tan's is not lost among the months); others are counted in their months.
    /// </summary>
    public const int OperationMinContacts = 20;
    public const int OperationMinFrKia = 3;
    public const int OperationMinEnKia = 25;

    /// <summary>A gap of this many days without a contact ends an operation's run (see <see cref="OperationTimeline.From"/>).</summary>
    public const int RunGapDays = 45;

    /// <summary>How many of a month's most significant contacts are kept; and of an operation's.</summary>
    public const int MonthNotable = 6;
    public const int OperationNotable = 8;

    /// <summary>Names recorded as operations that are continuing activities, not operations (compared without case or spacing).</summary>
    public static readonly IReadOnlySet<string> RoutineNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "LRRP", "TAOR", "TAOR patrol", "U/K", "Unknown", "na", "n/a",
    };

    private readonly Dictionary<int, UnitNode> _nodes = catalogue.Units.ToDictionary(u => u.Id);
    private readonly List<(UnitRow Row, IReadOnlySet<int> Subtree)> _histories =
        table.Histories.Select(h => (h, facts.Subtree(h.UnitId))).ToList();

    /// <summary>An operation's name as one thing: trimmed, with runs of spaces made one ("Cung  Chung 3" is "Cung Chung 3").</summary>
    public static string OperationName(string name) => string.Join(' ', name.Split(' ', StringSplitOptions.RemoveEmptyEntries));

    /// <summary>
    /// The war's phases, from phases.csv: a header, then <c>slug,title,from,to,units,series</c>, the dates as <c>yyyy-MM-dd</c> and
    /// the units the history units' slugs separated by semicolons (empty for the whole force).
    /// </summary>
    public static IReadOnlyList<PhaseRow> ParsePhases(string csv) =>
        Csv.Read(csv).Skip(1).Where(f => f.Count >= 4 && f[0].Trim().Length > 0)
            .Select(f => new PhaseRow(
                f[0].Trim(), f[1].Trim(), f[2].Trim(), f[3].Trim(),
                f.Count > 4 ? f[4].Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) : [],
                f.Count > 5 && f[5].Trim().Length > 0 ? f[5].Trim() : null))
            .ToList();

    /// <summary>The operations' names by the record's names, from operations.csv (a header, then <c>name,recorded</c>, the recorded
    /// names separated by semicolons).</summary>
    public static IReadOnlyDictionary<string, string> ParseAliases(string csv)
    {
        var aliases = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var fields in Csv.Read(csv).Skip(1).Where(f => f.Count >= 2 && f[0].Trim().Length > 0))
        {
            foreach (var recorded in fields[1].Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                aliases[OperationName(recorded)] = OperationName(fields[0]);
            }
        }

        return aliases;
    }

    public static bool IsRoutine(string name) => RoutineNames.Contains(OperationName(name));

    /// <summary>The contacts whose reports the facts show: each month's and each operation's most significant.</summary>
    public IReadOnlyCollection<int> Candidates() =>
        Months().SelectMany(m => Top(m.Contacts, MonthNotable)).Concat(Operations().SelectMany(o => Top(o.Contacts, OperationNotable)))
            .Select(c => c.Id).ToHashSet();

    /// <summary>
    /// A fingerprint of what a narrative is written from: the first 12 hex digits of the SHA-256 of its dates, figures, units, tasks,
    /// operations and notable contacts (with their summaries). A narrative keeps the fingerprint it was written from, so one written
    /// from facts that have since changed can be found and reviewed.
    /// </summary>
    public static string Fingerprint(params object?[] parts)
    {
        var text = System.Text.Json.JsonSerializer.Serialize(parts);
        return Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(text)))[..12];
    }

    public TimelineFacts Build(IReadOnlyDictionary<int, ContactDetail> reports)
    {
        var built = BuildFacts(reports);
        return built with
        {
            Phases = built.Phases.Select(p => p with { Fingerprint = Fingerprint(p.From, p.To, p.Contacts, p.Casualties, p.Tasks, p.Units, p.Operations) }).ToList(),
            Months = built.Months.Select(m => m with { Fingerprint = Fingerprint(m.Month, m.Contacts, m.Casualties, m.Tasks, m.Units, m.Operations, m.Notable) }).ToList(),
            Operations = built.Operations.Select(o => o with { Fingerprint = Fingerprint(o.From, o.To, o.Contacts, o.Casualties, o.Tasks, o.Units, o.Notable) }).ToList(),
        };
    }

    private TimelineFacts BuildFacts(IReadOnlyDictionary<int, ContactDetail> reports)
    {
        var operations = Operations().ToList();
        var placed = operations.ToDictionary(o => o.Name, o => o.Slug);
        var months = Months().Select(m => new MonthFacts(
                m.Month, m.Contacts.Count, CasualtiesOf(m.Contacts), TasksOf(m.Contacts), UnitsOf(m.Contacts),
                m.Contacts.Where(c => OpName(c) is { } n && !IsRoutine(n)).GroupBy(c => OpName(c)!)
                    .Select(g => new OperationCount(g.Key, placed.GetValueOrDefault(g.Key), g.Count()))
                    .OrderByDescending(o => o.Contacts).ThenBy(o => o.Name, StringComparer.Ordinal).ToList(),
                m.Contacts.Count(c => OpName(c) is { } n && IsRoutine(n)),
                m.Contacts.Count(c => OpName(c) is null),
                Top(m.Contacts, MonthNotable).Select(c => Contact(c, reports)).ToList(),
                $"/battlemap?from={m.Month}-01&to={LastDay(m.Month)}"))
            .ToList();
        var all = facts.Contacts;
        return new TimelineFacts(
            Day(all.Min(c => c.Dtg)!), Day(all.Max(c => c.Dtg)!), all.Count, phases.Select(p => Phase(p, placed)).ToList(), months,
            operations.Select(o => new OperationTimeline(
                    o.Slug, o.Name, o.Recorded.Order(StringComparer.Ordinal).ToList(), Day(o.Run.Min(c => c.Dtg)!), Day(o.Run.Max(c => c.Dtg)!),
                    o.Contacts.Count - o.Run.Count, o.Contacts.Count, CasualtiesOf(o.Contacts), TasksOf(o.Contacts), UnitsOf(o.Contacts),
                    Top(o.Contacts, OperationNotable).Select(c => Contact(c, reports)).ToList(),
                    "/battlemap?" + string.Join("&", o.Recorded.Order(StringComparer.Ordinal).Select(n => "ops=" + Uri.EscapeDataString(n)))))
                .ToList(),
            _histories.Select(h => new TimelineUnit(
                    h.Row.Slug, h.Row.Short, h.Row.Title, h.Row.Arm, h.Row.UnitId, MapUnits(h.Subtree),
                    all.Count(c => c.Units.Any(h.Subtree.Contains)), recorded.Count(c => c.Units.Any(h.Subtree.Contains))))
                .ToList(),
            catalogue.Operations.Select(o => OperationName(o.Name)).Where(IsRoutine).Distinct(StringComparer.OrdinalIgnoreCase)
                .Order(StringComparer.Ordinal).ToList());
    }

    // ---------------------------------------------------------------- phases

    private PhaseFacts Phase(PhaseRow p, IReadOnlyDictionary<string, string> placed)
    {
        var units = p.Units.Select(slug => _histories.SingleOrDefault(h => h.Row.Slug == slug))
            .Select((h, i) => h.Row ?? throw new InvalidOperationException($"phases.csv: {p.Slug} names a unit with no history: {p.Units[i]}"))
            .ToList();
        var subtree = _histories.Where(h => units.Contains(h.Row)).SelectMany(h => h.Subtree).ToHashSet();
        bool In(ContactSummary c) =>
            string.CompareOrdinal(c.Dtg[..10], p.From) >= 0 && string.CompareOrdinal(c.Dtg[..10], p.To) <= 0
            && (subtree.Count == 0 || c.Units.Any(subtree.Contains))
            && (p.Series is null || c.Series > 0 && catalogue.Series[c.Series - 1].Name == p.Series);
        var contacts = facts.Contacts.Where(In).ToList();

        var query = new List<string> { $"from={p.From}", $"to={p.To}" };
        if (subtree.Count > 0)
        {
            query.Add("units=" + Uri.EscapeDataString(MapUnits(subtree)));
        }

        if (p.Series is not null)
        {
            query.Add("series=" + Uri.EscapeDataString(p.Series));
        }

        return new PhaseFacts(
            p.Slug, p.Title, p.From, p.To, p.Units, p.Series, contacts.Count, recorded.Count(In), CasualtiesOf(contacts), TasksOf(contacts),
            UnitsOf(contacts),
            contacts.Where(c => OpName(c) is { } n && !IsRoutine(n)).GroupBy(c => OpName(c)!)
                .Select(g => new OperationCount(g.Key, placed.GetValueOrDefault(g.Key), g.Count()))
                .OrderByDescending(o => o.Contacts).ThenBy(o => o.Name, StringComparer.Ordinal).ToList(),
            "/battlemap?" + string.Join("&", query));
    }

    // ---------------------------------------------------------------- the Battle Map's unit filter

    /// <summary>
    /// The Battle Map's unit filter for exactly these units (the Battle Map's tree has no nesting and no exclusions): each unit whose
    /// whole branch of the tree is among them, as its id (the unit and everything under it); a unit only some of whose branch is, as
    /// its id and a <c>!</c> (the unit alone), with the parts of its branch that are among them after it. As the Battle Map's own
    /// links write it (UnitTree.cover), in the tree's order.
    /// </summary>
    public string MapUnits(IReadOnlySet<int> units)
    {
        var entries = new List<string>();
        void Cover(UnitNode node)
        {
            if (!units.Contains(node.Id))
            {
                foreach (var child in Children(node.Id))
                {
                    Cover(child);
                }

                return;
            }

            if (Branch(node.Id).All(units.Contains))
            {
                entries.Add(node.Id.ToString(CultureInfo.InvariantCulture));
                return;
            }

            entries.Add(node.Id.ToString(CultureInfo.InvariantCulture) + "!");
            foreach (var child in Children(node.Id))
            {
                Cover(child);
            }
        }

        foreach (var root in catalogue.Units.Where(u => u.Parent is null || !_nodes.ContainsKey(u.Parent.Value)))
        {
            Cover(root);
        }

        return string.Join(",", entries);
    }

    private ILookup<int?, UnitNode>? _treeChildren;

    private IEnumerable<UnitNode> Children(int id) => (_treeChildren ??= catalogue.Units.ToLookup(u => u.Parent))[id];

    /// <summary>A node and everything under it in the Battle Map's tree, as recorded (no nesting, no exclusions).</summary>
    private IEnumerable<int> Branch(int id) => Children(id).SelectMany(c => Branch(c.Id)).Prepend(id);

    // ---------------------------------------------------------------- months and operations

    private IEnumerable<(string Month, List<ContactSummary> Contacts)> Months() =>
        facts.Contacts.GroupBy(c => c.Dtg[..7]).OrderBy(g => g.Key, StringComparer.Ordinal).Select(g => (g.Key, g.ToList()));

    /// <summary>
    /// The operations with a place of their own: those with enough contacts or casualties, not continuing activities, by their name
    /// brought together (the record's names for one operation are one: see operations.csv), in order of their main run's start.
    /// </summary>
    private IEnumerable<(string Slug, string Name, IReadOnlyCollection<string> Recorded, List<ContactSummary> Contacts, List<ContactSummary> Run)> Operations() =>
        facts.Contacts.Where(c => OpName(c) is { } n && !IsRoutine(n))
            .GroupBy(c => OpName(c)!)
            .Where(g => g.Count() >= OperationMinContacts || g.Sum(c => c.FrKia) >= OperationMinFrKia || g.Sum(c => c.EnKia) >= OperationMinEnKia)
            .Select(g => (Slug: FactSheetBuilder.Slug(g.Key), Name: g.Key,
                Recorded: (IReadOnlyCollection<string>)g.Select(c => OperationName(catalogue.Operations[c.Op - 1].Name)).Distinct().ToList(),
                Contacts: g.ToList(), Run: MainRun(g)))
            .OrderBy(o => o.Run.Min(c => c.Dtg), StringComparer.Ordinal).ThenBy(o => o.Name, StringComparer.Ordinal);

    /// <summary>The longest run of an operation's contacts with no gap of <see cref="RunGapDays"/> or more between them.</summary>
    private static List<ContactSummary> MainRun(IEnumerable<ContactSummary> contacts)
    {
        var runs = new List<List<ContactSummary>>();
        DateOnly? last = null;
        foreach (var c in contacts.OrderBy(c => c.Dtg, StringComparer.Ordinal))
        {
            var day = DateOnly.ParseExact(Day(c.Dtg), "yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (last is null || day.DayNumber - last.Value.DayNumber >= RunGapDays)
            {
                runs.Add([]);
            }

            runs[^1].Add(c);
            last = day;
        }

        return runs.MaxBy(r => r.Count)!;
    }

    private string? OpName(ContactSummary c)
    {
        if (c.Op <= 0 || OperationName(catalogue.Operations[c.Op - 1].Name) is not { Length: > 0 } name)
        {
            return null;
        }

        return aliases.GetValueOrDefault(name, name);
    }

    private string? TaskName(ContactSummary c) =>
        c.Task > 0 && catalogue.Tasks[c.Task - 1].Name is { } t && !string.IsNullOrWhiteSpace(t) ? FactSheetBuilder.PlainTask(t) : null;

    private static IEnumerable<ContactSummary> Top(IEnumerable<ContactSummary> contacts, int count) =>
        contacts.OrderByDescending(FactSheetBuilder.Significance).ThenBy(c => c.Dtg, StringComparer.Ordinal).ThenBy(c => c.Id).Take(count);

    // ---------------------------------------------------------------- figures

    private static Casualties CasualtiesOf(IReadOnlyCollection<ContactSummary> contacts) =>
        new(contacts.Sum(c => c.FrKia), contacts.Sum(c => c.FrWia), contacts.Sum(c => c.EnKia), contacts.Sum(c => c.EnWia));

    private IReadOnlyList<TaskCount> TasksOf(IReadOnlyCollection<ContactSummary> contacts) =>
        contacts.Select(TaskName).OfType<string>().GroupBy(t => t)
            .Select(g => new TaskCount(g.Key, g.Count()))
            .OrderByDescending(t => t.Contacts).ThenBy(t => t.Task, StringComparer.Ordinal).ToList();

    /// <summary>The history units taking part, most contacts first: each counts the contacts of the unit and everything under it.</summary>
    private IReadOnlyList<UnitCount> UnitsOf(IReadOnlyCollection<ContactSummary> contacts) =>
        _histories
            .Select(h => new UnitCount(
                h.Row.Slug,
                contacts.Count(c => c.Units.Any(h.Subtree.Contains)),
                contacts.Count(c => h.Subtree.Contains(facts.LeadOf(c)))))
            .Where(u => u.Contacts > 0)
            .OrderByDescending(u => u.Contacts).ThenBy(u => u.Slug, StringComparer.Ordinal).ToList();

    private TimelineContact Contact(ContactSummary c, IReadOnlyDictionary<int, ContactDetail> reports)
    {
        var lead = facts.LeadOf(c);
        var unit = _histories.FirstOrDefault(h => h.Subtree.Contains(lead)).Row?.Slug;
        return new TimelineContact(
            c.Id, Day(c.Dtg), unit, _nodes.TryGetValue(lead, out var node) ? node.Label : "Unknown unit", TaskName(c), OpName(c),
            new Casualties(c.FrKia, c.FrWia, c.EnKia, c.EnWia), reports.GetValueOrDefault(c.Id)?.Summary, $"/battlemap?incident={c.Id}");
    }

    private static string Day(string dtg) => dtg[..10];

    private static string LastDay(string month)
    {
        var first = DateOnly.ParseExact(month + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture);
        return first.AddMonths(1).AddDays(-1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }
}
