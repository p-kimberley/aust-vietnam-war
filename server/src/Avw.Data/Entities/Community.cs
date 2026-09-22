namespace Avw.Data.Entities;

public enum ModerationStatus
{
    Pending,
    Approved,
    Rejected,
}

/// <summary>
/// A community note about one incident. Editing never overwrites: every save is a <see cref="IncidentNoteVersion"/>, and the
/// public sees the newest <em>approved</em> version until an editor approves a newer one.
/// </summary>
public class IncidentNote
{
    public long Id { get; set; }

    /// <summary>The Elasticsearch contact id (the contacts live in Elasticsearch, so this is not a foreign key).</summary>
    public int ContactId { get; set; }

    /// <summary>The local author. Null for migrated notes whose author has not registered yet.</summary>
    public long? AuthorId { get; set; }
    public AppUser? Author { get; set; }

    /// <summary>The name shown, stored at the time so it survives an author changing or removing their account.</summary>
    public string AuthorName { get; set; } = "";

    /// <summary>Hash of the legacy author's verified email, so their old notes can be claimed when they register (see <see cref="AppUser.EmailHash"/>).</summary>
    public string? AuthorEmailHash { get; set; }

    /// <summary>The id of this note in the legacy database, so an import can be repeated without duplicating it.</summary>
    public int? LegacyId { get; set; }

    /// <summary>The state of the <em>latest</em> version. An earlier approved version may still be showing.</summary>
    public ModerationStatus Status { get; set; }

    public int LatestVersionNo { get; set; }
    public int? ApprovedVersionNo { get; set; }
    public bool CommentsOpen { get; set; } = true;
    public DateTime CreatedUtc { get; set; }
    public DateTime UpdatedUtc { get; set; }
    public long? ModeratedById { get; set; }
    public DateTime? ModeratedUtc { get; set; }

    public List<IncidentNoteVersion> Versions { get; set; } = [];
    public List<NoteComment> Comments { get; set; } = [];
}

public class IncidentNoteVersion
{
    public long Id { get; set; }
    public long NoteId { get; set; }
    public IncidentNote Note { get; set; } = null!;
    public int VersionNo { get; set; }
    public string Title { get; set; } = "";

    /// <summary>Plain text. Paragraphs are separated by blank lines; nothing is ever treated as markup.</summary>
    public string Body { get; set; } = "";

    public long? EditedById { get; set; }
    public string EditedByName { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
}

public class NoteComment
{
    public long Id { get; set; }
    public long NoteId { get; set; }
    public IncidentNote Note { get; set; } = null!;
    public long? AuthorId { get; set; }
    public string AuthorName { get; set; } = "";
    public string? AuthorEmailHash { get; set; }
    public int? LegacyId { get; set; }
    public string Body { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
}

/// <summary>
/// A picture from the community, attached to an incident and/or placed on the map. The file, caption, credit and approval
/// state belong to the <see cref="MediaAsset"/>.
/// </summary>
public class IncidentMedia
{
    public long Id { get; set; }

    /// <summary>The incident it belongs to. Null for a migrated picture that was only placed on the map.</summary>
    public int? ContactId { get; set; }

    public long MediaId { get; set; }
    public MediaAsset Media { get; set; } = null!;
    public long? AttachedById { get; set; }

    /// <summary>The name shown for whoever added it, kept for migrated pictures whose author has not registered.</summary>
    public string? AuthorName { get; set; }

    public string? AuthorEmailHash { get; set; }

    /// <summary>Where the picture was taken, when known.</summary>
    public double? Lat { get; set; }

    public double? Lon { get; set; }
    public DateOnly? DateTaken { get; set; }
    public DateTime CreatedUtc { get; set; }

    /// <summary>Likes given on the legacy site, whose givers have no account here yet. Added to the likes given since.</summary>
    public int LegacyLikes { get; set; }

    public int? LegacyId { get; set; }
}

public class MediaLike
{
    public long MediaId { get; set; }
    public MediaAsset Media { get; set; } = null!;
    public long UserId { get; set; }
    public AppUser User { get; set; } = null!;
    public DateTime CreatedUtc { get; set; }
}

/// <summary>A poppy: a short message left for someone on the honour roll.</summary>
public class Tribute
{
    public long Id { get; set; }

    /// <summary>The service number of the person on the nominal roll (kept in Elasticsearch).</summary>
    public string ServiceNumber { get; set; } = "";

    public long? AuthorId { get; set; }
    public string AuthorName { get; set; } = "";
    public string? AuthorEmailHash { get; set; }
    public int? LegacyId { get; set; }
    public string Message { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
}

/// <summary>Someone telling us about a casualty in an incident: who, what happened to them, and where they know it from.</summary>
public class CasualtySubmission
{
    public long Id { get; set; }
    public int ContactId { get; set; }
    public string? ServiceNumber { get; set; }

    /// <summary>For example "Killed in action" or "Wounded in action".</summary>
    public string CasualtyType { get; set; } = "";

    public string Comment { get; set; } = "";
    public long? SubmittedById { get; set; }
    public string SubmittedByName { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
    public bool Handled { get; set; }
    public DateTime? HandledUtc { get; set; }
    public int? LegacyId { get; set; }
}

/// <summary>Links a person on the honour roll to the incident where they became a casualty.</summary>
public class CasualtyLink
{
    public string ServiceNumber { get; set; } = "";
    public int ContactId { get; set; }
}

/// <summary>
/// One person of the nominal roll who died in service, copied from Elasticsearch so that the roll can be searched with a MySQL
/// full-text index, sorted and filtered by the database. Refreshed from Elasticsearch on a schedule; never edited by hand.
/// </summary>
public class HonourRollPerson
{
    public string ServiceNumber { get; set; } = "";

    /// <summary>"James Mungo White".</summary>
    public string Name { get; set; } = "";

    /// <summary>"White, James Mungo": how a roll writes a name.</summary>
    public string SortName { get; set; } = "";

    /// <summary><see cref="SortName"/> in lower case, so every database sorts the roll the same way.</summary>
    public string SortKey { get; set; } = "";

    public string? Rank { get; set; }

    /// <summary>The roll's "branch": the corps, for the Army.</summary>
    public string? Corps { get; set; }

    /// <summary>Army, Navy or Air Force, worked out from the rank and corps because the roll does not say.</summary>
    public string? Service { get; set; }

    public DateOnly? BirthDate { get; set; }
    public DateOnly? DeathDate { get; set; }
    public string? BirthPlace { get; set; }
    public string? BirthState { get; set; }
    public string? BirthCountry { get; set; }
    public bool? NationalService { get; set; }

    /// <summary>The tours of duty, as JSON.</summary>
    public string Tours { get; set; } = "[]";

    /// <summary>The words of the names and the service number, in lower case with a space before each: what the full-text index and the short-word search read.</summary>
    public string SearchText { get; set; } = "";
}
