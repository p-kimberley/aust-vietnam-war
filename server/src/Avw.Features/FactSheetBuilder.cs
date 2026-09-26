using System.Globalization;
using Avw.Api.Map;

namespace Avw.Features;

/// <summary>A person on the honour roll, with the tours the nominal roll records.</summary>
public sealed record RollPerson(string ServiceNumber, string Name, string? Rank, DateOnly? Died, IReadOnlyList<Tour> Tours);

public sealed record Tour(string Unit, DateOnly? Start, DateOnly? End);

/// <summary>A community picture that is approved and so may be shown.</summary>
public sealed record SitePicture(long Id, string Url, string ThumbUrl, string? Caption, string? Credit, DateOnly? DateTaken, double? Lat, double? Lon, int? ContactId);

/// <summary>A base or landing zone on the map, for naming where a unit worked.</summary>
public sealed record Place(string Name, string Type, double Lat, double Lon);

/// <summary>
/// What a contact's record says about who did what, beyond the map's summary: its units and how the report names them, the unit
/// task as recorded, and the support given (the report's artillery, carrier, tank and air support fields).
/// </summary>
/// <param name="Units">The report's units, in the order the record lists them (which is not the order the report names them).</param>
/// <param name="Involved">The report's own words for the units involved, in order: the unit in contact first ("12 pl D coy 5 RAR; 105 Fd Bty").</param>
/// <param name="ArtilleryEngagement">Artillery or mortars engaged the enemy (the report's artillery incident, or strikes fired).</param>
public sealed record ContactRole(
    IReadOnlyList<int> Units, string? Involved, string? Task, bool ArtilleryEngagement, bool ArtillerySupport, bool Carriers, bool Tanks, bool Air);

/// <summary>Everything a fact sheet is worked out from, read once for all the units.</summary>
public sealed record FactInputs(
    IReadOnlyList<ContactSummary> Contacts,
    FilterCatalogue Catalogue,
    IReadOnlyDictionary<int, ContactRole> Roles,
    IReadOnlyList<RollPerson> Roll,
    ILookup<string, int> CasualtyLinks,
    IReadOnlyList<SitePicture> Pictures,
    IReadOnlyList<Place> Places,
    IReadOnlySet<string> Portraits);

/// <summary>
/// Works out a unit's fact sheet from the data: plain code, the same every time for the same data. Two steps, because the notable
/// contacts' reports are fetched one by one: <see cref="Candidates"/> says which to fetch, <see cref="Build"/> uses them.
/// </summary>
public sealed class FactSheetBuilder(UnitsTable table, FactInputs input)
{
    /// <summary>A sub-unit gets a section of its own from this many contacts.</summary>
    public const int SubUnitMinContacts = 20;

    /// <summary>How many of a unit's most significant contacts are kept.</summary>
    public const int SignificantCount = 8;

    /// <summary>A report shorter than this says too little to show what a unit's work was like.</summary>
    public const int TypicalReportMinChars = 120;

    private const double AreaRadiusKm = 15;
    private const double PictureRadiusKm = 1.5;
    private const int PictureMinNearby = 3;

    private readonly ILookup<int?, UnitNode> _children = BuildChildren(table, input.Catalogue.Units);
    private readonly Dictionary<int, UnitNode> _nodes = input.Catalogue.Units.ToDictionary(u => u.Id);
    private readonly Dictionary<int, HashSet<int>> _subtrees = [];
    private (List<ContactSummary> Contacts, Dictionary<int, IReadOnlyList<int>> RoleUnits, Dictionary<int, CorrectedContact> Corrections)? _corrected;

    /// <summary>
    /// The contacts, with those filed against the wrong unit put right: a contact recorded against a unit outside its official tours,
    /// whose report names another unit with a history that was in Vietnam then (by its short name or its label: "2 RAR"), is that
    /// unit's. Its recorded unit (and the sub-units under it) are replaced by the named unit. One whose report names a unit left out
    /// first (a New Zealand company: "1 pl V coy 4 RAR/NZ") is that unit's, and so in no history. The rest stay as recorded, and are
    /// listed as outside the unit's tours for review.
    /// </summary>
    private (List<ContactSummary> Contacts, Dictionary<int, IReadOnlyList<int>> RoleUnits, Dictionary<int, CorrectedContact> Corrections) Corrected()
    {
        if (_corrected is { } done)
        {
            return done;
        }

        var histories = table.Histories.Select(h => (Row: h, Subtree: Subtree(h.UnitId), Names: NamesOf(h))).ToList();
        var leftOut = table.Excluded.Where(_nodes.ContainsKey).Select(id => UnitWords(_nodes[id].Label)).Distinct().ToList();
        var contacts = new List<ContactSummary>(input.Contacts.Count);
        var roleUnits = new Dictionary<int, IReadOnlyList<int>>();
        var corrections = new Dictionary<int, CorrectedContact>();
        foreach (var c in input.Contacts)
        {
            var text = input.Roles.GetValueOrDefault(c.Id)?.Involved is { Length: > 0 } involved ? UnitWords(involved) : null;
            var recorded = histories.Where(h => h.Row.Tours.Count > 0 && c.Units.Any(h.Subtree.Contains) && !h.Row.Tours.Any(t => t.Contains(c.Dtg))).ToList();
            if (recorded.Count == 0 || text is null)
            {
                contacts.Add(c);
                continue;
            }

            static int First(string text, IEnumerable<string> names) => names.Select(n => Position(text, n)).Where(p => p >= 0).DefaultIfEmpty(-1).Min();
            var named = histories
                .Where(h => h.Row.Tours.Any(t => t.Contains(c.Dtg)))
                .Select(h => (h.Row, Position: First(text, h.Names)))
                .Where(h => h.Position >= 0)
                .OrderBy(h => h.Position)
                .FirstOrDefault();
            var excluded = First(text, leftOut);
            var toLeftOut = excluded >= 0 && (named.Row is null || excluded < named.Position);
            if (!toLeftOut && (named.Row is null || recorded.Any(h => h.Row == named.Row)))
            {
                contacts.Add(c);
                continue;
            }

            int[] Replace(IEnumerable<int> units) => units
                .SelectMany(u => !recorded.Any(h => h.Subtree.Contains(u)) ? [u] : toLeftOut ? Array.Empty<int>() : [named.Row!.UnitId])
                .Distinct().ToArray();
            contacts.Add(c with { Units = Replace(c.Units) });
            if (input.Roles.GetValueOrDefault(c.Id) is { Units.Count: > 0 } role)
            {
                roleUnits[c.Id] = Replace(role.Units);
            }

            corrections[c.Id] = new CorrectedContact(
                c.Id, c.Dtg[..10], string.Join(", ", recorded.Select(h => h.Row.Slug)), toLeftOut ? null : named.Row!.Slug);
        }

        _corrected = (contacts, roleUnits, corrections);
        return _corrected.Value;
    }

    private IReadOnlyList<string> NamesOf(UnitRow unit) =>
        new[] { unit.Short, _nodes.TryGetValue(unit.UnitId, out var n) ? n.Label : unit.Short }.Select(UnitWords).Distinct().ToList();

    /// <summary>The contacts whose reports <see cref="Build"/> may want: the most significant, the first and last, and the likeliest typical ones.</summary>
    public IReadOnlyCollection<int> Candidates(UnitRow unit)
    {
        var contacts = ContactsOf(Subtree(unit.UnitId));
        if (contacts.Count == 0)
        {
            return [];
        }

        var ids = new HashSet<int>(contacts.OrderByDescending(Significance).ThenBy(c => c.Dtg).Take(SignificantCount * 2).Select(c => c.Id))
        {
            contacts.MinBy(c => c.Dtg)!.Id,
            contacts.MaxBy(c => c.Dtg)!.Id,
        };
        var subtree = Subtree(unit.UnitId);
        foreach (var activity in TopActivities(contacts, subtree))
        {
            ids.UnionWith(contacts.Where(c => Led(c, subtree) && ActivityOf(c) == activity).OrderByDescending(Significance).ThenBy(c => c.Dtg).Take(6).Select(c => c.Id));
        }

        foreach (var sub in SubUnitNodes(unit))
        {
            ids.UnionWith(ContactsOf(Subtree(sub.Id)).OrderByDescending(Significance).ThenBy(c => c.Dtg).Take(3).Select(c => c.Id));
        }

        return ids;
    }

    public FactSheet Build(UnitRow unit, IReadOnlyDictionary<int, ContactDetail> reports)
    {
        var subtree = Subtree(unit.UnitId);
        var contacts = ContactsOf(subtree);
        var ids = contacts.Select(c => c.Id).ToHashSet();

        var sections = SubUnitNodes(unit).Select(n => (Node: n, Slug: SubUnitSlug(unit, n), Subtree: Subtree(n.Id))).ToList();
        var slugOf = sections.ToDictionary(s => s.Node.Id, s => s.Slug);
        IReadOnlyList<string> SectionsOf(IEnumerable<int> units) =>
            sections.Where(s => units.Any(s.Subtree.Contains)).Select(s => s.Slug).ToList();

        // The most significant, then the first and last, then one typical contact for each of the commonest activities.
        var notable = new Dictionary<int, List<string>>();
        void Add(int id, string why)
        {
            if (!notable.TryGetValue(id, out var list))
            {
                notable[id] = list = [];
            }

            if (!list.Contains(why)) list.Add(why);
        }

        // Significant means someone was killed or wounded, on one side or the other; the forces involved then rank them.
        foreach (var c in contacts.Where(c => c.FrKia + c.FrWia + c.EnKia + c.EnWia > 0).OrderByDescending(Significance).ThenBy(c => c.Dtg).Take(SignificantCount))
        {
            Add(c.Id, "significant");
        }

        if (contacts.Count > 0)
        {
            Add(contacts.MinBy(c => c.Dtg)!.Id, "first");
            Add(contacts.MaxBy(c => c.Dtg)!.Id, "last");
        }

        // Typical of what the unit itself did: from the contacts it led, never from another unit's contact it supported.
        foreach (var activity in TopActivities(contacts, subtree))
        {
            var typical = contacts
                .Where(c => Led(c, subtree) && ActivityOf(c) == activity && !notable.ContainsKey(c.Id)
                    && reports.TryGetValue(c.Id, out var r) && (r.Description?.Trim().Length ?? 0) >= TypicalReportMinChars)
                .OrderByDescending(Significance).ThenBy(c => c.Dtg)
                .FirstOrDefault();
            if (typical is not null)
            {
                Add(typical.Id, $"typical:{activity}");
            }
        }

        var byId = contacts.ToDictionary(c => c.Id);
        var notableContacts = notable
            .Select(kv => Notable(unit, subtree, byId[kv.Key], kv.Value, reports.GetValueOrDefault(kv.Key), SectionsOf(byId[kv.Key].Units)))
            .OrderBy(n => n.Dtg)
            .ToList();

        var subUnits = sections.Select(s =>
        {
            var own = ContactsOf(s.Subtree);
            var parent = s.Node.Parent is { } p && slugOf.TryGetValue(p, out var ps) ? ps : null;
            return new SubUnitFacts(
                s.Node.Id, s.Slug, parent, SubUnitTitle(unit, s.Node), MapUrl(s.Node.Id), FiguresOf(own, s.Subtree), ActivityOf(own, s.Subtree),
                SupportOf(unit, own, s.Subtree),
                own.OrderByDescending(Significance).ThenBy(c => c.Dtg).Take(3).OrderBy(c => c.Dtg).Select(Brief).ToList());
        }).ToList();

        return new FactSheet(
            new UnitFacts(unit.UnitId, unit.Slug, unit.Title, unit.Short, unit.Arm, unit.Awm, unit.Tours,
                unit.Tours.Count == 0 ? [] : contacts.Where(c => !unit.Tours.Any(t => t.Contains(c.Dtg))).OrderBy(c => c.Dtg).Select(c => c.Id).ToList(),
                Corrected().Corrections.Values.Where(k => k.CountedFor == unit.Slug || k.RecordedAgainst.Split(", ").Contains(unit.Slug))
                    .OrderBy(k => k.Date).ThenBy(k => k.Id).ToList(),
                MapUrl(unit.UnitId)),
            FiguresOf(contacts, subtree),
            contacts.GroupBy(c => Year(c.Dtg)).OrderBy(g => g.Key).Select(g => new YearCount(g.Key, g.Count())).ToList(),
            ActivityOf(contacts, subtree),
            SupportOf(unit, contacts, subtree),
            ShareOf(contacts, c => c.Series, input.Catalogue.Series),
            OperationsOf(contacts),
            AreasOf(contacts),
            notableContacts,
            subUnits,
            DeadOf(unit, ids, byId, SectionsOf),
            PicturesOf(contacts, ids),
            new SourceCounts(input.Contacts.Count, input.Catalogue.Units.Length, input.Roll.Count, input.CasualtyLinks.Sum(g => g.Count()),
                input.Pictures.Count, input.Places.Count, input.Portraits.Count));
    }

    // ---------------------------------------------------------------- the unit tree

    private static ILookup<int?, UnitNode> BuildChildren(UnitsTable table, IEnumerable<UnitNode> units) =>
        units.Where(u => !table.Excluded.Contains(u.Id))
            .ToLookup(u => table.Nested.TryGetValue(u.Id, out var parent) ? parent : u.Parent);

    /// <summary>A unit and everything under it (with the units nested under it, and without those left out).</summary>
    public IReadOnlySet<int> Subtree(int unitId)
    {
        if (_subtrees.TryGetValue(unitId, out var known))
        {
            return known;
        }

        var all = new HashSet<int>();
        _subtrees[unitId] = all;
        var stack = new Stack<int>([unitId]);
        while (stack.TryPop(out var id))
        {
            if (table.Excluded.Contains(id) || !all.Add(id))
            {
                continue;
            }

            foreach (var child in _children[id])
            {
                stack.Push(child.Id);
            }
        }

        return all;
    }

    /// <summary>
    /// The sub-units with enough contacts for a section of their own: those directly under the unit (its companies, squadrons or
    /// batteries), not the platoons and troops under them.
    /// </summary>
    private IEnumerable<UnitNode> SubUnitNodes(UnitRow unit) =>
        _children[unit.UnitId].OrderBy(c => c.Label, StringComparer.Ordinal).Where(c => ContactsOf(Subtree(c.Id)).Count >= SubUnitMinContacts);

    private List<ContactSummary> ContactsOf(IReadOnlySet<int> units) => Corrected().Contacts.Where(c => c.Units.Any(units.Contains)).ToList();

    /// <summary>Every contact, with those filed against the wrong unit put right (see <see cref="Corrected"/>).</summary>
    public IReadOnlyList<ContactSummary> Contacts => Corrected().Contacts;

    /// <summary>A sub-unit's name without its unit's ("B Company, 5 Battalion, Royal Australian Regiment" is "B Company").</summary>
    private string SubUnitTitle(UnitRow unit, UnitNode node)
    {
        if (table.Nest(node.Id) is { } nest)
        {
            return nest.Title;
        }

        var parts = node.Name.Split(',', StringSplitOptions.TrimEntries);
        var unitName = _nodes.TryGetValue(unit.UnitId, out var u) ? u.Name : unit.Title;
        var keep = parts.TakeWhile(p => !unitName.StartsWith(p, StringComparison.OrdinalIgnoreCase)).ToList();
        return string.Join(", ", keep.Count > 0 ? keep : parts.Take(1));
    }

    private string SubUnitSlug(UnitRow unit, UnitNode node) => table.Nest(node.Id)?.Slug ?? Slug(SubUnitTitle(unit, node));

    public static string Slug(string text) =>
        string.Join('-', System.Text.RegularExpressions.Regex.Split(text.ToLowerInvariant(), "[^a-z0-9]+").Where(w => w.Length > 0));

    // ---------------------------------------------------------------- figures

    /// <summary>How much a contact stands out: its casualties on both sides first, then the forces involved.</summary>
    public static double Significance(ContactSummary c) => 4 * c.FrKia + 2 * c.FrWia + 2 * c.EnKia + c.EnWia + (c.Fr + c.En) / 25.0;

    private Figures FiguresOf(IReadOnlyCollection<ContactSummary> contacts, IReadOnlySet<int> subtree) => new(
        contacts.Count,
        contacts.Count(c => Led(c, subtree)),
        contacts.Count(c => !Led(c, subtree)),
        contacts.Count > 0 ? Day(contacts.Min(c => c.Dtg)!) : null,
        contacts.Count > 0 ? Day(contacts.Max(c => c.Dtg)!) : null,
        contacts.Where(c => c.Op > 0).Select(c => c.Op).Distinct().Count(),
        contacts.Sum(c => c.FrKia), contacts.Sum(c => c.FrWia), contacts.Sum(c => c.EnKia), contacts.Sum(c => c.EnWia),
        contacts.Count(c => c.Mine == 2));

    private static IReadOnlyList<ShareCount> ShareOf(IReadOnlyCollection<ContactSummary> contacts, Func<ContactSummary, int> key, NamedCount[] names)
    {
        var recorded = contacts.Where(c => key(c) > 0).ToList();
        return recorded.GroupBy(key)
            .Select(g => new ShareCount(Name(names, g.Key), g.Count(), Math.Round((double)g.Count() / recorded.Count, 2)))
            .OrderByDescending(s => s.Count).ThenBy(s => s.Name, StringComparer.Ordinal)
            .ToList();
    }

    // ---------------------------------------------------------------- who did what

    /// <summary>Whether the unit (or one of its own) was the unit in contact, not taking part in another unit's contact.</summary>
    private bool Led(ContactSummary c, IReadOnlySet<int> subtree) => subtree.Contains(LeadOf(c));

    private readonly Dictionary<int, int> _leads = [];

    /// <summary>
    /// The unit in contact: of the report's units, the one its own words name first (by the unit's label or one of its parents', as
    /// whole words, with the usual abbreviations brought together: "Fd" and "Field", "1ATF" and "1 ATF"). Where the words name none
    /// of them, the first the record lists.
    /// </summary>
    public int LeadOf(ContactSummary c)
    {
        if (_leads.TryGetValue(c.Id, out var known))
        {
            return known;
        }

        var role = input.Roles.GetValueOrDefault(c.Id);
        var units = Corrected().RoleUnits.GetValueOrDefault(c.Id) ?? (role?.Units is { Count: > 0 } listed ? listed : c.Units);
        var lead = units.FirstOrDefault();
        if (units.Count > 1 && !string.IsNullOrWhiteSpace(role?.Involved))
        {
            var text = UnitWords(role.Involved);
            var best = (Position: int.MaxValue, Depth: 0);
            foreach (var id in units)
            {
                var chain = Ancestry(id).ToList();
                var position = chain.Select(n => Position(text, UnitWords(n.Label))).Where(p => p >= 0).DefaultIfEmpty(-1).Min();
                if (position >= 0 && (position < best.Position || (position == best.Position && chain.Count > best.Depth)))
                {
                    (best, lead) = ((position, chain.Count), id);
                }
            }
        }

        return _leads[c.Id] = lead;
    }

    private IEnumerable<UnitNode> Ancestry(int id)
    {
        for (var n = _nodes.GetValueOrDefault(id); n is not null; n = n.Parent is { } p ? _nodes.GetValueOrDefault(p) : null)
        {
            yield return n;
        }
    }

    private static readonly Dictionary<string, string> Abbreviations = new()
    {
        ["field"] = "fd", ["battery"] = "bty", ["company"] = "coy", ["platoon"] = "pl", ["troop"] = "tp", ["squadron"] = "sqn",
        ["regiment"] = "regt", ["battalion"] = "bn", ["cavalry"] = "cav", ["armoured"] = "armd", ["artillery"] = "arty",
        ["mortars"] = "mor", ["mortar"] = "mor",
    };

    /// <summary>Unit words brought to one form: lower case, the usual abbreviations, and no space between a number and its letters.</summary>
    public static string UnitWords(string words)
    {
        var lower = System.Text.RegularExpressions.Regex.Replace(words.ToLowerInvariant(), "[a-z]+", m => Abbreviations.GetValueOrDefault(m.Value, m.Value));
        return System.Text.RegularExpressions.Regex.Replace(lower, @"(\d)\s+(?=[a-z])", "$1");
    }

    private static int Position(string text, string label)
    {
        var m = System.Text.RegularExpressions.Regex.Match(text, @"(?<![a-z0-9])" + System.Text.RegularExpressions.Regex.Escape(label) + @"(?![a-z0-9])");
        return m.Success ? m.Index : -1;
    }

    /// <summary>
    /// What was being done, as the report records it (its unit task, in plain words); where it records none, what the report's
    /// other fields show: an artillery engagement, or a mine incident.
    /// </summary>
    private string ActivityOf(ContactSummary c)
    {
        var role = input.Roles.GetValueOrDefault(c.Id);
        var task = role?.Task ?? (c.Task > 0 ? Name(input.Catalogue.Tasks, c.Task) : null);
        if (!string.IsNullOrWhiteSpace(task))
        {
            return PlainTask(task);
        }

        return role?.ArtilleryEngagement == true ? "Artillery engagement" : c.Mine == 2 ? "Mine incident" : "Not recorded";
    }

    /// <summary>The report's unit tasks in plain words, with their spelling variants brought together.</summary>
    public static string PlainTask(string task) => task.Trim().ToLowerInvariant() switch
    {
        "arty/mor" => "Artillery and mortar fire",
        "harrassing fire" => "Harassing fire",
        "lft/air" => "Air support",
        "mine/booby trap" => "Mine or booby trap",
        "attack by en" or "enemy attack" => "Enemy attack",
        var t => char.ToUpperInvariant(t[0]) + t[1..],
    };

    /// <summary>
    /// The Battle Map's filter for an activity: the unit tasks that read as it in plain words ("Arty/Mor" for "Artillery and mortar
    /// fire"; both spellings of harassing fire), or null for one the Battle Map cannot filter on (worked out from the report's other
    /// fields: an artillery engagement, a mine incident with no task; or none recorded).
    /// </summary>
    private string? TaskFilter(string activity)
    {
        var tasks = input.Catalogue.Tasks.Where(t => !string.IsNullOrWhiteSpace(t.Name) && PlainTask(t.Name) == activity).Select(t => t.Name).ToList();
        return tasks.Count == 0 ? null : string.Join("&", tasks.Order(StringComparer.Ordinal).Select(t => "tasks=" + Uri.EscapeDataString(t)));
    }

    /// <summary>What the unit did in the contacts it led, by activity, commonest first (with those whose activity is not recorded).</summary>
    private IReadOnlyList<ShareCount> ActivityOf(IReadOnlyCollection<ContactSummary> contacts, IReadOnlySet<int> subtree)
    {
        var led = contacts.Where(c => Led(c, subtree)).ToList();
        return led.GroupBy(ActivityOf)
            .Select(g => new ShareCount(g.Key, g.Count(), Math.Round((double)g.Count() / led.Count, 2), TaskFilter(g.Key)))
            .OrderBy(s => s.Name == "Not recorded").ThenByDescending(s => s.Count).ThenBy(s => s.Name, StringComparer.Ordinal)
            .ToList();
    }

    private IEnumerable<string> TopActivities(IReadOnlyCollection<ContactSummary> contacts, IReadOnlySet<int> subtree) =>
        contacts.Where(c => Led(c, subtree)).Select(ActivityOf).Where(a => a != "Not recorded")
            .GroupBy(a => a).OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal).Take(4).Select(g => g.Key);

    /// <summary>
    /// What the unit did in other units' contacts. Its arm says what that was (an artillery unit fired in support; a cavalry unit
    /// carried and supported with its carriers; a tank unit supported with its tanks; engineers supported with their skills);
    /// a headquarters' support is read from the report (artillery support), and anything else was taking part in another unit's contact.
    /// </summary>
    private IReadOnlyList<SupportFacts> SupportOf(UnitRow unit, IReadOnlyCollection<ContactSummary> contacts, IReadOnlySet<int> subtree) =>
        contacts.Where(c => !Led(c, subtree))
            .GroupBy(c => SupportKind(unit, c))
            .Select(g => new SupportFacts(g.Key, g.Count(), g
                .GroupBy(c => SupportedName(c))
                .Select(u => new SupportedUnit(u.Key, u.Count()))
                .OrderByDescending(u => u.Contacts).ThenBy(u => u.Unit, StringComparer.Ordinal)
                .ToList()))
            .OrderByDescending(s => s.Contacts).ThenBy(s => s.Kind, StringComparer.Ordinal)
            .ToList();

    private string SupportKind(UnitRow unit, ContactSummary c)
    {
        var role = input.Roles.GetValueOrDefault(c.Id);
        return unit.Arm switch
        {
            "artillery" => "Fire support",
            "cavalry" => "Armoured personnel carriers",
            "armour" => "Tank support",
            "engineers" => "Engineer support",
            // A headquarters' own artillery and mortars (nested under it) gave fire support; the report's artillery field says so.
            "headquarters" when role?.ArtillerySupport == true => "Fire support",
            _ => "In another unit's contact",
        };
    }

    /// <summary>The unit in contact, by the short name of the history it belongs to, or of the top of its tree ("US Army").</summary>
    private string SupportedName(ContactSummary c)
    {
        var lead = LeadOf(c);
        var history = table.Histories.FirstOrDefault(h => Subtree(h.UnitId).Contains(lead));
        if (history is not null)
        {
            return history.Short;
        }

        // A unit left out (a New Zealand company) is named as the table names it, not by the unit it sits under.
        var node = _nodes.GetValueOrDefault(lead);
        for (var n = node; n is not null; n = n.Parent is { } p && _nodes.TryGetValue(p, out var up) ? up : null)
        {
            if (table.Excluded.Contains(n.Id))
            {
                return table.Rows.First(r => r.Role == UnitRole.Exclude && r.UnitId == n.Id).Title;
            }
        }

        while (node?.Parent is { } parent && _nodes.TryGetValue(parent, out var top))
        {
            node = top;
        }

        return node?.Label ?? "Not recorded";
    }

    private IReadOnlyList<OperationFacts> OperationsOf(IReadOnlyCollection<ContactSummary> contacts) =>
        contacts.Where(c => c.Op > 0).GroupBy(c => c.Op)
            .Select(g => new OperationFacts(Name(input.Catalogue.Operations, g.Key), g.Count(), Day(g.Min(c => c.Dtg)!), Day(g.Max(c => c.Dtg)!),
                g.Sum(c => c.FrKia), g.Sum(c => c.EnKia)))
            .OrderBy(o => o.First, StringComparer.Ordinal).ThenBy(o => o.Name, StringComparer.Ordinal)
            .ToList();

    private IReadOnlyList<AreaFacts> AreasOf(IReadOnlyCollection<ContactSummary> contacts)
    {
        if (input.Places.Count == 0 || contacts.Count == 0)
        {
            return [];
        }

        return contacts
            .Select(c => input.Places.Select(p => (Place: p, Km: Km(c.Lat, c.Lon, p.Lat, p.Lon))).MinBy(x => x.Km))
            .Where(x => x.Km <= AreaRadiusKm)
            .GroupBy(x => x.Place)
            .Select(g => new AreaFacts(g.Key.Name, g.Key.Type, g.Count(), Math.Round((double)g.Count() / contacts.Count, 2)))
            .OrderByDescending(a => a.Contacts).ThenBy(a => a.Place, StringComparer.Ordinal)
            .Take(8)
            .ToList();
    }

    private NotableBrief Brief(ContactSummary c) => new(
        c.Id, $"/battlemap?incident={c.Id}", Day(c.Dtg), c.Op > 0 ? Name(input.Catalogue.Operations, c.Op) : null, ActivityOf(c),
        c.FrKia, c.FrWia, c.EnKia);

    private NotableContact Notable(UnitRow unit, IReadOnlySet<int> subtree, ContactSummary c, List<string> why, ContactDetail? detail, IReadOnlyList<string> sections) => new(
        c.Id,
        $"/battlemap?incident={c.Id}",
        c.Dtg,
        why,
        Led(c, subtree) ? "led" : SupportKind(unit, c),
        Led(c, subtree) ? null : SupportedName(c),
        detail?.Operation ?? (c.Op > 0 ? Name(input.Catalogue.Operations, c.Op) : null),
        detail?.UnitTask ?? (c.Task > 0 ? Name(input.Catalogue.Tasks, c.Task) : null),
        detail?.GridRef,
        c.Fr, c.En, c.FrKia, c.FrWia, c.EnKia, c.EnWia,
        detail?.Units.Select(u => u.LongName).ToList() ?? c.Units.Select(u => _nodes.TryGetValue(u, out var n) ? n.Name : u.ToString()).ToList(),
        sections,
        detail?.Description?.Trim(),
        detail?.ArchivalSource);

    // ---------------------------------------------------------------- the dead and the pictures

    /// <summary>
    /// The unit's dead. A person whose tour at the time they died names one of the histories' units belongs to that unit, and only
    /// that one. A person whose tour does not say (most often a reinforcement, whose tour is with the reinforcement unit) belongs to
    /// the unit of the contact they are linked to; when that contact involves more than one history's unit, to the infantry
    /// battalion among them (reinforcements were very largely infantry), or else to each of them.
    /// </summary>
    private IReadOnlyList<Fallen> DeadOf(UnitRow unit, IReadOnlySet<int> ids, IReadOnlyDictionary<int, ContactSummary> byId, Func<IEnumerable<int>, IReadOnlyList<string>> sectionsOf)
    {
        var dead = new List<Fallen>();
        foreach (var p in input.Roll)
        {
            var tourUnits = p.Died is { } died
                ? table.Histories.Where(h => p.Tours.Any(t => h.RollNames.Contains(t.Unit, StringComparer.OrdinalIgnoreCase)
                    && (t.Start is null || t.Start <= died) && (t.End is null || died <= t.End.Value.AddDays(1)))).Select(h => h.Slug).ToHashSet()
                : [];
            var linked = input.CasualtyLinks[p.ServiceNumber].Where(ids.Contains).Distinct().OrderBy(id => id).ToList();

            var onTour = tourUnits.Contains(unit.Slug);
            var byContact = tourUnits.Count == 0 && linked.Count > 0 && ClaimedByContact(unit, linked);
            if (!onTour && !byContact)
            {
                continue;
            }

            var via = new List<string>();
            if (onTour) via.Add("tour");
            if (linked.Count > 0) via.Add("contact");
            dead.Add(new Fallen(
                p.ServiceNumber, p.Name, p.Rank, p.Died?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), via, linked,
                sectionsOf(linked.SelectMany(id => byId[id].Units)),
                input.Portraits.Contains(p.ServiceNumber) ? $"/media/portraits/{p.ServiceNumber}.jpg" : null));
        }

        return dead.OrderBy(d => d.Died, StringComparer.Ordinal).ThenBy(d => d.Name, StringComparer.Ordinal).ToList();
    }

    /// <summary>Whether a death known only from its contacts is this unit's: it is, unless an infantry battalion other than it took part.</summary>
    private bool ClaimedByContact(UnitRow unit, IReadOnlyList<int> contactIds)
    {
        var involved = table.Histories.Where(h => contactIds.Any(HistoryContacts(h).Contains)).ToList();
        var infantry = involved.Where(IsInfantry).ToList();
        return infantry.Count == 0 || infantry.Any(h => h.Slug == unit.Slug);
    }

    private readonly Dictionary<string, HashSet<int>> _historyContacts = [];

    private HashSet<int> HistoryContacts(UnitRow unit)
    {
        if (!_historyContacts.TryGetValue(unit.Slug, out var ids))
        {
            _historyContacts[unit.Slug] = ids = ContactsOf(Subtree(unit.UnitId)).Select(c => c.Id).ToHashSet();
        }

        return ids;
    }

    private static bool IsInfantry(UnitRow unit) => unit.Slug.EndsWith("-rar", StringComparison.Ordinal);

    private IReadOnlyList<PictureFacts> PicturesOf(IReadOnlyCollection<ContactSummary> contacts, IReadOnlySet<int> ids)
    {
        if (contacts.Count == 0)
        {
            return [];
        }

        var first = DateOnly.ParseExact(Day(contacts.Min(c => c.Dtg)!), "yyyy-MM-dd", CultureInfo.InvariantCulture).AddDays(-30);
        var last = DateOnly.ParseExact(Day(contacts.Max(c => c.Dtg)!), "yyyy-MM-dd", CultureInfo.InvariantCulture).AddDays(30);

        var linked = input.Pictures.Where(p => p.ContactId is { } id && ids.Contains(id))
            .Select(p => Picture(p, "linked", contacts.Count(c => p.Lat is { } la && p.Lon is { } lo && Km(la, lo, c.Lat, c.Lon) <= PictureRadiusKm)));

        var near = input.Pictures
            .Where(p => !(p.ContactId is { } id && ids.Contains(id)) && p.Lat is not null && p.Lon is not null
                && (p.DateTaken is null || (p.DateTaken >= first && p.DateTaken <= last)))
            .Select(p => (Picture: p, Nearby: contacts.Count(c => Km(p.Lat!.Value, p.Lon!.Value, c.Lat, c.Lon) <= PictureRadiusKm)))
            .Where(x => x.Nearby >= PictureMinNearby)
            .OrderByDescending(x => x.Picture.DateTaken is not null).ThenByDescending(x => x.Nearby).ThenBy(x => x.Picture.Id)
            .Take(12)
            .Select(x => Picture(x.Picture, "near", x.Nearby));

        return linked.Concat(near).ToList();
    }

    private static PictureFacts Picture(SitePicture p, string how, int nearby) => new(
        p.Id, p.Url, p.ThumbUrl, p.Caption, p.Credit, p.DateTaken?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), p.ContactId, how, nearby);

    // ---------------------------------------------------------------- small things

    private static string MapUrl(int unitId) => $"/battlemap?units={unitId}";

    private static string Name(NamedCount[] names, int oneBased) => oneBased >= 1 && oneBased <= names.Length ? names[oneBased - 1].Name : "Not recorded";

    private static string Day(string dtg) => dtg.Length >= 10 ? dtg[..10] : dtg;

    private static int Year(string dtg) => int.Parse(dtg[..4], CultureInfo.InvariantCulture);

    /// <summary>The distance between two points, in kilometres (haversine).</summary>
    public static double Km(double lat1, double lon1, double lat2, double lon2)
    {
        const double r = 6371;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLon = (lon2 - lon1) * Math.PI / 180;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
                + Math.Cos(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return 2 * r * Math.Asin(Math.Min(1, Math.Sqrt(a)));
    }
}
