namespace Avw.Api.Map;

/// <summary>
/// Builds the unit tree from the units recorded on contacts. The recorded parent id is used when that parent is itself
/// a recorded unit. Otherwise the ancestors are recovered from the unit's <c>Path</c>: a path prefix that matches a
/// recorded unit's path attaches to it, and one that matches nothing becomes a synthetic grouping node. (In the live
/// data 29 parent units are never recorded on a contact, so parent ids alone would leave those subtrees orphaned.)
/// </summary>
public static class UnitTreeBuilder
{
    private const char PathSeparator = '|';

    public static UnitNode[] Build(IEnumerable<UnitInfo> input)
    {
        var units = input.GroupBy(u => u.Id).Select(g => g.First()).ToDictionary(u => u.Id);
        var byPath = units.Values
            .Where(u => !string.IsNullOrWhiteSpace(u.Path))
            .GroupBy(u => u.Path!)
            .ToDictionary(g => g.Key, g => g.First().Id);

        // Every path prefix that is not a recorded unit becomes a synthetic node. Ids are negative and assigned in path
        // order, so the same data always produces the same tree.
        var syntheticPaths = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var unit in units.Values)
        {
            if (RecordedParent(unit, units) is not null || string.IsNullOrWhiteSpace(unit.Path))
            {
                continue;
            }

            var segments = unit.Path!.Split(PathSeparator);
            for (var i = 1; i < segments.Length; i++)
            {
                var prefix = string.Join(PathSeparator, segments[..i]);
                if (!byPath.ContainsKey(prefix))
                {
                    syntheticPaths.Add(prefix);
                }
            }
        }

        var syntheticIds = syntheticPaths.Select((p, i) => (Path: p, Id: -(i + 1))).ToDictionary(x => x.Path, x => x.Id);

        int? ParentOfPath(string path)
        {
            var cut = path.LastIndexOf(PathSeparator);
            if (cut < 0)
            {
                return null;
            }

            var prefix = path[..cut];
            if (byPath.TryGetValue(prefix, out var real))
            {
                return real;
            }

            return syntheticIds.TryGetValue(prefix, out var synthetic) ? synthetic : null;
        }

        var nodes = new List<UnitNode>();
        foreach (var unit in units.Values)
        {
            var parent = RecordedParent(unit, units)
                         ?? (string.IsNullOrWhiteSpace(unit.Path) ? null : ParentOfPath(unit.Path!));
            var label = LabelOf(unit);
            nodes.Add(new UnitNode(unit.Id, parent, label, string.IsNullOrWhiteSpace(unit.LongName) ? label : unit.LongName!, false));
        }

        foreach (var (path, id) in syntheticIds)
        {
            var name = path[(path.LastIndexOf(PathSeparator) + 1)..];
            nodes.Add(new UnitNode(id, ParentOfPath(path), name, name, true));
        }

        return InTreeOrder(nodes);
    }

    private static int? RecordedParent(UnitInfo unit, Dictionary<int, UnitInfo> units) =>
        unit.Parent is { } p && p != unit.Id && units.ContainsKey(p) ? p : null;

    private static string LabelOf(UnitInfo u)
    {
        var label = $"{u.Title} {u.ShortTypeName}".Trim();
        if (label.Length > 0)
        {
            return label;
        }

        return !string.IsNullOrWhiteSpace(u.ShortName) ? u.ShortName!
            : !string.IsNullOrWhiteSpace(u.LongName) ? u.LongName!
            : $"Unit {u.Id}";
    }

    /// <summary>Depth-first, siblings in natural order. A node caught in a parent cycle is treated as a root.</summary>
    private static UnitNode[] InTreeOrder(List<UnitNode> nodes)
    {
        var ids = nodes.Select(n => n.Id).ToHashSet();
        var children = nodes
            .Where(n => n.Parent is { } p && ids.Contains(p))
            .GroupBy(n => n.Parent!.Value)
            .ToDictionary(g => g.Key, g => g.OrderBy(n => n.Label, NaturalComparer.Instance).ThenBy(n => n.Id).ToList());

        var ordered = new List<UnitNode>(nodes.Count);
        var seen = new HashSet<int>();

        void Visit(UnitNode node, int? parent)
        {
            if (!seen.Add(node.Id))
            {
                return;
            }

            ordered.Add(node with { Parent = parent });
            if (children.TryGetValue(node.Id, out var kids))
            {
                foreach (var kid in kids)
                {
                    Visit(kid, node.Id);
                }
            }
        }

        foreach (var root in nodes.Where(n => n.Parent is not { } p || !ids.Contains(p))
                     .OrderBy(n => n.Label, NaturalComparer.Instance).ThenBy(n => n.Id))
        {
            Visit(root, null);
        }

        // Anything left over sits in a parent cycle and is unreachable from a root.
        foreach (var rest in nodes.Where(n => !seen.Contains(n.Id)).OrderBy(n => n.Id))
        {
            Visit(rest, null);
        }

        return [.. ordered];
    }
}

/// <summary>Orders text so that embedded numbers compare by value: <c>2 RAR</c> before <c>10 Fd Regt</c>.</summary>
public sealed class NaturalComparer : IComparer<string>
{
    public static readonly NaturalComparer Instance = new();

    public int Compare(string? x, string? y)
    {
        if (ReferenceEquals(x, y)) return 0;
        if (x is null) return -1;
        if (y is null) return 1;

        int i = 0, j = 0;
        while (i < x.Length && j < y.Length)
        {
            if (char.IsDigit(x[i]) && char.IsDigit(y[j]))
            {
                int si = i, sj = j;
                while (i < x.Length && char.IsDigit(x[i])) i++;
                while (j < y.Length && char.IsDigit(y[j])) j++;

                var a = x.AsSpan(si, i - si).TrimStart('0');
                var b = y.AsSpan(sj, j - sj).TrimStart('0');
                var byLength = a.Length.CompareTo(b.Length);
                if (byLength != 0) return byLength;

                var byDigits = a.CompareTo(b, StringComparison.Ordinal);
                if (byDigits != 0) return byDigits;
            }
            else
            {
                var byChar = char.ToUpperInvariant(x[i]).CompareTo(char.ToUpperInvariant(y[j]));
                if (byChar != 0) return byChar;
                i++;
                j++;
            }
        }

        return (x.Length - i).CompareTo(y.Length - j);
    }
}
