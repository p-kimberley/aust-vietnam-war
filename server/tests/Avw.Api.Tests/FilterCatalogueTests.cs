using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Avw.Api.Map;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Avw.Api.Tests;

public class NaturalComparerTests
{
    [Fact]
    public void Numbers_compare_by_value_not_by_text()
    {
        var sorted = new[] { "10 Fd Regt", "2 RAR", "A Coy", "1 ATF", "02 Sqn" }
            .OrderBy(x => x, NaturalComparer.Instance).ToArray();

        Assert.Equal(new[] { "1 ATF", "2 RAR", "02 Sqn", "10 Fd Regt", "A Coy" }, sorted);
    }

    [Fact]
    public void Letters_ignore_case_and_a_prefix_sorts_first()
    {
        Assert.True(NaturalComparer.Instance.Compare("a coy", "B Coy") < 0);
        Assert.True(NaturalComparer.Instance.Compare("D", "D Coy") < 0);
        Assert.Equal(0, NaturalComparer.Instance.Compare("D Coy", "D Coy"));
    }
}

public class UnitTreeBuilderTests
{
    private static UnitInfo Unit(int id, int? parent, string title, string type, string path, string? longName = null) =>
        new(id, parent, title, type, $"{title} {type}", longName ?? $"{title} {type} (long)", path);

    [Fact]
    public void A_recorded_parent_is_used()
    {
        var nodes = UnitTreeBuilder.Build([
            Unit(1, null, "1", "RAR", "1 Battalion"),
            Unit(2, 1, "A", "Coy", "1 Battalion|A Company"),
        ]);

        Assert.Equal([1, 2], nodes.Select(n => n.Id));
        Assert.Null(nodes[0].Parent);
        Assert.Equal(1, nodes[1].Parent);
        Assert.Equal("A Coy", nodes[1].Label);
        Assert.Equal("A Coy (long)", nodes[1].Name);
        Assert.All(nodes, n => Assert.False(n.Synthetic));
    }

    [Fact]
    public void A_parent_that_was_never_recorded_becomes_a_synthetic_group_shared_by_its_children()
    {
        // The live data has 29 such parents: units whose parent id appears on no contact.
        var nodes = UnitTreeBuilder.Build([
            Unit(15838, 15837, "D", "Coy", "US Army|16 Armor Battalion|D Company"),
            Unit(15839, 15837, "E", "Coy", "US Army|16 Armor Battalion|E Company"),
        ]);

        var groups = nodes.Where(n => n.Synthetic).ToArray();
        Assert.Equal(2, groups.Length);                                       // "US Army" and "16 Armor Battalion"
        Assert.All(groups, g => Assert.True(g.Id < 0));

        var army = Assert.Single(groups, g => g.Label == "US Army");
        var battalion = Assert.Single(groups, g => g.Label == "16 Armor Battalion");
        Assert.Null(army.Parent);
        Assert.Equal(army.Id, battalion.Parent);
        Assert.Equal(battalion.Id, nodes.Single(n => n.Id == 15838).Parent);
        Assert.Equal(battalion.Id, nodes.Single(n => n.Id == 15839).Parent);
    }

    [Fact]
    public void A_path_prefix_that_matches_a_recorded_unit_attaches_to_it_when_the_parent_id_is_missing()
    {
        var nodes = UnitTreeBuilder.Build([
            Unit(1, null, "1", "RAR", "1 Battalion"),
            Unit(2, 999, "A", "Coy", "1 Battalion|A Company"),
        ]);

        Assert.Equal(1, nodes.Single(n => n.Id == 2).Parent);
        Assert.DoesNotContain(nodes, n => n.Synthetic);
    }

    [Fact]
    public void A_recorded_parent_wins_over_a_path_that_disagrees()
    {
        // Live data has one unit whose path says it is a root but whose parent id names a battalion.
        var nodes = UnitTreeBuilder.Build([
            Unit(1, null, "1", "RAR", "1 Battalion"),
            Unit(2, 1, "3", "Sect", "3 Section"),
        ]);

        Assert.Equal(1, nodes.Single(n => n.Id == 2).Parent);
    }

    [Fact]
    public void Synthetic_ids_are_stable_for_the_same_data()
    {
        UnitInfo[] units = [Unit(1, 50, "B", "Coy", "Zulu|B Company"), Unit(2, 51, "C", "Coy", "Alpha|C Company")];

        var first = UnitTreeBuilder.Build(units);
        var second = UnitTreeBuilder.Build(units.Reverse());

        Assert.Equal(first.OrderBy(n => n.Id), second.OrderBy(n => n.Id));
        Assert.Equal(-1, first.Single(n => n.Label == "Alpha").Id);            // assigned in path order
    }

    [Fact]
    public void The_order_is_depth_first_with_siblings_in_natural_order()
    {
        var nodes = UnitTreeBuilder.Build([
            Unit(10, null, "10", "Fd Regt", "10 Fd"),
            Unit(2, null, "2", "RAR", "2 RAR"),
            Unit(21, 2, "B", "Coy", "2 RAR|B"),
            Unit(20, 2, "A", "Coy", "2 RAR|A"),
            Unit(201, 20, "1", "Pl", "2 RAR|A|1"),
        ]);

        Assert.Equal([2, 20, 201, 21, 10], nodes.Select(n => n.Id));
    }

    [Fact]
    public void A_parent_cycle_cannot_hang_or_lose_units()
    {
        var nodes = UnitTreeBuilder.Build([
            Unit(1, 2, "A", "Coy", "x|a"),
            Unit(2, 1, "B", "Coy", "x|b"),
            Unit(3, 3, "C", "Coy", "x|c"),
        ]);

        Assert.Equal(3, nodes.Count(n => !n.Synthetic));
        Assert.Equal(nodes.Length, nodes.Select(n => n.Id).Distinct().Count());
    }

    [Theory]
    [InlineData("1", "RAR", null, null, "1 RAR")]
    [InlineData(null, null, "Short Name", "Long Name", "Short Name")]
    [InlineData(null, null, null, "Long Name", "Long Name")]
    [InlineData(null, null, null, null, "Unit 7")]
    public void Labels_fall_back_sensibly(string? title, string? type, string? shortName, string? longName, string expected)
    {
        var node = Assert.Single(UnitTreeBuilder.Build([new UnitInfo(7, null, title, type, shortName, longName, null)]));
        Assert.Equal(expected, node.Label);
    }

    [Fact]
    public void A_unit_without_a_path_or_parent_is_a_root_and_duplicates_are_ignored()
    {
        var nodes = UnitTreeBuilder.Build([new UnitInfo(5, null, "X", "Coy", null, null, null), new UnitInfo(5, null, "Y", "Coy", null, null, null)]);
        Assert.Equal("X Coy", Assert.Single(nodes).Label);
    }
}

public class CatalogueBuilderTests
{
    private static ContactRecord Record(int id, string dtg, int fr = 0, int frCas = 0, int en = 0, int enCas = 0,
        string? op = null, string? task = null, string? series = "1ATF", bool? mine = null, int[]? units = null) =>
        new(id, dtg, 10.5, 107.1, fr, frCas, en, enCas, units ?? [], op, task, series, mine);

    [Fact]
    public void Names_are_stored_once_and_contacts_refer_to_them_by_one_based_position()
    {
        var (contacts, filters) = CatalogueBuilder.Build(new ContactSet([
            Record(1, "1966-01-01T00:00:00", op: "Hardihood", task: "Patrol"),
            Record(2, "1966-01-02T00:00:00", op: "Coburg", task: "Ambush", series: "1RAR"),
            Record(3, "1966-01-03T00:00:00", op: "hardihood ", task: "Patrol"),
            Record(4, "1966-01-04T00:00:00"),
        ], []));

        Assert.Equal(["Coburg", "Hardihood"], filters.Operations.Select(o => o.Name));
        Assert.Equal([1, 2], filters.Operations.Select(o => o.Count));              // "hardihood " merges with "Hardihood"
        Assert.Equal(["Ambush", "Patrol"], filters.Tasks.Select(t => t.Name));
        Assert.Equal(["1ATF", "1RAR"], filters.Series.Select(x => x.Name));
        Assert.Equal([2, 1, 2, 0], contacts.Select(c => c.Op));
        Assert.Equal([2, 1, 2, 0], contacts.Select(c => c.Task));
        Assert.Equal([1, 2, 1, 1], contacts.Select(c => c.Series));
    }

    [Theory]
    [InlineData(null, 0)]
    [InlineData(false, 1)]
    [InlineData(true, 2)]
    public void Mine_incident_is_not_recorded_no_or_yes(bool? mine, int expected)
    {
        var (contacts, _) = CatalogueBuilder.Build(new ContactSet([Record(1, "1966-01-01T00:00:00", mine: mine)], []));
        Assert.Equal(expected, contacts[0].Mine);
    }

    [Fact]
    public void Ranges_and_dates_span_the_data()
    {
        var (_, f) = CatalogueBuilder.Build(new ContactSet([
            Record(1, "1966-03-03T19:50:00", fr: 25, frCas: 0, en: 5, enCas: 0),
            Record(2, "1971-11-02T08:30:00", fr: 700, frCas: 38, en: 2500, enCas: 595),
            Record(3, "1965-05-29T11:30:00", fr: 0, frCas: 1, en: 0, enCas: 0),
        ], []));

        Assert.Equal("1965-05-29", f.DateMin);
        Assert.Equal("1971-11-02", f.DateMax);
        Assert.Equal(new RangeInfo(0, 700), f.Fr);
        Assert.Equal(new RangeInfo(0, 38), f.FrCas);
        Assert.Equal(new RangeInfo(0, 2500), f.En);
        Assert.Equal(new RangeInfo(0, 595), f.EnCas);
    }

    [Fact]
    public void An_empty_set_produces_an_empty_catalogue()
    {
        var (contacts, f) = CatalogueBuilder.Build(new ContactSet([], []));

        Assert.Empty(contacts);
        Assert.Equal("", f.DateMin);
        Assert.Equal(new RangeInfo(0, 0), f.Fr);
        Assert.Empty(f.Units);
    }
}

public class FilterEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private HttpClient Client() => factory.CreateClient(new() { AllowAutoRedirect = false });
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task The_filter_catalogue_describes_the_contacts()
    {
        var res = await Client().GetAsync("/api/contacts/filters");
        var f = await res.Content.ReadFromJsonAsync<FilterCatalogue>(Web);

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("1966-03-03", f!.DateMin);
        Assert.Equal("1966-03-05", f.DateMax);
        Assert.Equal("Hardihood", Assert.Single(f.Operations).Name);
        Assert.Equal(new RangeInfo(25, 40), f.Fr);
        Assert.Equal([3, 4], f.Units.Select(u => u.Id));
        Assert.Equal(3, f.Units[1].Parent);
        Assert.Contains("public", res.Headers.CacheControl!.ToString());
    }

    [Fact]
    public async Task The_filter_catalogue_supports_etag_revalidation()
    {
        var client = Client();
        var etag = (await client.GetAsync("/api/contacts/filters")).Headers.ETag!;

        var req = new HttpRequestMessage(HttpMethod.Get, "/api/contacts/filters");
        req.Headers.IfNoneMatch.Add(etag);

        Assert.Equal(HttpStatusCode.NotModified, (await client.SendAsync(req)).StatusCode);
    }

    [Fact]
    public async Task Contacts_carry_positions_into_the_catalogue()
    {
        var contacts = await Client().GetFromJsonAsync<ContactSummary[]>("/api/contacts", Web);

        Assert.Equal((1, 1, 1, 1), (contacts![0].Op, contacts[0].Task, contacts[0].Series, contacts[0].Mine));
        Assert.Equal((0, 0, 1, 2), (contacts[1].Op, contacts[1].Task, contacts[1].Series, contacts[1].Mine));
    }

    [Fact]
    public async Task Search_returns_matching_ids_for_trimmed_text()
    {
        var res = await Client().GetAsync("/api/contacts/search?q=%20ambush%20");
        var body = await res.Content.ReadFromJsonAsync<SearchResult>(Web);

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal([2], body!.Ids);
        Assert.Equal("ambush", factory.Services.GetService(typeof(FakeContactSource)) is FakeContactSource f ? f.LastSearch : null);
    }

    [Theory]
    [InlineData("/api/contacts/search")]
    [InlineData("/api/contacts/search?q=")]
    [InlineData("/api/contacts/search?q=a")]
    [InlineData("/api/contacts/search?q=%20%20a%20%20")]
    public async Task Search_needs_at_least_two_characters(string path)
    {
        var res = await Client().GetAsync(path);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Search_text_has_a_maximum_length()
    {
        var res = await Client().GetAsync($"/api/contacts/search?q={new string('x', 101)}");
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Search_is_rate_limited_per_client()
    {
        using var limited = factory.WithWebHostBuilder(b => b.UseSetting("Elasticsearch:SearchPermitsPerMinute", "3"));
        var client = limited.CreateClient();

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 5; i++)
        {
            statuses.Add((await client.GetAsync("/api/contacts/search?q=patrol")).StatusCode);
        }

        Assert.Equal([HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.TooManyRequests, HttpStatusCode.TooManyRequests], statuses);
    }

    [Fact]
    public async Task Other_endpoints_are_not_rate_limited_by_the_search_policy()
    {
        using var limited = factory.WithWebHostBuilder(b => b.UseSetting("Elasticsearch:SearchPermitsPerMinute", "1"));
        var client = limited.CreateClient();

        for (var i = 0; i < 4; i++)
        {
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/contacts")).StatusCode);
        }
    }

    [Fact]
    public async Task OpenApi_describes_the_new_endpoints()
    {
        var json = await Client().GetStringAsync("/api/openapi/v1.json");
        Assert.Contains("/api/contacts/filters", json);
        Assert.Contains("/api/contacts/search", json);
    }
}

public class ElasticsearchFilterMappingTests
{
    private sealed class Stub(string response) : HttpMessageHandler
    {
        public string? RequestBody;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            RequestBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(response, Encoding.UTF8, "application/json") };
        }
    }

    private static (ElasticsearchContactSource Source, Stub Handler) Create(string response)
    {
        var handler = new Stub(response);
        var http = new HttpClient(handler) { BaseAddress = new Uri("http://es.test/") };
        return (new ElasticsearchContactSource(
            http, Options.Create(new ElasticsearchOptions { Url = "http://es.test" }), NullLogger<ElasticsearchContactSource>.Instance), handler);
    }

    private const string Contacts = """
        {"hits":{"total":{"value":3,"relation":"eq"},"hits":[
          {"_id":"2","_source":{"DTG":"1966-03-03T19:50:00","Location":{"lat":10.5,"lon":107.1},"Fr_Force_Present":25,"Total_Fr_Cas":0,"En_Force":5,"Total_En_Cas":0,
            "Series":"1ATF","Operation":" Hardihood ","Unit_Task":"Patrol","Mine_Incid":0,
            "Fr_Units":[
              {"_id":3,"Title":"1","ShortTypeName":"RAR","ShortDisplayName":"1 RAR","LongDisplayName":"1 Battalion, RAR","Path":"1 Battalion, RAR"},
              {"_id":4,"Parent":3,"Title":"A","ShortTypeName":"Coy","ShortDisplayName":"A Coy, 1 RAR","LongDisplayName":"A Company","Path":"1 Battalion, RAR|A Company"},
              {"_id":9,"Title":"Secret","Path":"Secret","Hidden":true}]}},
          {"_id":"7","_source":{"DTG":"1966-03-04T01:00:00","Location":{"lat":10.6,"lon":107.2},"Series":"1RAR","Mine_Incid":1,
            "Fr_Units":[{"_id":4,"Parent":3,"Title":"A","ShortTypeName":"Coy","Path":"1 Battalion, RAR|A Company"}]}},
          {"_id":"8","_source":{"DTG":"1966-03-05T01:00:00","Location":{"lat":10.7,"lon":107.3},"Operation":"  "}}
        ]}}
        """;

    [Fact]
    public async Task Reads_series_operation_task_and_mine_incident_with_blanks_as_null()
    {
        var (source, _) = Create(Contacts);

        var set = await source.GetAllAsync(default);

        Assert.Equal(("1ATF", "Hardihood", "Patrol", false), (set.Contacts[0].Series, set.Contacts[0].Operation, set.Contacts[0].Task, set.Contacts[0].Mine));
        Assert.Equal(("1RAR", null, null, true), (set.Contacts[1].Series, set.Contacts[1].Operation, set.Contacts[1].Task, set.Contacts[1].Mine));
        Assert.Equal((null, null, null), (set.Contacts[2].Operation, set.Contacts[2].Series, set.Contacts[2].Mine));
    }

    [Fact]
    public async Task Collects_each_unit_once_and_never_exposes_hidden_ones()
    {
        var (source, _) = Create(Contacts);

        var set = await source.GetAllAsync(default);

        Assert.Equal([3, 4], set.Units.Select(u => u.Id).Order());
        Assert.Equal(new UnitInfo(4, 3, "A", "Coy", "A Coy, 1 RAR", "A Company", "1 Battalion, RAR|A Company"), set.Units.Single(u => u.Id == 4));
        Assert.Equal([3, 4], set.Contacts[0].Units);                       // the hidden unit 9 is dropped from the contact too
        Assert.DoesNotContain(9, set.Contacts.SelectMany(c => c.Units));
    }

    [Fact]
    public async Task Requests_the_extra_fields_it_reads()
    {
        var (source, handler) = Create(Contacts);

        await source.GetAllAsync(default);

        using var body = JsonDocument.Parse(handler.RequestBody!);
        var fields = body.RootElement.GetProperty("_source").EnumerateArray().Select(f => f.GetString()).ToArray();
        Assert.Subset(new HashSet<string?>(fields), new HashSet<string?> { "Series", "Operation", "Unit_Task", "Mine_Incid", "Fr_Units" });
    }

    [Fact]
    public async Task Text_search_matches_every_word_and_returns_only_ids()
    {
        var (source, handler) = Create("""{"hits":{"hits":[{"_id":"12"},{"_id":"7"},{"_id":"junk"}]}}""");

        var ids = await source.SearchAsync("claymore ambush", default);

        Assert.Equal([12, 7], ids);                                        // non-numeric ids are dropped
        using var body = JsonDocument.Parse(handler.RequestBody!);
        Assert.False(body.RootElement.GetProperty("_source").GetBoolean());
        var match = body.RootElement.GetProperty("query").GetProperty("bool").GetProperty("must")
            .GetProperty("match").GetProperty("Description_of_Incident");
        Assert.Equal("claymore ambush", match.GetProperty("query").GetString());
        Assert.Equal("and", match.GetProperty("operator").GetString());
    }

    [Fact]
    public async Task Search_text_is_sent_as_data_never_as_query_syntax()
    {
        var (source, handler) = Create("""{"hits":{"hits":[]}}""");

        await source.SearchAsync("\"} ], \"size\": 1, \"x\": [ {\"", default);

        // The whole payload must still be valid JSON with the original size, and the text inside a single string value.
        using var body = JsonDocument.Parse(handler.RequestBody!);
        Assert.Equal(10_000, body.RootElement.GetProperty("size").GetInt32());
        var text = body.RootElement.GetProperty("query").GetProperty("bool").GetProperty("must")
            .GetProperty("match").GetProperty("Description_of_Incident").GetProperty("query").GetString();
        Assert.Contains("\"size\"", text);
    }
}
