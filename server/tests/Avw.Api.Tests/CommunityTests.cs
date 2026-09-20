using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Avw.Api.Cms;
using Avw.Api.Community;
using Avw.Api.Map;
using Avw.Api.Media;
using Avw.Data;
using Avw.Data.Entities;
using ImageMagick;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Avw.Api.Tests;

public sealed class FakeHonourRoll : IHonourRollSource
{
    public List<HonourSummary> People { get; } =
    [
        new("5715978", "James Mungo White", "Private", "Royal Australian Infantry Corps", new(1947, 9, 10), new(1969, 4, 4), 21, null),
        new("39426", "Robert Maxwell Grist", "Sapper", "Royal Australian Engineers", new(1948, 8, 28), new(1968, 2, 1), 19, "/media/portraits/39426.jpg"),
    ];

    public Task<HonourPage> SearchAsync(string? text, int page, int pageSize, CancellationToken ct)
    {
        var found = People.Where(p => string.IsNullOrWhiteSpace(text) || p.Name.Contains(text, StringComparison.OrdinalIgnoreCase) || p.ServiceNumber == text).ToList();
        return Task.FromResult(new HonourPage(found.Skip((page - 1) * pageSize).Take(pageSize).ToList(), found.Count, page, pageSize));
    }

    public Task<HonourPerson?> GetAsync(string serviceNumber, CancellationToken ct)
    {
        var p = People.FirstOrDefault(x => x.ServiceNumber == serviceNumber);
        return Task.FromResult(p is null ? null : new HonourPerson(p.ServiceNumber, p.Name, p.Rank, p.Branch, p.Birth, p.Death, p.AgeAtDeath, p.PortraitUrl,
            "COLLIE", "WESTERN AUSTRALIA", "AUSTRALIA", true, [new HonourTour("5th Battalion, The Royal Australian Regiment", "05/02/1969", "04/04/1969")], [], 0));
    }

    public Task<IReadOnlyList<HonourSummary>> GetManyAsync(IReadOnlyCollection<string> serviceNumbers, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<HonourSummary>>(People.Where(p => serviceNumbers.Contains(p.ServiceNumber)).ToList());
}

public sealed class CommunityEndpointTests : IDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };
    private readonly RecordingNotifier _notifier = new();
    private readonly FakeHonourRoll _roll = new();
    private readonly ApiFactory _factory;

    public CommunityEndpointTests() => _factory = new ApiFactory
    {
        Configure = s =>
        {
            s.RemoveAll<INotifier>();
            s.AddSingleton<INotifier>(_notifier);
            s.RemoveAll<IHonourRollSource>();
            s.AddSingleton<IHonourRollSource>(_roll);
        },
    };

    public void Dispose() => _factory.Dispose();

    // ---- helpers

    private HttpClient Http() => _factory.CreateClient(new() { AllowAutoRedirect = false });

    private void Seed()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AvwDbContext>();
        if (db.Users.Any())
        {
            return;
        }

        db.Users.AddRange(
            new AppUser { Id = 1, Subject = "a", DisplayName = "Ann Member" },
            new AppUser { Id = 2, Subject = "b", DisplayName = "Bo Member" },
            new AppUser { Id = 3, Subject = "e", DisplayName = "Ed Editor" });
        db.SaveChanges();
    }

    private HttpRequestMessage Req(HttpMethod method, string url, string? role, long uid, object? body = null, bool csrf = true)
    {
        Seed();
        var req = new HttpRequestMessage(method, url);
        if (role is not null)
        {
            req.Headers.Add("X-Test-User", uid switch { 1 => "Ann Member", 2 => "Bo Member", _ => "Ed Editor" });
            req.Headers.Add("X-Test-Uid", uid.ToString());
            req.Headers.Add("X-Test-Roles", role);
        }

        if (csrf)
        {
            req.Headers.Add("X-Requested-With", "avw");
        }

        if (body is not null)
        {
            req.Content = JsonContent.Create(body, options: Json);
        }

        return req;
    }

    private Task<HttpResponseMessage> Anon(string url) => Http().SendAsync(Req(HttpMethod.Get, url, null, 0));
    private Task<HttpResponseMessage> As(long uid, HttpMethod method, string url, object? body = null) =>
        Http().SendAsync(Req(method, url, uid == 3 ? "editor" : "member", uid, body));

    private static async Task<T> Read<T>(HttpResponseMessage res, HttpStatusCode expected = HttpStatusCode.OK)
    {
        Assert.Equal(expected, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<T>(Json))!;
    }

    // ------------------------------------------------------------ notes

    [Fact]
    public async Task Anyone_can_read_approved_notes_but_writing_needs_a_sign_in_and_the_header()
    {
        Assert.Equal(HttpStatusCode.OK, (await Anon("/api/contacts/2/notes")).StatusCode);
        var anonymous = await Http().SendAsync(Req(HttpMethod.Post, "/api/contacts/2/notes", null, 0, new NoteInput("T", "B")));
        Assert.NotEqual(HttpStatusCode.Created, anonymous.StatusCode);

        var noHeader = await Http().SendAsync(Req(HttpMethod.Post, "/api/contacts/2/notes", "member", 1, new NoteInput("T", "B"), csrf: false));
        Assert.Equal(HttpStatusCode.Forbidden, noHeader.StatusCode);
    }

    [Fact]
    public async Task A_note_goes_through_write_approve_edit_comment_and_delete_over_http()
    {
        var created = await Read<NoteView>(await As(1, HttpMethod.Post, "/api/contacts/2/notes", new NoteInput("Ambush site", "Claymores were sited along the track.")), HttpStatusCode.Created);
        Assert.Equal(ModerationStatus.Pending, created.Status);
        Assert.Empty(await Read<List<NoteView>>(await Anon("/api/contacts/2/notes")));                                 // not public yet
        Assert.Single(await Read<List<NoteView>>(await As(1, HttpMethod.Get, "/api/contacts/2/notes")));                // but its author sees it
        Assert.Single(_notifier.Sent);

        Assert.Equal(HttpStatusCode.Forbidden, (await As(1, HttpMethod.Post, $"/api/notes/{created.Id}/status", new ModerationRequest(ModerationStatus.Approved))).StatusCode);
        Assert.Equal(ModerationStatus.Approved, (await Read<NoteView>(await As(3, HttpMethod.Post, $"/api/notes/{created.Id}/status", new ModerationRequest(ModerationStatus.Approved)))).Status);
        var publicNotes = await Read<List<NoteView>>(await Anon("/api/contacts/2/notes"));
        Assert.Equal("Ambush site", Assert.Single(publicNotes).Title);
        Assert.Equal("no-store", (await Anon("/api/contacts/2/notes")).Headers.CacheControl!.ToString());

        var withComment = await Read<NoteView>(await As(2, HttpMethod.Post, $"/api/notes/{created.Id}/comments", new CommentInput("I remember that track.")), HttpStatusCode.Created);
        Assert.Equal("Bo Member", Assert.Single(withComment.Comments).AuthorName);

        var versions = await Read<List<VersionView>>(await As(1, HttpMethod.Get, $"/api/notes/{created.Id}/versions"));
        Assert.Single(versions);
        Assert.Equal(HttpStatusCode.Forbidden, (await As(2, HttpMethod.Get, $"/api/notes/{created.Id}/versions")).StatusCode);

        Assert.Equal(HttpStatusCode.Forbidden, (await As(2, HttpMethod.Delete, $"/api/notes/{created.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await As(1, HttpMethod.Delete, $"/api/notes/{created.Id}")).StatusCode);
        Assert.Empty(await Read<List<NoteView>>(await Anon("/api/contacts/2/notes")));
    }

    [Fact]
    public async Task Refuses_a_note_on_an_incident_that_does_not_exist_and_bad_note_text()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await As(1, HttpMethod.Post, "/api/contacts/999/notes", new NoteInput("T", "B"))).StatusCode);
        var bad = await As(1, HttpMethod.Post, "/api/contacts/2/notes", new NoteInput("", "B"));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal("title", JsonDocument.Parse(await bad.Content.ReadAsStringAsync()).RootElement.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Only_an_editor_can_close_comments()
    {
        var note = await Read<NoteView>(await As(3, HttpMethod.Post, "/api/contacts/2/notes", new NoteInput("T", "B")), HttpStatusCode.Created);

        Assert.Equal(HttpStatusCode.Forbidden, (await As(1, HttpMethod.Post, $"/api/notes/{note.Id}/comments-open", new CommentsOpenRequest(false))).StatusCode);
        Assert.False((await Read<NoteView>(await As(3, HttpMethod.Post, $"/api/notes/{note.Id}/comments-open", new CommentsOpenRequest(false)))).CommentsOpen);
        Assert.Equal(HttpStatusCode.Forbidden, (await As(2, HttpMethod.Post, $"/api/notes/{note.Id}/comments", new CommentInput("Late"))).StatusCode);
    }

    // ------------------------------------------------------------ pictures

    private HttpRequestMessage UploadRequest(long uid, byte[] bytes, string? role = "member", string? dateTaken = null, string? caption = "A patrol", int contact = 2)
    {
        var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(file, "file", "photo.jpg");
        if (caption is not null)
        {
            form.Add(new StringContent(caption), "caption");
        }

        if (dateTaken is not null)
        {
            form.Add(new StringContent(dateTaken), "dateTaken");
        }

        var req = Req(HttpMethod.Post, $"/api/contacts/{contact}/media", role, uid);
        req.Content = form;
        return req;
    }

    [Fact]
    public async Task A_members_picture_waits_for_approval_then_appears_and_can_be_liked_and_removed()
    {
        var bytes = TestImages.Jpeg();
        var up = await Read<IncidentMediaView>(await Http().SendAsync(UploadRequest(1, bytes, dateTaken: "1966-08-18")), HttpStatusCode.Created);
        Assert.Equal((MediaStatus.Pending, "A patrol", new DateOnly(1966, 8, 18), true), (up.Status, up.Caption, up.DateTaken, up.Mine));
        Assert.Single(_notifier.Sent);

        Assert.Empty(await Read<List<IncidentMediaView>>(await Anon("/api/contacts/2/media")));
        Assert.Single(await Read<List<IncidentMediaView>>(await As(1, HttpMethod.Get, "/api/contacts/2/media")));
        Assert.Empty(await Read<List<IncidentMediaView>>(await As(2, HttpMethod.Get, "/api/contacts/2/media")));
        Assert.Equal(HttpStatusCode.NotFound, (await As(2, HttpMethod.Post, $"/api/incident-media/{up.Id}/like")).StatusCode);       // cannot like what is not public

        var approve = await As(3, HttpMethod.Post, $"/api/studio/media/{up.MediaId}/status", new MediaStatusRequest(MediaStatus.Approved));
        Assert.Equal(HttpStatusCode.OK, approve.StatusCode);
        var shown = Assert.Single(await Read<List<IncidentMediaView>>(await Anon("/api/contacts/2/media")));
        Assert.Equal((0, false, false), (shown.Likes, shown.LikedByMe, shown.Mine));

        var liked = await Read<LikeResult>(await As(2, HttpMethod.Post, $"/api/incident-media/{up.Id}/like"));
        Assert.Equal((1, true), (liked.Likes, liked.Liked));
        Assert.Equal((1, true), (await Read<List<IncidentMediaView>>(await As(2, HttpMethod.Get, "/api/contacts/2/media"))).Select(m => (m.Likes, m.LikedByMe)).Single());
        var unliked = await Read<LikeResult>(await As(2, HttpMethod.Post, $"/api/incident-media/{up.Id}/like"));
        Assert.Equal((0, false), (unliked.Likes, unliked.Liked));

        Assert.Equal(HttpStatusCode.Forbidden, (await As(2, HttpMethod.Delete, $"/api/incident-media/{up.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await As(1, HttpMethod.Delete, $"/api/incident-media/{up.Id}")).StatusCode);
        Assert.Empty(await Read<List<IncidentMediaView>>(await Anon("/api/contacts/2/media")));
    }

    [Fact]
    public async Task An_editors_picture_is_public_at_once_and_a_repeat_upload_is_not_duplicated()
    {
        var bytes = TestImages.Jpeg(640, 480);
        var first = await Read<IncidentMediaView>(await Http().SendAsync(UploadRequest(3, bytes, "editor")), HttpStatusCode.Created);
        var again = await Read<IncidentMediaView>(await Http().SendAsync(UploadRequest(3, bytes, "editor")), HttpStatusCode.Created);

        Assert.Equal(MediaStatus.Approved, first.Status);
        Assert.Equal(first.Id, again.Id);
        Assert.Single(await Read<List<IncidentMediaView>>(await Anon("/api/contacts/2/media")));
        Assert.Empty(_notifier.Sent);
    }

    [Fact]
    public async Task Refuses_pictures_for_a_missing_incident_a_bad_date_or_a_non_picture()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await Http().SendAsync(UploadRequest(1, TestImages.Jpeg(), contact: 999))).StatusCode);

        var badDate = await Http().SendAsync(UploadRequest(1, TestImages.Jpeg(200, 100), dateTaken: "last Tuesday"));
        Assert.Equal(HttpStatusCode.BadRequest, badDate.StatusCode);
        Assert.Equal("dateTaken", JsonDocument.Parse(await badDate.Content.ReadAsStringAsync()).RootElement.GetProperty("field").GetString());

        var notPicture = await Http().SendAsync(UploadRequest(1, "<svg onload=alert(1)>"u8.ToArray()));
        Assert.Equal(HttpStatusCode.BadRequest, notPicture.StatusCode);

        var anonymous = await Http().SendAsync(UploadRequest(0, TestImages.Jpeg(), role: null));
        Assert.NotEqual(HttpStatusCode.Created, anonymous.StatusCode);
    }

    // ------------------------------------------------------------ honour roll and tributes

    [Fact]
    public async Task Searches_the_honour_roll_and_shows_a_person_with_their_incidents_and_tribute_count()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AvwDbContext>();
            db.CasualtyLinks.AddRange(new CasualtyLink { ServiceNumber = "5715978", ContactId = 9 }, new CasualtyLink { ServiceNumber = "5715978", ContactId = 2 });
            db.Tributes.Add(new Tribute { ServiceNumber = "5715978", AuthorName = "Old", Message = "Rest in peace.", CreatedUtc = DateTime.UtcNow });
            db.SaveChanges();
        }

        var found = await Read<HonourPage>(await Anon("/api/honour-roll?q=grist"));
        Assert.Equal(["39426"], found.Items.Select(p => p.ServiceNumber));

        var person = await Read<HonourPerson>(await Anon("/api/honour-roll/5715978"));
        Assert.Equal(("James Mungo White", 21), (person.Name, person.AgeAtDeath));
        Assert.Equal([2, 9], person.Incidents);
        Assert.Equal(1, person.Tributes);
        Assert.Equal("5th Battalion, The Royal Australian Regiment", Assert.Single(person.Tours).Unit);
        Assert.Equal(HttpStatusCode.NotFound, (await Anon("/api/honour-roll/000")).StatusCode);

        var atIncident = await Read<List<HonourSummary>>(await Anon("/api/contacts/2/casualties"));
        Assert.Equal(["5715978"], atIncident.Select(p => p.ServiceNumber));
    }

    [Fact]
    public async Task Members_leave_tributes_that_show_at_once_and_only_the_author_or_an_editor_can_remove_them()
    {
        var made = await Read<TributeView>(await As(1, HttpMethod.Post, "/api/honour-roll/5715978/tributes", new TributeInput("  Thank you,\nRest in peace.  ")), HttpStatusCode.Created);
        Assert.Equal(("Thank you, Rest in peace.", "Ann Member", true), (made.Message, made.AuthorName, made.Mine));

        var listed = await Read<TributePage>(await Anon("/api/honour-roll/5715978/tributes"));
        Assert.Equal((1, 1), (listed.Total, listed.Items.Count));
        Assert.False(listed.Items[0].CanDelete);
        Assert.True((await Read<TributePage>(await As(1, HttpMethod.Get, "/api/honour-roll/5715978/tributes"))).Items[0].CanDelete);

        Assert.Equal(HttpStatusCode.Forbidden, (await As(2, HttpMethod.Delete, $"/api/tributes/{made.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await As(3, HttpMethod.Delete, $"/api/tributes/{made.Id}")).StatusCode);
        Assert.Empty((await Read<TributePage>(await Anon("/api/honour-roll/5715978/tributes"))).Items);
    }

    [Fact]
    public async Task Refuses_tributes_for_someone_not_on_the_roll_or_with_no_message_or_from_a_visitor()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await As(1, HttpMethod.Post, "/api/honour-roll/000/tributes", new TributeInput("Hello"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await As(1, HttpMethod.Post, "/api/honour-roll/5715978/tributes", new TributeInput("  "))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await As(1, HttpMethod.Post, "/api/honour-roll/5715978/tributes", new TributeInput(new string('x', TributeService.MaxMessage + 1)))).StatusCode);
        Assert.NotEqual(HttpStatusCode.Created, (await Http().SendAsync(Req(HttpMethod.Post, "/api/honour-roll/5715978/tributes", null, 0, new TributeInput("Hello")))).StatusCode);
    }

    [Fact]
    public async Task Limits_how_many_tributes_one_person_can_leave_in_an_hour()
    {
        var codes = new List<HttpStatusCode>();
        for (var i = 0; i < 11; i++)
        {
            codes.Add((await As(1, HttpMethod.Post, "/api/honour-roll/5715978/tributes", new TributeInput($"Tribute {i}"))).StatusCode);
        }

        Assert.Equal(10, codes.Count(c => c == HttpStatusCode.Created));
        Assert.Equal(HttpStatusCode.TooManyRequests, codes[^1]);
        Assert.Equal(HttpStatusCode.Created, (await As(2, HttpMethod.Post, "/api/honour-roll/5715978/tributes", new TributeInput("Someone else is not limited"))).StatusCode);
    }

    // ------------------------------------------------------------ casualty information and moderation

    [Fact]
    public async Task Accepts_casualty_information_tells_the_editors_and_lists_it_for_them_to_handle()
    {
        var sent = await Read<CasualtyRow>(await As(1, HttpMethod.Post, "/api/contacts/2/casualty-submissions",
            new CasualtyInput(" 5715978 ", "Killed in action", "He was in 5 Platoon; see the unit diary.")), HttpStatusCode.Created);
        Assert.Equal(("5715978", "Killed in action", false, "Ann Member"), (sent.ServiceNumber, sent.CasualtyType, sent.Handled, sent.SubmittedByName));
        Assert.Contains("Casualty information", Assert.Single(_notifier.Sent).Subject);

        Assert.Equal(HttpStatusCode.Forbidden, (await As(1, HttpMethod.Get, "/api/studio/moderation")).StatusCode);
        var queue = await Read<ModerationQueue>(await As(3, HttpMethod.Get, "/api/studio/moderation"));
        Assert.Equal(sent.Id, Assert.Single(queue.Casualties).Id);

        var handled = await Read<CasualtyRow>(await As(3, HttpMethod.Post, $"/api/studio/casualty-submissions/{sent.Id}/handled", new HandledInput(true)));
        Assert.True(handled.Handled);
        Assert.Empty((await Read<ModerationQueue>(await As(3, HttpMethod.Get, "/api/studio/moderation"))).Casualties);
    }

    [Theory]
    [InlineData("Enjoyed lunch", "Some comment", "casualtyType")]
    [InlineData("Killed in action", "  ", "comment")]
    [InlineData(null, "Some comment", "casualtyType")]
    public async Task Refuses_casualty_information_that_is_incomplete(string? type, string comment, string field)
    {
        var res = await As(1, HttpMethod.Post, "/api/contacts/2/casualty-submissions", new CasualtyInput(null, type, comment));

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal(field, JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement.GetProperty("field").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await As(1, HttpMethod.Post, "/api/contacts/999/casualty-submissions", new CasualtyInput(null, "Killed in action", "Known."))).StatusCode);
    }

    [Fact]
    public async Task Puts_pending_notes_and_pictures_in_the_editors_queue_oldest_first()
    {
        await As(1, HttpMethod.Post, "/api/contacts/2/notes", new NoteInput("First", "Body one."));
        var note = await Read<NoteView>(await As(2, HttpMethod.Post, "/api/contacts/2/notes", new NoteInput("Second", "Body two.")), HttpStatusCode.Created);
        await Http().SendAsync(UploadRequest(1, TestImages.Jpeg(320, 240)));

        var queue = await Read<ModerationQueue>(await As(3, HttpMethod.Get, "/api/studio/moderation"));

        Assert.Equal(["First", "Second"], queue.Notes.Select(n => n.Title));
        Assert.Equal("Bo Member", queue.Notes[1].AuthorName);
        Assert.False(queue.Notes[1].IsChange);
        var picture = Assert.Single(queue.Pictures);
        Assert.Equal(("Ann Member", 2, "A patrol"), (picture.UploadedByName, picture.ContactId, picture.Caption));

        await As(3, HttpMethod.Post, $"/api/notes/{note.Id}/status", new ModerationRequest(ModerationStatus.Approved));
        Assert.Equal(["First"], (await Read<ModerationQueue>(await As(3, HttpMethod.Get, "/api/studio/moderation"))).Notes.Select(n => n.Title));
    }
}

public class ElasticsearchHonourRollTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "avw-roll-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try
        {
            Directory.Delete(_dir, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    private sealed class Stub(string response) : HttpMessageHandler
    {
        public List<(string Path, string Body)> Calls { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls.Add((request.RequestUri!.PathAndQuery, await request.Content!.ReadAsStringAsync(cancellationToken)));
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(response, Encoding.UTF8, "application/json") };
        }
    }

    private ElasticsearchHonourRoll Source(Stub stub)
    {
        Directory.CreateDirectory(Path.Combine(_dir, "portraits"));
        return new(new HttpClient(stub) { BaseAddress = new Uri("http://es.test/") }, Options.Create(new ElasticsearchOptions { Url = "http://es.test" }),
            Options.Create(new MediaOptions { RootPath = _dir }));
    }

    private const string TwoPeople = """
        {"hits":{"total":{"value":522},"hits":[
          {"_source":{"ServiceNumber":"5715978","FirstName":"James","SecondName":"Mungo","ThirdName":null,"LastName":"WHITE","Rank":"Private","Branch":"Royal Australian Infantry Corps",
            "NationalService":true,"Birth":{"Date":"1947-09-10","Place":"COLLIE","State":"WESTERN AUSTRALIA","Country":"AUSTRALIA"},"Death":{"Date":"1969-04-04"},
            "Tours":[{"Unit":"5th Battalion","StartDate":"05/02/1969","EndDate":"04/04/1969"}]}},
          {"_source":{"ServiceNumber":"39426","FirstName":"Robert","LastName":"MC DONALD-SMITH","Birth":{"Date":"1948-08-28"},"Death":{"Date":"1968-08-27"}}}
        ]}}
        """;

    [Fact]
    public async Task Searches_only_those_who_died_with_every_word_matching_and_pages_by_death_date()
    {
        var stub = new Stub(TwoPeople);

        var page = await Source(stub).SearchAsync("  white  ", 3, 20, default);

        Assert.Equal((522, 3, 20), (page.Total, page.Page, page.PageSize));
        var body = stub.Calls[0].Body;
        Assert.Equal("/avw_nomroll/_search", stub.Calls[0].Path);
        Assert.Contains("\"exists\":{\"field\":\"Death.Date\"}", body);
        Assert.Contains("\"type\":\"cross_fields\"", body);
        Assert.Contains("\"operator\":\"and\"", body);
        Assert.Contains("\"query\":\"white\"", body);
        Assert.Contains("\"from\":40", body);
        Assert.Contains("\"Death.Date\":\"asc\"", body);
    }

    [Fact]
    public async Task Turns_records_into_readable_names_ages_and_dates()
    {
        var page = await Source(new Stub(TwoPeople)).SearchAsync(null, 1, 20, default);

        var white = page.Items[0];
        Assert.Equal(("5715978", "James Mungo White", "Private", 21), (white.ServiceNumber, white.Name, white.Rank, white.AgeAtDeath));
        Assert.Equal((new DateOnly(1947, 9, 10), new DateOnly(1969, 4, 4)), (white.Birth, white.Death));
        Assert.Equal(("Robert Mc Donald-Smith", 19), (page.Items[1].Name, page.Items[1].AgeAtDeath));
    }

    [Fact]
    public async Task Sends_no_query_text_when_none_is_given_and_keeps_the_page_within_bounds()
    {
        var stub = new Stub(TwoPeople);

        await Source(stub).SearchAsync("   ", 0, 5000, default);

        Assert.DoesNotContain("multi_match", stub.Calls[0].Body);
        Assert.Contains("\"from\":0", stub.Calls[0].Body);
        Assert.Contains($"\"size\":{ElasticsearchHonourRoll.MaxPageSize}", stub.Calls[0].Body);
    }

    [Fact]
    public async Task Gets_one_person_with_birthplace_and_tours_and_nobody_for_an_unknown_or_surviving_number()
    {
        var person = await Source(new Stub(TwoPeople)).GetAsync("5715978", default);

        Assert.Equal(("COLLIE", "WESTERN AUSTRALIA", true), (person!.BirthPlace, person.BirthState, person.NationalService));
        Assert.Equal(("5th Battalion", "05/02/1969"), (person.Tours[0].Unit, person.Tours[0].Start));

        Assert.Null(await Source(new Stub("""{"hits":{"total":{"value":0},"hits":[]}}""")).GetAsync("nope", default));
        Assert.Null(await Source(new Stub("""{"hits":{"total":{"value":1},"hits":[{"_source":{"ServiceNumber":"1","LastName":"LIVED","Birth":{"Date":"1940-01-01"}}}]}}""")).GetAsync("1", default));
    }

    [Fact]
    public async Task Looks_up_several_people_by_service_number_in_one_request_and_none_without_asking()
    {
        var stub = new Stub(TwoPeople);
        var source = Source(stub);

        var many = await source.GetManyAsync(["5715978", "39426"], default);
        Assert.Equal(["39426", "5715978"], many.Select(p => p.ServiceNumber));          // in order of death
        Assert.Contains("ServiceNumber.keyword", stub.Calls[0].Body);

        Assert.Empty(await source.GetManyAsync([], default));
        Assert.Single(stub.Calls);
    }

    [Fact]
    public async Task Points_at_a_portrait_only_when_its_file_exists_and_the_number_is_a_safe_name()
    {
        var source = Source(new Stub(TwoPeople));
        await File.WriteAllBytesAsync(Path.Combine(_dir, "portraits", "5715978.jpg"), [1]);

        var page = await source.SearchAsync(null, 1, 20, default);

        Assert.Equal("/media/portraits/5715978.jpg", page.Items[0].PortraitUrl);
        Assert.Null(page.Items[1].PortraitUrl);
        var evil = await Source(new Stub("""{"hits":{"total":{"value":1},"hits":[{"_source":{"ServiceNumber":"../../secret","LastName":"X","Death":{"Date":"1969-01-01"}}}]}}""")).SearchAsync(null, 1, 20, default);
        Assert.Null(evil.Items[0].PortraitUrl);
    }
}

public class EmailNotifierTests
{
    private static EmailNotifier Notifier(SmtpOptions? smtp = null, NotificationOptions? recipients = null) =>
        new(Options.Create(smtp ?? new SmtpOptions()), Options.Create(recipients ?? new NotificationOptions()), NullLogger<EmailNotifier>.Instance);

    [Fact]
    public void Can_send_only_with_a_server_a_from_address_and_someone_to_send_to()
    {
        var full = new SmtpOptions { Host = "smtp.test", From = "no-reply@example.com" };
        var to = new NotificationOptions { EditorEmails = ["ed@example.com"] };

        Assert.False(Notifier().CanSend);
        Assert.False(Notifier(full, new NotificationOptions()).CanSend);
        Assert.False(Notifier(new SmtpOptions { Host = "smtp.test" }, to).CanSend);
        Assert.False(Notifier(new SmtpOptions { From = "a@b.c" }, to).CanSend);
        Assert.True(Notifier(full, to).CanSend);
    }

    [Fact]
    public async Task Never_fails_the_caller_and_drains_its_queue_even_when_nothing_can_be_sent()
    {
        var notifier = Notifier();
        for (var i = 0; i < 500; i++)
        {
            notifier.Notify(new Notification($"Subject {i}", "Body"));               // more than the queue holds: the oldest are dropped, nobody is blocked
        }

        await notifier.StartAsync(default);
        await Task.Delay(200);
        await notifier.StopAsync(default);
    }
}
