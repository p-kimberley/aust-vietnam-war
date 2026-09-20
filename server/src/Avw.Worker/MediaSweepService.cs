using Avw.Data;

namespace Avw.Worker;

/// <summary>Clears out stale files in the shared media folder (see <see cref="MediaSweeper"/>). Does nothing when no media folder is configured.</summary>
public sealed class MediaSweepService(IConfiguration config, TimeProvider clock, ILogger<MediaSweepService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var root = config["Media:RootPath"];
        if (string.IsNullOrWhiteSpace(root))
        {
            logger.LogInformation("Media:RootPath is not set, so stale uploads will not be swept");
            return;
        }

        // An upload takes seconds, so a few hours is far longer than any live one and still soon enough to reclaim the space.
        var incomingAge = TimeSpan.FromMinutes(config.GetValue("Media:IncomingMaxAgeMinutes", 360));
        var markerAge = TimeSpan.FromDays(config.GetValue("Media:HealthMarkerMaxAgeDays", 2));

        using var timer = new PeriodicTimer(Interval, clock);
        do
        {
            try
            {
                var removed = MediaSweeper.Sweep(root, clock.GetUtcNow().UtcDateTime, incomingAge, markerAge);
                if (removed > 0)
                {
                    logger.LogInformation("Swept {Count} stale file(s) from the media folder", removed);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Media sweep failed");
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
