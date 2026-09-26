extern alias features;
using Avw.Api.Map;
using features::Avw.Features;

namespace Avw.Api.Tests;

public class WarTimelineBuilderTests
{
    // A battalion (1) with two companies (2, 3) and a New Zealand company left out (5); a cavalry regiment (20); a task force (8)
    // with an artillery group (9) nested under it that the Battle Map's tree has on its own. Each of 1, 20 and 8 has a history.
    private static readonly UnitNode[] Tree =
    [
        new(1, null, "5 RAR", "5 Battalion, Royal Australian Regiment", false),
        new(2, 1, "A Coy", "A Company, 5 Battalion, Royal Australian Regiment", false),
        new(3, 1, "B Coy", "B Company, 5 Battalion, Royal Australian Regiment", false),
        new(5, 1, "V Coy", "V Company, 5 Battalion, Royal Australian Regiment", false),
        new(20, null, "3 Cav Regt", "3 Cavalry Regiment", false),
        new(8, null, "1 ATF", "1 Australian Task Force", false),
        new(9, null, "1 ATF Artillery", "1 ATF Artillery", false),
    ];

    private const string UnitsCsv = """
        role,unit_id,slug,parent,arm,awm,tours,title,short,roll_names
        history,1,5-rar,,infantry,,,"5th Battalion, Royal Australian Regiment",5 RAR,
        history,20,3-cavalry-regiment,,cavalry,,,3rd Cavalry Regiment,3 Cav Regt,
        history,8,1-atf,,headquarters,,,1st Australian Task Force,1 ATF,
        nest,9,1-atf-artillery,1-atf,artillery,,,1 ATF Artillery,1 ATF Arty,
        exclude,5,,,,,,"V Company (New Zealand)",,
        """;

    private static readonly NamedCount[] Tasks = [new("Patrol", 0), new("Ambush", 0), new("Arty/Mor", 0)];

    // 1 and 2 are one operation spelt two ways; 3 is continuing patrolling; 4 a big operation; 5 a short, costly one.
    private static readonly NamedCount[] Operations =
        [new("Smithfield (original - Vendetta)", 0), new("Smithfield", 0), new("TAOR", 0), new("Hardihood", 0), new("Bribie", 0)];

    private static ContactSummary C(int id, string day, int[] units, int task = 1, int op = 0, int frKia = 0, int enKia = 0) =>
        new(id, $"{day}T10:00:00", 10.5, 107.2, 10, frKia, 5, enKia, units, op, task, 1, 0, frKia, 0, enKia, 0);

    private static WarTimelineBuilder Builder(
        IReadOnlyList<ContactSummary> contacts, string aliases = "name,recorded\nSmithfield,Smithfield (original - Vendetta);Smithfield\n", string phases = "")
    {
        var table = UnitsTable.Parse(UnitsCsv);
        var catalogue = new FilterCatalogue("1966-01-01", "1971-12-31", new(0, 0), new(0, 0), new(0, 0), new(0, 0), [new("1ATF", 0), new("1RAR", 0)], Operations, Tasks, Tree);
        var facts = new FactSheetBuilder(table, new FactInputs(
            contacts, catalogue, new Dictionary<int, ContactRole>(), [], Array.Empty<(string, int)>().ToLookup(x => x.Item1, x => x.Item2), [], [], new HashSet<string>()));
        return new WarTimelineBuilder(table, facts, catalogue, WarTimelineBuilder.ParseAliases(aliases), contacts, WarTimelineBuilder.ParsePhases(phases));
    }

    private static ContactSummary InSeries(ContactSummary c, int series) => c with { Series = series };

    private static ContactDetail Report(int id, string summary) =>
        new(id, "1966-08-18T16:00:00", 10.5, 107.2, null, null, null, [], 0, 0, 0, 0, 0, 0, "Original.", null, null, summary);

    [Fact]
    public void Counts_each_month_by_task_unit_and_operation_with_its_casualties_and_a_map_of_it()
    {
        var contacts = new[]
        {
            C(1, "1966-08-02", [2], task: 1, op: 4), C(2, "1966-08-10", [2, 20], task: 2, op: 4, enKia: 3),
            C(3, "1966-08-20", [20], task: 3, op: 3), C(4, "1966-08-28", [1], task: 1),
            C(5, "1966-09-01", [1], task: 1, frKia: 1),
        };

        var facts = Builder(contacts).Build(new Dictionary<int, ContactDetail>());

        Assert.Equal(["1966-08", "1966-09"], facts.Months.Select(m => m.Month));
        var august = facts.Months[0];
        Assert.Equal((4, 3), (august.Contacts, august.Casualties.EnKia));
        Assert.Equal([("Patrol", 2), ("Ambush", 1), ("Artillery and mortar fire", 1)], august.Tasks.Select(t => (t.Task, t.Contacts)));
        Assert.Equal([("5-rar", 3), ("3-cavalry-regiment", 2)], august.Units.Select(u => (u.Slug, u.Contacts)));
        Assert.Equal([("Hardihood", 2)], august.Operations.Select(o => (o.Name, o.Contacts)));   // TAOR patrolling is routine, not an operation
        Assert.Equal((1, 1), (august.Routine, august.Unassigned));
        Assert.Equal("/battlemap?from=1966-08-01&to=1966-08-31", august.MapUrl);
        Assert.Equal(["TAOR"], facts.Routine);                                                   // the continuing activities the record has
    }

    [Fact]
    public void Keeps_a_months_most_significant_contacts_with_their_plain_English_summaries()
    {
        var contacts = Enumerable.Range(1, 8).Select(i => C(i, $"1966-08-{i:00}", [2], enKia: i)).ToArray();

        var facts = Builder(contacts).Build(new Dictionary<int, ContactDetail> { [8] = Report(8, "A platoon met eight enemy.") });

        var notable = facts.Months.Single().Notable;
        Assert.Equal([8, 7, 6, 5, 4, 3], notable.Select(c => c.Id));
        Assert.Equal(("5-rar", "A Coy", "A platoon met eight enemy.", "/battlemap?incident=8"), (notable[0].Unit, notable[0].UnitLabel, notable[0].Summary, notable[0].MapUrl));
        Assert.Null(notable[1].Summary);
        Assert.Contains(8, Builder(contacts).Candidates());
    }

    [Fact]
    public void Gives_an_operation_a_place_of_its_own_by_its_size_or_its_cost_with_the_records_spellings_brought_together()
    {
        var contacts = new List<ContactSummary>
        {
            C(1, "1966-08-18", [2], op: 1, frKia: 17, enKia: 245), C(2, "1966-08-19", [2], op: 2),   // Long Tan, two spellings
            C(3, "1967-02-17", [2], op: 5, enKia: 10),                                                // Bribie: too small and too light
        };
        contacts.AddRange(Enumerable.Range(10, 20).Select(i => C(i, $"1966-05-{i:00}", [1], op: 4))); // Hardihood: 20 contacts
        contacts.AddRange(Enumerable.Range(40, 25).Select(i => C(i, "1966-07-01", [20], op: 3)));   // TAOR: many, but routine

        var ops = Builder(contacts).Build(new Dictionary<int, ContactDetail>()).Operations;

        Assert.Equal(["Hardihood", "Smithfield"], ops.Select(o => o.Name));
        var smithfield = ops[1];
        Assert.Equal(("smithfield", 2, 17), (smithfield.Slug, smithfield.Contacts, smithfield.Casualties.FrKia));
        Assert.Equal(["Smithfield", "Smithfield (original - Vendetta)"], smithfield.Recorded);
        Assert.Equal("/battlemap?ops=Smithfield&ops=Smithfield%20%28original%20-%20Vendetta%29", smithfield.MapUrl);
    }

    [Fact]
    public void Dates_an_operation_by_its_main_run_of_contacts_not_by_a_stray_one_far_off()
    {
        var contacts = Enumerable.Range(1, 20).Select(i => C(i, $"1966-05-{i:00}", [1], op: 4))
            .Append(C(99, "1969-01-05", [1], op: 4))                                                  // the name used again, or mistyped
            .ToArray();

        var hardihood = Builder(contacts).Build(new Dictionary<int, ContactDetail>()).Operations.Single();

        Assert.Equal(("1966-05-01", "1966-05-20", 1, 21), (hardihood.From, hardihood.To, hardihood.Outside, hardihood.Contacts));
    }

    [Fact]
    public void Writes_each_units_Battle_Map_filter_exactly_with_the_units_nested_under_it_and_without_those_left_out()
    {
        var facts = Builder([C(1, "1966-08-02", [2]), C(2, "1966-08-03", [5]), C(3, "1966-08-04", [9])]).Build(new Dictionary<int, ContactDetail>());

        var units = facts.Units.ToDictionary(u => u.Slug);
        Assert.Equal("1!,2,3", units["5-rar"].MapUnits);                   // the battalion alone, and its companies but New Zealand's
        Assert.Equal("20", units["3-cavalry-regiment"].MapUnits);          // the whole regiment
        Assert.Equal("8,9", units["1-atf"].MapUnits);                      // with its artillery, which the tree has on its own
        Assert.Equal((1, 1), (units["5-rar"].Contacts, units["5-rar"].Recorded));
    }

    [Fact]
    public void Gives_each_phase_its_figures_and_a_Battle_Map_link_over_its_dates_with_its_units_and_data_series()
    {
        var contacts = new[]
        {
            InSeries(C(1, "1965-09-14", [1], op: 4, frKia: 1), 2), InSeries(C(2, "1966-01-02", [2], op: 4), 2),
            C(3, "1966-06-01", [2]), C(4, "1966-06-02", [20]),
        };
        const string phases = """
            slug,title,from,to,units,series
            with-the-173rd,1 RAR with the US 173rd Airborne Brigade,1965-05-29,1966-06-15,,1RAR
            the-battalion,5 RAR in 1966,1966-01-01,1966-12-31,5-rar,
            """;

        var facts = Builder(contacts, phases: phases).Build(new Dictionary<int, ContactDetail>());

        var first = facts.Phases[0];
        Assert.Equal(("with-the-173rd", 2, 2, 1), (first.Slug, first.Contacts, first.Recorded, first.Casualties.FrKia));
        Assert.Equal("/battlemap?from=1965-05-29&to=1966-06-15&series=1RAR", first.MapUrl);
        Assert.Equal([("Hardihood", 2)], first.Operations.Select(o => (o.Name, o.Contacts)));
        var second = facts.Phases[1];
        Assert.Equal(2, second.Contacts);
        Assert.Equal(["5-rar"], second.UnitSlugs);
        Assert.Equal("/battlemap?from=1966-01-01&to=1966-12-31&units=1%21%2C2%2C3", second.MapUrl);   // 1!,2,3
    }

    [Fact]
    public void Reads_the_operations_names_by_the_records_names()
    {
        var aliases = WarTimelineBuilder.ParseAliases("name,recorded\nNew Life,\"16/65, New Life\"\nLavarack,Lavarack;Lavarack/Toan Thang III\n");

        Assert.Equal("New Life", aliases["16/65, New Life"]);
        Assert.Equal("Lavarack", aliases["lavarack/toan thang iii"]);                                 // without case
        Assert.Equal("Cung Chung 3", WarTimelineBuilder.OperationName("  Cung  Chung 3 "));
        Assert.True(WarTimelineBuilder.IsRoutine("taor  patrol"));
    }
}
