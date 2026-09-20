using System.Text.RegularExpressions;
using Avw.Api.Cms;
using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Avw.Api.Community;

public sealed record NoteInput(string? Title, string? Body);

public sealed record CommentInput(string? Body);

public sealed record CommentView(long Id, string AuthorName, string Body, DateTime CreatedUtc, bool Mine, bool CanDelete);

/// <summary>A note as one viewer sees it.</summary>
/// <param name="Status">The state of the newest version; only the author and editors are shown anything but the approved text.</param>
/// <param name="PendingEdit">The newest version is still waiting for approval, while an earlier approved one is what the public sees.</param>
public sealed record NoteView(
    long Id,
    int ContactId,
    string Title,
    string Body,
    string AuthorName,
    DateTime CreatedUtc,
    DateTime UpdatedUtc,
    ModerationStatus Status,
    bool PendingEdit,
    bool Mine,
    bool CanEdit,
    bool CommentsOpen,
    IReadOnlyList<CommentView> Comments);

public sealed record VersionView(int VersionNo, string Title, string Body, string EditedByName, DateTime CreatedUtc, bool Approved);

public sealed record ModerationRequest(ModerationStatus Status);

public sealed record CommentsOpenRequest(bool Open);

/// <summary>Cleans text typed by a member into safe plain text. Nothing here is ever markup.</summary>
public static partial class PlainText
{
    [GeneratedRegex(@"[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]")]
    private static partial Regex Unwanted();

    [GeneratedRegex(@"\n{3,}")]
    private static partial Regex Blanks();

    [GeneratedRegex(@"[ \t]+\n")]
    private static partial Regex TrailingSpaces();

    /// <summary>Normalises line breaks, removes control and direction-changing characters, and tidies blank lines. Returns "" for null.</summary>
    public static string Clean(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return "";
        }

        var s = Unwanted().Replace(text.Replace("\r\n", "\n").Replace('\r', '\n'), "");
        return Blanks().Replace(TrailingSpaces().Replace(s, "\n"), "\n\n").Trim();
    }
}

/// <summary>
/// Community notes about incidents, with their edit history, comments and moderation. Members write; an editor's own notes and
/// edits go live at once, anyone else's wait for approval, and until then the public keeps seeing the last approved text.
/// </summary>
public sealed class NoteService(AvwDbContext db, TimeProvider clock, INotifier notifier)
{
    public const int MaxTitle = 200;
    public const int MaxBody = 5000;
    public const int MaxComment = 1000;

    private IQueryable<IncidentNote> Visible(Person? viewer) =>
        db.Notes.Where(n => n.ApprovedVersionNo != null || viewer != null && (viewer.IsEditor || n.AuthorId == viewer.Id));

    public async Task<List<NoteView>> ListAsync(int contactId, Person? viewer, CancellationToken ct)
    {
        var notes = await Visible(viewer).AsNoTracking().Where(n => n.ContactId == contactId).OrderByDescending(n => n.CreatedUtc).ThenByDescending(n => n.Id).ToListAsync(ct);
        var ids = notes.Select(n => n.Id).ToList();
        var versions = await db.NoteVersions.AsNoTracking().Where(v => ids.Contains(v.NoteId)).ToListAsync(ct);
        var comments = await db.NoteComments.AsNoTracking().Where(c => ids.Contains(c.NoteId)).OrderBy(c => c.CreatedUtc).ThenBy(c => c.Id).ToListAsync(ct);

        return notes.Select(n => ToView(n, versions.Where(v => v.NoteId == n.Id).ToList(), comments.Where(c => c.NoteId == n.Id).ToList(), viewer)).ToList();
    }

    public async Task<CmsResult<NoteView>> CreateAsync(int contactId, NoteInput input, Person person, CancellationToken ct)
    {
        var invalid = Validate(input, out var title, out var body);
        if (invalid is not null)
        {
            return invalid;
        }

        var now = clock.GetUtcNow().UtcDateTime;
        var live = person.IsEditor;                                   // an editor's own words need no second opinion
        var note = new IncidentNote
        {
            ContactId = contactId,
            AuthorId = person.Id,
            AuthorName = person.Name,
            Status = live ? ModerationStatus.Approved : ModerationStatus.Pending,
            LatestVersionNo = 1,
            ApprovedVersionNo = live ? 1 : null,
            CreatedUtc = now,
            UpdatedUtc = now,
            ModeratedById = live ? person.Id : null,
            ModeratedUtc = live ? now : null,
        };
        note.Versions.Add(new IncidentNoteVersion { VersionNo = 1, Title = title, Body = body, EditedById = person.Id, EditedByName = person.Name, CreatedUtc = now });
        db.Notes.Add(note);
        await db.SaveChangesAsync(ct);

        if (!live)
        {
            Tell($"A note is waiting for approval (incident {contactId})", $"{person.Name} wrote a note titled \"{title}\" on incident {contactId}.", contactId);
        }

        return await ViewAsync(note.Id, person, ct);
    }

    public async Task<CmsResult<NoteView>> UpdateAsync(long id, NoteInput input, Person person, CancellationToken ct)
    {
        var note = await db.Notes.Include(n => n.Versions).FirstOrDefaultAsync(n => n.Id == id, ct);
        if (note is null || !CanSee(note, person))
        {
            return NotFound();
        }

        if (!CanEdit(note, person))
        {
            return CmsResult<NoteView>.Fail(CmsError.Forbidden, "Only the author or an editor can change a note.");
        }

        var invalid = Validate(input, out var title, out var body);
        if (invalid is not null)
        {
            return invalid;
        }

        var latest = note.Versions.First(v => v.VersionNo == note.LatestVersionNo);
        if (latest.Title == title && latest.Body == body)
        {
            return await ViewAsync(id, person, ct);                    // nothing changed: no new version
        }

        var now = clock.GetUtcNow().UtcDateTime;
        note.LatestVersionNo++;
        note.Versions.Add(new IncidentNoteVersion { VersionNo = note.LatestVersionNo, Title = title, Body = body, EditedById = person.Id, EditedByName = person.Name, CreatedUtc = now });
        note.UpdatedUtc = now;
        if (person.IsEditor)
        {
            note.Status = ModerationStatus.Approved;
            note.ApprovedVersionNo = note.LatestVersionNo;
            note.ModeratedById = person.Id;
            note.ModeratedUtc = now;
        }
        else
        {
            note.Status = ModerationStatus.Pending;                    // the earlier approved text, if any, stays public meanwhile
        }

        await db.SaveChangesAsync(ct);
        if (!person.IsEditor)
        {
            Tell($"A note change is waiting for approval (incident {note.ContactId})", $"{person.Name} changed their note \"{title}\" on incident {note.ContactId}.", note.ContactId);
        }

        return await ViewAsync(id, person, ct);
    }

    public async Task<CmsResult<bool>> DeleteAsync(long id, Person person, CancellationToken ct)
    {
        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id, ct);
        if (note is null || !CanSee(note, person))
        {
            return CmsResult<bool>.Fail(CmsError.NotFound, "There is no such note.");
        }

        if (!CanEdit(note, person))
        {
            return CmsResult<bool>.Fail(CmsError.Forbidden, "Only the author or an editor can delete a note.");
        }

        db.Notes.Remove(note);                                         // its versions and comments go with it
        await db.SaveChangesAsync(ct);
        return CmsResult<bool>.Success(true);
    }

    public async Task<CmsResult<List<VersionView>>> VersionsAsync(long id, Person person, CancellationToken ct)
    {
        var note = await db.Notes.AsNoTracking().FirstOrDefaultAsync(n => n.Id == id, ct);
        if (note is null || !CanSee(note, person))
        {
            return CmsResult<List<VersionView>>.Fail(CmsError.NotFound, "There is no such note.");
        }

        if (!CanEdit(note, person))
        {
            return CmsResult<List<VersionView>>.Fail(CmsError.Forbidden, "Only the author or an editor can see a note's history.");
        }

        var list = await db.NoteVersions.AsNoTracking().Where(v => v.NoteId == id).OrderByDescending(v => v.VersionNo)
            .Select(v => new VersionView(v.VersionNo, v.Title, v.Body, v.EditedByName, v.CreatedUtc, v.VersionNo == note.ApprovedVersionNo))
            .ToListAsync(ct);
        return CmsResult<List<VersionView>>.Success(list);
    }

    /// <summary>An editor approves the newest version, or rejects it (an earlier approved version, if any, stays public).</summary>
    public async Task<CmsResult<NoteView>> ModerateAsync(long id, ModerationStatus status, Person person, CancellationToken ct)
    {
        if (!person.IsEditor)
        {
            return CmsResult<NoteView>.Fail(CmsError.Forbidden, "Only editors can approve or reject notes.");
        }

        if (status == ModerationStatus.Pending)
        {
            return CmsResult<NoteView>.Invalid("status", "Choose approved or rejected.");
        }

        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id, ct);
        if (note is null)
        {
            return NotFound();
        }

        note.Status = status;
        if (status == ModerationStatus.Approved)
        {
            note.ApprovedVersionNo = note.LatestVersionNo;
        }

        note.ModeratedById = person.Id;
        note.ModeratedUtc = clock.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(ct);
        return await ViewAsync(id, person, ct);
    }

    public async Task<CmsResult<NoteView>> SetCommentsOpenAsync(long id, bool open, Person person, CancellationToken ct)
    {
        if (!person.IsEditor)
        {
            return CmsResult<NoteView>.Fail(CmsError.Forbidden, "Only editors can open or close comments.");
        }

        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id, ct);
        if (note is null)
        {
            return NotFound();
        }

        note.CommentsOpen = open;
        await db.SaveChangesAsync(ct);
        return await ViewAsync(id, person, ct);
    }

    public async Task<CmsResult<NoteView>> AddCommentAsync(long noteId, CommentInput input, Person person, CancellationToken ct)
    {
        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == noteId, ct);
        if (note is null || !CanSee(note, person))
        {
            return NotFound();
        }

        if (!note.CommentsOpen && !person.IsEditor)
        {
            return CmsResult<NoteView>.Fail(CmsError.Forbidden, "Comments are closed on this note.");
        }

        var body = PlainText.Clean(input.Body);
        if (body.Length is 0 or > MaxComment)
        {
            return CmsResult<NoteView>.Invalid("body", $"Write a comment of up to {MaxComment} characters.");
        }

        db.NoteComments.Add(new NoteComment { NoteId = noteId, AuthorId = person.Id, AuthorName = person.Name, Body = body, CreatedUtc = clock.GetUtcNow().UtcDateTime });
        await db.SaveChangesAsync(ct);
        return await ViewAsync(noteId, person, ct);
    }

    public async Task<CmsResult<NoteView>> DeleteCommentAsync(long commentId, Person person, CancellationToken ct)
    {
        var comment = await db.NoteComments.Include(c => c.Note).FirstOrDefaultAsync(c => c.Id == commentId, ct);
        if (comment is null || !CanSee(comment.Note, person))
        {
            return CmsResult<NoteView>.Fail(CmsError.NotFound, "There is no such comment.");
        }

        if (!person.IsEditor && comment.AuthorId != person.Id)
        {
            return CmsResult<NoteView>.Fail(CmsError.Forbidden, "Only the author or an editor can delete a comment.");
        }

        var noteId = comment.NoteId;
        db.NoteComments.Remove(comment);
        await db.SaveChangesAsync(ct);
        return await ViewAsync(noteId, person, ct);
    }

    // ---------------------------------------------------------------- internals

    private static bool CanSee(IncidentNote note, Person? viewer) =>
        note.ApprovedVersionNo is not null || viewer is not null && (viewer.IsEditor || note.AuthorId == viewer.Id);

    private static bool CanEdit(IncidentNote note, Person person) => person.IsEditor || note.AuthorId == person.Id;

    private static CmsResult<NoteView> NotFound() => CmsResult<NoteView>.Fail(CmsError.NotFound, "There is no such note.");

    private async Task<CmsResult<NoteView>> ViewAsync(long id, Person person, CancellationToken ct)
    {
        var note = await db.Notes.AsNoTracking().FirstAsync(n => n.Id == id, ct);
        var versions = await db.NoteVersions.AsNoTracking().Where(v => v.NoteId == id).ToListAsync(ct);
        var comments = await db.NoteComments.AsNoTracking().Where(c => c.NoteId == id).OrderBy(c => c.CreatedUtc).ThenBy(c => c.Id).ToListAsync(ct);
        return CmsResult<NoteView>.Success(ToView(note, versions, comments, person));
    }

    /// <summary>The author and editors see the newest text (to work on it); everyone else sees the newest approved text.</summary>
    private static NoteView ToView(IncidentNote n, List<IncidentNoteVersion> versions, List<NoteComment> comments, Person? viewer)
    {
        var privileged = viewer is not null && (viewer.IsEditor || n.AuthorId == viewer.Id);
        var shown = privileged || n.ApprovedVersionNo is null ? n.LatestVersionNo : n.ApprovedVersionNo.Value;
        var v = versions.First(x => x.VersionNo == shown);
        var mine = viewer is not null && n.AuthorId == viewer.Id;
        return new NoteView(
            n.Id, n.ContactId, v.Title, v.Body, n.AuthorName, n.CreatedUtc, v.CreatedUtc, privileged ? n.Status : ModerationStatus.Approved,
            privileged && n.ApprovedVersionNo is not null && n.ApprovedVersionNo != n.LatestVersionNo, mine, privileged, n.CommentsOpen,
            comments.Select(c => new CommentView(c.Id, c.AuthorName, c.Body, c.CreatedUtc, viewer is not null && c.AuthorId == viewer.Id, viewer is not null && (viewer.IsEditor || c.AuthorId == viewer.Id))).ToList());
    }

    private static CmsResult<NoteView>? Validate(NoteInput input, out string title, out string body)
    {
        title = PlainText.Clean(input.Title).Replace('\n', ' ');
        body = PlainText.Clean(input.Body);
        if (title.Length is 0 or > MaxTitle)
        {
            return CmsResult<NoteView>.Invalid("title", $"Give the note a title of up to {MaxTitle} characters.");
        }

        return body.Length is 0 or > MaxBody
            ? CmsResult<NoteView>.Invalid("body", $"Write the note, up to {MaxBody} characters.")
            : null;
    }

    private void Tell(string subject, string text, int contactId) => notifier.Notify(new Notification(subject, text + $"\n\nIncident: /battlemap?incident={contactId}\nModerate it in the Studio: /studio/moderation"));
}
