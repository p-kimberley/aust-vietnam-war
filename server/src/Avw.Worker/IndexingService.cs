using Avw.Data;
using Avw.Indexing;
using Microsoft.Extensions.Options;

namespace Avw.Worker;

/// <summary>Keeps the notes and pictures indexes in Elasticsearch in step with the database, by working through the outbox. Does nothing while indexing is off.</summary>
public sealed class IndexingService(IServiceScopeFactory scopes, IOptions<IndexingOptions> options, IConfiguration config, ILogger<IndexingService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var o = options.Value;
        if (!o.Enabled)
        {
            logger.LogInformation("Search indexing is off (Indexing:Enabled is not true): changes to notes and pictures are not queued or sent to Elasticsearch");
            return;
        }

        if (string.IsNullOrWhiteSpace(config["Indexing:Url"]) && string.IsNullOrWhiteSpace(config["Elasticsearch:Url"]))
        {
            logger.LogError("Search indexing is on but neither Indexing:Url nor Elasticsearch:Url is set, so nothing can be sent");
            return;
        }

        logger.LogInformation("Search indexing is on: notes go to {Notes} and pictures to {Media}", o.NotesIndex, o.MediaIndex);
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(1, o.PollSeconds)));
        do
        {
            try
            {
                // A busy spell is worked through at once rather than a batch every few seconds.
                IndexRun run;
                do
                {
                    await using var scope = scopes.CreateAsyncScope();
                    run = await scope.ServiceProvider.GetRequiredService<IndexProcessor>().RunOnceAsync(scope.ServiceProvider.GetRequiredService<AvwDbContext>(), stoppingToken);
                    if (run.Rows > 0)
                    {
                        logger.LogInformation("Indexing: {Written} document(s) written, {Removed} removed, {Retrying} to retry, {Failed} set aside", run.Written, run.Removed, run.Retrying, run.Failed);
                    }
                } while (run.Rows >= o.BatchSize && run.Retrying == 0 && !stoppingToken.IsCancellationRequested);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "An indexing pass failed");
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
