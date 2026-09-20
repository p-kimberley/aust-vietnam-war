using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Avw.Api.Map;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Avw.Api.Tests;

public class SnippetTests
{
    [Theory]
    [InlineData("", 0)]
    [InlineData("plain text", 1)]
    [InlineData("before \u0001match\u0002 after", 3)]
    [InlineData("\u0001match\u0002", 1)]
    [InlineData("a \u0001one\u0002 b \u0001two\u0002 c", 5)]
    public void Splits_an_excerpt_on_the_highlight_markers(string fragment, int parts) =>
        Assert.Equal(parts, ElasticsearchContactSource.SplitSnippet(fragment).Length);

    [Fact]
    public void Marks_exactly_the_matched_parts()
    {
        var parts = ElasticsearchContactSource.SplitSnippet("AT LOC, \u0001CLAYMORE\u0002 AMBUSH \u0001MINE\u0002.");

        Assert.Equal(
            [("AT LOC, ", false), ("CLAYMORE", true), (" AMBUSH ", false), ("MINE", true), (".", false)],
            parts.Select(p => (p.Text, p.Match)));
    }

    [Fact]
    public void Never_returns_a_marker_character_or_markup_in_the_text()
    {
        var parts = ElasticsearchContactSource.SplitSnippet("<b>x</b> \u0001<script>\u0002 y");

        Assert.All(parts, p => Assert.DoesNotContain('\u0001', p.Text));
        Assert.All(parts, p => Assert.DoesNotContain('\u0002', p.Text));
        Assert.Contains(parts, p => p.Text == "<script>" && p.Match);      // text stays text: the client renders it as text
    }
}

public class FindEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task Returns_hits_with_a_highlighted_excerpt_and_the_total()
    {
        var res = await factory.CreateClient().GetAsync("/api/contacts/find?q=claymore");
        var found = await res.Content.ReadFromJsonAsync<FindResult>(Web);

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(327, found!.Total);
        var hit = Assert.Single(found.Hits);
        Assert.Equal(2, hit.Id);
        Assert.Equal(("claymore", true), (hit.Snippet[1].Text, hit.Snippet[1].Match));
        Assert.Contains("public", res.Headers.CacheControl!.ToString());
    }

    [Theory]
    [InlineData("?q=a")]
    [InlineData("")]
    [InlineData("?q=")]
    public async Task Needs_at_least_two_characters(string query)
    {
        var res = await factory.CreateClient().GetAsync("/api/contacts/find" + query);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Theory]
    [InlineData("", 8)]
    [InlineData("&limit=3", 3)]
    [InlineData("&limit=0", 1)]
    [InlineData("&limit=500", 20)]
    public async Task Limits_the_number_of_hits_to_a_sensible_range(string query, int expected)
    {
        var res = await factory.CreateClient().GetAsync("/api/contacts/find?q=ambush" + query);

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var source = (FakeContactSource)factory.Services.GetService(typeof(FakeContactSource))!;
        Assert.Equal(expected, source.LastFindLimit);
    }

    [Fact]
    public async Task Shares_the_search_rate_limit()
    {
        using var limited = factory.WithWebHostBuilder(b => b.UseSetting("Elasticsearch:SearchPermitsPerMinute", "2"));
        var client = limited.CreateClient();

        var statuses = new List<HttpStatusCode>();
        foreach (var path in new[] { "/api/contacts/find?q=aa", "/api/contacts/search?q=aa", "/api/contacts/find?q=aa" })
        {
            statuses.Add((await client.GetAsync(path)).StatusCode);
        }

        Assert.Equal([HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.TooManyRequests], statuses);
    }
}

public class ElasticsearchFindMappingTests
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

    [Fact]
    public async Task Maps_highlights_to_parts_and_falls_back_to_the_start_of_the_report()
    {
        var (source, _) = Create("""
            {"hits":{"total":{"value":40},"hits":[
              {"_id":"5","_source":{"DTG":"1966-08-18T16:07:00","Description_of_Incident":"unused"},"highlight":{"Description_of_Incident":["AT LOC \u0001CLAYMORE\u0002 FIRED"]}},
              {"_id":"6","_source":{"DTG":"1966-08-19T01:00:00","Description_of_Incident":"NO HIGHLIGHT HERE"}},
              {"_id":"x","_source":{"DTG":"1966-08-19T01:00:00"}},
              {"_id":"7","_source":{}}
            ]}}
            """);

        var found = await source.FindAsync("claymore", 8, default);

        Assert.Equal(40, found.Total);
        Assert.Equal([5, 6], found.Hits.Select(h => h.Id));                   // non-numeric ids and rows without a date are dropped
        Assert.Equal(3, found.Hits[0].Snippet.Length);
        Assert.Equal(("NO HIGHLIGHT HERE", false), (found.Hits[1].Snippet[0].Text, found.Hits[1].Snippet[0].Match));
    }

    [Fact]
    public async Task Cuts_a_long_fallback_excerpt()
    {
        var json = "{\"hits\":{\"total\":{\"value\":1},\"hits\":[{\"_id\":\"5\",\"_source\":{\"DTG\":\"1966-08-18T16:07:00\",\"Description_of_Incident\":\""
                   + new string('x', 400) + "\"}}]}}";
        var (source, _) = Create(json);

        var text = (await source.FindAsync("x", 8, default)).Hits[0].Snippet[0].Text;

        Assert.Equal(141, text.Length);
        Assert.EndsWith("…", text);
    }

    [Fact]
    public async Task Asks_for_every_word_only_locations_and_a_short_highlighted_fragment()
    {
        var (source, handler) = Create("""{"hits":{"total":{"value":0},"hits":[]}}""");

        await source.FindAsync("claymore ambush", 5, default);

        using var body = JsonDocument.Parse(handler.RequestBody!);
        Assert.Equal(5, body.RootElement.GetProperty("size").GetInt32());
        var match = body.RootElement.GetProperty("query").GetProperty("bool").GetProperty("must").GetProperty("match").GetProperty("Description_of_Incident");
        Assert.Equal(("claymore ambush", "and"), (match.GetProperty("query").GetString(), match.GetProperty("operator").GetString()));
        Assert.Equal("Location", body.RootElement.GetProperty("query").GetProperty("bool").GetProperty("filter").GetProperty("exists").GetProperty("field").GetString());
        var highlight = body.RootElement.GetProperty("highlight").GetProperty("fields").GetProperty("Description_of_Incident");
        Assert.Equal(140, highlight.GetProperty("fragment_size").GetInt32());
        Assert.Equal(1, highlight.GetProperty("number_of_fragments").GetInt32());
    }
}
