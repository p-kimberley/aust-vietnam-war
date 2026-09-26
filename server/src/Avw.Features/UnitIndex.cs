namespace Avw.Features;

/// <summary>
/// The list of unit histories the Unit Histories page shows at the left (content/features/unit-histories/index.json): each unit in
/// the order of <c>units.csv</c>, with its dates, a few figures and its sub-unit sections. Made from the fact sheets.
/// </summary>
public sealed record UnitIndex(IReadOnlyList<UnitIndexEntry> Units)
{
    public static UnitIndex Build(UnitsTable table, IReadOnlyDictionary<string, FactSheet> sheets) => new(
        table.Histories.Where(h => sheets.ContainsKey(h.Slug)).Select(h =>
        {
            var s = sheets[h.Slug];
            return new UnitIndexEntry(
                h.Slug, h.Title, h.Short, h.Arm, h.Tours, s.Figures.Contacts, s.Figures.Operations, s.Figures.FriendlyKilled, s.Dead.Count,
                s.SubUnits.Select(u => new UnitIndexSubUnit(u.Slug, u.Title, u.Figures.Contacts)).ToList());
        }).ToList());
}

/// <param name="Dead">The unit's dead on the roll of honour (by tour or contact), not only those killed in its contacts.</param>
public sealed record UnitIndexEntry(
    string Slug, string Title, string Short, string Arm, IReadOnlyList<TourSpan> Tours, int Contacts, int Operations, int FriendlyKilled, int Dead,
    IReadOnlyList<UnitIndexSubUnit> SubUnits);

public sealed record UnitIndexSubUnit(string Slug, string Title, int Contacts);
