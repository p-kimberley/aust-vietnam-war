using System.Text.Json;
using System.Threading.RateLimiting;

namespace Avw.Api.Security;

/// <summary>
/// Response headers that tell the browser what it must not do with what the API sends. The API returns data and pictures, never
/// pages, so its policy is the strictest one: nothing may load or run from an API response, and none may be framed. The site's own
/// pages carry the fuller policy, set by the web server.
/// </summary>
public static class SecurityHeaders
{
    public const string ReportPolicy = "csp-report";
    private const int MaxReportBytes = 8192;

    public static void Apply(HttpContext ctx)
    {
        ctx.Response.OnStarting(() =>
        {
            var h = ctx.Response.Headers;
            h.TryAdd("X-Content-Type-Options", "nosniff");
            h.TryAdd("Referrer-Policy", "strict-origin-when-cross-origin");
            h.TryAdd("X-Frame-Options", "DENY");
            h.TryAdd("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
            h.TryAdd("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");

            // Only over HTTPS (behind the ingress, per the forwarded headers): telling a browser on plain HTTP to insist on HTTPS locks out local development.
            if (ctx.Request.IsHttps)
            {
                h.TryAdd("Strict-Transport-Security", "max-age=31536000");
            }

            return Task.CompletedTask;
        });
    }

    public static IServiceCollection AddAvwSecurity(this IServiceCollection services)
    {
        services.AddRateLimiter(o =>
            o.AddPolicy(ReportPolicy, ctx => RateLimitPartition.GetFixedWindowLimiter(
                ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })));
        return services;
    }

    /// <summary>
    /// Where browsers report what the site's content security policy blocked (or would block, while it is only being watched).
    /// Anyone can post here, so it reads a small body, keeps only the few fields that help, and writes one log line.
    /// </summary>
    public static void MapSecurityEndpoints(this IEndpointRouteBuilder api) =>
        api.MapPost("/csp-report", async (HttpRequest request, ILogger<Program> logger, CancellationToken ct) =>
            {
                // Read at most 8 KB whether or not the sender says how long the body is.
                var buffer = new byte[MaxReportBytes + 1];
                var length = 0;
                int read;
                while (length < buffer.Length && (read = await request.Body.ReadAsync(buffer.AsMemory(length), ct)) > 0)
                {
                    length += read;
                }

                if (length > MaxReportBytes)
                {
                    return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
                }

                try
                {
                    using var doc = JsonDocument.Parse(buffer.AsMemory(0, length));
                    foreach (var report in Reports(doc.RootElement).Take(5))
                    {
                        logger.LogWarning("CSP {Effective} blocked {Blocked} on {Page}", Field(report, "effectiveDirective", "effective-directive"),
                            Field(report, "blockedURL", "blocked-uri"), Field(report, "documentURL", "document-uri"));
                    }
                }
                catch (JsonException)
                {
                    // Not a report. Nothing to say to whoever sent it.
                }

                return Results.NoContent();
            })
            .RequireRateLimiting(ReportPolicy)
            .WithName("ReportContentSecurityPolicy")
            .ExcludeFromDescription();

    // Two formats exist: {"csp-report": {...}} (report-uri) and [{"type":"csp-violation","body":{...}}] (Reporting API).
    private static IEnumerable<JsonElement> Reports(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("csp-report", out var legacy) && legacy.ValueKind == JsonValueKind.Object)
        {
            yield return legacy;
        }
        else if (root.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in root.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.Object && item.TryGetProperty("body", out var body) && body.ValueKind == JsonValueKind.Object)
                {
                    yield return body;
                }
            }
        }
    }

    private static string Field(JsonElement report, params string[] names)
    {
        foreach (var name in names)
        {
            if (report.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
            {
                var s = v.GetString() ?? "";
                // Cut, and drop the query string, which can carry a token; and no control characters into a log line.
                var q = s.IndexOfAny(['?', '#']);
                s = q >= 0 ? s[..q] : s;
                s = new string(s.Where(c => !char.IsControl(c)).ToArray());
                return s.Length > 200 ? s[..200] : s;
            }
        }

        return "";
    }
}
