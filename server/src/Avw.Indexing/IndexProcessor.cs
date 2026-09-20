using Avw.Data;
using Avw.Data.Indexing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Avw.Indexing;

/// <param name="Rows">Outbox rows looked at.</param>
/// <param name="Written">Documents written or changed.</param>
/// <param name="Removed">Documents removed.</param>
/// <param name="Retrying">Rows that failed this time and will be tried again.</param>
/// <param name="Failed">Rows set aside after failing for good.</param>
public sealed record IndexRun(int Rows, int Written, int Removed, int Retrying, int Failed);

/// <summary>
/// Turns the outbox into changes in Elasticsearch. Each pass takes the oldest due rows, works out for each note or picture what its
/// document should be <em>now</em> (from the database, not from the row, so several changes to one thing cost one write), sends them in
/// bulk, and deletes the rows that went through. Rows that did not are tried again later, a little further apart each time.
/// </summary>
public sealed class IndexProcessor(IIndexWriter writer, IContactLocations locations, IOptions<IndexingOptions> options, TimeProvider clock, ILogger<IndexProcessor> logger)
{
    private sealed class Target(IndexKind kind, long id, long esIdHint)
    {
        public IndexKind Kind { get; } = kind;
        public long Id { get; } = id;
        public long EsIdHint { get; set; } = esIdHint;
        public IndexOperation? Operation { get; set; }
        public IndexResult Result { get; set; } = IndexResult.Ok;
    }

    public async Task<IndexRun> RunOnceAsync(AvwDbContext db, CancellationToken ct)
    {
        var o = options.Value;
        var now = clock.GetUtcNow().UtcDateTime;
        var rows = await db.IndexOutbox.Where(r => r.FailedUtc == null && r.NextAttemptUtc <= now).OrderBy(r => r.Id).Take(o.BatchSize).ToListAsync(ct);
        if (rows.Count == 0)
        {
            return new IndexRun(0, 0, 0, 0, 0);
        }

        // What each row is about. A file changing is about every place it is attached.
        var targets = new Dictionary<(IndexKind, long), Target>();
        var targetsOf = new Dictionary<IndexOutboxItem, List<Target>>();
        Target Get(IndexKind kind, long id, long esId)
        {
            if (!targets.TryGetValue((kind, id), out var t))
            {
                targets[(kind, id)] = t = new Target(kind, id, esId);
            }
            else if (t.EsIdHint == 0)
            {
                t.EsIdHint = esId;
            }

            return t;
        }

        var assetIds = rows.Where(r => r.Kind == IndexKind.MediaAsset).Select(r => r.EntityId).Distinct().ToList();
        var links = assetIds.Count == 0
            ? []
            : await db.IncidentMedia.AsNoTracking().Where(m => assetIds.Contains(m.MediaId)).Select(m => new { m.Id, m.MediaId, m.LegacyId }).ToListAsync(ct);
        foreach (var row in rows)
        {
            targetsOf[row] = row.Kind == IndexKind.MediaAsset
                ? [.. links.Where(l => l.MediaId == row.EntityId).Select(l => Get(IndexKind.Media, l.Id, IndexIds.Of(l.Id, l.LegacyId)))]
                : [Get(row.Kind, row.EntityId, row.EsId)];
        }

        foreach (var target in targets.Values)
        {
            target.Operation = target.Kind == IndexKind.Note ? await NoteOperationAsync(db, target, ct) : await MediaOperationAsync(db, target, now, ct);
        }

        await SendAsync(targets.Values.Where(t => t.Operation is not null).ToList(), o.BatchSize, ct);

        int written = 0, removed = 0, retrying = 0, failed = 0;
        foreach (var target in targets.Values)
        {
            if (target.Result.Done && target.Operation is { } op)
            {
                if (op.IsDelete) removed++; else written++;
            }
        }

        foreach (var row in rows)
        {
            var bad = targetsOf[row].FirstOrDefault(t => !t.Result.Done);
            if (bad is null)
            {
                db.IndexOutbox.Remove(row);
                continue;
            }

            row.Attempts++;
            row.LastError = bad.Result.Error is { Length: > 1000 } text ? text[..1000] : bad.Result.Error;
            if (!bad.Result.Retry || row.Attempts >= o.MaxAttempts)
            {
                row.FailedUtc = now;
                failed++;
                logger.LogError("Giving up indexing {Kind} {Id} after {Attempts} attempt(s): {Error}", row.Kind, row.EntityId, row.Attempts, row.LastError);
            }
            else
            {
                row.NextAttemptUtc = now + Backoff(row.Attempts);
                retrying++;
            }
        }

        await db.SaveChangesAsync(ct);
        return new IndexRun(rows.Count, written, removed, retrying, failed);
    }

    /// <summary>10 seconds after the first failure, doubling each time, never more than an hour.</summary>
    public static TimeSpan Backoff(int attempts) => TimeSpan.FromSeconds(Math.Min(3600, 10 * Math.Pow(2, Math.Max(0, attempts - 1))));

    private async Task<IndexOperation?> NoteOperationAsync(AvwDbContext db, Target target, CancellationToken ct)
    {
        var index = options.Value.NotesIndex;
        var note = await db.Notes.AsNoTracking().Include(n => n.Versions).FirstOrDefaultAsync(n => n.Id == target.Id, ct);
        if (note is null || note.Versions.Count == 0)
        {
            return target.EsIdHint == 0 ? null : IndexOperation.Delete(index, target.EsIdHint);
        }

        // A migrated note's document already says where it is; a new one is placed where its incident is.
        (double, double)? place = note.LegacyId is null ? await locations.FindAsync(note.ContactId, ct) : null;
        return IndexOperation.Upsert(index, IndexIds.Of(note.Id, note.LegacyId), IndexDocuments.Note(note, place));
    }

    private async Task<IndexOperation?> MediaOperationAsync(AvwDbContext db, Target target, DateTime now, CancellationToken ct)
    {
        var index = options.Value.MediaIndex;
        var link = await db.IncidentMedia.AsNoTracking().Include(m => m.Media).ThenInclude(a => a.UploadedBy).FirstOrDefaultAsync(m => m.Id == target.Id, ct);
        if (link is null)
        {
            return target.EsIdHint == 0 ? null : IndexOperation.Delete(index, target.EsIdHint);
        }

        var esId = IndexIds.Of(link.Id, link.LegacyId);
        var doc = IndexDocuments.Media(link, link.Media, link.Media.UploadedBy?.DisplayName, now);
        return doc is null ? IndexOperation.Delete(index, esId) : IndexOperation.Upsert(index, esId, doc);
    }

    private async Task SendAsync(List<Target> targets, int batchSize, CancellationToken ct)
    {
        foreach (var chunk in targets.Chunk(Math.Max(1, batchSize)))
        {
            IReadOnlyList<IndexResult> results;
            try
            {
                results = await writer.WriteAsync([.. chunk.Select(t => t.Operation!)], ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                // The request as a whole failed (Elasticsearch down, or the key refused): every one of them waits and tries again.
                logger.LogWarning(ex, "Elasticsearch could not be written to; {Count} document(s) will be tried again", chunk.Length);
                // Even a refused key is tried again: it is usually a setting that someone is about to correct, and the rows wait for that.
                var whole = new IndexResult(false, true, ex.Message);
                results = [.. chunk.Select(_ => whole)];
            }

            for (var i = 0; i < chunk.Length; i++)
            {
                chunk[i].Result = results[i];
            }
        }
    }
}
