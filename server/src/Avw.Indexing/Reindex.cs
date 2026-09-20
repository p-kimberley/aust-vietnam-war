using Avw.Data;
using Avw.Data.Indexing;
using Microsoft.EntityFrameworkCore;

namespace Avw.Indexing;

/// <param name="Notes">Notes put in the outbox.</param>
/// <param name="Media">Picture attachments put in the outbox.</param>
/// <param name="AlreadyWaiting">Left alone because the outbox already has a row waiting for them.</param>
public sealed record ReindexPlan(int Notes, int Media, int AlreadyWaiting);

/// <summary>
/// Puts every note and picture in the outbox, so the worker rewrites their documents. For catching up after indexing was switched on
/// later, or repairing the index. Migrated content is left out unless asked for, because it already has documents (with the old site's
/// wording of the text), which this would rewrite.
/// </summary>
public static class Reindex
{
    public static async Task<ReindexPlan> QueueAsync(AvwDbContext db, bool includeMigrated, bool dryRun, CancellationToken ct = default)
    {
        var waiting = (await db.IndexOutbox.Where(r => r.FailedUtc == null).Select(r => new { r.Kind, r.EntityId }).ToListAsync(ct)).Select(r => (r.Kind, r.EntityId)).ToHashSet();
        var now = DateTime.UtcNow;
        int notes = 0, media = 0, skipped = 0;

        foreach (var n in await db.Notes.AsNoTracking().Where(n => includeMigrated || n.LegacyId == null).Select(n => new { n.Id, n.LegacyId }).ToListAsync(ct))
        {
            if (waiting.Contains((IndexKind.Note, n.Id)))
            {
                skipped++;
                continue;
            }

            notes++;
            if (!dryRun) db.IndexOutbox.Add(new IndexOutboxItem { Kind = IndexKind.Note, EntityId = n.Id, EsId = IndexIds.Of(n.Id, n.LegacyId), CreatedUtc = now, NextAttemptUtc = DateTime.UnixEpoch });
        }

        foreach (var m in await db.IncidentMedia.AsNoTracking().Where(m => includeMigrated || m.LegacyId == null).Select(m => new { m.Id, m.LegacyId }).ToListAsync(ct))
        {
            if (waiting.Contains((IndexKind.Media, m.Id)))
            {
                skipped++;
                continue;
            }

            media++;
            if (!dryRun) db.IndexOutbox.Add(new IndexOutboxItem { Kind = IndexKind.Media, EntityId = m.Id, EsId = IndexIds.Of(m.Id, m.LegacyId), CreatedUtc = now, NextAttemptUtc = DateTime.UnixEpoch });
        }

        if (!dryRun)
        {
            await db.SaveChangesAsync(ct);
        }

        return new ReindexPlan(notes, media, skipped);
    }
}
