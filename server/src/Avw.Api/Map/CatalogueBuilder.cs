namespace Avw.Api.Map;

/// <summary>Reduces the raw contact set to the compact list and the catalogue that describes it.</summary>
public static class CatalogueBuilder
{
    public static (ContactSummary[] Contacts, FilterCatalogue Filters) Build(ContactSet set)
    {
        var records = set.Contacts;

        var series = Index(records.Select(c => c.Series));
        var operations = Index(records.Select(c => c.Operation));
        var tasks = Index(records.Select(c => c.Task));

        var contacts = records.Select(c => new ContactSummary(
            c.Id, c.Dtg, c.Lat, c.Lon, c.Fr, c.FrCas, c.En, c.EnCas, c.Units,
            operations.Lookup(c.Operation), tasks.Lookup(c.Task), series.Lookup(c.Series),
            c.Mine is null ? 0 : c.Mine.Value ? 2 : 1)).ToArray();

        var filters = new FilterCatalogue(
            DateMin: records.Count == 0 ? "" : records.Min(c => DateOf(c.Dtg))!,
            DateMax: records.Count == 0 ? "" : records.Max(c => DateOf(c.Dtg))!,
            Fr: RangeOf(records, c => c.Fr),
            FrCas: RangeOf(records, c => c.FrCas),
            En: RangeOf(records, c => c.En),
            EnCas: RangeOf(records, c => c.EnCas),
            Series: series.Entries, Operations: operations.Entries, Tasks: tasks.Entries,
            Units: UnitTreeBuilder.Build(set.Units));

        return (contacts, filters);
    }

    private static string DateOf(string dtg) => dtg.Length >= 10 ? dtg[..10] : dtg;

    private static RangeInfo RangeOf(IReadOnlyList<ContactRecord> records, Func<ContactRecord, int> value) =>
        records.Count == 0 ? new RangeInfo(0, 0) : new RangeInfo(records.Min(value), records.Max(value));

    /// <summary>Distinct non-blank names, sorted naturally, each with how many contacts use it.</summary>
    private static NameIndex Index(IEnumerable<string?> names)
    {
        var counted = names
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .GroupBy(n => n!.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(g => new NamedCount(g.First()!.Trim(), g.Count()))
            .OrderBy(n => n.Name, NaturalComparer.Instance)
            .ToArray();
        return new NameIndex(counted);
    }

    private sealed class NameIndex
    {
        private readonly Dictionary<string, int> _position;

        public NameIndex(NamedCount[] entries)
        {
            Entries = entries;
            _position = entries
                .Select((e, i) => (e.Name, Position: i + 1))
                .ToDictionary(x => x.Name, x => x.Position, StringComparer.OrdinalIgnoreCase);
        }

        public NamedCount[] Entries { get; }

        public int Lookup(string? name) =>
            !string.IsNullOrWhiteSpace(name) && _position.TryGetValue(name.Trim(), out var p) ? p : 0;
    }
}
