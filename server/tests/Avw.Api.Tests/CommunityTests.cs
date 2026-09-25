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
using Avw.Migration;
using ImageMagick;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
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

    /// <summary>What the last search was asked for, so a test can see that the endpoint passed it on.</summary>
    public (string? Text, HonourFilter Filter, bool Facets)? LastSearch { get; private set; }

    public Task<HonourPage> SearchAsync(string? text, HonourFilter filter, bool withFacets, int page, int pageSize, CancellationToken ct)
    {
        LastSearch = (text, filter, withFacets);
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

        // The picture's own page carries what was recorded at upload: who added it, when, and the file's format and size.
        var detail = await Read<IncidentMediaView>(await Anon($"/api/incident-media/{up.Id}"));
        Assert.Equal("image/jpeg", detail.ContentType);
        Assert.True(detail.ByteSize > 0);
        Assert.True(detail.AddedUtc > DateTime.UtcNow.AddMinutes(-5));
        Assert.False(string.IsNullOrWhiteSpace(detail.AddedBy));
        // The lists (an incident's pictures, the map's) do not name the uploader.
        Assert.Null(shown.AddedBy);

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
    public async Task A_picture_added_to_an_incident_is_placed_where_the_incident_is_so_the_map_and_area_search_find_it()
    {
        var up = await Read<IncidentMediaView>(await Http().SendAsync(UploadRequest(3, TestImages.Jpeg(640, 480), "editor")), HttpStatusCode.Created);      // incident 2 is at 10.5525, 107.1653

        Assert.Equal((10.5525, 107.1653), (up.Lat, up.Lon));
        var near = await Read<List<IncidentMediaView>>(await Anon("/api/community-media?minLat=10.5&minLon=107.1&maxLat=10.6&maxLon=107.2"));
        Assert.Equal(up.Id, Assert.Single(near).Id);
        Assert.Empty(await Read<List<IncidentMediaView>>(await Anon("/api/community-media?minLat=11&minLon=107.1&maxLat=11.5&maxLon=107.2")));      // and not somewhere else
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

    private HttpRequestMessage PlaceRequest(long uid, byte[] bytes, string? lat, string? lon, string role = "member", string? caption = "Nui Dat from the air")
    {
        var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(file, "file", "photo.jpg");
        foreach (var (name, value) in new[] { ("caption", caption), ("lat", lat), ("lon", lon) })
        {
            if (value is not null)
            {
                form.Add(new StringContent(value), name);
            }
        }

        var req = Req(HttpMethod.Post, "/api/community-media", role, uid);
        req.Content = form;
        return req;
    }

    [Fact]
    public async Task A_picture_placed_anywhere_on_the_map_belongs_to_no_incident_and_waits_for_approval()
    {
        var up = await Read<IncidentMediaView>(await Http().SendAsync(PlaceRequest(1, TestImages.Jpeg(), "10.4961234", "107.2023456")), HttpStatusCode.Created);

        Assert.Equal((null, 10.496123, 107.202346, MediaStatus.Pending, true), (up.ContactId, up.Lat, up.Lon, up.Status, up.Mine));
        Assert.Contains("placed a picture", Assert.Single(_notifier.Sent).Body);
        Assert.Empty(await Read<List<IncidentMediaView>>(await Anon("/api/community-media?minLat=10&minLon=107&maxLat=11&maxLon=108")));
        Assert.Equal(HttpStatusCode.OK, (await As(1, HttpMethod.Get, $"/api/incident-media/{up.Id}")).StatusCode);       // its uploader can see it

        await As(3, HttpMethod.Post, $"/api/studio/media/{up.MediaId}/status", new MediaStatusRequest(MediaStatus.Approved));
        Assert.Equal(up.Id, Assert.Single(await Read<List<IncidentMediaView>>(await Anon("/api/community-media?minLat=10&minLon=107&maxLat=11&maxLon=108"))).Id);
    }

    [Fact]
    public async Task Placing_the_same_file_twice_returns_the_first_picture()
    {
        var bytes = TestImages.Jpeg(640, 480);
        var first = await Read<IncidentMediaView>(await Http().SendAsync(PlaceRequest(3, bytes, "10.5", "107.2", "editor")), HttpStatusCode.Created);
        var again = await Read<IncidentMediaView>(await Http().SendAsync(PlaceRequest(3, bytes, "11", "108", "editor")), HttpStatusCode.Created);

        Assert.Equal((first.Id, 10.5, 107.2), (again.Id, again.Lat, again.Lon));
    }

    [Theory]
    [InlineData(null, "107.2")]
    [InlineData("10.5", null)]
    [InlineData("91", "107.2")]
    [InlineData("10.5", "-180.5")]
    [InlineData("north", "107.2")]
    [InlineData("NaN", "107.2")]
    public async Task Refuses_a_placed_picture_without_a_real_place(string? lat, string? lon)
    {
        var res = await Http().SendAsync(PlaceRequest(1, TestImages.Jpeg(), lat, lon));

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal("place", JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Only_a_member_can_place_a_picture() =>
        Assert.NotEqual(HttpStatusCode.Created, (await Http().SendAsync(PlaceRequest(0, TestImages.Jpeg(), "10.5", "107.2", role: null!))).StatusCode);

    [Fact]
    public async Task Pages_through_approved_pictures_newest_first_or_by_the_words_of_their_captions()
    {
        SeedPlacedPictures();

        var all = await Read<PicturePage>(await Anon("/api/community-media/search?pageSize=2"));
        Assert.Equal((4, 2), (all.Total, all.Items.Count));
        Assert.Equal("No incident", all.Items[0].Caption);
        var second = await Read<PicturePage>(await Anon("/api/community-media/search?pageSize=2&page=2"));
        Assert.Equal(2, second.Items.Count);
        Assert.Empty(all.Items.Select(i => i.Id).Intersect(second.Items.Select(i => i.Id)));

        var track = await Read<PicturePage>(await Anon("/api/community-media/search?q=track"));
        Assert.Equal("On the track", Assert.Single(track.Items).Caption);
        Assert.Equal(1, track.Total);
        Assert.Equal(HttpStatusCode.BadRequest, (await Anon("/api/community-media/search?q=" + new string('x', 101))).StatusCode);
    }

    private void SeedPlacedPictures()
    {
        Seed();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AvwDbContext>();
        var when = new DateTime(2012, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        MediaAsset Asset(string sha, MediaStatus status, string? caption = null) =>
            new() { Sha256 = sha.PadRight(64, '0'), Width = 800, Height = 600, ByteSize = 1000, Status = status, UploadedById = 1, CreatedUtc = when, Caption = caption };

        db.IncidentMedia.AddRange(
            new IncidentMedia { ContactId = 2, Media = Asset("aa", MediaStatus.Approved, "On the track"), Lat = -10.5, Lon = 107.2, CreatedUtc = when, LegacyLikes = 3, AuthorName = "Old Digger" },
            new IncidentMedia { ContactId = null, Media = Asset("bb", MediaStatus.Approved, "No incident"), Lat = -10.6, Lon = 107.3, CreatedUtc = when.AddDays(1) },
            new IncidentMedia { ContactId = 2, Media = Asset("cc", MediaStatus.Pending), Lat = -10.5, Lon = 107.2, CreatedUtc = when },
            new IncidentMedia { ContactId = 2, Media = Asset("dd", MediaStatus.Approved), Lat = 20, Lon = 20, CreatedUtc = when },
            new IncidentMedia { ContactId = 2, Media = Asset("ee", MediaStatus.Approved), CreatedUtc = when });
        db.SaveChanges();
    }

    [Fact]
    public async Task Lists_approved_pictures_placed_inside_a_box_newest_first_for_the_map()
    {
        SeedPlacedPictures();

        var res = await Anon("/api/community-media?minLat=-11&minLon=107&maxLat=-10&maxLon=108");
        var shown = await Read<List<IncidentMediaView>>(res);

        Assert.Equal(["No incident", "On the track"], shown.Select(m => m.Caption));
        Assert.Null(shown[0].ContactId);
        Assert.Equal((-10.5, 107.2, 3), (shown[1].Lat, shown[1].Lon, shown[1].Likes));
        Assert.All(shown, m => Assert.EndsWith("-480.jpg", m.ThumbUrl));
        Assert.Contains("max-age=60", res.Headers.CacheControl!.ToString());
    }

    [Theory]
    [InlineData("minLat=-10&minLon=107&maxLat=-11&maxLon=108")]
    [InlineData("minLat=-11&minLon=108&maxLat=-10&maxLon=107")]
    [InlineData("minLat=-95&minLon=107&maxLat=-10&maxLon=108")]
    [InlineData("minLat=-11&minLon=107&maxLat=-10&maxLon=181")]
    public async Task Refuses_an_upside_down_or_out_of_range_picture_box(string box) =>
        Assert.Equal(HttpStatusCode.BadRequest, (await Anon("/api/community-media?" + box)).StatusCode);

    private (long Approved, long Pending) PlacedPictureIds()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AvwDbContext>();
        return (db.IncidentMedia.Single(m => m.LegacyLikes == 3).Id, db.IncidentMedia.Single(m => m.Media.Status == MediaStatus.Pending).Id);
    }

    [Fact]
    public async Task Lists_poppies_with_words_first_then_wordless_ones_and_counts_them_all()
    {
        Seed();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AvwDbContext>();
            var when = new DateTime(2017, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            db.Tributes.AddRange(
                new Tribute { ServiceNumber = "5715978", AuthorName = "Member", Message = "", CreatedUtc = when.AddDays(9) },
                new Tribute { ServiceNumber = "5715978", AuthorName = "Old Digger", Message = "Rest easy.", CreatedUtc = when },
                new Tribute { ServiceNumber = "5715978", AuthorName = "Member", Message = "", CreatedUtc = when.AddDays(5) },
                new Tribute { ServiceNumber = "5715978", AuthorName = "Anne", Message = "Thank you.", CreatedUtc = when.AddDays(2) });
            db.SaveChanges();
        }

        var page = await Read<TributePage>(await Anon("/api/honour-roll/5715978/tributes"));

        Assert.Equal(4, page.Total);
        Assert.Equal(["Thank you.", "Rest easy.", "", ""], page.Items.Select(t => t.Message));
        Assert.Equal([On(9), On(5)], page.Items.Skip(2).Select(t => t.CreatedUtc));

        static DateTime On(int days) => new DateTime(2017, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddDays(days);
    }

    [Fact]
    public async Task Gives_one_picture_to_the_map_panel_with_the_viewers_own_like_and_never_caches_it()
    {
        SeedPlacedPictures();
        var (approved, _) = PlacedPictureIds();

        var anon = await Anon($"/api/incident-media/{approved}");
        var seen = await Read<IncidentMediaView>(anon);
        Assert.Equal(("On the track", 3, false, false), (seen.Caption, seen.Likes, seen.LikedByMe, seen.Mine));
        Assert.Contains("no-store", anon.Headers.CacheControl!.ToString());

        await As(2, HttpMethod.Post, $"/api/incident-media/{approved}/like");
        var bo = await Read<IncidentMediaView>(await As(2, HttpMethod.Get, $"/api/incident-media/{approved}"));
        Assert.Equal((4, true), (bo.Likes, bo.LikedByMe));
        Assert.False((await Read<IncidentMediaView>(await As(1, HttpMethod.Get, $"/api/incident-media/{approved}"))).LikedByMe);
    }

    [Fact]
    public async Task A_picture_that_is_not_approved_is_found_only_by_its_uploader_and_editors()
    {
        SeedPlacedPictures();
        var (_, pending) = PlacedPictureIds();

        Assert.Equal(HttpStatusCode.NotFound, (await Anon($"/api/incident-media/{pending}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await As(2, HttpMethod.Get, $"/api/incident-media/{pending}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await As(1, HttpMethod.Get, $"/api/incident-media/{pending}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await As(3, HttpMethod.Get, $"/api/incident-media/{pending}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Anon("/api/incident-media/999999")).StatusCode);
    }

    [Fact]
    public async Task A_box_returns_at_most_the_newest_five_hundred_pictures()
    {
        Seed();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AvwDbContext>();
            var when = new DateTime(2012, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            for (var i = 0; i < IncidentMediaService.MaxInArea + 1; i++)
            {
                db.IncidentMedia.Add(new IncidentMedia
                {
                    Media = new MediaAsset { Sha256 = i.ToString("x").PadRight(64, '0'), Width = 1, Height = 1, ByteSize = 1, Status = MediaStatus.Approved, UploadedById = 1, CreatedUtc = when, Caption = $"n{i}" },
                    Lat = 10.5, Lon = 107.2, CreatedUtc = when.AddMinutes(i),
                });
            }

            db.SaveChanges();
        }

        var shown = await Read<List<IncidentMediaView>>(await Anon("/api/community-media?minLat=-90&minLon=-180&maxLat=90&maxLon=180"));

        Assert.Equal(IncidentMediaService.MaxInArea, shown.Count);
        Assert.Equal($"n{IncidentMediaService.MaxInArea}", shown[0].Caption);     // newest first
        Assert.DoesNotContain(shown, m => m.Caption == "n0");                      // the oldest one is the one left out
    }

    [Fact]
    public async Task Counts_likes_carried_over_from_the_legacy_site_and_adds_new_ones_to_them()
    {
        SeedPlacedPictures();
        long id;
        using (var scope = _factory.Services.CreateScope())
        {
            id = scope.ServiceProvider.GetRequiredService<AvwDbContext>().IncidentMedia.Single(m => m.LegacyLikes == 3).Id;
        }

        Assert.Equal(3, (await Read<List<IncidentMediaView>>(await Anon("/api/contacts/2/media"))).Single(m => m.Id == id).Likes);
        var liked = await Read<LikeResult>(await As(1, HttpMethod.Post, $"/api/incident-media/{id}/like"));
        Assert.Equal((4, true), (liked.Likes, liked.Liked));
        var unliked = await Read<LikeResult>(await As(1, HttpMethod.Post, $"/api/incident-media/{id}/like"));
        Assert.Equal((3, false), (unliked.Likes, unliked.Liked));
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
        Assert.Null(found.Facets);
        Assert.Equal(("grist", HonourFilter.None, false), _roll.LastSearch);

        await Anon("/api/honour-roll?service=Navy&rank=Able%20Seaman&corps=Seaman&facets=true");
        Assert.Equal((null, new HonourFilter("Navy", "Able Seaman", "Seaman"), true), _roll.LastSearch);

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

/// <summary>A small nominal roll as Elasticsearch holds it, and the way to bring it into a database.</summary>
public static class RollFixtures
{
    // Five who died, not in order, and one who lived. Two are Army (White, White), one Navy (Smith), one Air Force (Hack), one with no rank or corps.
    public static readonly string[] Records =
    [
        """{"_source":{"ServiceNumber":"5715978","FirstName":"James","SecondName":"Mungo","ThirdName":null,"LastName":"WHITE","Rank":"Private","Branch":"Royal Australian Infantry Corps","NationalService":true,"Birth":{"Date":"1947-09-10","Place":"COLLIE","State":"WESTERN AUSTRALIA","Country":"AUSTRALIA"},"Death":{"Date":"1969-04-04"},"Tours":[{"Unit":"5th Battalion","StartDate":"05/02/1969","EndDate":"04/04/1969"}]}}""",
        """{"_source":{"ServiceNumber":"39426","FirstName":"Robert","LastName":"MC DONALD-SMITH","Birth":{"Date":"1948-08-28"},"Death":{"Date":"1968-08-27"}}}""",
        """{"_source":{"ServiceNumber":"2222","FirstName":"william","LastName":"SMITH","Rank":"Petty Officer","Branch":"Seaman","Birth":{"Date":"1940-01-01"},"Death":{"Date":"1970-01-01"}}}""",
        """{"_source":{"ServiceNumber":"1111","FirstName":"William","LastName":"HACK","Rank":"Pilot Officer","Branch":"General Duties","Birth":{"Date":"1944-01-01"},"Death":{"Date":"1967-06-01"}}}""",
        """{"_source":{"ServiceNumber":"3333","FirstName":"Alan","LastName":"WHITE","Rank":"(Temporary) Corporal","Branch":"Royal Australian Engineers","Birth":{"Date":"1945-01-01"},"Death":{"Date":"1969-01-01"}}}""",
        """{"_source":{"ServiceNumber":"4444","FirstName":"Lucky","LastName":"LIVED","Rank":"Private","Branch":"Royal Australian Infantry Corps","Birth":{"Date":"1940-01-01"}}}""",
    ];

    public static string Json(IEnumerable<string> records) => "{\"hits\":{\"hits\":[" + string.Join(',', records) + "]}}";

    public static string Roll => Json(Records);

    public sealed class Stub(string response) : HttpMessageHandler
    {
        public List<(string Path, string Body)> Calls { get; } = [];

        public string Response { get; set; } = response;

        public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls.Add((request.RequestUri!.PathAndQuery, await request.Content!.ReadAsStringAsync(cancellationToken)));
            return new HttpResponseMessage(Status) { Content = new StringContent(Response, Encoding.UTF8, "application/json") };
        }
    }

    /// <summary>The records in a response from Elasticsearch, as the importer receives them.</summary>
    public static List<NomRollRecord> Parse(string json) =>
        JsonDocument.Parse(json).RootElement.GetProperty("hits").GetProperty("hits").EnumerateArray()
            .Select(h => h.GetProperty("_source").Deserialize<NomRollRecord>()!).ToList();

    /// <summary>A database holding the roll, as the import leaves it.</summary>
    public static async Task<AvwDbContext> LoadedAsync(string? json = null, AvwDbContext? db = null)
    {
        db ??= SearchFixtures.Db();
        await RollImporter.ImportAsync(Parse(json ?? Roll), db, dryRun: false);
        return db;
    }
}

public class HonourRollStoreTests : IDisposable
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

    private HonourRollStore Store(AvwDbContext db)
    {
        Directory.CreateDirectory(Path.Combine(_dir, "portraits"));
        return new HonourRollStore(db, Options.Create(new MediaOptions { RootPath = _dir }));
    }

    private async Task<HonourRollStore> Loaded(string? json = null) => Store(await RollFixtures.LoadedAsync(json));

    private static async Task<string[]> Numbers(HonourRollStore store, string? text = null, HonourFilter? filter = null) =>
        (await store.SearchAsync(text, filter ?? HonourFilter.None, false, 1, 50, default)).Items.Select(i => i.ServiceNumber).ToArray();

    // ---- order and names

    [Fact]
    public async Task Lists_those_who_died_by_surname_then_given_names_whatever_the_case_they_are_held_in()
    {
        var page = await (await Loaded()).SearchAsync(null, HonourFilter.None, false, 1, 20, default);

        Assert.Equal(5, page.Total);                                        // not the one who lived
        Assert.Equal(["1111", "39426", "2222", "3333", "5715978"], page.Items.Select(i => i.ServiceNumber));
    }

    [Fact]
    public async Task Writes_the_name_for_reading_and_for_a_roll_and_works_out_ages_and_dates()
    {
        var page = await (await Loaded()).SearchAsync(null, HonourFilter.None, false, 1, 20, default);

        var white = page.Items.Single(i => i.ServiceNumber == "5715978");
        Assert.Equal(("James Mungo White", "White, James Mungo", "Private", 21), (white.Name, white.SortName, white.Rank, white.AgeAtDeath));
        Assert.Equal(("Royal Australian Infantry Corps", new DateOnly(1947, 9, 10), new DateOnly(1969, 4, 4)), (white.Branch, white.Birth, white.Death));
        var mc = page.Items.Single(i => i.ServiceNumber == "39426");
        Assert.Equal(("Robert Mc Donald-Smith", "Mc Donald-Smith, Robert", 19), (mc.Name, mc.SortName, mc.AgeAtDeath));
        Assert.Equal("Smith, william", page.Items.Single(i => i.ServiceNumber == "2222").SortName);   // given names as the record has them
    }

    [Fact]
    public async Task Pages_the_sorted_list_and_keeps_the_page_within_bounds()
    {
        var store = await Loaded();

        var second = await store.SearchAsync(null, HonourFilter.None, false, 2, 2, default);
        Assert.Equal((5, 2, 2), (second.Total, second.Page, second.PageSize));
        Assert.Equal(["2222", "3333"], second.Items.Select(i => i.ServiceNumber));

        var clamped = await store.SearchAsync("   ", HonourFilter.None, false, 0, 5000, default);
        Assert.Equal((1, HonourRollStore.MaxPageSize), (clamped.Page, clamped.PageSize));
        Assert.Equal(5, clamped.Items.Count);
        Assert.Empty((await store.SearchAsync(null, HonourFilter.None, false, 4, 2, default)).Items);
    }

    // ---- searching

    [Fact]
    public async Task Matches_the_start_of_a_word_in_any_name_or_the_service_number_so_will_finds_william()
    {
        var store = await Loaded();

        Assert.Equal(["1111", "2222"], await Numbers(store, "Will"));      // any case
        Assert.Equal(["3333", "5715978"], await Numbers(store, "wh"));
        Assert.Equal(["5715978"], await Numbers(store, "57159"));         // the service number
        Assert.Equal(["5715978"], await Numbers(store, "mun"));           // a middle name
        Assert.Equal(["39426"], await Numbers(store, "donald"));          // the second word of a surname
        Assert.Empty(await Numbers(store, "ill"));                        // the start of a word, not the middle
        Assert.Empty(await Numbers(store, "lived"));                      // who lived is not on this roll
    }

    [Fact]
    public async Task Needs_every_word_typed_to_start_some_word_and_lets_them_fall_in_different_names()
    {
        var store = await Loaded();

        Assert.Equal(["2222"], await Numbers(store, "will smi"));
        Assert.Equal(["2222"], await Numbers(store, "smi will"));
        Assert.Equal(["5715978"], await Numbers(store, "james white"));
        Assert.Empty(await Numbers(store, "will white"));
    }

    [Theory]
    [InlineData("will", new[] { "will" })]
    [InlineData("  WILL   Smi ", new[] { "will", "smi" })]
    [InlineData("mc donald-smith", new[] { "mc", "donald", "smith" })]
    [InlineData("o'brien", new[] { "o", "brien" })]
    [InlineData("will will", new[] { "will" })]
    [InlineData("571 5978", new[] { "571", "5978" })]
    [InlineData("émile", new[] { "émile" })]
    [InlineData("  ...  ", new string[0])]
    [InlineData(null, new string[0])]
    public void Splits_what_was_typed_into_lower_case_words_at_anything_that_is_not_a_letter_or_digit(string? typed, string[] expected) =>
        Assert.Equal(expected, HonourRollStore.SearchWords(typed));

    [Fact]
    public async Task Ignores_words_beyond_the_eighth_and_reads_no_wildcards_or_query_syntax_into_the_words()
    {
        Assert.Equal(HonourRollStore.MaxSearchWords, HonourRollStore.SearchWords("a b c d e f g h i j k l").Count);
        Assert.Equal(new[] { "smi", "and", "name" }, HonourRollStore.SearchWords("smi* AND name:*"));

        var store = await Loaded();
        Assert.Equal(5, (await Numbers(store, "*")).Length);                // nothing to look for, so no words: everyone
        Assert.Equal(["39426", "2222"], await Numbers(store, "smi*"));      // the star is dropped, not a wildcard: both Smiths
    }

    // ---- filtering

    [Theory]
    [InlineData("Army", new[] { "3333", "5715978" })]
    [InlineData("Navy", new[] { "2222" })]
    [InlineData("Air Force", new[] { "1111" })]
    [InlineData("air force", new[] { "1111" })]
    [InlineData("  Navy ", new[] { "2222" })]
    [InlineData("Marines", new string[0])]
    public async Task Restricts_the_roll_to_a_service(string service, string[] expected) =>
        Assert.Equal(expected, await Numbers(await Loaded(), filter: new HonourFilter(Service: service)));

    [Fact]
    public async Task Restricts_the_roll_by_rank_and_by_corps_and_by_all_of_them_with_the_search()
    {
        var store = await Loaded();

        Assert.Equal(["3333"], await Numbers(store, filter: new HonourFilter(Rank: "(Temporary) Corporal")));
        Assert.Equal(["5715978"], await Numbers(store, filter: new HonourFilter(Rank: "Private")));
        Assert.Equal(["3333"], await Numbers(store, filter: new HonourFilter(Corps: "Royal Australian Engineers")));
        Assert.Equal(["5715978"], await Numbers(store, "white", new HonourFilter("Army", "Private", "Royal Australian Infantry Corps")));
        Assert.Empty(await Numbers(store, "white", new HonourFilter(Service: "Navy")));
        Assert.Equal(5, (await Numbers(store, filter: new HonourFilter("", " ", null))).Length);          // blank is no restriction
    }

    [Fact]
    public async Task Counts_those_the_filter_and_search_leave_as_the_total()
    {
        var page = await (await Loaded()).SearchAsync("white", new HonourFilter(Service: "Army"), false, 1, 1, default);

        Assert.Equal(2, page.Total);
        Assert.Single(page.Items);
    }

    [Fact]
    public async Task Leaves_out_the_drop_down_choices_unless_asked_for_them()
    {
        var store = await Loaded();

        Assert.Null((await store.SearchAsync(null, HonourFilter.None, false, 1, 20, default)).Facets);
        Assert.NotNull((await store.SearchAsync(null, HonourFilter.None, true, 1, 20, default)).Facets);
    }

    [Fact]
    public async Task Offers_each_service_rank_and_corps_that_there_is_with_how_many_it_would_leave()
    {
        var facets = (await (await Loaded()).SearchAsync(null, HonourFilter.None, true, 1, 20, default)).Facets!;

        Assert.Equal([("Army", 2), ("Navy", 1), ("Air Force", 1)], facets.Services.Select(o => (o.Value, o.Count)));        // in this order, not alphabetical
        Assert.Equal(["(Temporary) Corporal", "Petty Officer", "Pilot Officer", "Private"], facets.Ranks.Select(o => o.Value));
        Assert.Equal(["General Duties", "Royal Australian Engineers", "Royal Australian Infantry Corps", "Seaman"], facets.Corps.Select(o => o.Value));
        Assert.All(facets.Ranks.Concat(facets.Corps), o => Assert.Equal(1, o.Count));
    }

    [Fact]
    public async Task Sorts_ranks_without_their_temporary_or_acting_so_a_captain_and_a_temporary_captain_sit_together()
    {
        var ranks = RollFixtures.Json(new[] { ("1", "Major"), ("2", "(Temporary) Captain"), ("3", "Captain"), ("4", "(Acting) Sergeant"), ("5", "Sergeant") }
            .Select(r => "{\"_source\":{\"ServiceNumber\":\"" + r.Item1 + "\",\"LastName\":\"P" + r.Item1 + "\",\"Rank\":\"" + r.Item2 + "\",\"Death\":{\"Date\":\"1969-01-01\"}}}"));

        var facets = (await (await Loaded(ranks)).SearchAsync(null, HonourFilter.None, true, 1, 20, default)).Facets!;

        Assert.Equal(["Captain", "(Temporary) Captain", "Major", "Sergeant", "(Acting) Sergeant"], facets.Ranks.Select(o => o.Value));
    }

    [Fact]
    public async Task Counts_each_list_with_the_search_and_the_other_two_choices_but_not_its_own()
    {
        var store = await Loaded();

        var navy = (await store.SearchAsync(null, new HonourFilter(Service: "Navy"), true, 1, 20, default)).Facets!;
        Assert.Equal(["Petty Officer"], navy.Ranks.Select(o => o.Value));                    // only the Navy's ranks and corps...
        Assert.Equal(["Seaman"], navy.Corps.Select(o => o.Value));
        Assert.Equal(["Army", "Navy", "Air Force"], navy.Services.Select(o => o.Value));     // ...but the services still all show

        var hack = (await store.SearchAsync("hack", HonourFilter.None, true, 1, 20, default)).Facets!;
        Assert.Equal(["Air Force"], hack.Services.Select(o => o.Value));                     // the search narrows every list

        var private1 = (await store.SearchAsync(null, new HonourFilter(Rank: "Private"), true, 1, 20, default)).Facets!;
        Assert.Equal(4, private1.Ranks.Count);                                               // its own list keeps the alternatives
        Assert.Equal([("Army", 1)], private1.Services.Select(o => (o.Value, o.Count)));
    }

    [Fact]
    public async Task Keeps_a_choice_already_made_in_its_list_even_when_nothing_is_left_under_it()
    {
        var facets = (await (await Loaded()).SearchAsync("hack", new HonourFilter(Service: "Army"), true, 1, 20, default)).Facets!;

        Assert.Contains(("Army", 0), facets.Services.Select(o => (o.Value, o.Count)));
    }

    // ---- one person, or several

    [Fact]
    public async Task Gets_one_person_with_birthplace_and_tours_and_nobody_for_an_unknown_or_surviving_number()
    {
        var store = await Loaded();

        var person = await store.GetAsync("5715978", default);

        Assert.Equal(("COLLIE", "WESTERN AUSTRALIA", true), (person!.BirthPlace, person.BirthState, person.NationalService));
        Assert.Equal(("5th Battalion", "05/02/1969"), (person.Tours[0].Unit, person.Tours[0].Start));
        Assert.Null(await store.GetAsync("nope", default));
        Assert.Null(await store.GetAsync("4444", default));                 // lived
    }

    [Fact]
    public async Task Looks_up_several_people_by_service_number_in_order_of_death_and_none_for_none()
    {
        var store = await Loaded();

        var many = await store.GetManyAsync(["5715978", "39426", "nope"], default);

        Assert.Equal(["39426", "5715978"], many.Select(p => p.ServiceNumber));
        Assert.Empty(await store.GetManyAsync([], default));
    }

    [Fact]
    public async Task Points_at_a_portrait_only_when_its_file_exists_and_the_number_is_a_safe_name()
    {
        var store = await Loaded();
        await File.WriteAllBytesAsync(Path.Combine(_dir, "portraits", "5715978.jpg"), [1]);

        var page = await store.SearchAsync(null, HonourFilter.None, false, 1, 20, default);

        Assert.Equal("/media/portraits/5715978.jpg", page.Items.Single(i => i.ServiceNumber == "5715978").PortraitUrl);
        Assert.Null(page.Items.Single(i => i.ServiceNumber == "39426").PortraitUrl);
        var evil = await (await Loaded(RollFixtures.Json(["""{"_source":{"ServiceNumber":"../../secret","LastName":"X","Death":{"Date":"1969-01-01"}}}"""]))).SearchAsync(null, HonourFilter.None, false, 1, 20, default);
        Assert.Null(evil.Items[0].PortraitUrl);
    }
}

public class RollImporterTests
{
    private static Task<ImportReport> Import(AvwDbContext db, string json, bool dryRun = false) => RollImporter.ImportAsync(RollFixtures.Parse(json), db, dryRun);

    [Fact]
    public async Task Imports_those_who_died_and_skips_the_one_who_lived()
    {
        var db = SearchFixtures.Db();

        var report = await Import(db, RollFixtures.Roll);

        Assert.Equal((5, 0, 0), (report.Added, report.Updated, report.Unchanged));
        Assert.Equal(1, report.Skipped["who did not die"]);
        Assert.Equal(5, await db.HonourRoll.CountAsync());
        Assert.DoesNotContain(await db.HonourRoll.Select(p => p.ServiceNumber).ToListAsync(), n => n == "4444");
    }

    [Fact]
    public async Task Stores_what_searching_and_the_drop_downs_need_worked_out()
    {
        var db = await RollFixtures.LoadedAsync();

        var smith = await db.HonourRoll.SingleAsync(p => p.ServiceNumber == "2222");
        Assert.Equal(("Navy", "smith, william", " william smith 2222 "), (smith.Service, smith.SortKey, smith.SearchText));
        var white = await db.HonourRoll.SingleAsync(p => p.ServiceNumber == "5715978");
        Assert.Equal(" james mungo white 5715978 ", white.SearchText);
        Assert.Equal(("Army", "White, James Mungo"), (white.Service, white.SortName));
        Assert.Contains("5th Battalion", white.Tours);
        Assert.Null((await db.HonourRoll.SingleAsync(p => p.ServiceNumber == "39426")).Service);          // no rank or corps recorded
    }

    [Fact]
    public async Task Sets_given_names_held_in_capitals_in_the_usual_way_and_leaves_mixed_case_alone()
    {
        var db = SearchFixtures.Db();

        await Import(db, RollFixtures.Json(
        [
            """{"_source":{"ServiceNumber":"1","FirstName":"DENNIS","SecondName":"ERIC","LastName":"ABRAHAM","Death":{"Date":"1969-01-01"}}}""",
            """{"_source":{"ServiceNumber":"2","FirstName":"Richard","SecondName":"McLEOD","LastName":"ABRAHAM","Death":{"Date":"1969-01-01"}}}""",
        ]));

        var names = await db.HonourRoll.OrderBy(p => p.ServiceNumber).Select(p => p.SortName).ToListAsync();
        Assert.Equal(["Abraham, Dennis Eric", "Abraham, Richard McLEOD"], names);
    }

    [Fact]
    public async Task Repeating_it_changes_nothing_and_a_changed_record_is_the_only_one_written()
    {
        var db = await RollFixtures.LoadedAsync();
        var changed = RollFixtures.Roll.Replace("\"Rank\":\"Private\",\"Branch\":\"Royal Australian Infantry Corps\",\"NationalService\"", "\"Rank\":\"Lance-Corporal\",\"Branch\":\"Royal Australian Infantry Corps\",\"NationalService\"");

        var again = await Import(db, RollFixtures.Roll);
        Assert.Equal((0, 0, 5), (again.Added, again.Updated, again.Unchanged));

        var edited = await Import(db, changed);
        Assert.Equal((0, 1, 4), (edited.Added, edited.Updated, edited.Unchanged));
        Assert.Equal("Lance-Corporal", (await db.HonourRoll.SingleAsync(p => p.ServiceNumber == "5715978")).Rank);
    }

    [Fact]
    public async Task Never_removes_anybody_so_the_table_can_be_added_to_after_the_import()
    {
        var db = await RollFixtures.LoadedAsync();
        var without = RollFixtures.Json(RollFixtures.Records.Where(r => !r.Contains("\"1111\"")).Append(
            """{"_source":{"ServiceNumber":"9999","FirstName":"New","LastName":"PERSON","Death":{"Date":"1971-01-01"}}}"""));

        var report = await Import(db, without);

        Assert.Equal((1, 0), (report.Added, report.Updated));
        Assert.Equal(6, await db.HonourRoll.CountAsync());                 // 1111 is still there
    }

    [Fact]
    public async Task A_dry_run_reports_what_it_would_do_and_writes_nothing()
    {
        var db = SearchFixtures.Db();

        var report = await Import(db, RollFixtures.Roll, dryRun: true);

        Assert.Equal(5, report.Added);
        Assert.Equal(0, await db.HonourRoll.CountAsync());
        Assert.Contains("dry run", report.ToString());
    }

    [Fact]
    public async Task Ignores_a_record_with_no_service_number_and_the_same_number_twice()
    {
        var json = RollFixtures.Json(
        [
            """{"_source":{"LastName":"NONUMBER","Death":{"Date":"1969-01-01"}}}""",
            """{"_source":{"ServiceNumber":"7","LastName":"ONE","Death":{"Date":"1969-01-01"}}}""",
            """{"_source":{"ServiceNumber":" 7 ","LastName":"TWO","Death":{"Date":"1969-01-01"}}}""",
        ]);

        var db = SearchFixtures.Db();
        var report = await Import(db, json);

        Assert.Equal(["One"], await db.HonourRoll.Select(p => p.Name).ToListAsync());
        Assert.Equal(1, report.Skipped["without a service number"]);
        Assert.Equal(1, report.Skipped["with a service number already seen"]);
    }

    [Fact]
    public async Task Reads_everyone_with_a_date_of_death_from_the_roll_index()
    {
        var stub = new RollFixtures.Stub(RollFixtures.Roll);

        var records = await LegacyRollReader.ReadAsync(new HttpClient(stub) { BaseAddress = new Uri("http://es.test/") }, "avw_nomroll");

        Assert.Equal(6, records.Count);
        Assert.Equal("/avw_nomroll/_search", stub.Calls[0].Path);
        Assert.Contains("\"exists\":{\"field\":\"Death.Date\"}", stub.Calls[0].Body);
        Assert.Contains($"\"size\":{LegacyRollReader.MaxPeople}", stub.Calls[0].Body);
    }

    [Fact]
    public async Task Fails_when_elasticsearch_will_not_answer()
    {
        var stub = new RollFixtures.Stub("{}") { Status = HttpStatusCode.Forbidden };

        await Assert.ThrowsAsync<HttpRequestException>(() => LegacyRollReader.ReadAsync(new HttpClient(stub) { BaseAddress = new Uri("http://es.test/") }, "avw_nomroll"));
    }
}

public class HonourRollRowsTests
{
    [Theory]
    [InlineData("Private", "Royal Australian Infantry Corps", "Army")]
    [InlineData("Private", null, "Army")]
    [InlineData(null, "Royal Australian Engineers", "Army")]
    [InlineData("Lieutenant", "Royal Australian Infantry Corps", "Army")]
    [InlineData("Lieutenant", "Supplementary List Seaman Branch", "Navy")]
    [InlineData("Able Seaman Clearance Diver", "Seaman", "Navy")]
    [InlineData("Leading Airman Aircrewman", "Naval Airman", "Navy")]
    [InlineData("Chief Electrician Weapons Radio", "Electrical", "Navy")]
    [InlineData("Lieutenant-Commander", null, "Navy")]
    [InlineData("Acting Sub-Lieutenant", null, "Navy")]
    [InlineData("Petty Officer Airman Aircrewman", null, "Navy")]
    [InlineData("Pilot Officer", "General Duties", "Air Force")]
    [InlineData("Leading Aircraftman", null, "Air Force")]
    [InlineData("Flight Lieutenant", null, "Air Force")]
    [InlineData("Wing Commander", null, "Air Force")]                      // a commander, but not of the Navy
    [InlineData(null, null, null)]
    public void Works_out_the_service_from_the_corps_and_the_rank_since_the_roll_does_not_say(string? rank, string? corps, string? expected) =>
        Assert.Equal(expected, HonourRollRows.ServiceOf(rank, corps));

    [Theory]
    [InlineData("Captain", "Captain")]
    [InlineData("(Temporary) Captain", "Captain")]
    [InlineData("(Acting) Lance-Corporal", "Lance-Corporal")]
    [InlineData("Temporary", "Temporary")]
    public void Sorts_a_rank_without_its_temporary_or_acting(string rank, string expected) => Assert.Equal(expected, HonourRollRows.RankSortKey(rank));
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

    [Theory]
    [InlineData("https://vietnam-war.au", "https://vietnam-war.au/battlemap?incident=2")]
    [InlineData("https://vietnam-war.au/", "https://vietnam-war.au/battlemap?incident=2")]
    [InlineData(null, "/battlemap?incident=2")]
    public void Turns_links_in_a_message_into_full_addresses_when_the_site_address_is_known(string? site, string expected)
    {
        var notifier = Notifier(recipients: new NotificationOptions { SiteUrl = site });

        var body = notifier.Render(new Notification("Subject", "Incident: {site}/battlemap?incident=2"));

        Assert.Equal("Incident: " + expected, body);
    }

    private sealed class ListLogger<T> : ILogger<T>
    {
        public List<string> Lines { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            lock (Lines)
            {
                Lines.Add($"{logLevel}: {formatter(state, exception)}");
            }
        }
    }

    [Fact]
    public async Task Says_at_start_up_whether_email_is_on_and_is_content_to_be_off()
    {
        var off = new ListLogger<EmailNotifier>();
        var notifier = new EmailNotifier(Options.Create(new SmtpOptions()), Options.Create(new NotificationOptions()), off);
        await notifier.StartAsync(default);
        notifier.Notify(new Notification("Waiting", "Body"));
        await Task.Delay(200);
        await notifier.StopAsync(default);

        Assert.Contains(off.Lines, l => l.StartsWith("Information: Email notifications are off") && l.Contains("Moderation page"));
        Assert.Contains(off.Lines, l => l.Contains("Notification not emailed") && l.Contains("Waiting"));
        Assert.DoesNotContain(off.Lines, l => l.StartsWith("Warning") || l.StartsWith("Error"));

        var on = new ListLogger<EmailNotifier>();
        var configured = new EmailNotifier(Options.Create(new SmtpOptions { Host = "smtp.test", From = "no-reply@example.com" }),
            Options.Create(new NotificationOptions { EditorEmails = ["a@example.com", "b@example.com"] }), on);
        await configured.StartAsync(default);
        await Task.Delay(100);
        await configured.StopAsync(default);

        Assert.Contains(on.Lines, l => l == "Information: Email notifications are on: 2 editor address(es) will be told when something is waiting");
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
