using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace Avw.Api.Map;

public static class MapEndpoints
{
    public const string SearchPolicy = "contact-search";
    public const int MinSearchLength = 2;
    public const int MaxSearchLength = 100;

    public static IServiceCollection AddAvwMap(this IServiceCollection services, IConfiguration config)
    {
        services.AddOptions<ElasticsearchOptions>()
            .Bind(config.GetSection(ElasticsearchOptions.Section))
            .ValidateDataAnnotations()
            .ValidateOnStart();
        services.AddSingleton<IValidateOptions<MapOptions>, MapOptionsValidator>();
        services.AddOptions<MapOptions>()
            .Bind(config.GetSection(MapOptions.Section))
            .ValidateOnStart();

        var client = services.AddHttpClient<IContactSource, ElasticsearchContactSource>((sp, http) =>
        {
            var o = sp.GetRequiredService<IOptions<ElasticsearchOptions>>().Value;
            http.BaseAddress = new Uri(o.Url.TrimEnd('/') + "/");
            http.Timeout = TimeSpan.FromSeconds(30);
            if (!string.IsNullOrWhiteSpace(o.ApiKey))
            {
                http.DefaultRequestHeaders.Authorization = new("ApiKey", o.ApiKey);
            }
        });
        client.ConfigurePrimaryHttpMessageHandler(sp =>
        {
            var handler = new SocketsHttpHandler();
            var ca = sp.GetRequiredService<IOptions<ElasticsearchOptions>>().Value.CaCertificatePath;
            if (!string.IsNullOrWhiteSpace(ca))
            {
                var validation = PrivateCaValidation.FromFile(ca);
                handler.SslOptions.RemoteCertificateValidationCallback =
                    (_, cert, chain, errors) => validation.Validate(cert, chain, errors);
            }

            return handler;
        });
        services.AddSingleton<ContactCatalogue>();

        // Text search reaches Elasticsearch on every call, so it is limited per client address. The address is the real
        // one because forwarded headers are applied first.
        var permits = config.GetValue<int?>("Elasticsearch:SearchPermitsPerMinute") ?? 60;
        services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.AddPolicy(SearchPolicy, ctx => RateLimitPartition.GetFixedWindowLimiter(
                ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = permits, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
        });
        return services;
    }

    public static void MapMapEndpoints(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/").WithTags("Map");

        g.MapGet("/map/config", (IOptionsSnapshot<MapOptions> options, HttpContext ctx) =>
            {
                ctx.Response.Headers.CacheControl = "public, max-age=300";
                return options.Value;
            })
            .WithName("GetMapConfig")
            .Produces<MapOptions>();

        // These stream pre-serialised bytes. The 200 body types are declared for the OpenAPI document (and so the generated
        // TypeScript client) because a raw byte result carries no type.
        g.MapGet("/contacts", async (ContactCatalogue catalogue, HttpContext ctx, CancellationToken ct) =>
                Serve(ctx, (await catalogue.GetAsync(ct)).Contacts))
            .WithName("GetContacts")
            .Produces<ContactSummary[]>()
            .Produces(StatusCodes.Status304NotModified);

        g.MapGet("/contacts/filters", async (ContactCatalogue catalogue, HttpContext ctx, CancellationToken ct) =>
                Serve(ctx, (await catalogue.GetAsync(ct)).Filters))
            .WithName("GetContactFilters")
            .Produces<FilterCatalogue>()
            .Produces(StatusCodes.Status304NotModified);

        g.MapGet("/contacts/search", async (string? q, IContactSource source, HttpContext ctx, CancellationToken ct) =>
            {
                var text = q?.Trim() ?? "";
                if (text.Length < MinSearchLength || text.Length > MaxSearchLength)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["q"] = [$"Search text must be {MinSearchLength} to {MaxSearchLength} characters."],
                    });
                }

                ctx.Response.Headers.CacheControl = "public, max-age=60";
                return Results.Ok(new SearchResult(await source.SearchAsync(text, ct)));
            })
            .RequireRateLimiting(SearchPolicy)
            .WithName("SearchContacts")
            .Produces<SearchResult>()
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status429TooManyRequests);

        // The int constraint keeps anything but a plain number out of the Elasticsearch URL.
        g.MapGet("/contacts/{id:int:min(1)}", async (int id, IContactSource source, HttpContext ctx, CancellationToken ct) =>
            {
                var detail = await source.GetAsync(id, ct);
                if (detail is null)
                {
                    return Results.NotFound();
                }

                ctx.Response.Headers.CacheControl = "public, max-age=300";
                return Results.Ok(detail);
            })
            .WithName("GetContact")
            .Produces<ContactDetail>()
            .Produces(StatusCodes.Status404NotFound);
    }

    private static IResult Serve(HttpContext ctx, ContactPayload payload)
    {
        var headers = ctx.Response.GetTypedHeaders();
        headers.ETag = new EntityTagHeaderValue(payload.ETag);
        headers.CacheControl = new CacheControlHeaderValue { Public = true, MaxAge = TimeSpan.FromMinutes(5) };

        // Results.Bytes does not evaluate If-None-Match itself, so do it here.
        if (ctx.Request.GetTypedHeaders().IfNoneMatch.Any(t => t.Tag == payload.ETag || t.Tag == "*"))
        {
            return Results.StatusCode(StatusCodes.Status304NotModified);
        }

        return Results.Bytes(payload.Json, "application/json");
    }
}
