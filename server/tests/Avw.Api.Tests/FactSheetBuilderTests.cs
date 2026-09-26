extern alias features;
using Avw.Api.Map;
using features::Avw.Features;

namespace Avw.Api.Tests;

public class FactSheetBuilderTests
{
    // A battalion (1) with two companies (2, 3), a platoon in one (4) and a New Zealand company left out (5); an artillery group (9)
    // nested under a task force (8); and a cavalry regiment (20).
    private static readonly UnitNode[] Tree =
    [
        new(1, null, "5 RAR", "5 Battalion, Royal Australian Regiment", false),
        new(2, 1, "A Coy", "A Company, 5 Battalion, Royal Australian Regiment", false),
        new(3, 1, "B Coy", "B Company, 5 Battalion, Royal Australian Regiment", false),
        new(4, 2, "1 Pl", "1 Platoon, A Company, 5 Battalion, Royal Australian Regiment", false),
        new(5, 1, "V Coy", "V Company, 5 Battalion, Royal Australian Regiment", false),
        new(8, null, "1 ATF", "1 Australian Task Force", false),
        new(9, null, "1 ATF Artillery", "1 ATF Artillery", false),
        new(20, null, "3 Cav Regt", "3 Cavalry Regiment", false),
        new(30, null, "1 Field Regt", "1 Field Regiment", false),
        new(31, 30, "105 Field Bty", "105 Field Battery, 1 Field Regiment", false),
        new(40, null, "6 RAR", "6 Battalion, Royal Australian Regiment", false),
    ];

    private const string UnitsCsv = """
        role,unit_id,slug,parent,arm,awm,tours,title,short,roll_names
        history,1,5-rar,,infantry,https://www.awm.gov.au/collection/U53500,1966-04..1967-05;1969-02..1970-02,"5th Battalion, Royal Australian Regiment",5 RAR,"5th Battalion, The Royal Australian Regiment"
        history,8,1-atf,,headquarters,,,1st Australian Task Force,1 ATF,"Headquarters, 1st Australian Task Force"
        history,20,3-cavalry-regiment,,cavalry,,,3rd Cavalry Regiment,3 Cav Regt,"A Squadron, 3rd Cavalry Regiment"
        history,30,1-field-regiment,,artillery,,,1st Field Regiment,1 Fd Regt,1st Field Regiment
        history,40,6-rar,,infantry,,1966-05..1967-06,"6th Battalion, Royal Australian Regiment",6 RAR,"6th Battalion, The Royal Australian Regiment"
        nest,9,1-atf-artillery,1-atf,artillery,,,1 ATF Artillery,1 ATF Arty,
        exclude,5,,,,,,"V Company (New Zealand)",,
        """;

    private static readonly NamedCount[] Tasks = [new("Patrol", 0), new("Ambush", 0)];
    private static readonly NamedCount[] Operations = [new("Hardihood", 0), new("Hammer", 0)];

    private static ContactSummary C(int id, string day, int[] units, int task = 1, int op = 0, int frKia = 0, int enKia = 0, double lat = 10.5, double lon = 107.2) =>
        new(id, $"{day}T10:00:00", lat, lon, 10, frKia, 5, enKia, units, op, task, 1, 0, frKia, 0, enKia, 0);

    private static FactSheetBuilder Builder(IReadOnlyList<ContactSummary> contacts, IReadOnlyList<RollPerson>? roll = null, ILookup<string, int>? links = null,
        IReadOnlyList<SitePicture>? pictures = null, IReadOnlySet<string>? portraits = null, IReadOnlyDictionary<int, ContactRole>? roles = null) =>
        new(UnitsTable.Parse(UnitsCsv), new FactInputs(
            contacts,
            new FilterCatalogue("1966-01-01", "1971-12-31", new(0, 0), new(0, 0), new(0, 0), new(0, 0), [new("1ATF", 0)], Operations, Tasks, Tree),
            roles ?? new Dictionary<int, ContactRole>(),
            roll ?? [],
            links ?? Array.Empty<(string, int)>().ToLookup(x => x.Item1, x => x.Item2),
            pictures ?? [],
            [new Place("Nui Dat", "Base", 10.5, 107.2)],
            portraits ?? new HashSet<string>()));

    private static UnitRow Unit(string slug) => UnitsTable.Parse(UnitsCsv).Histories.Single(u => u.Slug == slug);

    [Fact]
    public void Reads_the_units_table_with_its_nesting_and_exclusions()
    {
        var table = UnitsTable.Parse(UnitsCsv);

        Assert.Equal(["5-rar", "1-atf", "3-cavalry-regiment", "1-field-regiment", "6-rar"], table.Histories.Select(h => h.Slug));
        Assert.Equal("5th Battalion, Royal Australian Regiment", table.Histories.First().Title);
        Assert.Equal(("infantry", "https://www.awm.gov.au/collection/U53500"), (table.Histories.First().Arm, table.Histories.First().Awm));
        Assert.Equal([new TourSpan("1966-04", "1967-05"), new TourSpan("1969-02", "1970-02")], table.Histories.First().Tours);
        Assert.Equal(8, table.Nested[9]);
        Assert.Contains(5, table.Excluded);
    }

    [Fact]
    public void Counts_a_units_contacts_with_its_sub_units_but_not_those_left_out_and_nests_re_parented_units()
    {
        var contacts = new[]
        {
            C(1, "1966-03-03", [2]), C(2, "1966-04-01", [4]), C(3, "1967-01-01", [3]),
            C(4, "1967-02-01", [5]),                                  // New Zealand only: not the battalion's
            C(5, "1968-01-01", [9]), C(6, "1968-02-01", [8]),
        };
        var b = Builder(contacts);

        var rar = b.Build(Unit("5-rar"), new Dictionary<int, ContactDetail>());
        var atf = b.Build(Unit("1-atf"), new Dictionary<int, ContactDetail>());

        Assert.Equal(3, rar.Figures.Contacts);
        Assert.Equal(("1966-03-03", "1967-01-01"), (rar.Figures.First, rar.Figures.Last));
        Assert.Equal(2, atf.Figures.Contacts);
        Assert.Equal("/battlemap?units=1", rar.Unit.MapUrl);
    }

    [Fact]
    public void Gives_the_companies_with_enough_contacts_a_section_named_without_their_units_name_but_not_their_platoons()
    {
        var contacts = Enumerable.Range(1, 25).Select(i => C(i, $"1966-05-{i:00}", [4]))
            .Concat(Enumerable.Range(26, 5).Select(i => C(i, "1966-06-01", [3])))
            .Concat(Enumerable.Range(40, 25).Select(i => C(i, $"1968-01-{i - 39:00}", [9])))
            .ToList();
        var b = Builder(contacts);

        var rar = b.Build(Unit("5-rar"), new Dictionary<int, ContactDetail>());
        var atf = b.Build(Unit("1-atf"), new Dictionary<int, ContactDetail>());

        Assert.Equal([("a-company", (string?)null, "A Company")],
            rar.SubUnits.Select(s => (s.Slug, s.Parent, s.Title)));                 // B Company, with 5 contacts, has none; 1 Platoon is in A Company's
        Assert.Equal([("1966-05-01", "/battlemap?incident=1", "Patrol"), ("1966-05-02", "/battlemap?incident=2", "Patrol"), ("1966-05-03", "/battlemap?incident=3", "Patrol")],
            rar.SubUnits[0].Notable.Select(n => (n.Date, n.Url, n.Activity)));
        Assert.Equal(("1-atf-artillery", "1 ATF Artillery"), (atf.SubUnits.Single().Slug, atf.SubUnits.Single().Title));
    }

    [Fact]
    public void Works_out_the_activity_mix_operations_years_and_places()
    {
        var contacts = new[]
        {
            C(1, "1966-03-03", [2], task: 1, op: 1), C(2, "1966-04-01", [2], task: 1, op: 1), C(3, "1969-06-06", [2], task: 2, op: 2),
            C(4, "1969-06-07", [2], task: 0, lat: 11.5),              // no task, and far from any base
        };

        var sheet = Builder(contacts).Build(Unit("5-rar"), new Dictionary<int, ContactDetail>());

        Assert.Equal([("Patrol", 2, 0.5), ("Ambush", 1, 0.25), ("Not recorded", 1, 0.25)], sheet.Activity.Select(a => (a.Name, a.Count, a.Share)));
        Assert.Equal([("Hardihood", 2, "1966-03-03"), ("Hammer", 1, "1969-06-06")], sheet.Operations.Select(o => (o.Name, o.Contacts, o.First)));
        Assert.Equal([(1966, 2), (1969, 2)], sheet.PerYear.Select(y => (y.Year, y.Contacts)));
        Assert.Equal(("Nui Dat", 3), (sheet.Areas.Single().Place, sheet.Areas.Single().Contacts));
    }

    [Fact]
    public void Picks_the_significant_contacts_the_first_and_last_and_a_typical_one_with_a_substantial_report_linked_to_the_map()
    {
        var contacts = new[]
        {
            C(1, "1966-03-03", [2]), C(2, "1967-02-21", [3], frKia: 9), C(3, "1968-01-01", [2], task: 2),
            C(4, "1968-02-01", [2], task: 2), C(5, "1970-02-14", [2]),
        };
        var b = Builder(contacts);
        var reports = new Dictionary<int, ContactDetail>
        {
            [3] = Detail(3, "Short."),
            [4] = Detail(4, new string('x', FactSheetBuilder.TypicalReportMinChars)),
        };

        var sheet = b.Build(Unit("5-rar"), reports);

        Assert.Equal(["first"], sheet.Notable.Single(n => n.Id == 1).Why);
        Assert.Equal(["significant"], sheet.Notable.Single(n => n.Id == 2).Why);
        Assert.Equal(["last"], sheet.Notable.Single(n => n.Id == 5).Why);
        Assert.Equal(["typical:Ambush"], sheet.Notable.Single(n => n.Id == 4).Why);        // 3's report is too short to show much
        Assert.DoesNotContain(sheet.Notable, n => n.Id == 3);
        Assert.Equal("/battlemap?incident=2", sheet.Notable.Single(n => n.Id == 2).Url);
        Assert.Contains(4, b.Candidates(Unit("5-rar")));
    }

    [Fact]
    public void Counts_a_death_to_the_unit_of_the_tour_or_failing_that_of_the_contact_preferring_the_infantry()
    {
        var contacts = new[] { C(1, "1966-05-24", [2, 20]), C(2, "1967-01-01", [20]) };
        var roll = new[]
        {
            // On tour with the battalion.
            new RollPerson("1", "On Tour", "Private", new DateOnly(1966, 5, 24), [new Tour("5th Battalion, The Royal Australian Regiment", new(1966, 5, 10), new(1966, 11, 14))]),
            // A reinforcement, linked to a contact of the battalion and the cavalry: the battalion's.
            new RollPerson("2", "Reinforcement", "Private", new DateOnly(1966, 5, 24), [new Tour("1 Australian Reinforcement Unit", new(1966, 1, 1), new(1966, 12, 1))]),
            // On tour with the cavalry, linked to the same contact: the cavalry's only.
            new RollPerson("3", "Trooper", "Trooper", new DateOnly(1966, 5, 24), [new Tour("A Squadron, 3rd Cavalry Regiment", new(1966, 1, 1), new(1966, 12, 1))]),
            // Linked only to a cavalry contact, with no telling tour: the cavalry's.
            new RollPerson("4", "Unknown", "Private", new DateOnly(1967, 1, 1), []),
        };
        var links = new[] { ("2", 1), ("3", 1), ("4", 2) }.ToLookup(x => x.Item1, x => x.Item2);
        var b = Builder(contacts, roll, links, portraits: new HashSet<string> { "1" });

        var rar = b.Build(Unit("5-rar"), new Dictionary<int, ContactDetail>());
        var cav = b.Build(Unit("3-cavalry-regiment"), new Dictionary<int, ContactDetail>());

        Assert.Equal([("1", "tour"), ("2", "contact")], rar.Dead.Select(d => (d.ServiceNumber, string.Join("+", d.Via))));
        Assert.Equal(["3", "4"], cav.Dead.Select(d => d.ServiceNumber));
        Assert.Equal("/media/portraits/1.jpg", rar.Dead[0].Portrait);
        Assert.Null(rar.Dead[1].Portrait);
        Assert.Equal([1], rar.Dead[1].Contacts);
    }

    [Fact]
    public void Takes_pictures_linked_to_its_contacts_and_those_taken_near_them_in_its_time()
    {
        var contacts = Enumerable.Range(1, 4).Select(i => C(i, $"1969-06-0{i}", [2])).ToList();
        var pictures = new[]
        {
            new SitePicture(1, "/media/a.jpg", "/media/a-480.jpg", "Linked", null, null, 10.5, 107.2, 2),
            new SitePicture(2, "/media/b.jpg", "/media/b-480.jpg", "Near, in its time", null, new DateOnly(1969, 6, 20), 10.501, 107.2, null),
            new SitePicture(3, "/media/c.jpg", "/media/c-480.jpg", "Near, years later", null, new DateOnly(1975, 1, 1), 10.5, 107.2, null),
            new SitePicture(4, "/media/d.jpg", "/media/d-480.jpg", "Far away", null, null, 12.0, 108.0, null),
        };

        var sheet = Builder(contacts, pictures: pictures).Build(Unit("5-rar"), new Dictionary<int, ContactDetail>());

        Assert.Equal([(1L, "linked"), (2L, "near")], sheet.Pictures.Select(p => (p.Id, p.How)));
    }

    [Fact]
    public void Takes_the_unit_in_contact_from_the_words_of_the_report_not_the_order_of_its_list()
    {
        // The record lists the battery first; the report names the platoon's battalion first.
        var contacts = new[] { C(1, "1966-06-24", [31, 4]) };
        var roles = new Dictionary<int, ContactRole> { [1] = new([31, 4], "1 pl A Coy 5 RAR; 105 Fd Bty", "Patrol", false, true, false, false, false) };
        var b = Builder(contacts, roles: roles);

        Assert.Equal(4, b.LeadOf(contacts[0]));
        Assert.Equal("5rar 105fd bty", FactSheetBuilder.UnitWords("5 RAR 105 Field Battery"));
    }

    [Fact]
    public void Counts_what_a_unit_did_from_the_contacts_it_led_and_its_support_to_others_by_its_arm()
    {
        var contacts = new[]
        {
            C(1, "1966-06-24", [4, 31], task: 1),                    // a patrol by 5 RAR, the battery firing in support
            C(2, "1966-06-25", [31], task: 0),                       // the battery's own fire mission
            C(3, "1966-06-26", [31], task: 0),                       // nothing recorded
        };
        var roles = new Dictionary<int, ContactRole>
        {
            [1] = new([31, 4], "1 pl A Coy 5 RAR; 105 Fd Bty", "Patrol", false, true, false, false, false),
            [2] = new([31], "105 Fd Bty", null, true, false, false, false, false),
            [3] = new([31], "105 Fd Bty", null, false, false, false, false, false),
        };
        var b = Builder(contacts, roles: roles);

        var arty = b.Build(Unit("1-field-regiment"), new Dictionary<int, ContactDetail>());
        var rar = b.Build(Unit("5-rar"), new Dictionary<int, ContactDetail>());

        Assert.Equal((3, 2, 1), (arty.Figures.Contacts, arty.Figures.Led, arty.Figures.Supported));
        Assert.Equal([("Artillery engagement", 1), ("Not recorded", 1)], arty.Activity.Select(a => (a.Name, a.Count)));   // never "Patrol"
        Assert.Equal(("Fire support", 1, "5 RAR"), (arty.Support.Single().Kind, arty.Support.Single().Contacts, arty.Support.Single().For.Single().Unit));
        Assert.Equal([("Patrol", 1)], rar.Activity.Select(a => (a.Name, a.Count)));
        Assert.Empty(rar.Support);
    }

    [Fact]
    public void Lists_the_contacts_recorded_outside_the_units_official_tours()
    {
        var contacts = new[] { C(1, "1966-03-03", [2]), C(2, "1966-05-01", [2]), C(3, "1968-01-01", [2]), C(4, "1970-02-14", [2]) };

        var sheet = Builder(contacts).Build(Unit("5-rar"), new Dictionary<int, ContactDetail>());
        var cav = Builder([C(5, "1966-01-01", [20])]).Build(Unit("3-cavalry-regiment"), new Dictionary<int, ContactDetail>());

        Assert.Equal([1, 3], sheet.Unit.OutsideTours);
        Assert.Empty(cav.Unit.OutsideTours);                        // no tours checked yet: nothing to flag
    }

    [Fact]
    public void Counts_a_contact_filed_against_a_unit_outside_its_tours_for_the_unit_its_report_names()
    {
        // All filed under B Company, 5 RAR, after 5 RAR went home (May 1967), while 6 RAR was there.
        var contacts = new[] { C(1, "1967-06-10", [3]), C(2, "1967-06-11", [3]), C(3, "1967-06-12", [3]), C(4, "1967-06-13", [3]) };
        var roles = new Dictionary<int, ContactRole>
        {
            [1] = new([3], "4 pl B Coy 6 RAR", "Patrol", false, false, false, false, false),     // another battalion's: 6 RAR's
            [2] = new([3], "5 pl B Coy 5 RAR", "Patrol", false, false, false, false, false),     // names 5 RAR itself: left to review
            [3] = new([3], "7 RAR", "Patrol", false, false, false, false, false),                // names no unit with a history
            [4] = new([3], "1 pl V coy 6 RAR", "Patrol", false, false, false, false, false),     // a New Zealand company's: in no history
        };
        var b = Builder(contacts, roles: roles);

        var rar = b.Build(Unit("5-rar"), new Dictionary<int, ContactDetail>());
        var six = b.Build(Unit("6-rar"), new Dictionary<int, ContactDetail>());

        Assert.Equal(2, rar.Figures.Contacts);
        Assert.Equal([2, 3], rar.Unit.OutsideTours);
        Assert.Equal((1, 1), (six.Figures.Contacts, six.Figures.Led));
        Assert.Equal([new CorrectedContact(1, "1967-06-10", "5-rar", "6-rar"), new CorrectedContact(4, "1967-06-13", "5-rar", null)], rar.Unit.Corrected);
        Assert.Equal([rar.Unit.Corrected[0]], six.Unit.Corrected);
        Assert.Empty(six.Unit.OutsideTours);
    }

    [Fact]
    public void Lists_the_units_with_their_sections_in_the_tables_order_for_the_page()
    {
        var contacts = Enumerable.Range(1, 25).Select(i => C(i, $"1966-05-{i:00}", [2], frKia: i == 1 ? 1 : 0)).ToList();
        var b = Builder(contacts);
        var sheets = new[] { "1-atf", "5-rar" }.ToDictionary(s => s, s => b.Build(Unit(s), new Dictionary<int, ContactDetail>()));

        var index = UnitIndex.Build(UnitsTable.Parse(UnitsCsv), sheets);

        Assert.Equal(["5-rar", "1-atf"], index.Units.Select(u => u.Slug));      // the table's order; units without a sheet left out
        Assert.Equal(("5 RAR", 25, 1), (index.Units[0].Short, index.Units[0].Contacts, index.Units[0].FriendlyKilled));
        Assert.Equal([("a-company", "A Company", 25)], index.Units[0].SubUnits.Select(s => (s.Slug, s.Title, s.Contacts)));
    }

    [Theory]
    [InlineData("Arty/Mor", "Artillery and mortar fire")]
    [InlineData("patrol", "Patrol")]
    [InlineData("Friendly Fire", "Friendly fire")]
    [InlineData("Harrassing fire", "Harassing fire")]
    public void Puts_the_reports_unit_tasks_in_plain_words(string task, string plain) => Assert.Equal(plain, FactSheetBuilder.PlainTask(task));

    [Fact]
    public void Uses_a_reports_summary_only_while_the_report_is_the_one_it_was_written_from()
    {
        var summaries = ReportSummaries.Parse(
            $$"""{ "4": { "report": "{{ReportSummaries.Fingerprint("B Coy contact en.\r\n")}}", "summary": "B Company met the enemy." } }""");

        Assert.Equal("B Company met the enemy.", summaries.For(4, "B Coy contact en.\n"));   // line endings and space aside
        Assert.Null(summaries.For(4, "B Coy contact en. Amended."));
        Assert.Null(summaries.For(5, "B Coy contact en."));
    }

    [Fact]
    public void Writes_the_history_as_markdown_with_its_head_sections_summaries_and_galleries()
    {
        var contacts = new[] { C(1, "1966-05-24", [2], frKia: 2, enKia: 3) };
        var roll = new[] { new RollPerson("1", "A [Name]", "Private", new DateOnly(1966, 5, 24), [new Tour("5th Battalion, The Royal Australian Regiment", new(1966, 5, 1), new(1966, 12, 1))]) };
        var pictures = new[] { new SitePicture(7, "/media/a.jpg", "/media/a-480.jpg", "A caption", "A credit", null, 10.5, 107.2, 1) };
        var sheet = Builder(contacts, roll, pictures: pictures, portraits: new HashSet<string> { "1" })
            .Build(Unit("5-rar"), new Dictionary<int, ContactDetail> { [1] = Detail(1, "A Coy contact 5 en.") });
        var summaries = ReportSummaries.Parse(
            $$"""{ "1": { "report": "{{ReportSummaries.Fingerprint("A Coy contact 5 en.")}}", "summary": "A Company met five enemy." } }""");

        var md = HistoryMarkdown.Render(sheet, summaries);

        Assert.StartsWith("---\nunit: 5-rar\nid: 1\ntitle: 5th Battalion, Royal Australian Regiment\n", md);
        Assert.Contains("tours: April 1966 – May 1967, February 1969 – February 1970\n", md);
        Assert.Contains("\n## Year by year\n", md);
        // The first column opens the Battle Map on the unit's contacts of that year, or with that task.
        Assert.Contains("| [1966](/battlemap?units=1&from=1966-01-01&to=1966-12-31) | 1 |", md);
        Assert.Contains("| [Patrol](/battlemap?units=1&tasks=Patrol) | 1 | 100% |", md);
        Assert.Contains("\n### 24 May 1966: Ambush\n", md);
        Assert.Contains("\nAustralian: 2 killed. Enemy: 3 killed.\n", md);
        Assert.Contains("\nA Company met five enemy.\n", md);
        // Name (escaped), rank and date of death, a line each.
        Assert.Contains("\n- ![](/media/portraits/1.jpg) [A \\[Name\\]](/battlemap?person=1)\\\n  Private\\\n  24 May 1966\n", md);
        Assert.Contains("\n- [![A caption](/media/a-480.jpg)](/battlemap?picture=7) A caption *A credit*\n", md);
        Assert.Contains("*No summary of the report yet.*", HistoryMarkdown.Render(sheet, ReportSummaries.Empty));
    }

    private static ContactDetail Detail(int id, string report) =>
        new(id, "1968-01-01T10:00:00", 10.5, 107.2, "YS374671", null, "Ambush", [], 10, 5, 0, 0, 0, 0, report, "AWM95", null);
}
