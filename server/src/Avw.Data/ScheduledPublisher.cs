using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Avw.Data;

/// <summary>Publishes scheduled articles whose time has come. Idempotent, so an overlapping run is harmless.</summary>
public static class ScheduledPublisher
{
    /// <returns>The number of articles published.</returns>
    public static async Task<int> PublishDueAsync(AvwDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var now = clock.GetUtcNow().UtcDateTime;

        var due = await db.Articles
            .Where(a => a.Status == ArticleStatus.Scheduled && a.ScheduledUtc != null && a.ScheduledUtc <= now)
            .ToListAsync(ct);

        foreach (var article in due)
        {
            article.Status = ArticleStatus.Published;
            article.PublishedUtc = article.ScheduledUtc;
            article.ScheduledUtc = null;
            article.UpdatedUtc = now;
            article.Version++;
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            // An editor changed one of them between our read and write. It will be picked up on the next pass.
            return 0;
        }

        return due.Count;
    }
}
