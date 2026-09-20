using Avw.Api.Map;
using Microsoft.Extensions.Options;

namespace Avw.Api.Analytics;

/// <summary>Keeps the chart data for a while so a chart costs a calculation, not a trip to Elasticsearch.</summary>
public sealed class AnalyticsStore(IAnalyticsSource source, IOptions<ElasticsearchOptions> options, TimeProvider clock, ILogger<AnalyticsStore> logger)
{
    /// <summary>The nominal roll changes far less often than anything else, and reading it is the expensive part.</summary>
    public static readonly TimeSpan PeopleLifetime = TimeSpan.FromHours(6);

    private readonly Cached<IncidentRow> _incidents = new(clock);
    private readonly Cached<PersonRow> _people = new(clock);

    public Task<IReadOnlyList<IncidentRow>> IncidentsAsync(CancellationToken ct) =>
        _incidents.GetAsync(source.LoadIncidentsAsync, TimeSpan.FromSeconds(options.Value.ContactsCacheSeconds), logger, ct);

    public Task<IReadOnlyList<PersonRow>> PeopleAsync(CancellationToken ct) =>
        _people.GetAsync(source.LoadPeopleAsync, PeopleLifetime, logger, ct);

    /// <summary>One list, loaded at most once per lifetime however many requests arrive, and kept if a refresh fails.</summary>
    private sealed class Cached<T>(TimeProvider clock)
    {
        private readonly SemaphoreSlim _gate = new(1, 1);
        private IReadOnlyList<T>? _value;
        private DateTimeOffset _expires;

        public async Task<IReadOnlyList<T>> GetAsync(Func<CancellationToken, Task<IReadOnlyList<T>>> load, TimeSpan lifetime, ILogger logger, CancellationToken ct)
        {
            if (_value is { } fresh && clock.GetUtcNow() < _expires)
            {
                return fresh;
            }

            await _gate.WaitAsync(ct);
            try
            {
                if (_value is { } current && clock.GetUtcNow() < _expires)
                {
                    return current;
                }

                try
                {
                    _value = await load(ct);
                    _expires = clock.GetUtcNow() + lifetime;
                }
                catch (Exception ex) when (_value is not null && ex is not OperationCanceledException)
                {
                    logger.LogError(ex, "Refreshing chart data failed; using the previous data");
                    _expires = clock.GetUtcNow().AddSeconds(30);
                }

                return _value!;
            }
            finally
            {
                _gate.Release();
            }
        }
    }
}

public static class AnalyticsEndpoints
{
    /// <summary>The map has about 6,200 contacts, so a filter can never name more ids than this.</summary>
    public const int MaxIds = 10_000;

    public static IServiceCollection AddAvwAnalytics(this IServiceCollection services)
    {
        var client = services.AddHttpClient<IAnalyticsSource, ElasticsearchAnalyticsSource>(MapEndpoints.ConfigureElasticsearchClient(TimeSpan.FromSeconds(60)));
        client.ConfigurePrimaryHttpMessageHandler(MapEndpoints.ElasticsearchHandler);
        services.AddSingleton<AnalyticsStore>();
        return services;
    }

    public static void MapAnalyticsEndpoints(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/analytics").WithTags("Analytics");

        g.MapGet("/charts", (HttpContext ctx) =>
            {
                ctx.Response.Headers.CacheControl = "public, max-age=3600";
                return Charts.All;
            })
            .WithName("GetCharts")
            .Produces<ChartInfo[]>();

        // POST because the filter is a list of ids that can run to thousands, too long for an address. Nothing is changed.
        g.MapPost("/charts/{id}", async (string id, ChartFilter? filter, AnalyticsStore store, CancellationToken ct) =>
            {
                var info = Charts.Find(id);
                if (info is null)
                {
                    return Results.NotFound();
                }

                if (filter?.Ids is { Length: > MaxIds })
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["ids"] = [$"Send at most {MaxIds} ids."] });
                }

                IReadOnlyList<IncidentRow> incidents = [];
                IReadOnlyList<PersonRow> people = [];
                if (info.UsesFilter)
                {
                    incidents = await store.IncidentsAsync(ct);
                    if (filter?.Ids is { } ids)
                    {
                        var wanted = ids.ToHashSet();
                        incidents = incidents.Where(r => wanted.Contains(r.Id)).ToList();
                    }
                }
                else
                {
                    people = await store.PeopleAsync(ct);
                }

                return Results.Ok(Charts.Draw(id, incidents, people));
            })
            .WithName("DrawChart")
            .Produces<ChartResult>()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesValidationProblem();
    }
}
