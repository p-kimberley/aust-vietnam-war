using Avw.Api.Community;
using Avw.Api.Media;
using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Avw.Migration;

/// <summary>Where the legacy picture files are. Returns null for a file that is not there. Paths that try to leave the folder are never opened.</summary>
public interface ILegacyFiles
{
    Stream? Open(string relativePath);
}

public sealed class DirectoryFiles(string root) : ILegacyFiles
{
    private readonly string _root = Path.GetFullPath(root);

    public Stream? Open(string relativePath)
    {
        var full = Path.GetFullPath(Path.Combine(_root, relativePath.Replace('\\', '/').TrimStart('/')));
        // A path such as ..\..\secret must not reach outside the picture folder, whatever the database says.
        if (!full.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
        {
            return null;
        }

        return new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.Read);
    }
}

/// <summary>
/// Brings the legacy community content across: notes with their versions and comments, tributes, casualty information, the links
/// between people and incidents, and pictures. Each import is safe to repeat (rows are matched on their legacy id), honours a dry run,
/// and reports only counts. Authors keep a name and a hash of their email, so they can claim their content when they sign up.
/// </summary>
public static class CommunityImporter
{
    public const string LegacyUserSubject = "legacy-import";

    /// <summary>
    /// Migrated notes may be longer than what a member can write today (<see cref="CommunityLimits.MaxBody"/>), because cutting an old note
    /// short loses the author's work. The database column is a <c>text</c> (65,535 bytes, whatever the characters), so this is where a note
    /// is finally cut, measured in bytes. The longest legacy note is about 56,000 characters, so in practice nothing is cut.
    /// </summary>
    public const int MaxLegacyBodyBytes = 65_000;

    /// <summary>The longest start of <paramref name="text"/> that fits in <paramref name="maxBytes"/> bytes of UTF-8, never splitting a character.</summary>
    public static string CutToBytes(string text, int maxBytes)
    {
        if (System.Text.Encoding.UTF8.GetByteCount(text) <= maxBytes)
        {
            return text;
        }

        var bytes = 0;
        var end = 0;
        foreach (var rune in text.EnumerateRunes())
        {
            bytes += rune.Utf8SequenceLength;
            if (bytes > maxBytes)
            {
                break;
            }

            end += rune.Utf16SequenceLength;
        }

        return text[..end];
    }

    /// <summary>The name shown and the email hash for an author of legacy content. An author with no matching user is anonymous.</summary>
    public sealed class Authors(IEnumerable<LegacyUser> users)
    {
        private readonly Dictionary<long, LegacyUser> _byId = users.GroupBy(u => u.Id).ToDictionary(g => g.Key, g => g.First());

        public (string Name, string? Hash) Of(long id, string? fallbackName = null)
        {
            if (_byId.TryGetValue(id, out var u))
            {
                var email = u.Email?.Trim();
                var name = Clean(u.DisplayName) ?? Clean(fallbackName) ?? CommunityLimits.DefaultAuthorName;
                return (Cut(name, 200), string.IsNullOrEmpty(email) ? null : EmailHash.Of(email));
            }

            return (Cut(Clean(fallbackName) ?? CommunityLimits.DefaultAuthorName, 200), null);
        }
    }

    public const string NoDetails = "No details were given.";

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : PlainText.Clean(HtmlText.ToPlain(s) ?? s).Replace('\n', ' ');

    private static string Cut(string s, int max) => s.Length <= max ? s : s[..max].TrimEnd();

    private static string Text(string? html) => PlainText.Clean(HtmlText.ToPlain(html));

    // ---------------------------------------------------------------- notes

    public static async Task<ImportReport> ImportNotesAsync(
        IReadOnlyList<LegacyNote> notes, IReadOnlyList<LegacyNoteVersion> versions, IReadOnlyList<LegacyComment> comments, Authors authors,
        AvwDbContext db, bool dryRun, CancellationToken ct = default)
    {
        var report = new ImportReport("notes and comments", dryRun);
        var known = (await db.Notes.Where(n => n.LegacyId != null).Select(n => new { n.LegacyId, n.Id }).ToListAsync(ct)).ToDictionary(n => n.LegacyId!.Value, n => n.Id);
        var knownComments = (await db.NoteComments.Where(c => c.LegacyId != null).Select(c => c.LegacyId!.Value).ToListAsync(ct)).ToHashSet();
        var versionsOf = versions.GroupBy(v => v.NoteId).ToDictionary(g => g.Key, g => g.OrderBy(v => v.Created).ThenBy(v => v.Id).ToList());
        var commentsOf = comments.GroupBy(c => c.NoteId).ToDictionary(g => g.Key, g => g.ToList());

        foreach (var legacy in notes)
        {
            if (known.TryGetValue(legacy.Id, out var existingId))
            {
                report.Unchanged++;
                AddComments(existingId, legacy.Id);
                continue;
            }

            var history = versionsOf.GetValueOrDefault(legacy.Id) ?? [];
            var latest = history.LastOrDefault();
            if (latest is null || Text(latest.Body).Length == 0)
            {
                report.Skip("without any text");
                continue;
            }

            var (name, hash) = authors.Of(legacy.Author);
            var note = new IncidentNote
            {
                ContactId = legacy.IncidentId,
                AuthorName = name,
                AuthorEmailHash = hash,
                LegacyId = legacy.Id,
                CommentsOpen = legacy.CommentsOpen,
                CreatedUtc = Utc(legacy.Created),
                UpdatedUtc = Utc(legacy.Modified ?? latest.Created),
                LatestVersionNo = history.Count,
            };
            var number = 0;
            foreach (var v in history)
            {
                var body = Text(v.Body);
                var fitted = CutToBytes(body, MaxLegacyBodyBytes);
                if (fitted.Length < body.Length)
                {
                    body = fitted;
                    report.Skip("versions cut at the column limit");
                }

                var title = Cut(Text(v.Title).Replace('\n', ' '), CommunityLimits.MaxTitle);
                note.Versions.Add(new IncidentNoteVersion
                {
                    VersionNo = ++number,
                    Title = title.Length == 0 ? "Note" : title,
                    Body = body,
                    EditedByName = authors.Of(v.Author).Name,
                    CreatedUtc = Utc(v.Created),
                });
            }

            note.Status = legacy.ApprovalStatus switch { 1 => ModerationStatus.Approved, < 0 => ModerationStatus.Rejected, _ => ModerationStatus.Pending };
            note.ApprovedVersionNo = note.Status == ModerationStatus.Approved ? note.LatestVersionNo : null;
            report.Added++;
            if (!dryRun)
            {
                db.Notes.Add(note);
                await db.SaveChangesAsync(ct);
            }

            AddComments(note.Id, legacy.Id);
        }

        if (!dryRun)
        {
            await db.SaveChangesAsync(ct);
        }

        return report;

        void AddComments(long noteId, int legacyNoteId)
        {
            foreach (var c in commentsOf.GetValueOrDefault(legacyNoteId) ?? [])
            {
                if (knownComments.Contains(c.Id))
                {
                    report.Unchanged++;
                    continue;
                }

                var body = Text(c.Comment);
                if (body.Length == 0)
                {
                    report.Skip("comments with no text");
                    continue;
                }

                var (author, commentHash) = authors.Of(c.Author);
                report.Added++;
                if (!dryRun)
                {
                    db.NoteComments.Add(new NoteComment
                    {
                        NoteId = noteId,
                        AuthorName = author,
                        AuthorEmailHash = commentHash,
                        LegacyId = c.Id,
                        Body = Cut(body, 2000),
                        CreatedUtc = Utc(c.Created),
                    });
                }
            }
        }
    }

    // ---------------------------------------------------------------- tributes, casualties

    public static async Task<ImportReport> ImportTributesAsync(IEnumerable<LegacyTribute> rows, Authors authors, AvwDbContext db, bool dryRun, CancellationToken ct = default)
    {
        var report = new ImportReport("tributes", dryRun);
        var known = (await db.Tributes.Where(t => t.LegacyId != null).Select(t => t.LegacyId!.Value).ToListAsync(ct)).ToHashSet();
        foreach (var row in rows)
        {
            if (known.Contains(row.Id))
            {
                report.Unchanged++;
                continue;
            }

            // Most old poppies were laid with one click and no words. They are kept, as poppies with no message, so the count is right.
            var message = Text(row.Comment).Replace('\n', ' ');
            var serviceNumber = row.ServiceNumber.Trim();
            if (serviceNumber.Length == 0 || serviceNumber.Length > 32)
            {
                report.Skip("without a usable service number");
                continue;
            }

            var (name, hash) = authors.Of(row.Author, row.AuthorName);
            report.Added++;
            if (!dryRun)
            {
                db.Tributes.Add(new Tribute
                {
                    ServiceNumber = serviceNumber,
                    AuthorName = name,
                    AuthorEmailHash = hash,
                    LegacyId = row.Id,
                    Message = Cut(message, 1000),
                    CreatedUtc = Utc(row.Created),
                });
            }
        }

        if (!dryRun)
        {
            await db.SaveChangesAsync(ct);
        }

        return report;
    }

    public static async Task<ImportReport> ImportCasualtySubmissionsAsync(IEnumerable<LegacyCasualtySubmission> rows, Authors authors, AvwDbContext db, bool dryRun, CancellationToken ct = default)
    {
        var report = new ImportReport("casualty submissions", dryRun);
        var known = (await db.CasualtySubmissions.Where(c => c.LegacyId != null).Select(c => c.LegacyId!.Value).ToListAsync(ct)).ToHashSet();
        foreach (var row in rows)
        {
            if (known.Contains(row.Id))
            {
                report.Unchanged++;
                continue;
            }

            var comment = Text(row.Comment);
            var type = row.CasualtyType?.Trim();
            if (comment.Length == 0 && string.IsNullOrWhiteSpace(row.ServiceNo) && string.IsNullOrEmpty(type))
            {
                report.Skip("with nothing to review");
                continue;
            }

            // A report with no words still says who, where and what happened to them, so an editor can follow it up.
            if (comment.Length == 0)
            {
                comment = NoDetails;
            }

            var (name, _) = authors.Of(row.Author);
            report.Added++;
            if (!dryRun)
            {
                db.CasualtySubmissions.Add(new CasualtySubmission
                {
                    ContactId = row.IncidentId,
                    ServiceNumber = string.IsNullOrWhiteSpace(row.ServiceNo) ? null : Cut(row.ServiceNo.Trim(), 32),
                    CasualtyType = CommunityLimits.CasualtyTypes.FirstOrDefault(t => string.Equals(t, type, StringComparison.OrdinalIgnoreCase)) ?? "Other",
                    Comment = Cut(comment, 4000),
                    SubmittedByName = name,
                    CreatedUtc = Utc(row.Created),
                    LegacyId = row.Id,
                });
            }
        }

        if (!dryRun)
        {
            await db.SaveChangesAsync(ct);
        }

        return report;
    }

    public static async Task<ImportReport> ImportCasualtyLinksAsync(IEnumerable<LegacyCasualtyLink> rows, AvwDbContext db, bool dryRun, CancellationToken ct = default)
    {
        var report = new ImportReport("casualty links", dryRun);
        var known = (await db.CasualtyLinks.Select(l => new { l.ServiceNumber, l.ContactId }).ToListAsync(ct)).Select(l => (l.ServiceNumber, l.ContactId)).ToHashSet();
        foreach (var row in rows.Select(r => (Number: r.ServiceNumber.Trim(), r.IncidentId)).Distinct())
        {
            if (row.Number.Length is 0 or > 32 || row.IncidentId <= 0)
            {
                report.Skip("without a service number or incident");
                continue;
            }

            if (!known.Add((row.Number, row.IncidentId)))
            {
                report.Unchanged++;
                continue;
            }

            report.Added++;
            if (!dryRun)
            {
                db.CasualtyLinks.Add(new CasualtyLink { ServiceNumber = row.Number, ContactId = row.IncidentId });
            }
        }

        if (!dryRun)
        {
            await db.SaveChangesAsync(ct);
        }

        return report;
    }

    // ---------------------------------------------------------------- pictures

    /// <summary>
    /// Runs each legacy picture through the same pipeline as a new upload (so it is checked, straightened, resized and stored under its
    /// hash) and attaches it to its incident and place. A picture whose file is missing is skipped, so this can be run again once the
    /// files arrive. In a dry run the files are only checked for, not processed.
    /// </summary>
    public static async Task<ImportReport> ImportMediaAsync(
        IReadOnlyList<LegacyMedia> rows, IReadOnlyList<LegacyLike> likes, Authors authors, ILegacyFiles files, MediaProcessor processor,
        AvwDbContext db, bool dryRun, TimeProvider clock, CancellationToken ct = default)
    {
        var report = new ImportReport("pictures", dryRun);
        var known = (await db.IncidentMedia.Where(m => m.LegacyId != null).Select(m => m.LegacyId!.Value).ToListAsync(ct)).ToHashSet();
        var likeCounts = likes.GroupBy(l => l.MediaId).ToDictionary(g => g.Key, g => g.Select(l => l.UserId).Distinct().Count());
        AppUser? uploader = null;

        foreach (var row in rows)
        {
            if (known.Contains(row.Id))
            {
                report.Unchanged++;
                continue;
            }

            if (string.IsNullOrWhiteSpace(row.Path))
            {
                report.Skip("without a file name");
                continue;
            }

            await using var file = files.Open(row.Path.Trim());
            if (file is null)
            {
                report.Skip("with the file missing");
                continue;
            }

            if (dryRun)
            {
                report.Added++;
                continue;
            }

            ProcessedImage image;
            try
            {
                image = await processor.ProcessAsync(file, ct);
            }
            catch (MediaException)
            {
                report.Skip("that could not be read as pictures");
                continue;
            }

            uploader ??= await LegacyUploaderAsync(db, clock, ct);
            var asset = await db.MediaAssets.FirstOrDefaultAsync(m => m.Sha256 == image.Sha256, ct)
                        ?? await AddAssetAsync(db, image, row, uploader, ct);

            // Approval belongs to the file, so an unreviewed submission of a file that is already public would put it on a new
            // incident or place without anyone having looked at that. It is left out, and an editor can add it by hand.
            if (row.ApprovalStatus != 1 && asset.Status == MediaStatus.Approved)
            {
                report.Skip("not approved, and the same file is already approved elsewhere");
                continue;
            }

            var (name, hash) = authors.Of(row.Author);
            var contact = row.FeatureId is > 0 ? row.FeatureId : null;
            if (contact is not null && await db.IncidentMedia.AnyAsync(m => m.ContactId == contact && m.MediaId == asset.Id, ct))
            {
                report.Skip("that repeat a picture already on the incident");
                continue;
            }

            var placed = row.Lat is >= -90 and <= 90 && row.Lon is >= -180 and <= 180 && (row.Lat != 0 || row.Lon != 0);
            db.IncidentMedia.Add(new IncidentMedia
            {
                ContactId = contact,
                MediaId = asset.Id,
                AuthorName = name,
                AuthorEmailHash = hash,
                Lat = placed ? row.Lat : null,
                Lon = placed ? row.Lon : null,
                DateTaken = row.DateTaken is { } d && d.Year > 1900 ? DateOnly.FromDateTime(d) : null,
                CreatedUtc = Utc(row.Created),
                LegacyLikes = likeCounts.GetValueOrDefault(row.Id),
                LegacyId = row.Id,
            });
            await db.SaveChangesAsync(ct);
            report.Added++;
        }

        return report;
    }

    private static async Task<MediaAsset> AddAssetAsync(AvwDbContext db, ProcessedImage image, LegacyMedia row, AppUser uploader, CancellationToken ct)
    {
        var asset = new MediaAsset
        {
            Sha256 = image.Sha256,
            Width = image.Width,
            Height = image.Height,
            ByteSize = image.ByteSize,
            Caption = Cut(Text(row.Description).Replace('\n', ' '), 500) is { Length: > 0 } c ? c : null,
            Credit = Cut(Text(row.Attribution).Replace('\n', ' '), 200) is { Length: > 0 } a ? a : null,
            Status = row.ApprovalStatus switch { 1 => MediaStatus.Approved, < 0 => MediaStatus.Rejected, _ => MediaStatus.Pending },
            UploadedById = uploader.Id,
            CreatedUtc = Utc(row.Created),
        };
        db.MediaAssets.Add(asset);
        await db.SaveChangesAsync(ct);
        return asset;
    }

    /// <summary>The one account that owns every migrated file, since the people who uploaded them have no account here yet.</summary>
    private static async Task<AppUser> LegacyUploaderAsync(AvwDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Subject == LegacyUserSubject, ct);
        if (user is null)
        {
            var now = clock.GetUtcNow().UtcDateTime;
            user = new AppUser { Subject = LegacyUserSubject, DisplayName = "Legacy content", CreatedUtc = now, LastSeenUtc = now };
            db.Users.Add(user);
            await db.SaveChangesAsync(ct);
        }

        return user;
    }

    private static DateTime Utc(DateTime t) => DateTime.SpecifyKind(t, DateTimeKind.Utc);
}
