using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace Avw.Data.Indexing;

/// <summary>
/// Looks at what a save is about to change and works out which search documents that touches. It reads the change tracker before the
/// save (an added row has no id yet) and produces the outbox rows after it, when every id is known.
/// </summary>
internal sealed class IndexChangeCollector
{
    private readonly List<Func<IndexOutboxItem?>> _pending = [];

    public bool Any => _pending.Count > 0;

    // Only a change to something a document is made from counts. Signing in links a returning member's old notes and pictures to them
    // (setting who owns them), and a like moves a count; neither changes a document, and neither should stir the index.
    private static readonly string[] NoteFields = [nameof(IncidentNote.ContactId), nameof(IncidentNote.Status), nameof(IncidentNote.ApprovedVersionNo), nameof(IncidentNote.LatestVersionNo), nameof(IncidentNote.UpdatedUtc), nameof(IncidentNote.AuthorName)];
    private static readonly string[] MediaFields = [nameof(IncidentMedia.ContactId), nameof(IncidentMedia.MediaId), nameof(IncidentMedia.Lat), nameof(IncidentMedia.Lon), nameof(IncidentMedia.DateTaken), nameof(IncidentMedia.AuthorName)];
    private static readonly string[] AssetFields = [nameof(MediaAsset.Status), nameof(MediaAsset.Caption), nameof(MediaAsset.Credit)];

    private static bool Touches(EntityEntry entry, string[] fields) =>
        entry.State == EntityState.Modified && entry.Properties.Any(p => p.IsModified && fields.Contains(p.Metadata.Name));

    public static IndexChangeCollector From(IEnumerable<EntityEntry> entries)
    {
        var c = new IndexChangeCollector();
        foreach (var entry in entries)
        {
            switch (entry.Entity)
            {
                case IncidentNote note when entry.State == EntityState.Added || Touches(entry, NoteFields):
                    c._pending.Add(() => Row(IndexKind.Note, note.Id, 0));
                    break;

                case IncidentNote note when entry.State == EntityState.Deleted:
                {
                    // Once it is gone its document has to be found by the id it was given, so that is written down now.
                    var (id, esId) = (note.Id, IndexIds.Of(note.Id, note.LegacyId));
                    c._pending.Add(() => Row(IndexKind.Note, id, esId));
                    break;
                }

                // A new version is the note changing: the words shown, and who last edited them.
                case IncidentNoteVersion version when entry.State == EntityState.Added:
                    c._pending.Add(() => Row(IndexKind.Note, version.NoteId != 0 ? version.NoteId : version.Note?.Id ?? 0, 0));
                    break;

                case IncidentMedia link when entry.State == EntityState.Added || Touches(entry, MediaFields):
                    c._pending.Add(() => Row(IndexKind.Media, link.Id, 0));
                    break;

                case IncidentMedia link when entry.State == EntityState.Deleted:
                {
                    var (id, esId) = (link.Id, IndexIds.Of(link.Id, link.LegacyId));
                    c._pending.Add(() => Row(IndexKind.Media, id, esId));
                    break;
                }

                // A file's status or caption changing changes every document made from it. Which those are is worked out later.
                case MediaAsset asset when Touches(entry, AssetFields):
                    c._pending.Add(() => Row(IndexKind.MediaAsset, asset.Id, 0));
                    break;
            }
        }

        return c;
    }

    /// <summary>The outbox rows, one for each thing touched however many times it was touched in this save.</summary>
    public List<IndexOutboxItem> Rows()
    {
        var rows = new Dictionary<(IndexKind, long), IndexOutboxItem>();
        foreach (var make in _pending)
        {
            var row = make();
            if (row is null)
            {
                continue;
            }

            // If a delete and another change meet, keep the id the delete recorded: the row may no longer exist to ask.
            if (!rows.TryGetValue((row.Kind, row.EntityId), out var existing) || existing.EsId == 0)
            {
                rows[(row.Kind, row.EntityId)] = row;
            }
        }

        return [.. rows.Values];
    }

    private static IndexOutboxItem? Row(IndexKind kind, long entityId, long esId)
    {
        if (entityId == 0)
        {
            return null;
        }

        var now = DateTime.UtcNow;
        // Due at once; only a failed attempt pushes it later.
        return new IndexOutboxItem { Kind = kind, EntityId = entityId, EsId = esId, CreatedUtc = now, NextAttemptUtc = DateTime.UnixEpoch };
    }
}
