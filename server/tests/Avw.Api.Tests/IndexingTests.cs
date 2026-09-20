using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Avw.Data;
using Avw.Data.Entities;
using Avw.Data.Indexing;
using Avw.Indexing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Avw.Api.Tests;

internal static class IndexingFixtures
{
    public static readonly DateTime T0 = new(2026, 9, 20, 10, 0, 0, DateTimeKind.Utc);

    public static AvwDbContext Db(bool indexing = true) =>
        new(new DbContextOptionsBuilder<AvwDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, new IndexingSwitch(indexing));

    public static IncidentNote Note(int contact = 2, int? legacyId = null, int versions = 1, ModerationStatus status = ModerationStatus.Approved, int? approved = 1, long? authorId = 7)
    {
        var note = new IncidentNote
        {
            ContactId = contact, LegacyId = legacyId, AuthorId = authorId, AuthorName = "Ann Member", Status = status, LatestVersionNo = versions, ApprovedVersionNo = approved,
            CreatedUtc = T0, UpdatedUtc = T0.AddHours(1),
        };
        for (var v = 1; v <= versions; v++)
        {
            note.Versions.Add(new IncidentNoteVersion { VersionNo = v, Title = $"Title {v}", Body = $"Body {v}", EditedById = 7 + v, EditedByName = "Ed", CreatedUtc = T0.AddMinutes(v) });
        }

        return note;
    }

    public static MediaAsset Asset(string sha = "ab", MediaStatus status = MediaStatus.Approved, string? caption = "A patrol", string? credit = "AWM") =>
        new() { Sha256 = sha.PadRight(64, '0'), Width = 800, Height = 600, ByteSize = 12345, ContentType = "image/jpeg", Caption = caption, Credit = credit, Status = status, UploadedById = 7, CreatedUtc = T0 };

    public static IncidentMedia Link(MediaAsset asset, int? contact = 2, int? legacyId = null, double? lat = 10.5, double? lon = 107.2) =>
        new() { Media = asset, ContactId = contact, LegacyId = legacyId, Lat = lat, Lon = lon, DateTaken = new DateOnly(1966, 8, 18), CreatedUtc = T0 };

    public sealed class Time(DateTime now) : TimeProvider
    {
        public DateTime Now { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => new(Now, TimeSpan.Zero);
    }
}

public class IndexOutboxTests
{
    private static Task<List<IndexOutboxItem>> Rows(AvwDbContext db) => db.IndexOutbox.AsNoTracking().OrderBy(r => r.Id).ToListAsync();

    [Fact]
    public async Task A_new_note_queues_itself_once_under_its_real_id_however_many_rows_made_it()
    {
        var db = IndexingFixtures.Db();
        var note = IndexingFixtures.Note(versions: 2);

        db.Notes.Add(note);
        await db.SaveChangesAsync();

        var row = Assert.Single(await Rows(db));
        Assert.Equal((IndexKind.Note, note.Id, 0L, 0), (row.Kind, row.EntityId, row.EsId, row.Attempts));
        Assert.NotEqual(0, note.Id);
    }

    [Fact]
    public async Task A_new_version_a_moderation_and_no_change_at_all()
    {
        var db = IndexingFixtures.Db();
        var note = IndexingFixtures.Note();
        db.Notes.Add(note);
        await db.SaveChangesAsync();
        db.IndexOutbox.RemoveRange(db.IndexOutbox);
        await db.SaveChangesAsync();

        await db.SaveChangesAsync();                                                       // nothing changed
        Assert.Empty(await Rows(db));

        note.LatestVersionNo = 2;
        note.Versions.Add(new IncidentNoteVersion { VersionNo = 2, Title = "T", Body = "B", CreatedUtc = IndexingFixtures.T0 });
        await db.SaveChangesAsync();
        Assert.Equal(IndexKind.Note, Assert.Single(await Rows(db)).Kind);

        db.IndexOutbox.RemoveRange(db.IndexOutbox);
        await db.SaveChangesAsync();
        note.Status = ModerationStatus.Rejected;
        await db.SaveChangesAsync();
        Assert.Equal(note.Id, Assert.Single(await Rows(db)).EntityId);
    }

    [Fact]
    public async Task A_comment_alone_is_not_indexed()
    {
        var db = IndexingFixtures.Db();
        var note = IndexingFixtures.Note();
        db.Notes.Add(note);
        await db.SaveChangesAsync();
        db.IndexOutbox.RemoveRange(db.IndexOutbox);
        await db.SaveChangesAsync();

        db.NoteComments.Add(new NoteComment { NoteId = note.Id, AuthorName = "Bo", Body = "Well said", CreatedUtc = IndexingFixtures.T0 });
        await db.SaveChangesAsync();

        Assert.Empty(await Rows(db));
    }

    [Theory]
    [InlineData(77, 77L)]                     // migrated: the old site's id is the document's id
    [InlineData(null, 0L)]                    // new: its own id, filled in below
    public async Task Deleting_a_note_writes_down_the_id_of_the_document_to_remove(int? legacyId, long expectedEsId)
    {
        var db = IndexingFixtures.Db();
        var note = IndexingFixtures.Note(legacyId: legacyId);
        db.Notes.Add(note);
        await db.SaveChangesAsync();
        db.IndexOutbox.RemoveRange(db.IndexOutbox);
        await db.SaveChangesAsync();
        var id = note.Id;

        db.Notes.Remove(note);
        await db.SaveChangesAsync();

        var row = Assert.Single(await Rows(db));
        Assert.Equal((IndexKind.Note, id, expectedEsId == 0 ? id : expectedEsId), (row.Kind, row.EntityId, row.EsId));
    }

    [Fact]
    public async Task Attaching_and_removing_a_picture_queue_it_and_a_changed_file_queues_the_file()
    {
        var db = IndexingFixtures.Db();
        var asset = IndexingFixtures.Asset();
        db.MediaAssets.Add(asset);
        await db.SaveChangesAsync();
        Assert.Empty(await Rows(db));                                                      // a file with nowhere to be shown has no document

        var link = IndexingFixtures.Link(asset, legacyId: 55);
        db.IncidentMedia.Add(link);
        await db.SaveChangesAsync();
        var added = Assert.Single(await Rows(db));
        Assert.Equal((IndexKind.Media, link.Id), (added.Kind, added.EntityId));

        db.IndexOutbox.RemoveRange(db.IndexOutbox);
        await db.SaveChangesAsync();
        asset.Status = MediaStatus.Rejected;
        await db.SaveChangesAsync();
        var file = Assert.Single(await Rows(db));
        Assert.Equal((IndexKind.MediaAsset, asset.Id), (file.Kind, file.EntityId));

        db.IndexOutbox.RemoveRange(db.IndexOutbox);
        await db.SaveChangesAsync();
        db.IncidentMedia.Remove(link);
        await db.SaveChangesAsync();
        var removed = Assert.Single(await Rows(db));
        Assert.Equal((IndexKind.Media, link.Id, 55L), (removed.Kind, removed.EntityId, removed.EsId));
    }

    [Fact]
    public async Task Linking_old_content_to_a_returning_member_and_counting_a_like_do_not_stir_the_index()
    {
        var db = IndexingFixtures.Db();
        var note = IndexingFixtures.Note(legacyId: 77, authorId: null);
        var link = IndexingFixtures.Link(IndexingFixtures.Asset(), legacyId: 55);
        db.Notes.Add(note);
        db.IncidentMedia.Add(link);
        await db.SaveChangesAsync();
        db.IndexOutbox.RemoveRange(db.IndexOutbox);
        await db.SaveChangesAsync();

        note.AuthorId = 9;                                                                 // what LegacyContentLinker does on sign-in
        note.AuthorEmailHash = new string('a', 64);
        link.AttachedById = 9;
        link.LegacyLikes = 4;
        await db.SaveChangesAsync();

        Assert.Empty(await Rows(db));

        link.Lat = 11.0;                                                                   // but moving a picture does
        await db.SaveChangesAsync();
        Assert.Single(await Rows(db));
    }

    [Fact]
    public async Task Several_changes_to_one_thing_in_one_save_make_one_row()
    {
        var db = IndexingFixtures.Db();
        var note = IndexingFixtures.Note();
        db.Notes.Add(note);
        await db.SaveChangesAsync();
        db.IndexOutbox.RemoveRange(db.IndexOutbox);
        await db.SaveChangesAsync();

        note.Status = ModerationStatus.Approved;
        note.UpdatedUtc = IndexingFixtures.T0.AddDays(1);
        note.Versions.Add(new IncidentNoteVersion { VersionNo = 2, Title = "T", Body = "B", CreatedUtc = IndexingFixtures.T0 });
        await db.SaveChangesAsync();

        Assert.Single(await Rows(db));
    }

    [Fact]
    public async Task Nothing_is_queued_while_indexing_is_off_and_the_outbox_itself_never_queues_anything()
    {
        var off = IndexingFixtures.Db(indexing: false);
        off.Notes.Add(IndexingFixtures.Note());
        await off.SaveChangesAsync();
        Assert.Empty(await Rows(off));

        var on = IndexingFixtures.Db();
        on.IndexOutbox.Add(new IndexOutboxItem { Kind = IndexKind.Note, EntityId = 1, CreatedUtc = IndexingFixtures.T0, NextAttemptUtc = IndexingFixtures.T0 });
        await on.SaveChangesAsync();
        Assert.Single(await Rows(on));                                                     // saving an outbox row does not add another
    }

    [Fact]
    public void Migrated_content_keeps_the_old_sites_id_and_new_content_takes_its_own()
    {
        Assert.Equal(77, IndexIds.Of(5, 77));
        Assert.Equal(5, IndexIds.Of(5, null));
        Assert.True(IndexIds.FirstNewId > 10_000);
    }
}

public class IndexDocumentTests
{
    private static string Str(JsonObject o, string key) => o[key]!.ToString();

    [Fact]
    public void A_new_approved_note_carries_its_words_author_editor_and_place()
    {
        var note = IndexingFixtures.Note(contact: 9);

        var doc = IndexDocuments.Note(note, (10.5, 107.2));

        Assert.Equal(("9", "Title 1", "Body 1", "1"), (Str(doc, "IncidentId"), Str(doc, "Title"), Str(doc, "Body"), Str(doc, "ApprovalStatus")));
        Assert.Equal(("2026-09-20T10:00:00Z", "2026-09-20T11:00:00Z"), (Str(doc, "Created"), Str(doc, "Modified")));
        Assert.Equal(("7", "Ann Member"), (Str(doc["Author"]!.AsObject(), "Id"), Str(doc["Author"]!.AsObject(), "Name")));
        Assert.Equal("8", Str(doc, "Editor"));
        Assert.Equal((10.5, 107.2), (doc["Location"]!["lat"]!.GetValue<double>(), doc["Location"]!["lon"]!.GetValue<double>()));
    }

    [Theory]
    [InlineData(ModerationStatus.Pending, "-1")]
    [InlineData(ModerationStatus.Rejected, "0")]
    public void A_note_never_approved_shows_its_newest_words_with_the_old_sites_waiting_or_rejected_value(ModerationStatus status, string expected)
    {
        var doc = IndexDocuments.Note(IndexingFixtures.Note(versions: 2, status: status, approved: null), null);

        Assert.Equal((expected, "Title 2"), (Str(doc, "ApprovalStatus"), Str(doc, "Title")));
        Assert.Null(doc["Location"]);
    }

    [Fact]
    public void An_edit_waiting_for_a_moderator_is_not_shown_and_the_note_stays_approved()
    {
        var doc = IndexDocuments.Note(IndexingFixtures.Note(versions: 3, status: ModerationStatus.Pending, approved: 2), null);

        Assert.Equal(("Title 2", "1"), (Str(doc, "Title"), Str(doc, "ApprovalStatus")));
    }

    [Fact]
    public void A_migrated_note_sends_only_what_this_site_owns_so_the_old_fields_are_left_alone()
    {
        var doc = IndexDocuments.Note(IndexingFixtures.Note(legacyId: 77), (10.5, 107.2));

        Assert.Equal(["IncidentId", "Title", "Body", "Created", "Modified", "ApprovalStatus"], doc.Select(p => p.Key));
    }

    [Fact]
    public void An_approved_new_picture_describes_the_file_where_it_is_and_who_added_it()
    {
        var asset = IndexingFixtures.Asset("cd");
        var doc = IndexDocuments.Media(IndexingFixtures.Link(asset), asset, "Ann Member", IndexingFixtures.T0.AddDays(2))!;

        Assert.Equal(($"{asset.Sha256}.jpg", "jpg", "image/jpeg", $"/media/cd/{asset.Sha256}.jpg", "12345"), (Str(doc, "FileName"), Str(doc, "FileExtension"), Str(doc, "MimeType"), Str(doc, "Path"), Str(doc, "Size")));
        Assert.Equal(("2", "A patrol", "AWM", "1966-08-18"), (Str(doc, "FeatureId"), Str(doc, "Description"), Str(doc, "Attribution"), Str(doc, "DateTaken")));
        Assert.Equal((10.5, 107.2), (doc["Location"]!["lat"]!.GetValue<double>(), doc["Location"]!["lon"]!.GetValue<double>()));
        Assert.Equal(("2026-09-20T10:00:00Z", "2026-09-22T10:00:00Z"), (Str(doc, "Created"), Str(doc, "Modified")));
        Assert.Equal(("7", "Ann Member"), (Str(doc["Author"]!.AsObject(), "Id"), Str(doc["Author"]!.AsObject(), "Name")));
    }

    [Theory]
    [InlineData(MediaStatus.Pending)]
    [InlineData(MediaStatus.Rejected)]
    public void A_picture_that_is_not_approved_has_no_document(MediaStatus status)
    {
        var asset = IndexingFixtures.Asset(status: status);

        Assert.Null(IndexDocuments.Media(IndexingFixtures.Link(asset), asset, "Ann", IndexingFixtures.T0));
    }

    [Fact]
    public void A_migrated_picture_sends_only_caption_credit_incident_place_and_date_and_a_place_less_one_sends_no_place()
    {
        var asset = IndexingFixtures.Asset();
        var migrated = IndexDocuments.Media(IndexingFixtures.Link(asset, legacyId: 55, contact: null, lat: null, lon: null), asset, "Ann", IndexingFixtures.T0)!;

        Assert.Equal(["Description", "Attribution", "Modified", "DateTaken"], migrated.Select(p => p.Key));
    }

    [Fact]
    public void A_cleared_caption_is_sent_as_null_so_it_is_cleared_in_the_index_too()
    {
        var asset = IndexingFixtures.Asset(caption: null, credit: null);

        var doc = IndexDocuments.Media(IndexingFixtures.Link(asset), asset, null, IndexingFixtures.T0)!;

        Assert.True(doc.ContainsKey("Description"));
        Assert.Null(doc["Description"]);
    }
}

public class ElasticsearchWriterTests
{
    private sealed class Stub(HttpStatusCode status, string response) : HttpMessageHandler
    {
        public string? Body { get; private set; }
        public HttpRequestMessage? Request { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Request = request;
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(status) { Content = new StringContent(response, Encoding.UTF8, "application/json") };
        }
    }

    private static readonly IndexOperation[] TwoOps =
    [
        IndexOperation.Upsert("avw_incident_notes", 100001, new JsonObject { ["Title"] = "T" }),
        IndexOperation.Delete("avw_incident_media", 77),
    ];

    [Fact]
    public void The_body_has_an_action_line_then_the_fields_for_a_change_and_one_line_for_a_removal()
    {
        var lines = ElasticsearchWriter.Body(TwoOps).TrimEnd('\n').Split('\n');

        Assert.Equal(3, lines.Length);
        Assert.Equal("""{"update":{"_index":"avw_incident_notes","_id":"100001"}}""", lines[0]);
        Assert.Equal("""{"doc":{"Title":"T"},"doc_as_upsert":true}""", lines[1]);
        Assert.Equal("""{"delete":{"_index":"avw_incident_media","_id":"77"}}""", lines[2]);
    }

    [Fact]
    public async Task Posts_the_body_as_ndjson_to_the_bulk_address()
    {
        var stub = new Stub(HttpStatusCode.OK, """{"errors":false,"items":[{"update":{"status":201}},{"delete":{"status":200}}]}""");

        var results = await new ElasticsearchWriter(new HttpClient(stub) { BaseAddress = new Uri("http://es.test/") }).WriteAsync(TwoOps, default);

        Assert.Equal("http://es.test/_bulk", stub.Request!.RequestUri!.ToString());
        Assert.Equal("application/x-ndjson", stub.Request.Content!.Headers.ContentType!.MediaType);
        Assert.All(results, r => Assert.True(r.Done));
    }

    [Fact]
    public async Task Sends_nothing_for_no_operations()
    {
        var stub = new Stub(HttpStatusCode.OK, "{}");

        Assert.Empty(await new ElasticsearchWriter(new HttpClient(stub) { BaseAddress = new Uri("http://es.test/") }).WriteAsync([], default));
        Assert.Null(stub.Request);
    }

    [Fact]
    public void Reads_each_answer_separately_removing_a_missing_document_is_fine_busy_is_worth_another_try_and_a_bad_document_is_not()
    {
        const string answer = """
            {"errors":true,"items":[
              {"update":{"status":200}},
              {"delete":{"status":404}},
              {"update":{"status":429,"error":{"type":"es_rejected_execution_exception","reason":"queue full"}}},
              {"update":{"status":503,"error":"unavailable"}},
              {"update":{"status":400,"error":{"type":"mapper_parsing_exception","reason":"failed to parse field [Created]"}}}
            ]}
            """;

        var r = ElasticsearchWriter.Results(answer, 5);

        Assert.Equal([true, true, false, false, false], r.Select(x => x.Done));
        Assert.Equal([false, false, true, true, false], r.Select(x => x.Retry));
        Assert.Contains("queue full", r[2].Error);
        Assert.Equal("unavailable", r[3].Error);
        Assert.Contains("mapper_parsing_exception", r[4].Error);
    }

    [Fact]
    public void A_missing_document_is_only_forgiven_for_a_removal()
    {
        var r = ElasticsearchWriter.Results("""{"items":[{"update":{"status":404,"error":{"type":"document_missing_exception","reason":"x"}}}]}""", 1);

        Assert.False(r[0].Done);
    }

    [Fact]
    public async Task A_refused_request_or_an_answer_that_does_not_match_throws_so_everything_is_tried_again()
    {
        var refused = new ElasticsearchWriter(new HttpClient(new Stub(HttpStatusCode.Unauthorized, """{"error":"unable to authenticate"}""")) { BaseAddress = new Uri("http://es.test/") });
        var ex = await Assert.ThrowsAsync<HttpRequestException>(() => refused.WriteAsync(TwoOps, default));
        Assert.Contains("401", ex.Message);

        var short_ = new ElasticsearchWriter(new HttpClient(new Stub(HttpStatusCode.OK, """{"items":[{"update":{"status":200}}]}""")) { BaseAddress = new Uri("http://es.test/") });
        await Assert.ThrowsAsync<HttpRequestException>(() => short_.WriteAsync(TwoOps, default));
    }
}

public class IndexProcessorTests
{
    private sealed class FakeWriter : IIndexWriter
    {
        public List<List<IndexOperation>> Batches { get; } = [];
        public Func<IndexOperation, IndexResult> Answer { get; set; } = _ => IndexResult.Ok;
        public Exception? Throw { get; set; }

        public IEnumerable<IndexOperation> All => Batches.SelectMany(b => b);

        public Task<IReadOnlyList<IndexResult>> WriteAsync(IReadOnlyList<IndexOperation> operations, CancellationToken ct)
        {
            if (Throw is not null)
            {
                throw Throw;
            }

            Batches.Add([.. operations]);
            return Task.FromResult<IReadOnlyList<IndexResult>>([.. operations.Select(Answer)]);
        }
    }

    private sealed class FakeLocations(Dictionary<int, (double, double)>? known = null) : IContactLocations
    {
        public List<int> Asked { get; } = [];

        public Task<(double Lat, double Lon)?> FindAsync(int contactId, CancellationToken ct)
        {
            Asked.Add(contactId);
            return Task.FromResult<(double, double)?>(known is not null && known.TryGetValue(contactId, out var p) ? p : null);
        }
    }

    private sealed record Fixture(AvwDbContext Db, FakeWriter Writer, FakeLocations Locations, IndexingFixtures.Time Time, IndexProcessor Processor)
    {
        public Task<IndexRun> Run() => Processor.RunOnceAsync(Db, default);
        public Task<List<IndexOutboxItem>> Rows() => Db.IndexOutbox.AsNoTracking().OrderBy(r => r.Id).ToListAsync();
    }

    private static Fixture Make(int batch = 200, int maxAttempts = 12, Dictionary<int, (double, double)>? places = null)
    {
        var writer = new FakeWriter();
        var locations = new FakeLocations(places);
        var time = new IndexingFixtures.Time(IndexingFixtures.T0);
        var db = IndexingFixtures.Db();
        db.Users.Add(new AppUser { Id = 7, Subject = "s7", DisplayName = "Ann Member" });        // pictures belong to someone, as they must in a real database
        db.SaveChanges();
        var options = Options.Create(new IndexingOptions { BatchSize = batch, MaxAttempts = maxAttempts });
        return new Fixture(db, writer, locations, time, new IndexProcessor(writer, locations, options, time, NullLogger<IndexProcessor>.Instance));
    }

    [Fact]
    public async Task Writes_a_new_note_under_its_own_id_with_its_place_and_clears_its_row()
    {
        var f = Make(places: new() { [2] = (10.5, 107.2) });
        var note = IndexingFixtures.Note();
        f.Db.Notes.Add(note);
        await f.Db.SaveChangesAsync();

        var run = await f.Run();

        Assert.Equal((1, 1, 0, 0, 0), (run.Rows, run.Written, run.Removed, run.Retrying, run.Failed));
        var op = Assert.Single(f.Writer.All);
        Assert.Equal(("avw_incident_notes", note.Id, false), (op.Index, op.Id, op.IsDelete));
        Assert.Equal(10.5, op.Fields!["Location"]!["lat"]!.GetValue<double>());
        Assert.Empty(await f.Rows());
        Assert.Equal((await f.Run()).Rows, 0);                                              // nothing left to do
    }

    [Fact]
    public async Task A_migrated_note_uses_the_old_sites_id_and_is_not_placed()
    {
        var f = Make(places: new() { [2] = (10.5, 107.2) });
        f.Db.Notes.Add(IndexingFixtures.Note(legacyId: 77));
        await f.Db.SaveChangesAsync();

        await f.Run();

        var op = Assert.Single(f.Writer.All);
        Assert.Equal(77, op.Id);
        Assert.False(op.Fields!.ContainsKey("Location"));
        Assert.Empty(f.Locations.Asked);
    }

    [Fact]
    public async Task A_note_whose_place_cannot_be_found_is_still_indexed()
    {
        var f = Make();
        f.Db.Notes.Add(IndexingFixtures.Note(contact: 404));
        await f.Db.SaveChangesAsync();

        await f.Run();

        var op = Assert.Single(f.Writer.All);
        Assert.False(op.Fields!.ContainsKey("Location"));
        Assert.Equal([404], f.Locations.Asked);
    }

    [Fact]
    public async Task Many_changes_to_one_note_cost_one_write_of_how_it_is_now()
    {
        var f = Make();
        var note = IndexingFixtures.Note();
        f.Db.Notes.Add(note);
        await f.Db.SaveChangesAsync();
        for (var i = 0; i < 3; i++)
        {
            note.UpdatedUtc = IndexingFixtures.T0.AddDays(i + 1);
            await f.Db.SaveChangesAsync();
        }

        Assert.Equal(4, (await f.Rows()).Count);
        var run = await f.Run();

        Assert.Equal((4, 1), (run.Rows, run.Written));
        Assert.Equal("2026-09-23T11:00:00Z", Assert.Single(f.Writer.All).Fields!["Modified"]!.ToString().Replace("10:00", "11:00"));
        Assert.Empty(await f.Rows());
    }

    [Fact]
    public async Task A_deleted_note_is_removed_by_the_id_written_down_and_one_with_no_known_id_is_just_forgotten()
    {
        var f = Make();
        var migrated = IndexingFixtures.Note(legacyId: 77);
        f.Db.Notes.Add(migrated);
        await f.Db.SaveChangesAsync();
        f.Db.IndexOutbox.RemoveRange(f.Db.IndexOutbox);
        await f.Db.SaveChangesAsync();
        f.Db.Notes.Remove(migrated);
        await f.Db.SaveChangesAsync();
        f.Db.IndexOutbox.Add(new IndexOutboxItem { Kind = IndexKind.Note, EntityId = 9999, EsId = 0, CreatedUtc = IndexingFixtures.T0, NextAttemptUtc = DateTime.UnixEpoch });
        await f.Db.SaveChangesAsync();

        var run = await f.Run();

        var op = Assert.Single(f.Writer.All);
        Assert.Equal((77, true), (op.Id, op.IsDelete));
        Assert.Equal((2, 0, 1), (run.Rows, run.Written, run.Removed));
        Assert.Empty(await f.Rows());
    }

    [Fact]
    public async Task Only_approved_pictures_are_written_and_one_that_stops_being_approved_is_removed()
    {
        var f = Make();
        var approved = IndexingFixtures.Asset("aa");
        var pending = IndexingFixtures.Asset("bb", MediaStatus.Pending);
        var link = IndexingFixtures.Link(approved);
        f.Db.IncidentMedia.AddRange(link, IndexingFixtures.Link(pending));
        await f.Db.SaveChangesAsync();
        await f.Run();
        Assert.Equal([false, true], f.Writer.All.Select(o => o.IsDelete).OrderBy(x => x));       // one written, one (never there) removed

        f.Writer.Batches.Clear();
        approved.Status = MediaStatus.Rejected;
        await f.Db.SaveChangesAsync();
        await f.Run();

        var op = Assert.Single(f.Writer.All);
        Assert.Equal(("avw_incident_media", link.Id, true), (op.Index, op.Id, op.IsDelete));
    }

    [Fact]
    public async Task A_changed_file_rewrites_every_place_it_is_attached_and_a_file_attached_nowhere_is_ignored()
    {
        var f = Make();
        var shared = IndexingFixtures.Asset("cc");
        var one = IndexingFixtures.Link(shared, contact: 2);
        var two = IndexingFixtures.Link(shared, contact: null, legacyId: 55);
        var lonely = IndexingFixtures.Asset("dd");
        f.Db.IncidentMedia.AddRange(one, two);
        f.Db.MediaAssets.Add(lonely);
        await f.Db.SaveChangesAsync();
        await f.Run();
        f.Writer.Batches.Clear();

        shared.Caption = "A new caption";
        lonely.Caption = "Nobody sees this";
        await f.Db.SaveChangesAsync();
        var run = await f.Run();

        Assert.Equal(2, run.Rows);
        Assert.Equal([one.Id, 55], f.Writer.All.Select(o => o.Id).Order());
        Assert.All(f.Writer.All, o => Assert.Equal("A new caption", o.Fields!["Description"]!.ToString()));
        Assert.Empty(await f.Rows());
    }

    [Fact]
    public async Task A_failure_that_may_pass_waits_ten_seconds_then_longer_and_is_not_tried_early()
    {
        var f = Make();
        f.Db.Notes.Add(IndexingFixtures.Note());
        await f.Db.SaveChangesAsync();
        f.Writer.Answer = _ => new IndexResult(false, true, "es_rejected_execution_exception: queue full");

        var first = await f.Run();

        Assert.Equal((1, 1, 0), (first.Rows, first.Retrying, first.Failed));
        var row = Assert.Single(await f.Rows());
        Assert.Equal((1, IndexingFixtures.T0.AddSeconds(10)), (row.Attempts, row.NextAttemptUtc));
        Assert.Contains("queue full", row.LastError);

        f.Time.Now = IndexingFixtures.T0.AddSeconds(5);
        Assert.Equal(0, (await f.Run()).Rows);                                              // not due yet

        f.Time.Now = IndexingFixtures.T0.AddSeconds(11);
        f.Writer.Answer = _ => IndexResult.Ok;
        var again = await f.Run();
        Assert.Equal((1, 1), (again.Rows, again.Written));
        Assert.Empty(await f.Rows());
    }

    [Fact]
    public void The_wait_doubles_each_time_up_to_an_hour()
    {
        Assert.Equal([10, 20, 40, 80, 160, 320, 640, 1280, 2560, 3600, 3600], Enumerable.Range(1, 11).Select(n => (int)IndexProcessor.Backoff(n).TotalSeconds));
    }

    [Fact]
    public async Task A_document_elasticsearch_refuses_for_good_is_set_aside_at_once_and_left_for_someone_to_see()
    {
        var f = Make();
        f.Db.Notes.Add(IndexingFixtures.Note());
        await f.Db.SaveChangesAsync();
        f.Writer.Answer = _ => new IndexResult(false, false, "mapper_parsing_exception: failed to parse field [Created]");

        var run = await f.Run();

        Assert.Equal((0, 1), (run.Retrying, run.Failed));
        var row = Assert.Single(await f.Rows());
        Assert.NotNull(row.FailedUtc);
        f.Time.Now = IndexingFixtures.T0.AddDays(1);
        Assert.Equal(0, (await f.Run()).Rows);                                              // never picked up again by itself
    }

    [Fact]
    public async Task Elasticsearch_being_down_puts_every_row_off_for_later_and_a_row_that_keeps_failing_is_eventually_set_aside()
    {
        var f = Make(maxAttempts: 3);
        f.Db.Notes.AddRange(IndexingFixtures.Note(contact: 1), IndexingFixtures.Note(contact: 2));
        await f.Db.SaveChangesAsync();
        f.Writer.Throw = new HttpRequestException("connection refused");

        var first = await f.Run();
        Assert.Equal((2, 2, 0), (first.Rows, first.Retrying, first.Failed));

        f.Time.Now = IndexingFixtures.T0.AddMinutes(1);
        await f.Run();
        f.Time.Now = IndexingFixtures.T0.AddMinutes(10);
        var last = await f.Run();

        Assert.Equal((2, 0, 2), (last.Rows, last.Retrying, last.Failed));
        Assert.All(await f.Rows(), r => Assert.Equal((3, true), (r.Attempts, r.FailedUtc is not null)));
    }

    [Fact]
    public async Task Sends_in_batches_of_the_configured_size_and_works_through_the_oldest_first()
    {
        var f = Make(batch: 2);
        f.Db.Notes.AddRange(Enumerable.Range(1, 5).Select(i => IndexingFixtures.Note(contact: i)));
        await f.Db.SaveChangesAsync();

        var run = await f.Run();

        Assert.Equal(2, run.Rows);
        Assert.Equal(3, (await f.Rows()).Count);                                            // the rest wait for the next pass
        Assert.Equal([1L, 2L], f.Writer.All.Select(o => o.Id));
    }
}

public class ReindexTests
{
    [Fact]
    public async Task Queues_new_notes_and_pictures_and_leaves_migrated_ones_unless_asked()
    {
        var db = IndexingFixtures.Db(indexing: false);
        db.Notes.AddRange(IndexingFixtures.Note(), IndexingFixtures.Note(legacyId: 77));
        db.IncidentMedia.AddRange(IndexingFixtures.Link(IndexingFixtures.Asset("aa")), IndexingFixtures.Link(IndexingFixtures.Asset("bb"), legacyId: 55));
        await db.SaveChangesAsync();

        var dry = await Reindex.QueueAsync(db, includeMigrated: false, dryRun: true);
        Assert.Equal((1, 1), (dry.Notes, dry.Media));
        Assert.Empty(db.IndexOutbox);

        var normal = await Reindex.QueueAsync(db, includeMigrated: false, dryRun: false);
        Assert.Equal((1, 1, 0), (normal.Notes, normal.Media, normal.AlreadyWaiting));
        Assert.Equal(2, await db.IndexOutbox.CountAsync());

        var all = await Reindex.QueueAsync(db, includeMigrated: true, dryRun: false);
        Assert.Equal((1, 1, 2), (all.Notes, all.Media, all.AlreadyWaiting));               // the two already waiting are not queued twice
        var migratedRow = await db.IndexOutbox.SingleAsync(r => r.EsId == 77);
        Assert.Equal(IndexKind.Note, migratedRow.Kind);
    }
}

public sealed class IndexingEndpointTests : IDisposable
{
    private readonly ApiFactory _on = new() { Extra = { ["Indexing:Enabled"] = "true" } };
    private readonly ApiFactory _off = new();

    public void Dispose()
    {
        _on.Dispose();
        _off.Dispose();
    }

    private static async Task<HttpStatusCode> AddNote(ApiFactory factory)
    {
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AvwDbContext>();
            db.Users.Add(new AppUser { Id = 1, Subject = "a", DisplayName = "Ann Member" });
            await db.SaveChangesAsync();
        }

        var req = new HttpRequestMessage(HttpMethod.Post, "/api/contacts/2/notes") { Content = JsonContent.Create(new { title = "Ambush site", body = "Claymores were sited along the track." }) };
        req.Headers.Add("X-Test-User", "Ann Member");
        req.Headers.Add("X-Test-Uid", "1");
        req.Headers.Add("X-Test-Roles", "member");
        req.Headers.Add("X-Requested-With", "avw");
        return (await factory.CreateClient().SendAsync(req)).StatusCode;
    }

    private static int Queued(ApiFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<AvwDbContext>().IndexOutbox.Count(r => r.Kind == IndexKind.Note);
    }

    [Fact]
    public async Task A_note_written_through_the_api_is_queued_for_the_index_when_indexing_is_on()
    {
        Assert.Equal(HttpStatusCode.Created, await AddNote(_on));

        Assert.Equal(1, Queued(_on));
    }

    [Fact]
    public async Task Nothing_is_queued_when_indexing_is_off_which_is_the_default()
    {
        Assert.Equal(HttpStatusCode.Created, await AddNote(_off));

        Assert.Equal(0, Queued(_off));
    }
}
