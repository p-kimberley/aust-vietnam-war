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
    public List<ContactSummary> Contacts { get; } =
    [
        new(2, "1966-03-03T19:50:00", 10.5525, 107.1653, 25, 0, 5, 0, [3]),
        new(9, "1966-03-05T08:10:00", 10.61, 107.2, 40, 2, 12, 7, [3, 4]),
    ];

    public Task<IReadOnlyList<ContactSummary>> GetAllAsync(CancellationToken ct)
    {
        Interlocked.Increment(ref Calls);
        if (Failure is not null)
        {
            throw Failure;
        }

        return Task.FromResult<IReadOnlyList<ContactSummary>>(Contacts.ToList());
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
    public async Task Map_config_is_served_without_signing_in()
    {
        var res = await Client().GetAsync("/api/map/config");
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(107.17, json.GetProperty("center")[0].GetDouble());
    }

    [Fact]
    public async Task OpenApi_document_describes_the_map_endpoints()
    {
        var json = await Client().GetStringAsync("/api/openapi/v1.json");
        Assert.Contains("/api/contacts", json);
        Assert.Contains("/api/map/config", json);
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
        Assert.Equal(first.ETag, unchanged.ETag);

        source.Contacts.Add(new(11, "1966-04-01T00:00:00", 10.7, 107.3, 1, 0, 1, 0, []));
        clock.Now = clock.Now.AddSeconds(2);
        var changed = await catalogue.GetAsync(default);
        Assert.NotEqual(first.ETag, changed.ETag);
        Assert.Equal(3, changed.Count);
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
    private sealed class Stub(string response) : HttpMessageHandler
    {
        public HttpRequestMessage? Request;
        public string? RequestBody;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Request = request;
            RequestBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
            return new HttpResponseMessage(HttpStatusCode.OK)
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

        var contacts = await source.GetAllAsync(default);

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
}
