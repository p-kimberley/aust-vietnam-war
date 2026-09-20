using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Avw.Api.Tests;

public sealed class SecurityTests : IDisposable
{
    private sealed class Capture : ILoggerProvider
    {
        public List<string> Lines { get; } = [];
        public ILogger CreateLogger(string categoryName) => new Sink(this);
        public void Dispose()
        {
        }

        private sealed class Sink(Capture owner) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                lock (owner.Lines)
                {
                    owner.Lines.Add($"{logLevel}: {formatter(state, exception)}");
                }
            }
        }
    }

    private readonly Capture _log = new();
    private readonly ApiFactory _factory;

    public SecurityTests() => _factory = new ApiFactory { Configure = s => s.AddLogging(b => b.AddProvider(_log)) };

    public void Dispose() => _factory.Dispose();

    private HttpClient Http() => _factory.CreateClient(new() { AllowAutoRedirect = false });

    [Theory]
    [InlineData("/api/health/live")]
    [InlineData("/api/no-such-thing")]
    public async Task Every_response_says_what_the_browser_must_not_do_with_it(string url)
    {
        var res = await Http().GetAsync(url);

        Assert.Equal("nosniff", res.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", res.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("strict-origin-when-cross-origin", res.Headers.GetValues("Referrer-Policy").Single());
        Assert.Equal("default-src 'none'; frame-ancestors 'none'", res.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Contains("geolocation=()", res.Headers.GetValues("Permissions-Policy").Single());
    }

    [Fact]
    public async Task Insists_on_https_only_when_the_request_came_in_over_https()
    {
        var plain = await Http().GetAsync("/api/health/live");
        Assert.False(plain.Headers.Contains("Strict-Transport-Security"));

        var req = new HttpRequestMessage(HttpMethod.Get, "/api/health/live");
        req.Headers.Add("X-Forwarded-Proto", "https");
        var secure = await Http().SendAsync(req);
        Assert.Equal("max-age=31536000", secure.Headers.GetValues("Strict-Transport-Security").Single());
    }

    private static JsonContent Report(object body, string type = "application/csp-report") => JsonContent.Create(body, new System.Net.Http.Headers.MediaTypeHeaderValue(type));

    [Fact]
    public async Task Takes_a_browsers_report_without_the_anti_forgery_header_and_logs_one_line_without_the_query_string()
    {
        var res = await Http().PostAsync("/api/csp-report", Report(new Dictionary<string, object>
        {
            ["csp-report"] = new Dictionary<string, string>
            {
                ["effective-directive"] = "script-src-elem",
                ["blocked-uri"] = "https://evil.example/x.js?token=secret",
                ["document-uri"] = "https://vietnam-war.au/battlemap#frag",
            },
        }));

        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        var line = Assert.Single(_log.Lines, l => l.Contains("CSP "));
        Assert.Equal("Warning: CSP script-src-elem blocked https://evil.example/x.js on https://vietnam-war.au/battlemap", line);
        Assert.DoesNotContain("secret", line);
    }

    [Fact]
    public async Task Reads_the_newer_reporting_format_too()
    {
        var res = await Http().PostAsync("/api/csp-report", Report(new object[]
        {
            new Dictionary<string, object>
            {
                ["type"] = "csp-violation",
                ["body"] = new Dictionary<string, string> { ["effectiveDirective"] = "img-src", ["blockedURL"] = "https://cdn.example/a.png", ["documentURL"] = "https://vietnam-war.au/" },
            },
        }, "application/reports+json"));

        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        Assert.Contains(_log.Lines, l => l == "Warning: CSP img-src blocked https://cdn.example/a.png on https://vietnam-war.au/");
    }

    [Fact]
    public async Task Ignores_rubbish_and_refuses_a_large_body()
    {
        Assert.Equal(HttpStatusCode.NoContent, (await Http().PostAsync("/api/csp-report", new StringContent("not json", System.Text.Encoding.UTF8, "application/json"))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Http().PostAsync("/api/csp-report", Report(new { hello = "world" }))).StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge,
            (await Http().PostAsync("/api/csp-report", new StringContent(new string('x', 9000), System.Text.Encoding.UTF8, "application/json"))).StatusCode);
        Assert.DoesNotContain(_log.Lines, l => l.Contains("CSP "));
    }

    [Fact]
    public async Task Other_state_changing_requests_still_need_the_anti_forgery_header()
    {
        var res = await Http().PostAsync("/api/feedback", JsonContent.Create(new { }));

        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }

    [Fact]
    public async Task Limits_how_many_reports_one_address_can_send()
    {
        var http = Http();
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 35; i++)
        {
            statuses.Add((await http.PostAsync("/api/csp-report", Report(new { }))).StatusCode);
        }

        Assert.Equal(30, statuses.Count(s => s == HttpStatusCode.NoContent));
        Assert.All(statuses.Skip(30), s => Assert.Equal(HttpStatusCode.TooManyRequests, s));
    }
}
