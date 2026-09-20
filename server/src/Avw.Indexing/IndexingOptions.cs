namespace Avw.Indexing;

public sealed class IndexingOptions
{
    public const string Section = "Indexing";

    /// <summary>
    /// Off until someone has given the worker a key that may write to the indexes. While it is off nothing is queued and nothing is sent;
    /// switching it on later needs one <c>Avw.Migrator reindex</c> to catch up on what was missed.
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>The cluster to write to. When empty, the <c>Elasticsearch</c> section's address is used.</summary>
    public string? Url { get; set; }

    /// <summary>
    /// An API key that may write to the notes and pictures indexes. It is a different key from the read-only one the site reads with,
    /// so the site itself can never change the indexes it reads.
    /// </summary>
    public string? ApiKey { get; set; }

    /// <summary>The private CA the cluster's certificate chains to. When empty, the <c>Elasticsearch</c> section's is used.</summary>
    public string? CaCertificatePath { get; set; }

    public string NotesIndex { get; set; } = "avw_incident_notes";
    public string MediaIndex { get; set; } = "avw_incident_media";

    /// <summary>Read, to find where an incident is so a new note can be placed on the map.</summary>
    public string ContactsIndex { get; set; } = "avw_contacts";

    /// <summary>How many documents go in one request.</summary>
    public int BatchSize { get; set; } = 200;

    /// <summary>Tries before a change is set aside for someone to look at (the waits between grow, up to an hour).</summary>
    public int MaxAttempts { get; set; } = 12;

    /// <summary>How often the worker looks for changes.</summary>
    public int PollSeconds { get; set; } = 5;
}
