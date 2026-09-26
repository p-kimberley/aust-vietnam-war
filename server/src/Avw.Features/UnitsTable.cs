namespace Avw.Features;

/// <summary>What a row of <c>units.csv</c> does.</summary>
public enum UnitRole
{
    /// <summary>A unit with a history of its own.</summary>
    History,

    /// <summary>A unit shown as a sub-unit of <see cref="UnitRow.Parent"/> rather than where the data puts it (1 ATF Artillery).</summary>
    Nest,

    /// <summary>A unit left out, with everything under it (the New Zealand companies and battery).</summary>
    Exclude,
}

/// <summary>
/// One row of <c>content/features/unit-histories/units.csv</c>: which units have histories, their addresses and names, their arm
/// and their Australian War Memorial record (the official source for both), the names the nominal roll uses for them, and the
/// units that are re-parented or left out. Kept by hand and reviewed.
/// </summary>
/// <param name="Arm">infantry, cavalry, armour, artillery, engineers, special-air-service or headquarters: what the unit was, which
/// says what it did when it took part in another unit's contact (an artillery unit gave fire support; it did not patrol).</param>
/// <param name="Tours">Its tours in Vietnam, as the official record gives them (months, inclusive); empty until they are checked.</param>
public sealed record UnitRow(
    UnitRole Role, int UnitId, string Slug, string? Parent, string Arm, string? Awm, IReadOnlyList<TourSpan> Tours, string Title, string Short,
    IReadOnlyList<string> RollNames);

/// <summary>A tour, from its first month to its last (<c>yyyy-MM</c>), as the official record gives it.</summary>
public sealed record TourSpan(string From, string To)
{
    /// <summary>Whether a contact's date-time group falls within it.</summary>
    public bool Contains(string dtg) => string.CompareOrdinal(dtg[..7], From) >= 0 && string.CompareOrdinal(dtg[..7], To) <= 0;

    public static IReadOnlyList<TourSpan> Parse(string text) =>
        text.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(t => t.Split("..", StringSplitOptions.TrimEntries))
            .Select(p => new TourSpan(p[0], p[1]))
            .ToList();
}

public sealed class UnitsTable(IReadOnlyList<UnitRow> rows)
{
    public IReadOnlyList<UnitRow> Rows { get; } = rows;

    public IEnumerable<UnitRow> Histories => Rows.Where(r => r.Role == UnitRole.History);

    public IReadOnlySet<int> Excluded { get; } = rows.Where(r => r.Role == UnitRole.Exclude).Select(r => r.UnitId).ToHashSet();

    /// <summary>Units moved under another history's unit: unit id to the id of the unit it is shown under.</summary>
    public IReadOnlyDictionary<int, int> Nested { get; } = rows.Where(r => r.Role == UnitRole.Nest)
        .ToDictionary(r => r.UnitId, r => rows.Single(h => h.Role == UnitRole.History && h.Slug == r.Parent).UnitId);

    public UnitRow? Nest(int unitId) => Rows.FirstOrDefault(r => r.Role == UnitRole.Nest && r.UnitId == unitId);

    public static UnitsTable Parse(string csv)
    {
        var lines = Csv.Read(csv).ToList();
        if (lines.Count == 0 || lines[0].FirstOrDefault() != "role")
        {
            throw new FormatException("units.csv must start with its header row (role,unit_id,slug,parent,arm,awm,tours,title,short,roll_names).");
        }

        return new UnitsTable(lines.Skip(1).Where(l => l.Count > 1).Select(l => new UnitRow(
            Enum.Parse<UnitRole>(l[0], ignoreCase: true),
            int.Parse(l[1]),
            l[2],
            string.IsNullOrWhiteSpace(l[3]) ? null : l[3],
            l[4],
            string.IsNullOrWhiteSpace(l[5]) ? null : l[5],
            TourSpan.Parse(l[6]),
            l[7],
            l[8],
            l[9].Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))).ToList());
    }
}

/// <summary>Just enough CSV: commas, and double quotes round a field that holds them (with "" for a quote).</summary>
internal static class Csv
{
    public static IEnumerable<List<string>> Read(string text)
    {
        foreach (var line in text.Replace("\r\n", "\n").Split('\n'))
        {
            if (line.Length == 0)
            {
                continue;
            }

            var fields = new List<string>();
            var field = new System.Text.StringBuilder();
            var quoted = false;
            for (var i = 0; i < line.Length; i++)
            {
                var c = line[i];
                if (quoted)
                {
                    if (c == '"' && i + 1 < line.Length && line[i + 1] == '"')
                    {
                        field.Append('"');
                        i++;
                    }
                    else if (c == '"')
                    {
                        quoted = false;
                    }
                    else
                    {
                        field.Append(c);
                    }
                }
                else if (c == '"')
                {
                    quoted = true;
                }
                else if (c == ',')
                {
                    fields.Add(field.ToString());
                    field.Clear();
                }
                else
                {
                    field.Append(c);
                }
            }

            fields.Add(field.ToString());
            while (fields.Count < 10)
            {
                fields.Add("");
            }

            yield return fields;
        }
    }
}
