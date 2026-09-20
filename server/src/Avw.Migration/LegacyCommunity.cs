using MySql.Data.MySqlClient;

namespace Avw.Migration;

/// <summary>A row of <c>wp_users</c>. Only what identifies an author: the name shown, and the email (which is hashed on import and never stored).</summary>
public sealed record LegacyUser(long Id, string? DisplayName, string? Email);

public sealed record LegacyNote(int Id, int IncidentId, DateTime Created, DateTime? Modified, long Author, bool CommentsOpen, int ApprovalStatus);

public sealed record LegacyNoteVersion(int Id, int NoteId, string? Title, string? Body, DateTime Created, long Author);

public sealed record LegacyComment(int Id, int NoteId, string? Comment, DateTime Created, long Author);

public sealed record LegacyTribute(int Id, string ServiceNumber, string? Comment, long Author, string? AuthorName, DateTime Created);

public sealed record LegacyCasualtySubmission(int Id, string? ServiceNo, int IncidentId, string? CasualtyType, string? Comment, long Author, DateTime Created);

public sealed record LegacyCasualtyLink(string ServiceNumber, int IncidentId);

public sealed record LegacyMedia(
    int Id, string? Path, int? FeatureId, double? Lat, double? Lon, DateTime? DateTaken, string? Attribution, string? Description,
    DateTime Created, long Author, int ApprovalStatus);

public sealed record LegacyLike(int MediaId, long UserId);

/// <summary>Reads the legacy community tables. Read-only: nothing is written to the legacy database.</summary>
public static class LegacyCommunityReader
{
    private static async Task<List<T>> ReadAsync<T>(MySqlConnection c, string sql, Func<MySqlDataReader, T> map, CancellationToken ct)
    {
        var rows = new List<T>();
        await using var cmd = new MySqlCommand(sql, c);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            rows.Add(map((MySqlDataReader)reader));
        }

        return rows;
    }

    private static string? Str(MySqlDataReader r, int i) => r.IsDBNull(i) ? null : r.GetString(i);
    private static long Long(MySqlDataReader r, int i) => r.IsDBNull(i) ? 0 : Convert.ToInt64(r.GetValue(i));
    private static int Int(MySqlDataReader r, int i) => r.IsDBNull(i) ? 0 : Convert.ToInt32(r.GetValue(i));
    private static int? IntOrNull(MySqlDataReader r, int i) => r.IsDBNull(i) ? null : Convert.ToInt32(r.GetValue(i));
    private static double? Dbl(MySqlDataReader r, int i) => r.IsDBNull(i) ? null : Convert.ToDouble(r.GetValue(i));
    private static DateTime When(MySqlDataReader r, int i) => r.IsDBNull(i) ? DateTime.UnixEpoch : r.GetDateTime(i);
    private static DateTime? WhenOrNull(MySqlDataReader r, int i) => r.IsDBNull(i) ? null : r.GetDateTime(i);

    public static Task<List<LegacyUser>> UsersAsync(MySqlConnection c, CancellationToken ct = default) =>
        ReadAsync(c, "SELECT ID, display_name, user_email FROM wp_users", r => new LegacyUser(Long(r, 0), Str(r, 1), Str(r, 2)), ct);

    public static Task<List<LegacyNote>> NotesAsync(MySqlConnection c, CancellationToken ct = default) =>
        ReadAsync(c, "SELECT ID, IncidentID, Created, Modified, Author, CommentsOpen, ApprovalStatus FROM incident_notes ORDER BY ID",
            r => new LegacyNote(Int(r, 0), Int(r, 1), When(r, 2), WhenOrNull(r, 3), Long(r, 4), Int(r, 5) != 0, Int(r, 6)), ct);

    public static Task<List<LegacyNoteVersion>> NoteVersionsAsync(MySqlConnection c, CancellationToken ct = default) =>
        ReadAsync(c, "SELECT ID, NoteID, Title, Body, Created, Author FROM incident_note_versions ORDER BY NoteID, Created, ID",
            r => new LegacyNoteVersion(Int(r, 0), Int(r, 1), Str(r, 2), Str(r, 3), When(r, 4), Long(r, 5)), ct);

    public static Task<List<LegacyComment>> CommentsAsync(MySqlConnection c, CancellationToken ct = default) =>
        ReadAsync(c, "SELECT ID, NoteID, Comment, Created, Author FROM incident_note_comments ORDER BY ID",
            r => new LegacyComment(Int(r, 0), Int(r, 1), Str(r, 2), When(r, 3), Long(r, 4)), ct);

    public static Task<List<LegacyTribute>> TributesAsync(MySqlConnection c, CancellationToken ct = default) =>
        ReadAsync(c,
            "SELECT t.ID, p.`Service Number`, t.Comment, t.Author, t.AuthorName, t.Created FROM personal_tributes t JOIN nomroll_personnel p ON p.NR_ID = t.NR_ID ORDER BY t.ID",
            r => new LegacyTribute(Int(r, 0), Str(r, 1) ?? "", Str(r, 2), Long(r, 3), Str(r, 4), When(r, 5)), ct);

    public static Task<List<LegacyCasualtySubmission>> CasualtySubmissionsAsync(MySqlConnection c, CancellationToken ct = default) =>
        ReadAsync(c, "SELECT ID, ServiceNo, IncidentID, CasualtyType, Comment, Author, Created FROM casualty_incident_submissions ORDER BY ID",
            r => new LegacyCasualtySubmission(Int(r, 0), Str(r, 1), Int(r, 2), Str(r, 3), Str(r, 4), Long(r, 5), When(r, 6)), ct);

    /// <summary>People killed in an incident: from the roll's own "Death Incident ID" and from the separate link table, which agree where both exist.</summary>
    public static Task<List<LegacyCasualtyLink>> CasualtyLinksAsync(MySqlConnection c, CancellationToken ct = default) =>
        ReadAsync(c,
            "SELECT p.`Service Number`, p.`Death Incident ID` FROM nomroll_personnel p WHERE p.`Death Incident ID` IS NOT NULL " +
            "UNION SELECT p.`Service Number`, k.Incident FROM nomroll_contacts k JOIN nomroll_personnel p ON p.NR_ID = k.NR_ID WHERE k.Incident IS NOT NULL",
            r => new LegacyCasualtyLink(Str(r, 0) ?? "", Int(r, 1)), ct);

    public static Task<List<LegacyMedia>> MediaAsync(MySqlConnection c, CancellationToken ct = default) =>
        ReadAsync(c, "SELECT ID, Path, FeatureID, Lat, Lon, DateTaken, Attribution, Description, Created, Author, ApprovalStatus FROM incident_media ORDER BY ID",
            r => new LegacyMedia(Int(r, 0), Str(r, 1), IntOrNull(r, 2), Dbl(r, 3), Dbl(r, 4), WhenOrNull(r, 5), Str(r, 6), Str(r, 7), When(r, 8), Long(r, 9), Int(r, 10)), ct);

    public static Task<List<LegacyLike>> LikesAsync(MySqlConnection c, CancellationToken ct = default) =>
        ReadAsync(c, "SELECT MediaItem, `User` FROM incident_media_likes", r => new LegacyLike(Int(r, 0), Long(r, 1)), ct);
}
