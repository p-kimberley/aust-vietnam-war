namespace Avw.Data.Indexing;

/// <summary>What a row of the outbox says needs looking at in the search index.</summary>
public enum IndexKind
{
    /// <summary>A community note.</summary>
    Note = 1,

    /// <summary>A picture attached to an incident or placed on the map.</summary>
    Media = 2,

    /// <summary>A picture file, whose status or caption changed: every place it is attached needs looking at.</summary>
    MediaAsset = 3,
}

/// <summary>
/// A note that something changed and the search index may need to follow. Written in the same transaction as the change itself, so
/// a change is never lost if Elasticsearch is down; the worker reads the row, builds the document from the database as it is
/// <em>then</em> (never from the row), and deletes the row once Elasticsearch has it.
/// </summary>
public class IndexOutboxItem
{
    public long Id { get; set; }
    public IndexKind Kind { get; set; }

    /// <summary>The database id of the note, picture attachment or picture file.</summary>
    public long EntityId { get; set; }

    /// <summary>
    /// The document id in Elasticsearch, which is the old site's id for content migrated from it and this database's id for anything new.
    /// Zero when it can be worked out from the row itself (it is only needed to remove the document of a row that no longer exists).
    /// </summary>
    public long EsId { get; set; }

    public DateTime CreatedUtc { get; set; }
    public int Attempts { get; set; }

    /// <summary>Not tried before this time. New rows are due at once (the epoch); a failed attempt waits longer each time.</summary>
    public DateTime NextAttemptUtc { get; set; }

    public string? LastError { get; set; }

    /// <summary>Set when it has failed too many times to be tried again on its own. Such rows stay for someone to look at.</summary>
    public DateTime? FailedUtc { get; set; }
}

/// <summary>Which id a document has in Elasticsearch.</summary>
public static class IndexIds
{
    /// <summary>
    /// Migrated content keeps the id it had on the old site, so its existing document is updated in place instead of duplicated.
    /// New content takes this database's own id, which the migration keeps above the old site's range so the two never meet.
    /// </summary>
    public static long Of(long id, int? legacyId) => legacyId ?? id;

    /// <summary>New notes and pictures are numbered from here (the old site's highest id is a few hundred).</summary>
    public const long FirstNewId = 100_000;
}

/// <summary>Whether changes are written to the outbox at all. Off until indexing is configured; on by default in tests.</summary>
public sealed class IndexingSwitch(bool enabled = true)
{
    public bool Enabled { get; set; } = enabled;
}
