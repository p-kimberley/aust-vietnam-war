using Avw.Api.Auth;
using Avw.Api.Community;
using Avw.Api.Media;
using Avw.Data;
using Avw.Data.Entities;
using Avw.Migration;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Avw.Api.Tests;

public sealed class CommunityImporterTests : IDisposable
{
    private static readonly DateTime T = new(2011, 5, 4, 10, 30, 0);
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "avw-import-" + Guid.NewGuid().ToString("N"));
    private readonly AvwDbContext _db = new(new DbContextOptionsBuilder<AvwDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static readonly CommunityImporter.Authors Authors = new(
    [
        new LegacyUser(5, "Old Digger", "Old.Digger@Example.com"),
        new LegacyUser(6, "  ", null),
    ]);

    public void Dispose()
    {
        _db.Dispose();
        try
        {
            Directory.Delete(_dir, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    // ---------------------------------------------------------------- authors

    [Fact]
    public void An_author_keeps_a_name_and_only_a_hash_of_their_email()
    {
        var (name, hash) = Authors.Of(5);

        Assert.Equal("Old Digger", name);
        Assert.Equal(UserSync.HashEmail("Old.Digger@Example.com"), hash);
        Assert.DoesNotContain("example", hash, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void An_unknown_or_nameless_author_is_a_member_with_no_hash_and_may_fall_back_to_a_stored_name()
    {
        Assert.Equal(("Member", null), Authors.Of(99));
        Assert.Equal(("Member", null), Authors.Of(6));
        Assert.Equal(("Digger Dave", null), Authors.Of(99, "Digger Dave"));
    }

    // ---------------------------------------------------------------- notes

    private static LegacyNote Note(int id = 1, int incident = 100, int approval = 1, long author = 5) => new(id, incident, T, T.AddDays(1), author, true, approval);
    private static LegacyNoteVersion Version(int id, int note, string title, string body, long author = 5) => new(id, note, title, body, T.AddHours(id), author);

    [Fact]
    public async Task Imports_a_note_with_every_version_in_order_and_its_latest_as_the_current_one()
    {
        var report = await CommunityImporter.ImportNotesAsync(
            [Note()], [Version(2, 1, "Second title", "<p>Second &amp; better.</p>"), Version(1, 1, "First title", "<p>First.</p>")],
            [new LegacyComment(1, 1, "<p>Well said</p>", T, 5)], Authors, _db, dryRun: false);

        Assert.Equal(2, report.Added);
        var note = await _db.Notes.Include(n => n.Versions).SingleAsync();
        Assert.Equal((100, "Old Digger", 1, 2, 2, ModerationStatus.Approved), (note.ContactId, note.AuthorName, note.LegacyId, note.LatestVersionNo, note.ApprovedVersionNo, note.Status));
        Assert.Equal(UserSync.HashEmail("old.digger@example.com"), note.AuthorEmailHash);
        Assert.Equal(DateTimeKind.Utc, note.CreatedUtc.Kind);
        Assert.Equal(["First title", "Second title"], note.Versions.OrderBy(v => v.VersionNo).Select(v => v.Title));
        Assert.Equal("Second & better.", note.Versions.Single(v => v.VersionNo == 2).Body);
        Assert.Equal("Well said", (await _db.NoteComments.SingleAsync()).Body);
    }

    [Theory]
    [InlineData(1, ModerationStatus.Approved, 1)]
    [InlineData(0, ModerationStatus.Pending, null)]
    [InlineData(-1, ModerationStatus.Rejected, null)]
    public async Task Carries_the_legacy_approval_status_across(int legacy, ModerationStatus expected, int? approvedVersion)
    {
        await CommunityImporter.ImportNotesAsync([Note(approval: legacy)], [Version(1, 1, "T", "Body")], [], Authors, _db, false);

        var note = await _db.Notes.SingleAsync();
        Assert.Equal((expected, approvedVersion), (note.Status, note.ApprovedVersionNo));
    }

    [Fact]
    public async Task Skips_a_note_with_no_versions_or_no_text_and_a_comment_with_no_text()
    {
        var report = await CommunityImporter.ImportNotesAsync(
            [Note(1), Note(2), Note(3)],
            [Version(1, 2, "Empty", "<p> &nbsp; </p>"), Version(2, 3, "Fine", "Text")],
            [new LegacyComment(1, 3, "<br>", T, 5), new LegacyComment(2, 3, "Kept", T, 5)], Authors, _db, false);

        Assert.Equal(2, report.Added);
        Assert.Equal((2, 1), (report.Skipped["without any text"], report.Skipped["comments with no text"]));
        Assert.Single(await _db.Notes.ToListAsync());
        Assert.Equal("Kept", (await _db.NoteComments.SingleAsync()).Body);
    }

    [Fact]
    public async Task Repeating_a_note_import_adds_nothing_but_picks_up_new_comments()
    {
        LegacyNote[] notes = [Note()];
        LegacyNoteVersion[] versions = [Version(1, 1, "T", "Body")];
        await CommunityImporter.ImportNotesAsync(notes, versions, [new LegacyComment(1, 1, "One", T, 5)], Authors, _db, false);

        var again = await CommunityImporter.ImportNotesAsync(notes, versions, [new LegacyComment(1, 1, "One", T, 5), new LegacyComment(2, 1, "Two", T, 5)], Authors, _db, false);

        Assert.Equal(1, again.Added);
        Assert.Equal(2, again.Unchanged);
        Assert.Single(await _db.Notes.ToListAsync());
        Assert.Equal(2, await _db.NoteComments.CountAsync());
    }

    [Fact]
    public async Task A_dry_run_counts_notes_and_comments_and_writes_nothing()
    {
        var report = await CommunityImporter.ImportNotesAsync([Note()], [Version(1, 1, "T", "Body")], [new LegacyComment(1, 1, "One", T, 5)], Authors, _db, dryRun: true);

        Assert.Equal((2, true), (report.Added, report.DryRun));
        Assert.Empty(await _db.Notes.ToListAsync());
        Assert.Empty(await _db.NoteComments.ToListAsync());
    }

    [Fact]
    public async Task Very_long_versions_are_cut_only_at_the_column_limit_and_titles_are_never_blank()
    {
        var report = await CommunityImporter.ImportNotesAsync([Note()], [Version(1, 1, "", new string('x', CommunityImporter.MaxLegacyBody + 500))], [], Authors, _db, false);

        var v = (await _db.Notes.Include(n => n.Versions).SingleAsync()).Versions.Single();
        Assert.Equal("Note", v.Title);
        Assert.Equal(CommunityImporter.MaxLegacyBody, v.Body.Length);
        Assert.Equal(1, report.Skipped["versions cut at the column limit"]);
    }

    // ---------------------------------------------------------------- tributes and casualties

    [Fact]
    public async Task Imports_tributes_once_with_the_author_hashed_and_skips_empty_ones()
    {
        LegacyTribute[] rows =
        [
            new(1, "3400456", "<p>Rest easy, Dad.</p>", 5, "Ignored", T),
            new(2, "3400456", "  ", 5, null, T),
            new(3, "3400789", "Thank you.", 99, "Anne", T),
        ];

        var first = await CommunityImporter.ImportTributesAsync(rows, Authors, _db, false);
        var again = await CommunityImporter.ImportTributesAsync(rows, Authors, _db, false);

        Assert.Equal((2, 1), (first.Added, first.Skipped["without a message or service number"]));
        Assert.Equal((0, 2), (again.Added, again.Unchanged));
        var tributes = await _db.Tributes.OrderBy(t => t.LegacyId).ToListAsync();
        Assert.Equal(("Old Digger", "Rest easy, Dad."), (tributes[0].AuthorName, tributes[0].Message));
        Assert.NotNull(tributes[0].AuthorEmailHash);
        Assert.Equal(("Anne", null), (tributes[1].AuthorName, tributes[1].AuthorEmailHash));
    }

    [Fact]
    public async Task Imports_casualty_reports_with_a_known_type_or_other_and_keeps_wordless_ones_that_name_someone()
    {
        LegacyCasualtySubmission[] rows =
        [
            new(1, "3400456", 100, CommunityLimits.CasualtyTypes[0].ToUpperInvariant(), "<p>He was wounded here.</p>", 5, T),
            new(2, null, 100, "Something odd", "Text", 5, T),
            new(3, "1", 100, null, " ", 5, T),
            new(4, null, 100, null, " ", 5, T),
        ];

        var report = await CommunityImporter.ImportCasualtySubmissionsAsync(rows, Authors, _db, false);
        await CommunityImporter.ImportCasualtySubmissionsAsync(rows, Authors, _db, false);

        Assert.Equal((3, 1), (report.Added, report.Skipped["with nothing to review"]));
        var saved = await _db.CasualtySubmissions.OrderBy(c => c.LegacyId).ToListAsync();
        Assert.Equal(3, saved.Count);
        Assert.Equal((CommunityLimits.CasualtyTypes[0], "3400456", "He was wounded here."), (saved[0].CasualtyType, saved[0].ServiceNumber, saved[0].Comment));
        Assert.Equal(("Other", null), (saved[1].CasualtyType, saved[1].ServiceNumber));
        Assert.Equal(("Other", "1", CommunityImporter.NoDetails), (saved[2].CasualtyType, saved[2].ServiceNumber, saved[2].Comment));      // no words, but it still says who and where
    }

    [Fact]
    public async Task Links_people_to_incidents_without_duplicates_and_ignores_rows_with_no_incident()
    {
        LegacyCasualtyLink[] rows = [new("111", 100), new("111", 100), new(" 222 ", 100), new("333", 0), new("", 5)];

        var report = await CommunityImporter.ImportCasualtyLinksAsync(rows, _db, false);
        var again = await CommunityImporter.ImportCasualtyLinksAsync(rows, _db, false);

        Assert.Equal(2, report.Added);
        Assert.Equal(2, report.Skipped["without a service number or incident"]);
        Assert.Equal((0, 2), (again.Added, again.Unchanged));
        Assert.Equal(["111", "222"], _db.CasualtyLinks.Select(l => l.ServiceNumber).OrderBy(n => n));
    }

    // ---------------------------------------------------------------- pictures

    private sealed class Files(Dictionary<string, byte[]> byPath) : ILegacyFiles
    {
        public Stream? Open(string relativePath) => byPath.TryGetValue(relativePath, out var b) ? new MemoryStream(b) : null;
    }

    private MediaProcessor Processor() => new(Options.Create(new MediaOptions { RootPath = Path.Combine(_dir, "media"), ScratchPath = Path.Combine(_dir, "scratch") }));

    private static LegacyMedia Pic(int id, string path = "a.jpg", int? feature = 100, double? lat = -10.5, double? lon = 107.2, long author = 5, int approval = 1) =>
        new(id, path, feature, lat, lon, new DateTime(1969, 3, 2), "<i>AWM</i> photo", "<p>A patrol</p>", T, author, approval);

    [Fact]
    public async Task Imports_a_picture_through_the_upload_pipeline_and_attaches_it_to_its_incident_and_place()
    {
        using var processor = Processor();
        var files = new Files(new() { ["a.jpg"] = TestImages.Jpeg(3000, 2000) });

        var report = await CommunityImporter.ImportMediaAsync([Pic(1)], [new(1, 5), new(1, 6), new(1, 6)], Authors, files, processor, _db, false, TimeProvider.System);

        Assert.Equal(1, report.Added);
        var link = await _db.IncidentMedia.Include(m => m.Media).SingleAsync();
        Assert.Equal((100, -10.5, 107.2, new DateOnly(1969, 3, 2), 2, 1), (link.ContactId, link.Lat, link.Lon, link.DateTaken, link.LegacyLikes, link.LegacyId));
        Assert.Equal(("A patrol", "AWM photo", MediaStatus.Approved), (link.Media.Caption, link.Media.Credit, link.Media.Status));
        Assert.Equal(UserSync.HashEmail("old.digger@example.com"), link.AuthorEmailHash);
        Assert.Null(link.AttachedById);
        Assert.True(File.Exists(Path.Combine(_dir, "media", link.Media.Sha256[..2], link.Media.Sha256 + ".jpg")));
        Assert.Equal(CommunityImporter.LegacyUserSubject, (await _db.Users.SingleAsync()).Subject);
    }

    [Fact]
    public async Task Skips_missing_files_and_unreadable_ones_and_can_be_run_again_once_they_arrive()
    {
        using var processor = Processor();
        var files = new Dictionary<string, byte[]> { ["bad.jpg"] = "not a picture at all"u8.ToArray() };
        LegacyMedia[] rows = [Pic(1, "missing.jpg"), Pic(2, "bad.jpg"), Pic(3, path: "  ")];

        var first = await CommunityImporter.ImportMediaAsync(rows, [], Authors, new Files(files), processor, _db, false, TimeProvider.System);

        Assert.Equal(0, first.Added);
        Assert.Equal((1, 1, 1), (first.Skipped["with the file missing"], first.Skipped["that could not be read as pictures"], first.Skipped["without a file name"]));

        files["missing.jpg"] = TestImages.Jpeg();
        var second = await CommunityImporter.ImportMediaAsync(rows, [], Authors, new Files(files), processor, _db, false, TimeProvider.System);

        Assert.Equal(1, second.Added);
        Assert.Equal(1, (await _db.IncidentMedia.SingleAsync()).LegacyId);
    }

    [Fact]
    public async Task The_same_picture_uploaded_twice_is_stored_once_and_attached_once_per_incident()
    {
        using var processor = Processor();
        var bytes = TestImages.Jpeg(800, 600);
        var files = new Files(new() { ["a.jpg"] = bytes, ["b.jpg"] = bytes });

        var report = await CommunityImporter.ImportMediaAsync(
            [Pic(1, "a.jpg"), Pic(2, "b.jpg"), Pic(3, "b.jpg", feature: 200)], [], Authors, files, processor, _db, false, TimeProvider.System);

        Assert.Equal(2, report.Added);
        Assert.Equal(1, report.Skipped["that repeat a picture already on the incident"]);
        Assert.Equal(1, await _db.MediaAssets.CountAsync());
        Assert.Equal([100, 200], _db.IncidentMedia.Select(m => m.ContactId).OrderBy(c => c).Select(c => c!.Value));
    }

    [Fact]
    public async Task A_picture_with_no_incident_is_kept_for_the_map_and_a_bad_or_zero_position_is_dropped()
    {
        using var processor = Processor();
        var files = new Files(new() { ["a.jpg"] = TestImages.Jpeg(400, 300), ["b.jpg"] = TestImages.Jpeg(500, 300), ["c.jpg"] = TestImages.Jpeg(600, 300) });

        await CommunityImporter.ImportMediaAsync(
            [Pic(1, "a.jpg", feature: null), Pic(2, "b.jpg", lat: 0, lon: 0), Pic(3, "c.jpg", lat: 95, lon: 200)], [], Authors, files, processor, _db, false, TimeProvider.System);

        var links = await _db.IncidentMedia.OrderBy(m => m.LegacyId).ToListAsync();
        Assert.Equal((null, -10.5), (links[0].ContactId, links[0].Lat));
        Assert.Equal((100, null, null), (links[1].ContactId, links[1].Lat, links[1].Lon));
        Assert.Equal((null, null), (links[2].Lat, links[2].Lon));
    }

    [Fact]
    public async Task Maps_legacy_approval_to_the_picture_status()
    {
        using var processor = Processor();
        var files = new Files(new() { ["a.jpg"] = TestImages.Jpeg(400, 300), ["b.jpg"] = TestImages.Jpeg(500, 300), ["c.jpg"] = TestImages.Jpeg(600, 300) });

        await CommunityImporter.ImportMediaAsync(
            [Pic(1, "a.jpg", approval: 1), Pic(2, "b.jpg", approval: 0), Pic(3, "c.jpg", approval: -1)], [], Authors, files, processor, _db, false, TimeProvider.System);

        Assert.Equal([MediaStatus.Approved, MediaStatus.Pending, MediaStatus.Rejected], _db.IncidentMedia.OrderBy(m => m.LegacyId).Select(m => m.Media.Status));
    }

    [Fact]
    public async Task An_unapproved_submission_of_a_file_that_is_already_approved_is_not_attached_anywhere_new()
    {
        using var processor = Processor();
        var bytes = TestImages.Jpeg(640, 480);
        var files = new Files(new() { ["a.jpg"] = bytes, ["b.jpg"] = bytes });

        var report = await CommunityImporter.ImportMediaAsync(
            [Pic(1, "a.jpg", approval: 1), Pic(2, "b.jpg", feature: 200, approval: 0)], [], Authors, files, processor, _db, false, TimeProvider.System);

        Assert.Equal(1, report.Added);
        Assert.Equal(1, report.Skipped["not approved, and the same file is already approved elsewhere"]);
        Assert.Equal(100, (await _db.IncidentMedia.SingleAsync()).ContactId);
        Assert.Equal(MediaStatus.Approved, (await _db.MediaAssets.SingleAsync()).Status);
    }

    [Fact]
    public async Task A_dry_run_checks_for_the_files_and_stores_nothing()
    {
        using var processor = Processor();
        var files = new Files(new() { ["a.jpg"] = TestImages.Jpeg() });

        var report = await CommunityImporter.ImportMediaAsync([Pic(1), Pic(2, "gone.jpg")], [], Authors, files, processor, _db, true, TimeProvider.System);

        Assert.Equal((1, 1), (report.Added, report.Skipped["with the file missing"]));
        Assert.Empty(await _db.IncidentMedia.ToListAsync());
        Assert.Empty(await _db.Users.ToListAsync());
        Assert.Empty(Directory.GetFiles(Path.Combine(_dir, "media"), "*.jpg", SearchOption.AllDirectories));
    }

    [Fact]
    public void The_folder_reader_never_opens_anything_outside_its_folder()
    {
        var root = Path.Combine(_dir, "uploads");
        Directory.CreateDirectory(Path.Combine(root, "2011"));
        File.WriteAllText(Path.Combine(root, "2011", "a.jpg"), "x");
        File.WriteAllText(Path.Combine(_dir, "secret.txt"), "secret");
        var files = new DirectoryFiles(root);

        using (var ok = files.Open("2011/a.jpg"))
        {
            Assert.NotNull(ok);
        }

        using (var backslashes = files.Open(@"2011\a.jpg"))
        {
            Assert.NotNull(backslashes);
        }

        Assert.Null(files.Open("../secret.txt"));
        Assert.Null(files.Open(@"..\secret.txt"));
        Assert.Null(files.Open(Path.Combine(_dir, "secret.txt")));
        Assert.Null(files.Open("2011"));
        Assert.Null(files.Open("nothing.jpg"));
    }
}
