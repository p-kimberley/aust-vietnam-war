using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Avw.Api.Map;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Avw.Api.Tests;

/// <summary>Stands in for Elasticsearch in the API tests.</summary>
public sealed class FakeContactSource : IContactSource
{
    public int Calls;
    public Exception? Failure;
    public string? LastSearch;
    public int[] SearchResult = [2];

    public List<ContactRecord> Contacts { get; } =
    [
        new(2, "1966-03-03T19:50:00", 10.5525, 107.1653, 25, 0, 5, 0, [3], "Hardihood", "Patrol", "1ATF", false),
        new(9, "1966-03-05T08:10:00", 10.61, 107.2, 40, 2, 12, 7, [3, 4], null, null, "1ATF", true),
    ];

    public List<UnitInfo> Units { get; } =
    [
        new(3, null, "1", "RAR", "1 RAR", "1 Battalion, Royal Australian Regiment", "1 Battalion, Royal Australian Regiment"),
        new(4, 3, "A", "Coy", "A Coy, 1 RAR", "A Company, 1 Battalion", "1 Battalion, Royal Australian Regiment|A Company"),
    ];

    public Dictionary<int, ContactDetail> Details { get; } = new()
    {
        [2] = new(2, "1966-03-03T19:50:00", 10.5525, 107.1653, "YS374671", "Hardihood", null,
            [new(3, "1 Pl, A Coy, 5 RAR", "1 Platoon, A Company, 5 Battalion, Royal Australian Regiment")],
            25, 5, 1, 2, 3, 4, "AT LOC STATED, CONTACTED 5 EN.", "Intel V-dat Base", null),
    };

    public Task<ContactDetail?> GetAsync(int id, CancellationToken ct) =>
        Task.FromResult(Details.GetValueOrDefault(id));

    public Task<int[]> SearchAsync(string text, CancellationToken ct)
    {
        LastSearch = text;
        return Task.FromResult(SearchResult);
    }

    public Task<ContactSet> GetAllAsync(CancellationToken ct)
    {
        Interlocked.Increment(ref Calls);
        if (Failure is not null)
        {
            throw Failure;
        }

        return Task.FromResult(new ContactSet(Contacts.ToList(), Units.ToList()));
    }
}

public class ContactsEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private HttpClient Client() => factory.CreateClient(new() { AllowAutoRedirect = false });

    [Fact]
    public async Task Contacts_are_returned_compactly_and_are_public()
    {
        var res = await Client().GetAsync("/api/contacts");
        var contacts = await res.Content.ReadFromJsonAsync<ContactSummary[]>(new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(2, contacts!.Length);
        Assert.Equal(new[] { 3, 4 }, contacts[1].Units);
        Assert.Equal("1966-03-03T19:50:00", contacts[0].Dtg);
        Assert.Contains("public", res.Headers.CacheControl!.ToString());
        Assert.NotNull(res.Headers.ETag);
    }

    [Fact]
    public async Task Contacts_are_compressed_for_clients_that_accept_it()
    {
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/contacts");
        req.Headers.AcceptEncoding.ParseAdd("gzip");

        var res = await Client().SendAsync(req);

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("gzip", res.Content.Headers.ContentEncoding);
    }

    [Fact]
    public async Task A_matching_etag_returns_304_without_a_body()
    {
        var client = Client();
        var etag = (await client.GetAsync("/api/contacts")).Headers.ETag!;

        var req = new HttpRequestMessage(HttpMethod.Get, "/api/contacts");
        req.Headers.IfNoneMatch.Add(etag);
        var res = await client.SendAsync(req);

        Assert.Equal(HttpStatusCode.NotModified, res.StatusCode);
        Assert.Empty(await res.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task A_contact_is_returned_in_full()
    {
        var res = await Client().GetAsync("/api/contacts/2");
        var detail = await res.Content.ReadFromJsonAsync<ContactDetail>(new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("YS374671", detail!.GridRef);
        Assert.Equal("Hardihood", detail.Operation);
        Assert.Equal("1 Pl, A Coy, 5 RAR", Assert.Single(detail.Units).ShortName);
        Assert.Equal((25, 5, 1, 2, 3, 4), (detail.FrForce, detail.EnForce, detail.FrKia, detail.FrWia, detail.EnKia, detail.EnWia));
        Assert.Contains("public", res.Headers.CacheControl!.ToString());
    }

    [Theory]
    [InlineData("/api/contacts/999")]
    [InlineData("/api/contacts/0")]
    [InlineData("/api/contacts/-4")]
    [InlineData("/api/contacts/abc")]
    [InlineData("/api/contacts/2%2F..%2F_search")]
    public async Task An_unknown_or_malformed_contact_is_not_found(string path)
    {
        var res = await Client().GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task Map_config_is_served_without_signing_in()
    {
        var res = await Client().GetAsync("/api/map/config");
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(107.17, json.GetProperty("center")[0].GetDouble());
        Assert.Equal("plain", json.GetProperty("basemaps")[0].GetProperty("id").GetString());
        Assert.False(json.TryGetProperty("mapboxToken", out _));
    }

    [Fact]
    public async Task OpenApi_document_describes_the_map_endpoints()
    {
        var json = await Client().GetStringAsync("/api/openapi/v1.json");
        Assert.Contains("/api/contacts", json);
        Assert.Contains("/api/map/config", json);
        Assert.Contains("/api/contacts/{id}", json);
    }
}

public class ContactCatalogueTests
{
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 9, 20, 0, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static (ContactCatalogue Catalogue, FakeContactSource Source, Clock Clock) Create(int cacheSeconds = 600)
    {
        var source = new FakeContactSource();
        var clock = new Clock();
        var options = Options.Create(new ElasticsearchOptions { Url = "http://es.test", ContactsCacheSeconds = cacheSeconds });
        return (new ContactCatalogue(source, options, clock, NullLogger<ContactCatalogue>.Instance), source, clock);
    }

    [Fact]
    public async Task Concurrent_requests_share_one_source_call_and_one_payload()
    {
        var (catalogue, source, _) = Create();

        var payloads = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => catalogue.GetAsync(default)));

        Assert.Equal(1, source.Calls);
        Assert.All(payloads, p => Assert.Same(payloads[0], p));
    }

    [Fact]
    public async Task The_payload_is_rebuilt_after_it_expires()
    {
        var (catalogue, source, clock) = Create(cacheSeconds: 60);
        await catalogue.GetAsync(default);

        clock.Now = clock.Now.AddSeconds(59);
        await catalogue.GetAsync(default);
        Assert.Equal(1, source.Calls);

        clock.Now = clock.Now.AddSeconds(2);
        await catalogue.GetAsync(default);
        Assert.Equal(2, source.Calls);
    }

    [Fact]
    public async Task The_etag_changes_only_when_the_data_changes()
    {
        var (catalogue, source, clock) = Create(cacheSeconds: 1);
        var first = await catalogue.GetAsync(default);

        clock.Now = clock.Now.AddSeconds(2);
        var unchanged = await catalogue.GetAsync(default);
        Assert.Equal(first.Contacts.ETag, unchanged.Contacts.ETag);
        Assert.Equal(first.Filters.ETag, unchanged.Filters.ETag);

        source.Contacts.Add(new(11, "1966-04-01T00:00:00", 10.7, 107.3, 1, 0, 1, 0, [], null, null, null, null));
        clock.Now = clock.Now.AddSeconds(2);
        var changed = await catalogue.GetAsync(default);
        Assert.NotEqual(first.Contacts.ETag, changed.Contacts.ETag);
        Assert.NotEqual(first.Filters.ETag, changed.Filters.ETag);
        Assert.Equal(3, changed.Contacts.Count);
    }

    [Fact]
    public async Task A_failed_refresh_serves_the_previous_payload()
    {
        var (catalogue, source, clock) = Create(cacheSeconds: 1);
        var first = await catalogue.GetAsync(default);

        source.Failure = new HttpRequestException("es is down");
        clock.Now = clock.Now.AddSeconds(2);
        var stale = await catalogue.GetAsync(default);

        Assert.Same(first, stale);
    }

    [Fact]
    public async Task A_failure_with_nothing_cached_is_an_error()
    {
        var (catalogue, source, _) = Create();
        source.Failure = new HttpRequestException("es is down");

        await Assert.ThrowsAsync<HttpRequestException>(() => catalogue.GetAsync(default));
    }
}

public class ElasticsearchContactSourceTests
{
    private sealed class Stub(string response, HttpStatusCode status = HttpStatusCode.OK) : HttpMessageHandler
    {
        public HttpRequestMessage? Request;
        public string? RequestBody;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Request = request;
            RequestBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
            return new HttpResponseMessage(status)
            {
                Content = new StringContent(response, Encoding.UTF8, "application/json"),
            };
        }
    }

    // Shape of a real avw_contacts search response, trimmed to the requested _source fields.
    private const string Response = """
        {"took":5,"timed_out":false,"hits":{"total":{"value":3,"relation":"eq"},"hits":[
          {"_index":"avw_contacts","_id":"2","_source":{"DTG":"1966-03-03T19:50:00","Location":{"lat":10.5525403933,"lon":107.165297718204},
            "Fr_Force_Present":25,"Total_Fr_Cas":0,"En_Force":5,"Total_En_Cas":0,"Fr_Units":[{"_id":3}]}},
          {"_index":"avw_contacts","_id":"7","_source":{"DTG":"1966-03-04T01:00:00","Location":{"lat":10.6,"lon":107.2},
            "Fr_Force_Present":40,"Total_Fr_Cas":2,"En_Force":12,"Total_En_Cas":7,"Fr_Units":[{"_id":3},{"_id":4}]}},
          {"_index":"avw_contacts","_id":"8","_source":{"DTG":"1966-03-05T01:00:00"}}
        ]}}
        """;

    private static (ElasticsearchContactSource Source, Stub Handler) Create(string response, ElasticsearchOptions? o = null)
    {
        o ??= new ElasticsearchOptions { Url = "http://es.test" };
        var handler = new Stub(response);
        var http = new HttpClient(handler) { BaseAddress = new Uri("http://es.test/") };
        return (new ElasticsearchContactSource(http, Options.Create(o), NullLogger<ElasticsearchContactSource>.Instance), handler);
    }

    [Fact]
    public async Task Maps_hits_to_compact_contacts_and_skips_those_without_a_location()
    {
        var (source, _) = Create(Response);

        var set = await source.GetAllAsync(default);
        var contacts = set.Contacts;

        Assert.Equal(2, contacts.Count);
        Assert.Equal(2, contacts[0].Id);
        Assert.Equal(10.5525403933, contacts[0].Lat);
        Assert.Equal(107.165297718204, contacts[0].Lon);
        Assert.Equal(25, contacts[0].Fr);
        Assert.Equal(new[] { 3, 4 }, contacts[1].Units);
        Assert.Equal(7, contacts[1].EnCas);
    }

    [Fact]
    public async Task Requests_only_the_fields_the_map_needs_from_the_configured_index()
    {
        var (source, handler) = Create(Response, new ElasticsearchOptions
        {
            Url = "http://es.test", ContactsIndex = "avw_contacts_v2", MaxContacts = 8000,
        });

        await source.GetAllAsync(default);

        Assert.Equal("/avw_contacts_v2/_search", handler.Request!.RequestUri!.AbsolutePath);
        using var body = JsonDocument.Parse(handler.RequestBody!);
        Assert.Equal(8000, body.RootElement.GetProperty("size").GetInt32());
        var fields = body.RootElement.GetProperty("_source").EnumerateArray().Select(f => f.GetString()).ToArray();
        Assert.Contains("Location", fields);
        Assert.DoesNotContain("Description_of_Incident", fields);
    }

    [Fact]
    public async Task Sends_field_names_exactly_as_indexed_not_camel_cased()
    {
        var (source, handler) = Create(Response);

        await source.GetAllAsync(default);

        // Elasticsearch fields are case-sensitive: a re-cased `dtg` is an unmapped field and the search fails with 400.
        using var body = JsonDocument.Parse(handler.RequestBody!);
        Assert.True(body.RootElement.GetProperty("sort")[0].TryGetProperty("DTG", out _));
        Assert.True(body.RootElement.GetProperty("query").GetProperty("exists").TryGetProperty("field", out var f));
        Assert.Equal("Location", f.GetString());
        Assert.True(body.RootElement.TryGetProperty("track_total_hits", out _));
    }

    [Fact]
    public async Task A_failed_search_reports_what_elasticsearch_said()
    {
        var handler = new Stub("""{"error":{"reason":"No mapping found for [dtg] in order to sort on"},"status":400}""", HttpStatusCode.BadRequest);
        var http = new HttpClient(handler) { BaseAddress = new Uri("http://es.test/") };
        var source = new ElasticsearchContactSource(
            http, Options.Create(new ElasticsearchOptions { Url = "http://es.test" }), NullLogger<ElasticsearchContactSource>.Instance);

        var ex = await Assert.ThrowsAsync<HttpRequestException>(() => source.GetAllAsync(default));

        Assert.Contains("400", ex.Message);
        Assert.Contains("No mapping found for [dtg]", ex.Message);
        Assert.Equal(HttpStatusCode.BadRequest, ex.StatusCode);
    }

    private const string DocResponse = """
        {"_index":"avw_contacts","_id":"2","found":true,"_source":{
          "DTG":"1966-03-03T19:50:00","Location":{"lat":10.55,"lon":107.16},"Grid_Ref":"YS374671","Operation":"Hardihood","Unit_Task":"  ",
          "Fr_Units":[
            {"_id":5,"ShortDisplayName":"Z Coy","LongDisplayName":"Z Company"},
            {"_id":3,"ShortDisplayName":"1 Pl, A Coy","LongDisplayName":"1 Platoon, A Company"},
            {"_id":9,"ShortDisplayName":"Secret","LongDisplayName":"Secret unit","Hidden":true}],
          "Fr_Force_Present":25,"En_Force":5,"Fr_KIA":1,"Fr_WIA":2,"En_KIA":3,"En_WIA":4,
          "Description_of_Incident":"AT LOC STATED.","Archival_Source_Data":"Intel V-dat Base",
          "Source_Hyperlink":"https://www.awm.gov.au/collection/R1"}}
        """;

    [Fact]
    public async Task Maps_a_document_to_detail_hiding_hidden_units_and_blank_fields()
    {
        var (source, handler) = Create(DocResponse);

        var d = await source.GetAsync(2, default);

        Assert.Equal("/avw_contacts/_doc/2", handler.Request!.RequestUri!.AbsolutePath);
        Assert.Contains("Description_of_Incident", handler.Request.RequestUri.Query);
        Assert.Equal("Hardihood", d!.Operation);
        Assert.Null(d.UnitTask);
        Assert.Equal(new[] { "1 Pl, A Coy", "Z Coy" }, d.Units.Select(u => u.ShortName));
        Assert.DoesNotContain(d.Units, u => u.Id == 9);
        Assert.Equal((1, 2, 3, 4), (d.FrKia, d.FrWia, d.EnKia, d.EnWia));
        Assert.Equal("https://www.awm.gov.au/collection/R1", d.SourceUrl);
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:text/html,<script>1</script>")]
    [InlineData("/relative/path")]
    [InlineData("not a url")]
    public async Task Drops_source_links_that_are_not_http_urls(string link)
    {
        var (source, _) = Create(DocResponse.Replace("https://www.awm.gov.au/collection/R1", link));
        Assert.Null((await source.GetAsync(2, default))!.SourceUrl);
    }

    [Fact]
    public async Task A_missing_document_is_null()
    {
        var (source, _) = Create("""{"_index":"avw_contacts","_id":"77","found":false}""");
        Assert.Null(await source.GetAsync(77, default));
    }
}

public class MapOptionsValidatorTests
{
    private static MapOptions Valid() => new()
    {
        Basemaps = [new() { Id = "terrain", Name = "Terrain", Style = "https://tiles.test/styles/terrain/style.json", Default = true }],
    };

    private static string[] Failures(MapOptions o)
    {
        var result = new MapOptionsValidator().Validate(null, o);
        return result.Failed ? result.Failures!.ToArray() : [];
    }

    [Fact]
    public void A_catalogue_of_http_styles_is_valid()
    {
        var o = Valid();
        o.Overlays = [new() { Id = "topo", Name = "Topo", Tiles = ["https://geo.test/wmts/{z}/{x}/{y}.png"] }];
        o.Terrain = new() { Tiles = ["https://dem.test/{z}/{x}/{y}.png"] };

        Assert.Empty(Failures(o));
    }

    [Fact]
    public void At_least_one_basemap_is_required()
    {
        Assert.Contains(Failures(new MapOptions()), f => f.Contains("at least one basemap"));
    }

    [Theory]
    [InlineData("mapbox://styles/mapbox/outdoors-v12")]
    [InlineData("/styles/terrain/style.json")]
    [InlineData("")]
    [InlineData("javascript:alert(1)")]
    public void A_style_must_be_an_absolute_http_url(string style)
    {
        var o = Valid();
        o.Basemaps[0].Style = style;

        var failure = Assert.Single(Failures(o));
        Assert.Contains("absolute http(s) URL", failure);
    }

    [Fact]
    public void The_mapbox_error_says_what_to_do_instead()
    {
        var o = Valid();
        o.Basemaps[0].Style = "mapbox://styles/gradata-systems/abc";

        Assert.Contains("host the style on a tile server", Failures(o).Single());
    }

    [Fact]
    public void Duplicate_ids_are_rejected()
    {
        var o = Valid();
        o.Basemaps.Add(new() { Id = "TERRAIN", Name = "Again", Style = "https://tiles.test/x/style.json" });

        Assert.Contains(Failures(o), f => f.Contains("more than one entry with id"));
    }

    [Fact]
    public void An_overlay_needs_tile_urls()
    {
        var o = Valid();
        o.Overlays = [new() { Id = "topo", Name = "Topo", Tiles = [] }];

        Assert.Contains(Failures(o), f => f.Contains("Overlays 'topo'"));
    }

    [Theory]
    [InlineData(null, "terrarium")]
    [InlineData("https://dem.test/tiles.json", "elevation")]
    public void Terrain_needs_a_source_and_a_known_encoding(string? url, string encoding)
    {
        var o = Valid();
        o.Terrain = new() { Url = url, Encoding = encoding };

        Assert.NotEmpty(Failures(o));
    }
}
