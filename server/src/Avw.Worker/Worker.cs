using Avw.Data;

namespace Avw.Worker;

/// <summary>
/// Single-replica background jobs. Today: scheduled publishing. Search sync and orphan-media sweeps
/// join here in later phases.
/// </summary>
public sealed class Worker(IServiceScopeFactory scopes, TimeProvider clock, ILogger<Worker> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval, clock);
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<AvwDbContext>();
                var published = await ScheduledPublisher.PublishDueAsync(db, clock, stoppingToken);
                if (published > 0)
                {
                    logger.LogInformation("Published {Count} scheduled article(s)", published);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Never let one bad pass (e.g. a database failover) kill the worker.
                logger.LogError(ex, "Scheduled publishing pass failed");
            }
        } while (await WaitAsync(timer, stoppingToken));
    }

    private static async Task<bool> WaitAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try
        {
            return await timer.WaitForNextTickAsync(ct);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }
}
