using Avw.Api.Community;
using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Avw.Api.Tests;

public sealed class RecordingNotifier : INotifier
{
    public List<Notification> Sent { get; } = [];

    public void Notify(Notification notification) => Sent.Add(notification);
}

public class PlainTextTests
{
    [Theory]
    [InlineData(null, "")]
    [InlineData("   \n  ", "")]
    [InlineData("  hello  ", "hello")]
    [InlineData("one\r\ntwo\rthree", "one\ntwo\nthree")]
    [InlineData("a\n\n\n\n\nb", "a\n\nb")]
    [InlineData("trailing   \nspaces\t\nhere", "trailing\nspaces\nhere")]
    [InlineData("bell\u0007 and null\u0000 gone", "bell and null gone")]
    [InlineData("right‮to-left override", "rightto-left override")]
    [InlineData("zero​width", "zerowidth")]
    [InlineData("Trận Long Tân, Đồng Nai — 1966", "Trận Long Tân, Đồng Nai — 1966")]
    [InlineData("<script>alert(1)</script>", "<script>alert(1)</script>")]                         // kept as text: it is never rendered as markup
    public void Cleans_typed_text(string? input, string expected) => Assert.Equal(expected, PlainText.Clean(input));
}

public class NoteServiceTests
{
    private static readonly DateTime T0 = new(2026, 9, 20, 9, 0, 0, DateTimeKind.Utc);

    private static readonly Person Ann = new(1, "Ann Member", false);
    private static readonly Person Bo = new(2, "Bo Member", false);
    private static readonly Person Ed = new(3, "Ed Editor", true);

    private sealed class Clock(DateTime now) : TimeProvider
    {
        public DateTime Now { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => new(Now, TimeSpan.Zero);
    }

    private sealed record Fixture(AvwDbContext Db, NoteService Svc, RecordingNotifier Notifier, Clock Clock);

    private static Fixture Make()
    {
        var db = new AvwDbContext(new DbContextOptionsBuilder<AvwDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var notifier = new RecordingNotifier();
        var clock = new Clock(T0);
        return new Fixture(db, new NoteService(db, clock, notifier), notifier, clock);
    }

    private static NoteInput Note(string title = "A detail", string body = "The platoon moved at dawn.") => new(title, body);

    private static async Task<NoteView> Create(Fixture f, Person who, int contact = 2, NoteInput? input = null)
    {
        var r = await f.Svc.CreateAsync(contact, input ?? Note(), who, default);
        Assert.True(r.Ok, r.Message);
        return r.Value!;
    }

    private static Task<List<NoteView>> Public(Fixture f, int contact = 2) => f.Svc.ListAsync(contact, null, default);

    // ------------------------------------------------------------ creating and moderating

    [Fact]
    public async Task A_members_note_waits_for_approval_and_the_editors_are_told()
    {
        var f = Make();

        var note = await Create(f, Ann);

        Assert.Equal((ModerationStatus.Pending, true, true, "Ann Member"), (note.Status, note.Mine, note.CanEdit, note.AuthorName));
        Assert.Empty(await Public(f));
        var told = Assert.Single(f.Notifier.Sent);
        Assert.Contains("waiting for approval", told.Subject);
        Assert.Contains("/studio/moderation", told.Body);
    }

    [Fact]
    public async Task An_editors_note_is_live_at_once_and_nobody_is_told()
    {
        var f = Make();

        var note = await Create(f, Ed);

        Assert.Equal(ModerationStatus.Approved, note.Status);
        Assert.Single(await Public(f));
        Assert.Empty(f.Notifier.Sent);
    }

    [Fact]
    public async Task Shows_a_pending_note_only_to_its_author_and_to_editors()
    {
        var f = Make();
        await Create(f, Ann);

        Assert.Empty(await Public(f));
        Assert.Empty(await f.Svc.ListAsync(2, Bo, default));
        Assert.Single(await f.Svc.ListAsync(2, Ann, default));
        Assert.Single(await f.Svc.ListAsync(2, Ed, default));
        Assert.Empty(await f.Svc.ListAsync(9, Ed, default));                       // another incident
    }

    [Fact]
    public async Task Approving_makes_it_public_and_only_an_editor_can()
    {
        var f = Make();
        var note = await Create(f, Ann);

        Assert.Equal(CmsErrorOf(await f.Svc.ModerateAsync(note.Id, ModerationStatus.Approved, Ann, default)), Avw.Api.Cms.CmsError.Forbidden);
        Assert.Equal("status", (await f.Svc.ModerateAsync(note.Id, ModerationStatus.Pending, Ed, default)).Field);
        Assert.True((await f.Svc.ModerateAsync(note.Id, ModerationStatus.Approved, Ed, default)).Ok);

        var shown = Assert.Single(await Public(f));
        Assert.Equal(("A detail", "The platoon moved at dawn.", ModerationStatus.Approved), (shown.Title, shown.Body, shown.Status));
        Assert.False(shown.Mine);
        Assert.False(shown.CanEdit);
    }

    private static Avw.Api.Cms.CmsError CmsErrorOf<T>(Avw.Api.Cms.CmsResult<T> r) => r.Error;

    [Fact]
    public async Task A_rejected_first_version_never_becomes_public()
    {
        var f = Make();
        var note = await Create(f, Ann);

        await f.Svc.ModerateAsync(note.Id, ModerationStatus.Rejected, Ed, default);

        Assert.Empty(await Public(f));
        Assert.Equal(ModerationStatus.Rejected, Assert.Single(await f.Svc.ListAsync(2, Ann, default)).Status);        // the author can see why it is not up
    }

    // ------------------------------------------------------------ editing and history

    [Fact]
    public async Task An_edit_by_the_author_is_a_new_version_awaiting_approval_while_the_public_keeps_the_old_text()
    {
        var f = Make();
        var note = await Create(f, Ann);
        await f.Svc.ModerateAsync(note.Id, ModerationStatus.Approved, Ed, default);
        f.Notifier.Sent.Clear();
        f.Clock.Now = T0.AddHours(1);

        var edited = (await f.Svc.UpdateAsync(note.Id, Note("A detail", "The platoon moved at first light, not dawn."), Ann, default)).Value!;

        Assert.Equal(("The platoon moved at first light, not dawn.", ModerationStatus.Pending, true), (edited.Body, edited.Status, edited.PendingEdit));
        Assert.Equal("The platoon moved at dawn.", Assert.Single(await Public(f)).Body);
        Assert.Equal("The platoon moved at first light, not dawn.", Assert.Single(await f.Svc.ListAsync(2, Ed, default)).Body);
        Assert.Contains("change is waiting", Assert.Single(f.Notifier.Sent).Subject);

        await f.Svc.ModerateAsync(note.Id, ModerationStatus.Approved, Ed, default);
        Assert.Equal("The platoon moved at first light, not dawn.", Assert.Single(await Public(f)).Body);
    }

    [Fact]
    public async Task A_rejected_edit_leaves_the_earlier_approved_text_public()
    {
        var f = Make();
        var note = await Create(f, Ann);
        await f.Svc.ModerateAsync(note.Id, ModerationStatus.Approved, Ed, default);
        await f.Svc.UpdateAsync(note.Id, Note(body: "Something unacceptable."), Ann, default);

        await f.Svc.ModerateAsync(note.Id, ModerationStatus.Rejected, Ed, default);

        Assert.Equal("The platoon moved at dawn.", Assert.Single(await Public(f)).Body);
        var mine = Assert.Single(await f.Svc.ListAsync(2, Ann, default));
        Assert.Equal((ModerationStatus.Rejected, true), (mine.Status, mine.PendingEdit));
    }

    [Fact]
    public async Task An_editors_edit_goes_live_at_once_even_on_someone_elses_note()
    {
        var f = Make();
        var note = await Create(f, Ann);
        await f.Svc.ModerateAsync(note.Id, ModerationStatus.Approved, Ed, default);

        await f.Svc.UpdateAsync(note.Id, Note("A detail", "Corrected by an editor."), Ed, default);

        Assert.Equal("Corrected by an editor.", Assert.Single(await Public(f)).Body);
        Assert.Equal("Ann Member", Assert.Single(await Public(f)).AuthorName);                // still Ann's note
    }

    [Fact]
    public async Task Saving_the_same_text_again_makes_no_new_version()
    {
        var f = Make();
        var note = await Create(f, Ann);

        await f.Svc.UpdateAsync(note.Id, Note(), Ann, default);

        Assert.Single((await f.Svc.VersionsAsync(note.Id, Ann, default)).Value!);
    }

    [Fact]
    public async Task Keeps_every_version_for_the_author_and_editors_and_marks_the_approved_one()
    {
        var f = Make();
        var note = await Create(f, Ann);
        await f.Svc.ModerateAsync(note.Id, ModerationStatus.Approved, Ed, default);
        await f.Svc.UpdateAsync(note.Id, Note(body: "Second."), Ann, default);
        await f.Svc.UpdateAsync(note.Id, Note(body: "Third."), Ann, default);

        var versions = (await f.Svc.VersionsAsync(note.Id, Ann, default)).Value!;

        Assert.Equal([(3, false), (2, false), (1, true)], versions.Select(v => (v.VersionNo, v.Approved)));
        Assert.Equal(["Third.", "Second.", "The platoon moved at dawn."], versions.Select(v => v.Body));
        Assert.Equal(Avw.Api.Cms.CmsError.Forbidden, (await f.Svc.VersionsAsync(note.Id, Bo, default)).Error);
        Assert.Equal(3, (await f.Svc.VersionsAsync(note.Id, Ed, default)).Value!.Count);
    }

    [Fact]
    public async Task Only_the_author_or_an_editor_can_change_or_delete_a_note()
    {
        var f = Make();
        var note = await Create(f, Ann);
        await f.Svc.ModerateAsync(note.Id, ModerationStatus.Approved, Ed, default);

        Assert.Equal(Avw.Api.Cms.CmsError.Forbidden, (await f.Svc.UpdateAsync(note.Id, Note(body: "Hijack."), Bo, default)).Error);
        Assert.Equal(Avw.Api.Cms.CmsError.Forbidden, (await f.Svc.DeleteAsync(note.Id, Bo, default)).Error);
        Assert.Equal(Avw.Api.Cms.CmsError.NotFound, (await f.Svc.UpdateAsync(9999, Note(), Ann, default)).Error);

        Assert.True((await f.Svc.DeleteAsync(note.Id, Ann, default)).Ok);
        Assert.Empty(f.Db.Notes);
        Assert.Empty(f.Db.NoteVersions);                                                       // the history goes with it
    }

    [Fact]
    public async Task An_editor_can_delete_anyones_note()
    {
        var f = Make();
        var note = await Create(f, Ann);

        Assert.True((await f.Svc.DeleteAsync(note.Id, Ed, default)).Ok);
    }

    [Fact]
    public async Task Someone_else_cannot_even_tell_that_a_pending_note_exists()
    {
        var f = Make();
        var note = await Create(f, Ann);

        Assert.Equal(Avw.Api.Cms.CmsError.NotFound, (await f.Svc.UpdateAsync(note.Id, Note(), Bo, default)).Error);
        Assert.Equal(Avw.Api.Cms.CmsError.NotFound, (await f.Svc.DeleteAsync(note.Id, Bo, default)).Error);
        Assert.Equal(Avw.Api.Cms.CmsError.NotFound, (await f.Svc.VersionsAsync(note.Id, Bo, default)).Error);
        Assert.Equal(Avw.Api.Cms.CmsError.NotFound, (await f.Svc.AddCommentAsync(note.Id, new("Hello"), Bo, default)).Error);
    }

    [Theory]
    [InlineData("", "body", "title")]
    [InlineData("   ", "body", "title")]
    [InlineData("Title", "", "body")]
    [InlineData("Title", "  \n ", "body")]
    public async Task Requires_a_title_and_a_body(string title, string body, string field)
    {
        var f = Make();

        var r = await f.Svc.CreateAsync(2, new(title, body), Ann, default);

        Assert.Equal((Avw.Api.Cms.CmsError.Invalid, field), (r.Error, r.Field));
        Assert.Empty(f.Db.Notes);
    }

    [Fact]
    public async Task Limits_the_length_of_the_title_and_body()
    {
        var f = Make();

        Assert.Equal("title", (await f.Svc.CreateAsync(2, new(new string('t', NoteService.MaxTitle + 1), "body"), Ann, default)).Field);
        Assert.Equal("body", (await f.Svc.CreateAsync(2, new("t", new string('b', NoteService.MaxBody + 1)), Ann, default)).Field);
        Assert.True((await f.Svc.CreateAsync(2, new(new string('t', NoteService.MaxTitle), new string('b', NoteService.MaxBody)), Ann, default)).Ok);
    }

    [Fact]
    public async Task Stores_the_note_as_clean_text_keeping_paragraphs_and_a_one_line_title()
    {
        var f = Make();

        var note = await Create(f, Ed, input: new("Two\nlines‮", "First paragraph.\r\n\r\n\r\n\r\nSecond <b>paragraph</b>.\u0007"));

        Assert.Equal(("Two lines", "First paragraph.\n\nSecond <b>paragraph</b>."), (note.Title, note.Body));
    }

    // ------------------------------------------------------------ comments

    [Fact]
    public async Task Anyone_signed_in_can_comment_on_a_public_note_and_the_comment_shows_at_once()
    {
        var f = Make();
        var note = await Create(f, Ed);

        var withComment = (await f.Svc.AddCommentAsync(note.Id, new("  I was there.  "), Bo, default)).Value!;

        var comment = Assert.Single(withComment.Comments);
        Assert.Equal(("I was there.", "Bo Member", true, true), (comment.Body, comment.AuthorName, comment.Mine, comment.CanDelete));
        var publicView = Assert.Single(Assert.Single(await Public(f)).Comments);
        Assert.Equal((false, false), (publicView.Mine, publicView.CanDelete));
    }

    [Fact]
    public async Task Refuses_empty_or_over_long_comments()
    {
        var f = Make();
        var note = await Create(f, Ed);

        Assert.Equal("body", (await f.Svc.AddCommentAsync(note.Id, new("  "), Bo, default)).Field);
        Assert.Equal("body", (await f.Svc.AddCommentAsync(note.Id, new(new string('x', NoteService.MaxComment + 1)), Bo, default)).Field);
    }

    [Fact]
    public async Task Lets_only_editors_comment_once_comments_are_closed_and_only_editors_close_them()
    {
        var f = Make();
        var note = await Create(f, Ed);

        Assert.Equal(Avw.Api.Cms.CmsError.Forbidden, (await f.Svc.SetCommentsOpenAsync(note.Id, false, Ann, default)).Error);
        Assert.False((await f.Svc.SetCommentsOpenAsync(note.Id, false, Ed, default)).Value!.CommentsOpen);

        Assert.Equal(Avw.Api.Cms.CmsError.Forbidden, (await f.Svc.AddCommentAsync(note.Id, new("Late."), Bo, default)).Error);
        Assert.True((await f.Svc.AddCommentAsync(note.Id, new("From the editor."), Ed, default)).Ok);
    }

    [Fact]
    public async Task Deletes_a_comment_for_its_author_or_an_editor_and_nobody_else()
    {
        var f = Make();
        var note = await Create(f, Ed);
        var first = (await f.Svc.AddCommentAsync(note.Id, new("Mine."), Bo, default)).Value!.Comments[0].Id;

        Assert.Equal(Avw.Api.Cms.CmsError.Forbidden, (await f.Svc.DeleteCommentAsync(first, Ann, default)).Error);
        Assert.Empty((await f.Svc.DeleteCommentAsync(first, Bo, default)).Value!.Comments);

        var second = (await f.Svc.AddCommentAsync(note.Id, new("Another."), Bo, default)).Value!.Comments[0].Id;
        Assert.Empty((await f.Svc.DeleteCommentAsync(second, Ed, default)).Value!.Comments);
        Assert.Equal(Avw.Api.Cms.CmsError.NotFound, (await f.Svc.DeleteCommentAsync(9999, Ed, default)).Error);
    }

    [Fact]
    public async Task Lists_comments_oldest_first_and_newest_notes_first()
    {
        var f = Make();
        var older = await Create(f, Ed, input: Note("Older"));
        f.Clock.Now = T0.AddMinutes(5);
        var newer = await Create(f, Ed, input: Note("Newer"));
        await f.Svc.AddCommentAsync(older.Id, new("One"), Ann, default);
        f.Clock.Now = T0.AddMinutes(6);
        await f.Svc.AddCommentAsync(older.Id, new("Two"), Bo, default);

        var list = await Public(f);

        Assert.Equal(["Newer", "Older"], list.Select(n => n.Title));
        Assert.Equal(["One", "Two"], list[1].Comments.Select(c => c.Body));
        Assert.Equal(newer.Id, list[0].Id);
    }

    // ------------------------------------------------------------ legacy content

    [Fact]
    public async Task Links_migrated_notes_comments_and_tributes_to_a_person_with_the_same_verified_email_and_nobody_else()
    {
        var f = Make();
        var hash = UserSyncHash("old@example.com");
        f.Db.Users.Add(new AppUser { Id = 7, Subject = "s7", DisplayName = "Returning", EmailHash = hash });
        f.Db.Users.Add(new AppUser { Id = 8, Subject = "s8", DisplayName = "Stranger", EmailHash = UserSyncHash("other@example.com") });
        var note = new IncidentNote { ContactId = 2, AuthorName = "Old Name", AuthorEmailHash = hash, Status = ModerationStatus.Approved, LatestVersionNo = 1, ApprovedVersionNo = 1, CreatedUtc = T0, UpdatedUtc = T0 };
        note.Versions.Add(new IncidentNoteVersion { VersionNo = 1, Title = "Old", Body = "Old.", EditedByName = "Old Name", CreatedUtc = T0 });
        note.Comments.Add(new NoteComment { AuthorName = "Old Name", AuthorEmailHash = hash, Body = "Old comment.", CreatedUtc = T0 });
        f.Db.Notes.Add(note);
        f.Db.Tributes.Add(new Tribute { ServiceNumber = "123", AuthorName = "Old Name", AuthorEmailHash = hash, Message = "Rest in peace.", CreatedUtc = T0 });
        f.Db.Tributes.Add(new Tribute { ServiceNumber = "123", AuthorName = "Someone", AuthorEmailHash = UserSyncHash("else@example.com"), Message = "Thank you.", CreatedUtc = T0 });
        await f.Db.SaveChangesAsync();

        Assert.Equal(0, await LegacyContentLinker.LinkAsync(f.Db, await f.Db.Users.FindAsync(8L) ?? throw new InvalidOperationException(), default));
        Assert.Equal(3, await LegacyContentLinker.LinkAsync(f.Db, await f.Db.Users.FindAsync(7L) ?? throw new InvalidOperationException(), default));

        Assert.Equal(7, (await f.Db.Notes.SingleAsync()).AuthorId);
        Assert.Equal(7, (await f.Db.NoteComments.SingleAsync()).AuthorId);
        Assert.Equal([7L, null], f.Db.Tributes.OrderBy(t => t.Id).Select(t => t.AuthorId));
        // Now the returning member can edit their old note, as a new (pending) version.
        var edit = await f.Svc.UpdateAsync(note.Id, Note("Old", "Corrected."), new Person(7, "Returning", false), default);
        Assert.True(edit.Ok, edit.Message);
        Assert.Equal(0, await LegacyContentLinker.LinkAsync(f.Db, await f.Db.Users.FindAsync(7L) ?? throw new InvalidOperationException(), default));      // a second sign-in has nothing left to link
    }

    [Fact]
    public async Task An_author_can_edit_a_long_migrated_note_without_making_it_longer_and_new_notes_stay_short()
    {
        var f = Make();
        var note = await Create(f, Ann);
        var long_ = new string('b', 20_000);
        (await f.Db.NoteVersions.SingleAsync()).Body = long_;                                 // as carried over from the old site
        await f.Db.SaveChangesAsync();

        var shorter = await f.Svc.UpdateAsync(note.Id, Note("A detail", new string('c', 19_999)), Ann, default);
        var same = await f.Svc.UpdateAsync(note.Id, Note("A detail", new string('d', 19_999)), Ann, default);
        var longer = await f.Svc.UpdateAsync(note.Id, Note("A detail", new string('e', 20_001)), Ann, default);

        Assert.True(shorter.Ok, shorter.Message);
        Assert.True(same.Ok, same.Message);
        Assert.Equal(("body", false), (longer.Field, longer.Ok));
        Assert.Contains("19999", longer.Message);                                             // the limit is now what that version was
        Assert.Equal("body", (await f.Svc.CreateAsync(2, Note("New", new string('n', NoteService.MaxBody + 1)), Ann, default)).Field);
    }

    [Fact]
    public async Task A_note_is_still_limited_to_five_thousand_characters_when_edited_if_it_started_short()
    {
        var f = Make();
        var note = await Create(f, Ann);

        var tooLong = await f.Svc.UpdateAsync(note.Id, Note("A detail", new string('x', NoteService.MaxBody + 1)), Ann, default);

        Assert.Equal("body", tooLong.Field);
    }

    [Fact]
    public async Task Links_migrated_pictures_to_the_person_with_the_same_verified_email()
    {
        var f = Make();
        var hash = UserSyncHash("old@example.com");
        f.Db.Users.Add(new AppUser { Id = 7, Subject = "s7", DisplayName = "Returning", EmailHash = hash });
        MediaAsset Asset(string sha) => new() { Sha256 = sha.PadRight(64, '0'), Width = 1, Height = 1, ByteSize = 1, Status = MediaStatus.Approved, UploadedById = 1, CreatedUtc = T0 };
        f.Db.IncidentMedia.AddRange(
            new IncidentMedia { ContactId = 2, Media = Asset("a1"), AuthorEmailHash = hash, CreatedUtc = T0 },
            new IncidentMedia { ContactId = null, Media = Asset("a2"), AuthorEmailHash = hash, Lat = -10, Lon = 107, CreatedUtc = T0 },
            new IncidentMedia { ContactId = 2, Media = Asset("a3"), AuthorEmailHash = UserSyncHash("else@example.com"), CreatedUtc = T0 });
        await f.Db.SaveChangesAsync();

        Assert.Equal(2, await LegacyContentLinker.LinkAsync(f.Db, await f.Db.Users.FindAsync(7L) ?? throw new InvalidOperationException(), default));

        Assert.Equal([7L, 7L, null], f.Db.IncidentMedia.OrderBy(m => m.Id).Select(m => m.AttachedById));
    }

    [Fact]
    public async Task Links_nothing_for_someone_with_no_verified_email()
    {
        var f = Make();
        f.Db.Users.Add(new AppUser { Id = 7, Subject = "s7", DisplayName = "No email" });
        await f.Db.SaveChangesAsync();

        Assert.Equal(0, await LegacyContentLinker.LinkAsync(f.Db, await f.Db.Users.FindAsync(7L) ?? throw new InvalidOperationException(), default));
    }

    private static string UserSyncHash(string email) => Avw.Api.Auth.UserSync.HashEmail(email);
}
