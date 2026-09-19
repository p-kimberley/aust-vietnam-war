using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace Avw.Api.Map;

public static class MapEndpoints
{
    public static IServiceCollection AddAvwMap(this IServiceCollection services, IConfiguration config)
    {
        services.AddOptions<ElasticsearchOptions>()
            .Bind(config.GetSection(ElasticsearchOptions.Section))
            .ValidateDataAnnotations()
            .ValidateOnStart();
        services.Configure<MapOptions>(config.GetSection(MapOptions.Section));

        services.AddHttpClient<IContactSource, ElasticsearchContactSource>((sp, http) =>
        {
            var o = sp.GetRequiredService<IOptions<ElasticsearchOptions>>().Value;
            http.BaseAddress = new Uri(o.Url.TrimEnd('/') + "/");
            http.Timeout = TimeSpan.FromSeconds(30);
            if (!string.IsNullOrWhiteSpace(o.ApiKey))
            {
                http.DefaultRequestHeaders.Authorization = new("ApiKey", o.ApiKey);
            }
        });
        services.AddSingleton<ContactCatalogue>();
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

        // Streams the pre-serialised bytes. The 200 body is an array of ContactSummary; it is declared for the OpenAPI
        // document (and so the generated TypeScript client) because a raw byte result carries no type.
        g.MapGet("/contacts", async (ContactCatalogue catalogue, HttpContext ctx, CancellationToken ct) =>
            {
                var payload = await catalogue.GetAsync(ct);
                var headers = ctx.Response.GetTypedHeaders();
                headers.ETag = new EntityTagHeaderValue(payload.ETag);
                headers.CacheControl = new CacheControlHeaderValue { Public = true, MaxAge = TimeSpan.FromMinutes(5) };

                // Results.Bytes does not evaluate If-None-Match itself, so do it here.
                if (ctx.Request.GetTypedHeaders().IfNoneMatch.Any(t => t.Tag == payload.ETag || t.Tag == "*"))
                {
                    return Results.StatusCode(StatusCodes.Status304NotModified);
                }

                return Results.Bytes(payload.Json, "application/json");
            })
            .WithName("GetContacts")
            .Produces<ContactSummary[]>()
            .Produces(StatusCodes.Status304NotModified);
    }
}
