using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Avw.Api.Analytics;
using Avw.Api.Map;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Avw.Api.Tests;

internal static class Rows
{
    public static IncidentRow Incident(int id, string dtg, int frKia = 0, int frWia = 0, int enKia = 0, int enWia = 0, string? task = "Patrol",
        string? firedFirst = "Friendly", params WeaponEffectRow[] effects) =>
        new(id, DateTime.Parse(dtg, System.Globalization.CultureInfo.InvariantCulture), frKia, frWia, enKia, enWia, frKia + frWia, enKia + enWia, task, firedFirst, effects);

    public static WeaponEffectRow Effect(string weapon = "M16", string category = "Small Arms", string actor = "Friendly", int range = 25, int rounds = 10, int casualties = 1) =>
        new(weapon, category, actor, range, rounds, casualties);

    public static double Utc(int y, int m, int d) => new DateTimeOffset(y, m, d, 0, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds();
}

public class ChartCalculationTests
{
    private static double[] Ys(ChartSeries s) => s.Points.Select(p => p[1]).ToArray();
    private static double[] Xs(ChartSeries s) => s.Points.Select(p => p[0]).ToArray();
    private static ChartSeries Named(ChartResult r, string name) => r.Series.Single(s => s.Name == name);

    [Fact]
    public void Lists_thirteen_charts_each_drawable_and_each_marked_as_filtered_or_not()
    {
        Assert.Equal(13, Charts.All.Length);
        Assert.Equal(Charts.All.Length, Charts.All.Select(c => c.Id).Distinct().Count());
        Assert.Equal(3, Charts.All.Count(c => !c.UsesFilter));
        foreach (var chart in Charts.All)
        {
            var drawn = Charts.Draw(chart.Id, [], []);
            Assert.NotNull(drawn);
            Assert.Equal(chart.Id, drawn!.Id);
            Assert.Equal(chart.Title, drawn.Title);
        }

        Assert.Null(Charts.Draw("nonsense", [], []));
    }

    [Fact]
    public void Adds_up_casualties_for_each_day_in_date_order_with_days_as_utc_midnight()
    {
        var rows = new[]
        {
            Rows.Incident(1, "1966-08-19T13:00:00", frKia: 1, enKia: 5),
            Rows.Incident(2, "1966-08-18T16:00:00", frKia: 17, frWia: 20, enKia: 3, enWia: 2),
            Rows.Incident(3, "1966-08-18T22:00:00", frWia: 1, enKia: 4),
        };

        var chart = Charts.BattleDamageByDate(rows);

        Assert.Equal((ChartShape.Area, XKind.Time, 3), (chart.Shape, chart.X, chart.Rows));
        Assert.Equal(["Enemy killed", "Enemy wounded", "Friendly killed", "Friendly wounded"], chart.Series.Select(s => s.Name));
        Assert.Equal([Rows.Utc(1966, 8, 18), Rows.Utc(1966, 8, 19)], Xs(Named(chart, "Enemy killed")));
        Assert.Equal([7, 5], Ys(Named(chart, "Enemy killed")));
        Assert.Equal([2, 0], Ys(Named(chart, "Enemy wounded")));
        Assert.Equal([17, 1], Ys(Named(chart, "Friendly killed")));
        Assert.Equal([21, 0], Ys(Named(chart, "Friendly wounded")));
    }

    [Fact]
    public void Adds_up_casualties_for_each_hour_of_the_day()
    {
        var rows = new[] { Rows.Incident(1, "1966-08-18T16:07:00", enKia: 3), Rows.Incident(2, "1967-01-02T16:59:00", enKia: 2), Rows.Incident(3, "1967-01-02T03:00:00", enKia: 1) };

        var chart = Charts.BattleDamageByTime(rows);

        Assert.Equal(XKind.Hour, chart.X);
        Assert.Equal([3, 16], Xs(Named(chart, "Enemy killed")));
        Assert.Equal([1, 5], Ys(Named(chart, "Enemy killed")));
    }

    [Fact]
    public void Works_out_friendly_casualties_per_enemy_casualty_treating_none_as_one()
    {
        var rows = new[]
        {
            Rows.Incident(1, "1966-08-10T10:00:00", frKia: 2, enKia: 0, firedFirst: "Enemy"),                    // 2 per (none = 1) = 2
            Rows.Incident(2, "1966-08-20T10:00:00", frKia: 1, enKia: 4, firedFirst: "Enemy"),                    // 0.25, average with the first = 1.13
            Rows.Incident(3, "1966-09-05T10:00:00", frKia: 3, enKia: 3, firedFirst: "Friendly"),                 // 1
            Rows.Incident(4, "1966-09-06T10:00:00", frKia: 0, enKia: 5, firedFirst: null),                       // 0
        };

        var chart = Charts.LossRatioByDate(rows);

        Assert.Equal(["Friendly fired first", "Enemy fired first", "Unknown fired first"], chart.Series.Select(s => s.Name));
        Assert.Equal([1.13], Ys(Named(chart, "Enemy fired first")));
        Assert.Equal([Rows.Utc(1966, 8, 1)], Xs(Named(chart, "Enemy fired first")));                              // a month's point sits at its first day
        Assert.Equal([1.0], Ys(Named(chart, "Friendly fired first")));
        Assert.Equal([0.0], Ys(Named(chart, "Unknown fired first")));
        Assert.NotNull(chart.Note);
    }

    [Fact]
    public void Gives_the_commonest_tasks_a_line_each_and_groups_the_rest_keeping_zero_months_so_areas_stack()
    {
        var tasks = Enumerable.Range(1, 10).Select(n => $"Task {n}").ToArray();
        var rows = new List<IncidentRow>();
        var id = 0;
        for (var t = 0; t < tasks.Length; t++)
        {
            for (var k = 0; k < 10 - t; k++)                              // Task 1 is commonest, Task 10 the rarest
            {
                rows.Add(Rows.Incident(++id, "1966-01-15T10:00:00", task: tasks[t]));
            }
        }

        rows.Add(Rows.Incident(++id, "1966-03-15T10:00:00", task: "Task 1"));
        rows.Add(Rows.Incident(++id, "1966-03-16T10:00:00", task: null));

        var chart = Charts.IncidentFrequencyByDate(rows);

        Assert.Equal(ChartShape.StackedArea, chart.Shape);
        Assert.Equal(Charts.TopN + 1, chart.Series.Length);
        Assert.Equal("Task 1", chart.Series[0].Name);
        Assert.Equal(Charts.OtherName, chart.Series[^1].Name);
        Assert.Equal([10, 1], Ys(Named(chart, "Task 1")));                                                   // January and March
        Assert.Equal([3, 1], Ys(Named(chart, Charts.OtherName)));                                            // Tasks 9 and 10 in January, and the null task in March: nothing is lost
        Assert.All(chart.Series, s => Assert.Equal(2, s.Points.Length));                                     // every line has every month
    }

    [Fact]
    public void Names_a_missing_task_unknown_when_it_is_common_enough()
    {
        var rows = new[] { Rows.Incident(1, "1966-01-01T01:00:00", task: null), Rows.Incident(2, "1966-01-01T02:00:00", task: "  ") };

        var chart = Charts.IncidentFrequencyByTime(rows);

        Assert.Equal([Charts.UnknownName], chart.Series.Select(s => s.Name));
        Assert.Equal([1, 2], Xs(chart.Series[0]));
    }

    [Fact]
    public void Averages_rounds_and_casualties_by_range_for_small_arms_only_ignoring_unrecorded_ranges()
    {
        var rows = new[]
        {
            Rows.Incident(1, "1966-01-01T10:00:00", effects:
            [
                Rows.Effect("M16", rounds: 10, casualties: 1, range: 23),
                Rows.Effect("M16", rounds: 20, casualties: 3, range: 27),      // same 20 m bin: averages 15 rounds, 2 casualties
                Rows.Effect("M16", rounds: 5, casualties: 0, range: 35),
                Rows.Effect("M16", rounds: 99, casualties: 9, range: 0),        // range not recorded
                Rows.Effect("Mine", "Mine", range: 5, rounds: 1),                // not a small arm
                Rows.Effect(null!, "Small Arms", range: 5),                       // no weapon name
            ]),
        };

        var rounds = Charts.WeaponRoundsByRange(rows);
        var casualties = Charts.WeaponCasualtiesByRange(rows);

        var m16 = Assert.Single(rounds.Series);
        Assert.Equal("M16", m16.Name);
        Assert.Equal([20, 30], Xs(m16));
        Assert.Equal([15, 5], Ys(m16));
        Assert.Equal([2, 0], Ys(Assert.Single(casualties.Series)));
        Assert.Equal(XKind.Value, rounds.X);
    }

    [Fact]
    public void Adds_up_only_friendly_rounds_by_task_and_weapon_with_the_busiest_tasks_first()
    {
        var rows = new[]
        {
            Rows.Incident(1, "1966-01-01T10:00:00", task: "Ambush", effects: [Rows.Effect("M16", rounds: 100), Rows.Effect("M60", rounds: 50), Rows.Effect("AK47", actor: "Enemy", rounds: 400)]),
            Rows.Incident(2, "1966-01-02T10:00:00", task: "Patrol", effects: [Rows.Effect("M16", rounds: 30)]),
            Rows.Incident(3, "1966-01-03T10:00:00", task: "Ambush", effects: [Rows.Effect("M16", rounds: 20)]),
        };

        var chart = Charts.WeaponRoundsByTask(rows);

        Assert.Equal(ChartShape.StackedBar, chart.Shape);
        Assert.Equal(["Ambush", "Patrol"], chart.Categories!);
        Assert.Equal(["M16", "M60"], chart.Series.Select(s => s.Name));                  // enemy weapons are not counted
        Assert.Equal([120, 30], Ys(Named(chart, "M16")));
        Assert.Equal([50, 0], Ys(Named(chart, "M60")));
    }

    [Fact]
    public void Divides_each_months_friendly_rounds_by_its_enemy_casualties_and_leaves_out_months_with_no_rounds()
    {
        var rows = new[]
        {
            Rows.Incident(1, "1966-01-05T10:00:00", enKia: 2, effects: [Rows.Effect(rounds: 100)]),
            Rows.Incident(2, "1966-01-20T10:00:00", enKia: 3, effects: [Rows.Effect(rounds: 150)]),         // 250 / 5 = 50
            Rows.Incident(3, "1966-02-02T10:00:00", enKia: 0, effects: [Rows.Effect(rounds: 40)]),          // 40 / (none = 1) = 40
            Rows.Incident(4, "1966-03-02T10:00:00", enKia: 4),                                              // no rounds recorded
        };

        var chart = Charts.RoundsPerEnemyCasualty(rows);

        var patrol = Assert.Single(chart.Series);
        Assert.Equal([Rows.Utc(1966, 1, 1), Rows.Utc(1966, 2, 1)], Xs(patrol));
        Assert.Equal([50, 40], Ys(patrol));
    }

    [Theory]
    [InlineData("1947-09-10", "1969-09-09", 21)]           // the day before the birthday
    [InlineData("1947-09-10", "1969-09-10", 22)]           // the birthday itself
    [InlineData("1947-09-10", "1970-01-01", 22)]
    [InlineData("1948-02-29", "1969-02-27", 20)]           // a leap-day birthday is reached on 28 February in other years
    [InlineData("1948-02-29", "1969-02-28", 21)]
    public void Counts_whole_years_between_birth_and_a_date(string birth, string on, int age) =>
        Assert.Equal(age, Charts.AgeOn(DateOnly.Parse(birth), DateOnly.Parse(on)));

    [Fact]
    public void Averages_the_age_at_death_by_month_and_service_dropping_impossible_ages()
    {
        var infantry = "Royal Australian Infantry Corps";
        var people = new[]
        {
            new PersonRow(new(1947, 9, 10), new(1969, 4, 4), infantry, []),      // 21
            new PersonRow(new(1945, 4, 4), new(1969, 4, 20), infantry, []),      // 24
            new PersonRow(new(1948, 8, 28), new(1969, 6, 1), null, []),          // 20, service unknown
            new PersonRow(new(1969, 1, 1), new(1969, 4, 1), infantry, []),       // age 0: a typing error, dropped
            new PersonRow(null, new(1969, 4, 1), infantry, []),                  // no birth date
            new PersonRow(new(1947, 1, 1), null, infantry, []),                  // did not die
        };

        var chart = Charts.AgeAtDeath(people);

        Assert.Equal(3, chart.Rows);
        Assert.Equal([infantry, Charts.UnknownName], chart.Series.Select(s => s.Name));
        Assert.Equal([Rows.Utc(1969, 4, 1)], Xs(Named(chart, infantry)));
        Assert.Equal([22.5], Ys(Named(chart, infantry)));
        Assert.Equal([20.0], Ys(Named(chart, Charts.UnknownName)));
    }

    [Fact]
    public void Works_out_ages_at_each_tour_start_and_counts_tours_by_age_band()
    {
        var people = new[]
        {
            new PersonRow(new(1947, 6, 1), null, "Army", [new(1966, 3, 10), new(1968, 3, 20)]),      // 18 and 20
            new PersonRow(new(1945, 1, 1), null, "Army", [new(1966, 3, 30)]),                           // 21
            new PersonRow(null, null, "Army", [new(1966, 3, 1)]),                                       // no birth date: no age
            new PersonRow(new(1930, 1, 1), null, "Navy", [new(1966, 3, 5)]),                            // 36
        };

        var byService = Charts.AgeAtTour(people);
        var bands = Charts.TourAgeBands(people);

        Assert.Equal(4, byService.Rows);
        Assert.Equal([19.5, 20.0], Ys(Named(byService, "Army")));                                        // March 1966: (18+21)/2; March 1968: 20
        Assert.Equal([36.0], Ys(Named(byService, "Navy")));
        Assert.Equal(["16-18", "19-22", "36-40"], bands.Series.Select(s => s.Name));                     // bands with no tours are left out
        Assert.Equal([1, 0], Ys(Named(bands, "16-18")));
        Assert.Equal([1, 1], Ys(Named(bands, "19-22")));
        Assert.Equal(ChartShape.StackedArea, bands.Shape);
    }

    [Fact]
    public void Draws_every_chart_from_realistic_rows_without_error()
    {
        var rows = new[] { Rows.Incident(1, "1966-08-18T16:07:00", frKia: 1, enKia: 2, effects: [Rows.Effect()]) };
        var people = new[] { new PersonRow(new(1947, 1, 1), new(1969, 1, 1), "Army", [new(1968, 1, 1)]) };

        foreach (var chart in Charts.All)
        {
            var drawn = Charts.Draw(chart.Id, rows, people)!;
            Assert.All(drawn.Series, s => Assert.All(s.Points, p => Assert.All(p, v => Assert.True(double.IsFinite(v)))));
        }
    }
}

public class ElasticsearchAnalyticsSourceTests
{
    private sealed class Stub(Func<HttpRequestMessage, string?, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<(HttpMethod Method, string Path, string? Body)> Calls { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            Calls.Add((request.Method, request.RequestUri!.PathAndQuery, body));
            return respond(request, body);
        }
    }

    private static HttpResponseMessage Json(string json) => new(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private static ElasticsearchAnalyticsSource Source(Stub stub) => new(
        new HttpClient(stub) { BaseAddress = new Uri("http://es.test/") },
        Options.Create(new ElasticsearchOptions { Url = "http://es.test" }),
        NullLogger<ElasticsearchAnalyticsSource>.Instance);

    [Theory]
    [InlineData("2026-09-20", 2026, 9, 20)]
    [InlineData("1966-08-18T16:07:00", 1966, 8, 18)]
    [InlineData("20/09/1969", 1969, 9, 20)]
    [InlineData("5/2/1969", 1969, 2, 5)]
    public void Reads_the_date_forms_the_data_uses(string text, int y, int m, int d) =>
        Assert.Equal(new DateOnly(y, m, d), ElasticsearchAnalyticsSource.TryParseDate(text));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData("not a date")]
    [InlineData("31/02/1969")]
    public void Treats_anything_else_as_no_date(string? text) => Assert.Null(ElasticsearchAnalyticsSource.TryParseDate(text));

    [Fact]
    public async Task Reads_incidents_keeping_the_case_sensitive_field_names_and_flattening_weapon_effects()
    {
        var stub = new Stub((_, _) => Json("""
            {"hits":{"total":{"value":2},"hits":[
              {"_id":"12","_source":{"DTG":"1966-08-18T16:07:00","Fr_KIA":1,"Fr_WIA":2,"En_KIA":3,"En_WIA":4,"Total_Fr_Cas":3,"Total_En_Cas":7,"Unit_Task":" Patrol ","Fired_First":"Enemy",
                "Weapon_Effects":[{"Weapon":{"Name":"M16","Category":"Small Arms"},"Actor":"Friendly","Engagement_Range":25,"Rounds_Fired":30,"Affected_Asset":{"Casualties":2}},
                                  {"Weapon":null,"Actor":null}]}},
              {"_id":"oops","_source":{"DTG":"1966-08-19T00:00:00"}},
              {"_id":"13","_source":{"DTG":"garbage"}}
            ]}}
            """));

        var rows = await Source(stub).LoadIncidentsAsync(default);

        var row = Assert.Single(rows);
        Assert.Equal((12, new DateTime(1966, 8, 18, 16, 7, 0), 1, 2, 3, 4, "Patrol", "Enemy"), (row.Id, row.Dtg, row.FrKia, row.FrWia, row.EnKia, row.EnWia, row.Task, row.FiredFirst));
        Assert.Equal(2, row.Effects.Length);
        Assert.Equal(("M16", "Small Arms", "Friendly", 25, 30, 2), (row.Effects[0].Weapon, row.Effects[0].Category, row.Effects[0].Actor, row.Effects[0].Range, row.Effects[0].Rounds, row.Effects[0].Casualties));
        Assert.Equal(new WeaponEffectRow(null, null, null, 0, 0, 0), row.Effects[1]);
        var call = Assert.Single(stub.Calls);
        Assert.Equal("/avw_contacts/_search", call.Path);
        Assert.Contains("\"DTG\"", call.Body);                                    // not camel-cased
        Assert.Contains("Weapon_Effects.Rounds_Fired", call.Body);
    }

    private const string RollPage1 = """
        {"_scroll_id":"S1","hits":{"total":{"value":3},"hits":[
          {"_id":"a","_source":{"Birth":{"Date":"1947-09-10"},"Death":{"Date":"1969-04-04"},"Branch":"Army","Tours":[{"StartDate":"05/02/1969"},{"StartDate":"bad"},{"StartDate":null}]}},
          {"_id":"b","_source":{"Birth":{"Date":"1948-01-01"}}}]}}
        """;

    private const string RollPage2 = """
        {"_scroll_id":"S2","hits":{"total":{"value":3},"hits":[{"_id":"c","_source":{"Branch":" Navy "}}]}}
        """;

    private const string RollEnd = """
        {"_scroll_id":"S2","hits":{"total":{"value":3},"hits":[]}}
        """;

    [Fact]
    public async Task Reads_the_roll_page_by_page_with_the_scroll_api_and_then_releases_the_scroll()
    {
        var page = 0;
        var stub = new Stub((req, body) =>
        {
            if (req.Method == HttpMethod.Delete)
            {
                return Json("{\"succeeded\":true}");
            }

            page++;
            return Json(page == 1 ? RollPage1 : page == 2 ? RollPage2 : RollEnd);
        });

        var people = await Source(stub).LoadPeopleAsync(default);

        Assert.Equal(3, people.Count);
        Assert.Equal((new DateOnly(1947, 9, 10), new DateOnly(1969, 4, 4), "Army"), (people[0].Birth, people[0].Death, people[0].Branch));
        Assert.Equal([new DateOnly(1969, 2, 5)], people[0].TourStarts);                 // the two unreadable dates are dropped
        Assert.Equal((null, null, "Navy"), (people[2].Birth, people[2].Death, people[2].Branch));
        Assert.Equal([HttpMethod.Post, HttpMethod.Post, HttpMethod.Post, HttpMethod.Delete], stub.Calls.Select(c => c.Method));
        Assert.Contains("\"scroll_id\":\"S1\"", stub.Calls[1].Body);
        Assert.Contains("\"scroll_id\":\"S2\"", stub.Calls[3].Body);                 // the newest scroll id is the one released
    }

    [Fact]
    public async Task Releases_the_scroll_even_when_a_later_page_fails_and_reports_what_went_wrong()
    {
        var n = 0;
        var stub = new Stub((req, _) => req.Method == HttpMethod.Delete
            ? Json("{}")
            : ++n == 1
                ? Json("{\"_scroll_id\":\"S1\",\"hits\":{\"total\":{\"value\":2},\"hits\":[{\"_id\":\"a\",\"_source\":{}}]}}")
                : new HttpResponseMessage(HttpStatusCode.ServiceUnavailable) { Content = new StringContent("shards down") });

        var e = await Assert.ThrowsAsync<HttpRequestException>(() => Source(stub).LoadPeopleAsync(default));

        Assert.Contains("503", e.Message);
        Assert.Contains("shards down", e.Message);
        Assert.Equal(HttpMethod.Delete, stub.Calls[^1].Method);
    }
}

public sealed class FakeAnalyticsSource : IAnalyticsSource
{
    public int IncidentLoads;
    public int PeopleLoads;

    public Task<IReadOnlyList<IncidentRow>> LoadIncidentsAsync(CancellationToken ct)
    {
        Interlocked.Increment(ref IncidentLoads);
        return Task.FromResult<IReadOnlyList<IncidentRow>>(
        [
            Rows.Incident(1, "1966-08-18T16:07:00", frKia: 17, enKia: 10),
            Rows.Incident(2, "1966-08-19T09:00:00", frKia: 1, enKia: 2),
            Rows.Incident(3, "1966-08-20T09:00:00", frKia: 0, enKia: 4),
        ]);
    }

    public Task<IReadOnlyList<PersonRow>> LoadPeopleAsync(CancellationToken ct)
    {
        Interlocked.Increment(ref PeopleLoads);
        return Task.FromResult<IReadOnlyList<PersonRow>>([new PersonRow(new(1947, 1, 1), new(1969, 1, 1), "Army", [new DateOnly(1968, 1, 1)])]);
    }
}

public sealed class AnalyticsEndpointTests : IDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };
    private readonly FakeAnalyticsSource _source = new();
    private readonly ApiFactory _factory;

    public AnalyticsEndpointTests() =>
        _factory = new ApiFactory { Configure = s => { s.RemoveAll<IAnalyticsSource>(); s.AddSingleton<IAnalyticsSource>(_source); } };

    public void Dispose() => _factory.Dispose();

    private async Task<HttpResponseMessage> Post(string id, object? body = null)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, $"/api/analytics/charts/{id}") { Content = JsonContent.Create(body ?? new { }) };
        req.Headers.Add("X-Requested-With", "avw");
        return await _factory.CreateClient().SendAsync(req);
    }

    [Fact]
    public async Task Lists_the_charts_with_a_long_shared_cache()
    {
        var res = await _factory.CreateClient().GetAsync("/api/analytics/charts");

        var list = (await res.Content.ReadFromJsonAsync<ChartInfo[]>(Json))!;
        Assert.Equal(13, list.Length);
        Assert.Contains("max-age=3600", res.Headers.CacheControl!.ToString());
        Assert.Equal(["Casualties", "Frequency", "Weapons", "Personnel"], list.Select(c => c.Group.ToString()).Distinct());
    }

    [Fact]
    public async Task Draws_a_contact_chart_from_every_contact_when_no_filter_is_sent_and_from_the_chosen_ones_otherwise()
    {
        var all = (await (await Post("battle-damage-date")).Content.ReadFromJsonAsync<ChartResult>(Json))!;
        var some = (await (await Post("battle-damage-date", new { ids = new[] { 2, 3, 999 } })).Content.ReadFromJsonAsync<ChartResult>(Json))!;
        var none = (await (await Post("battle-damage-date", new { ids = Array.Empty<int>() })).Content.ReadFromJsonAsync<ChartResult>(Json))!;

        Assert.Equal((3, 3), (all.Rows, all.Series[0].Points.Length));
        Assert.Equal(2, some.Rows);                                                // 999 is not a contact and is ignored
        Assert.Equal([2, 4], some.Series.Single(s => s.Name == "Enemy killed").Points.Select(p => p[1]));
        Assert.Equal(0, none.Rows);                                                 // an empty filter is an empty chart, not "everything"
    }

    [Fact]
    public async Task Draws_personnel_charts_from_the_roll_whatever_filter_is_sent()
    {
        var chart = (await (await Post("age-at-death", new { ids = new[] { 1 } })).Content.ReadFromJsonAsync<ChartResult>(Json))!;

        Assert.Equal(1, chart.Rows);
        Assert.Equal(0, _source.IncidentLoads);
    }

    [Fact]
    public async Task Keeps_the_loaded_data_between_requests()
    {
        await Post("battle-damage-date");
        await Post("battle-damage-time");
        await Post("age-at-death");
        await Post("age-at-tour");

        Assert.Equal((1, 1), (_source.IncidentLoads, _source.PeopleLoads));
    }

    [Fact]
    public async Task Answers_404_for_an_unknown_chart_and_400_for_an_absurd_filter()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await Post("nonsense")).StatusCode);
        var tooMany = await Post("battle-damage-date", new { ids = Enumerable.Range(1, AnalyticsEndpoints.MaxIds + 1).ToArray() });
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
    }

    [Fact]
    public async Task Refuses_a_post_without_the_anti_forgery_header_like_every_other_change()
    {
        var res = await _factory.CreateClient().PostAsJsonAsync("/api/analytics/charts/battle-damage-date", new { });

        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }
}
