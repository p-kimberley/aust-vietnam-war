namespace Avw.Api.Analytics;

/// <summary>
/// The thirteen charts, as pure functions of the data so they can be tested without Elasticsearch. Contact charts take the
/// incidents the map is showing; personnel charts take the whole nominal roll.
/// </summary>
public static class Charts
{
    public const string Friendly = "Friendly";
    public const string Enemy = "Enemy";

    /// <summary>How many tasks, weapons or services get their own line before the rest are grouped as "Other".</summary>
    public const int TopN = 8;

    private static readonly string[] SmallArms = ["Small Arms", "Grenade", "Rocket"];
    private static readonly (string Name, int From, int To)[] AgeBands =
        [("16-18", 16, 18), ("19-22", 19, 22), ("23-26", 23, 26), ("27-30", 27, 30), ("31-35", 31, 35), ("36-40", 36, 40), ("41-50", 41, 50), ("51 and over", 51, 200)];

    public const string OtherName = "Other";
    public const string UnknownName = "Unknown";

    public static readonly ChartInfo[] All =
    [
        new("battle-damage-date", "Casualties over time", ChartGroup.Casualties, "Friendly and enemy killed and wounded, added up for each day.", true),
        new("battle-damage-time", "Casualties by time of day", ChartGroup.Casualties, "Friendly and enemy killed and wounded, added up for each hour of the day.", true),
        new("loss-ratio-date", "Loss ratio over time, by who fired first", ChartGroup.Casualties, "Friendly casualties for each enemy casualty, averaged for each month, by whoever opened fire.", true),
        new("loss-ratio-time", "Loss ratio by time of day, by who fired first", ChartGroup.Casualties, "Friendly casualties for each enemy casualty, averaged for each hour of the day, by whoever opened fire.", true),
        new("incident-frequency-date", "Contacts over time, by unit task", ChartGroup.Frequency, "How many contacts happened each month, by what the friendly unit was doing.", true),
        new("incident-frequency-time", "Contacts by time of day, by unit task", ChartGroup.Frequency, "How many contacts happened in each hour of the day, by what the friendly unit was doing.", true),
        new("weapon-rounds-range", "Rounds fired by range", ChartGroup.Weapons, "Average rounds fired per weapon use at each engagement range, for small arms, grenades and rockets.", true),
        new("weapon-casualty-range", "Casualties by range", ChartGroup.Weapons, "Average casualties caused per weapon use at each engagement range, for small arms, grenades and rockets.", true),
        new("weapon-rounds-task", "Friendly rounds fired, by unit task", ChartGroup.Weapons, "Total rounds fired by friendly forces, by weapon, for each kind of unit task.", true),
        new("rounds-per-casualty", "Rounds fired per enemy casualty", ChartGroup.Weapons, "Friendly rounds fired for each enemy casualty in each month, by unit task.", true),
        new("age-at-death", "Age at death, by service", ChartGroup.Personnel, "Average age of those who died, by month of death and service.", false),
        new("age-at-tour", "Age at the start of a tour, by service", ChartGroup.Personnel, "Average age of those starting a tour of duty, by month and service.", false),
        new("tour-age-bands", "Tours started, by age", ChartGroup.Personnel, "How many tours of duty began each month, by the age of the person.", false),
    ];

    public static ChartInfo? Find(string id) => All.FirstOrDefault(c => c.Id == id);

    private static ChartInfo Info(string id) => All.First(c => c.Id == id);

    // ---------------------------------------------------------------- contacts

    public static ChartResult BattleDamageByDate(IReadOnlyList<IncidentRow> rows) =>
        Damage(rows, "battle-damage-date", XKind.Time, "Date", r => Day(r.Dtg));

    public static ChartResult BattleDamageByTime(IReadOnlyList<IncidentRow> rows) =>
        Damage(rows, "battle-damage-time", XKind.Hour, "Hour of the day", r => r.Dtg.Hour);

    private static ChartResult Damage(IReadOnlyList<IncidentRow> rows, string id, XKind x, string xLabel, Func<IncidentRow, double> bucket)
    {
        (string Name, Func<IncidentRow, int> Get)[] measures =
            [("Enemy killed", r => r.EnKia), ("Enemy wounded", r => r.EnWia), ("Friendly killed", r => r.FrKia), ("Friendly wounded", r => r.FrWia)];
        var series = measures.Select(m => new ChartSeries(m.Name,
            Points(rows.GroupBy(bucket).OrderBy(g => g.Key).Select(g => (g.Key, (double)g.Sum(m.Get)))))).ToArray();
        return Result(id, ChartShape.Area, x, xLabel, "Casualties", null, series, rows.Count, null);
    }

    public static ChartResult LossRatioByDate(IReadOnlyList<IncidentRow> rows) =>
        LossRatio(rows, "loss-ratio-date", XKind.Time, "Month", r => Month(r.Dtg));

    public static ChartResult LossRatioByTime(IReadOnlyList<IncidentRow> rows) =>
        LossRatio(rows, "loss-ratio-time", XKind.Hour, "Hour of the day", r => r.Dtg.Hour);

    private static ChartResult LossRatio(IReadOnlyList<IncidentRow> rows, string id, XKind x, string xLabel, Func<IncidentRow, double> bucket)
    {
        // Friendly casualties for each enemy casualty; a contact with no enemy casualties counts as one, so it cannot divide by zero.
        static double Ratio(IncidentRow r) => (double)r.FrCas / Math.Max(r.EnCas, 1);
        var series = rows.GroupBy(r => Who(r.FiredFirst)).OrderBy(g => Array.IndexOf(new[] { Friendly, Enemy, UnknownName }, g.Key))
            .Select(g => new ChartSeries($"{g.Key} fired first",
                Points(g.GroupBy(bucket).OrderBy(b => b.Key).Select(b => (b.Key, Round(b.Average(Ratio), 2))))))
            .ToArray();
        return Result(id, ChartShape.Line, x, xLabel, "Friendly casualties per enemy casualty", null, series, rows.Count,
            "A contact with no enemy casualties is counted as one, so a single friendly loss reads as a ratio of its own size.");
    }

    public static ChartResult IncidentFrequencyByDate(IReadOnlyList<IncidentRow> rows) =>
        Frequency(rows, "incident-frequency-date", XKind.Time, "Month", r => Month(r.Dtg));

    public static ChartResult IncidentFrequencyByTime(IReadOnlyList<IncidentRow> rows) =>
        Frequency(rows, "incident-frequency-time", XKind.Hour, "Hour of the day", r => r.Dtg.Hour);

    private static ChartResult Frequency(IReadOnlyList<IncidentRow> rows, string id, XKind x, string xLabel, Func<IncidentRow, double> bucket)
    {
        var task = TaskGrouper(rows.Select(r => r.Task), rows.Count);
        var buckets = rows.Select(bucket).Distinct().Order().ToArray();
        var series = rows.GroupBy(r => task(r.Task)).OrderBy(g => g.Key == OtherName ? 1 : 0).ThenByDescending(g => g.Count())
            .Select(g =>
            {
                var counts = g.GroupBy(bucket).ToDictionary(b => b.Key, b => (double)b.Count());
                return new ChartSeries(g.Key, Points(buckets.Select(b => (b, counts.GetValueOrDefault(b)))));   // zeros kept so areas stack cleanly
            }).ToArray();
        return Result(id, ChartShape.StackedArea, x, xLabel, "Contacts", null, series, rows.Count, null);
    }

    // ---------------------------------------------------------------- weapons

    public static ChartResult WeaponRoundsByRange(IReadOnlyList<IncidentRow> rows) =>
        WeaponRange(rows, "weapon-rounds-range", "Rounds fired", e => e.Rounds);

    public static ChartResult WeaponCasualtiesByRange(IReadOnlyList<IncidentRow> rows) =>
        WeaponRange(rows, "weapon-casualty-range", "Casualties", e => e.Casualties);

    private static ChartResult WeaponRange(IReadOnlyList<IncidentRow> rows, string id, string yLabel, Func<WeaponEffectRow, int> measure)
    {
        const int binMetres = 10;
        var uses = rows.SelectMany(r => r.Effects)
            .Where(e => e.Weapon is not null && e.Category is not null && SmallArms.Contains(e.Category) && e.Range > 0)     // a range of 0 means not recorded
            .ToList();
        var top = uses.GroupBy(e => e.Weapon!).OrderByDescending(g => g.Count()).Take(TopN).Select(g => g.Key).ToHashSet();
        var series = uses.Where(e => top.Contains(e.Weapon!)).GroupBy(e => e.Weapon!).OrderByDescending(g => g.Count())
            .Select(g => new ChartSeries(g.Key, Points(g.GroupBy(e => e.Range / binMetres * binMetres).OrderBy(b => b.Key)
                .Select(b => ((double)b.Key, Round(b.Average(measure), 2))))))
            .ToArray();
        return Result(id, ChartShape.Line, XKind.Value, $"Engagement range (metres, in steps of {binMetres})", $"{yLabel} per use", null, series, rows.Count,
            "Only weapon uses with a recorded range are shown, and only the eight most used weapons.");
    }

    public static ChartResult WeaponRoundsByTask(IReadOnlyList<IncidentRow> rows)
    {
        var fired = rows.SelectMany(r => r.Effects.Where(e => e.Actor == Friendly && e.Weapon is not null && e.Rounds > 0).Select(e => (Task: TaskName(r.Task), e.Weapon, e.Rounds))).ToList();
        var tasks = fired.GroupBy(f => f.Task).OrderByDescending(g => g.Sum(f => f.Rounds)).Take(12).Select(g => g.Key).ToArray();
        var weapons = fired.GroupBy(f => f.Weapon!).OrderByDescending(g => g.Sum(f => f.Rounds)).Take(TopN).Select(g => g.Key).ToHashSet();
        var series = fired.Where(f => tasks.Contains(f.Task)).GroupBy(f => weapons.Contains(f.Weapon!) ? f.Weapon! : OtherName)
            .OrderBy(g => g.Key == OtherName ? 1 : 0).ThenByDescending(g => g.Sum(f => f.Rounds))
            .Select(g => new ChartSeries(g.Key, Points(tasks.Select((t, i) => ((double)i, (double)g.Where(f => f.Task == t).Sum(f => f.Rounds))))))
            .ToArray();
        return Result("weapon-rounds-task", ChartShape.StackedBar, XKind.Category, "Unit task", "Rounds fired", tasks, series, rows.Count,
            "The twelve tasks that fired the most rounds.");
    }

    public static ChartResult RoundsPerEnemyCasualty(IReadOnlyList<IncidentRow> rows)
    {
        var task = TaskGrouper(rows.Select(r => r.Task), rows.Count);
        var items = rows.Select(r => (Task: task(r.Task), Month: Month(r.Dtg), Rounds: r.Effects.Where(e => e.Actor == Friendly).Sum(e => e.Rounds), r.EnCas)).ToList();
        var series = items.GroupBy(i => i.Task).OrderBy(g => g.Key == OtherName ? 1 : 0).ThenByDescending(g => g.Sum(i => i.Rounds))
            .Select(g => new ChartSeries(g.Key, Points(g.GroupBy(i => i.Month).OrderBy(m => m.Key)
                .Where(m => m.Sum(i => i.Rounds) > 0)
                .Select(m => (m.Key, Round((double)m.Sum(i => i.Rounds) / Math.Max(m.Sum(i => i.EnCas), 1), 1))))))
            .Where(s => s.Points.Length > 0).ToArray();
        return Result("rounds-per-casualty", ChartShape.Line, XKind.Time, "Month", "Rounds fired per enemy casualty", null, series, rows.Count,
            "Months with no enemy casualties are counted as one, and months where no rounds were recorded are left out.");
    }

    // ---------------------------------------------------------------- personnel

    public static ChartResult AgeAtDeath(IReadOnlyList<PersonRow> people)
    {
        var deaths = people.Where(p => p is { Birth: not null, Death: not null } && Plausible(AgeOn(p.Birth!.Value, p.Death!.Value)))
            .Select(p => (Branch: BranchName(p.Branch), When: Month(p.Death!.Value), Age: AgeOn(p.Birth!.Value, p.Death!.Value))).ToList();
        return Result("age-at-death", ChartShape.Line, XKind.Time, "Month of death", "Average age", null, ByBranch(deaths), deaths.Count,
            "Only those whose date of birth and date of death are both recorded.");
    }

    public static ChartResult AgeAtTour(IReadOnlyList<PersonRow> people)
    {
        var tours = TourAges(people).Select(t => (t.Branch, t.When, t.Age)).ToList();
        return Result("age-at-tour", ChartShape.Line, XKind.Time, "Month the tour started", "Average age", null, ByBranch(tours), tours.Count,
            "Only tours with a start date, for people whose date of birth is recorded.");
    }

    public static ChartResult TourAgeBands(IReadOnlyList<PersonRow> people)
    {
        var tours = TourAges(people).ToList();
        var months = tours.Select(t => t.When).Distinct().Order().ToArray();
        var series = AgeBands.Select(b =>
        {
            var counts = tours.Where(t => t.Age >= b.From && t.Age <= b.To).GroupBy(t => t.When).ToDictionary(g => g.Key, g => (double)g.Count());
            return new ChartSeries(b.Name, Points(months.Select(m => (m, counts.GetValueOrDefault(m)))));
        }).Where(s => s.Points.Any(p => p[1] > 0)).ToArray();
        return Result("tour-age-bands", ChartShape.StackedArea, XKind.Time, "Month the tour started", "Tours started", null, series, tours.Count,
            "Only tours with a start date, for people whose date of birth is recorded.");
    }

    private static IEnumerable<(string Branch, double When, int Age)> TourAges(IReadOnlyList<PersonRow> people) =>
        people.Where(p => p.Birth is not null).SelectMany(p => p.TourStarts
            .Select(start => (Branch: BranchName(p.Branch), When: Month(start), Age: AgeOn(p.Birth!.Value, start)))
            .Where(t => Plausible(t.Age)));

    private static ChartSeries[] ByBranch(List<(string Branch, double When, int Age)> items)
    {
        var top = items.GroupBy(i => i.Branch).OrderByDescending(g => g.Count()).Take(TopN).Select(g => g.Key).ToHashSet();
        return items.Where(i => top.Contains(i.Branch)).GroupBy(i => i.Branch).OrderByDescending(g => g.Count())
            .Select(g => new ChartSeries(g.Key, Points(g.GroupBy(i => i.When).OrderBy(m => m.Key).Select(m => (m.Key, Round(m.Average(i => i.Age), 1))))))
            .ToArray();
    }

    // ---------------------------------------------------------------- helpers

    /// <summary>Whole years between two dates.</summary>
    public static int AgeOn(DateOnly birth, DateOnly on)
    {
        var age = on.Year - birth.Year;
        return on < birth.AddYears(age) ? age - 1 : age;
    }

    private static bool Plausible(int age) => age is >= 14 and <= 90;           // anything else is a typing error in a date

    public static double Day(DateTime d) => new DateTimeOffset(d.Date, TimeSpan.Zero).ToUnixTimeMilliseconds();

    public static double Month(DateTime d) => new DateTimeOffset(new DateTime(d.Year, d.Month, 1), TimeSpan.Zero).ToUnixTimeMilliseconds();

    public static double Month(DateOnly d) => Month(d.ToDateTime(TimeOnly.MinValue));

    private static string Who(string? firedFirst) => firedFirst?.Trim() switch
    {
        { } s when s.StartsWith("Friend", StringComparison.OrdinalIgnoreCase) => Friendly,
        { } s when s.StartsWith("Enem", StringComparison.OrdinalIgnoreCase) => Enemy,
        _ => UnknownName,
    };

    private static string TaskName(string? task) => string.IsNullOrWhiteSpace(task) ? UnknownName : task.Trim();

    private static string BranchName(string? branch) => string.IsNullOrWhiteSpace(branch) ? UnknownName : branch.Trim();

    /// <summary>Names the <see cref="TopN"/> most common tasks and puts every other task under "Other".</summary>
    private static Func<string?, string> TaskGrouper(IEnumerable<string?> tasks, int _)
    {
        var top = tasks.Select(TaskName).GroupBy(t => t).OrderByDescending(g => g.Count()).ThenBy(g => g.Key).Take(TopN).Select(g => g.Key).ToHashSet();
        return t => top.Contains(TaskName(t)) ? TaskName(t) : OtherName;
    }

    /// <summary>Rounds halves upwards, so an average of 1.125 reads as 1.13 and not the banker's 1.12.</summary>
    private static double Round(double value, int places) => Math.Round(value, places, MidpointRounding.AwayFromZero);

    private static double[][] Points(IEnumerable<(double X, double Y)> points) => points.Select(p => new[] { p.X, p.Y }).ToArray();

    private static ChartResult Result(string id, ChartShape shape, XKind x, string xLabel, string yLabel, string[]? categories, ChartSeries[] series, int rows, string? note) =>
        new(id, Info(id).Title, shape, x, xLabel, yLabel, categories, series, rows, note);

    /// <summary>Draws <paramref name="id"/> from the incidents or the people, whichever it uses; the other list may be empty.</summary>
    public static ChartResult? Draw(string id, IReadOnlyList<IncidentRow> incidents, IReadOnlyList<PersonRow> people) => id switch
    {
        "battle-damage-date" => BattleDamageByDate(incidents),
        "battle-damage-time" => BattleDamageByTime(incidents),
        "loss-ratio-date" => LossRatioByDate(incidents),
        "loss-ratio-time" => LossRatioByTime(incidents),
        "incident-frequency-date" => IncidentFrequencyByDate(incidents),
        "incident-frequency-time" => IncidentFrequencyByTime(incidents),
        "weapon-rounds-range" => WeaponRoundsByRange(incidents),
        "weapon-casualty-range" => WeaponCasualtiesByRange(incidents),
        "weapon-rounds-task" => WeaponRoundsByTask(incidents),
        "rounds-per-casualty" => RoundsPerEnemyCasualty(incidents),
        "age-at-death" => AgeAtDeath(people),
        "age-at-tour" => AgeAtTour(people),
        "tour-age-bands" => TourAgeBands(people),
        _ => null,
    };
}
