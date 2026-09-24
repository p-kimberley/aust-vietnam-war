using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Avw.Api.Community;
using Avw.Api.Map;
using Avw.Api.Media;
using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Avw.Api.Tests;

/// <summary>A test that needs a real MySQL (full-text search is MySQL's own). Skipped unless AVW_TEST_MYSQL holds a connection string with rights to create a database.</summary>
public sealed class MySqlFactAttribute : FactAttribute
{
    public const string Variable = "AVW_TEST_MYSQL";

    public MySqlFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(Variable)))
        {
            Skip = $"Set {Variable} to a MySQL connection string (for example Server=127.0.0.1;Port=3307;User=root;Password=root) to run this.";
        }
    }
}

internal static class SearchFixtures
{
    public static readonly DateTime T0 = new(2026, 9, 20, 10, 0, 0, DateTimeKind.Utc);

    public static AvwDbContext Db() => new(new DbContextOptionsBuilder<AvwDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    /// <summary>A note whose approved text is <paramref name="approved"/>; a newer <paramref name="waiting"/> version, if given, is an edit still waiting for a moderator.</summary>
    public static IncidentNote Note(string title, string approved, string? waiting = null, bool everApproved = true, int contact = 2, string author = "Ann Member")
    {
        var note = new IncidentNote
        {
            ContactId = contact, AuthorName = author, CreatedUtc = T0, UpdatedUtc = T0, Status = everApproved && waiting is null ? ModerationStatus.Approved : ModerationStatus.Pending,
            LatestVersionNo = waiting is null ? 1 : 2, ApprovedVersionNo = everApproved ? 1 : null,
        };
        note.Versions.Add(new IncidentNoteVersion { VersionNo = 1, Title = title, Body = approved, CreatedUtc = T0 });
        if (waiting is not null)
        {
            note.Versions.Add(new IncidentNoteVersion { VersionNo = 2, Title = title, Body = waiting, CreatedUtc = T0.AddHours(1) });
        }

        return note;
    }

    public static IncidentMedia Picture(string caption, string? credit = null, MediaStatus status = MediaStatus.Approved, int? contact = null, double? lat = null, double? lon = null, string sha = "ab")
    {
        var asset = new MediaAsset { Sha256 = sha.PadRight(64, '0'), Width = 800, Height = 600, ByteSize = 1, ContentType = "image/jpeg", Caption = caption, Credit = credit, Status = status, UploadedById = 1, CreatedUtc = T0 };
        return new IncidentMedia { Media = asset, ContactId = contact, Lat = lat, Lon = lon, CreatedUtc = T0 };
    }
}

public class SearchTermsTests
{
    [Theory]
    [InlineData("claymore", "+claymore*", new[] { "claymore" })]
    [InlineData("  Nui   Dat ", "+Nui* +Dat*", new[] { "Nui", "Dat" })]
    [InlineData("\"Nui Dat\"", "+\"Nui Dat\"", new[] { "Nui", "Dat" })]
    [InlineData("ambush \"long tan\"", "+\"long tan\" +ambush*", new[] { "long", "tan", "ambush" })]
    [InlineData("Phước Đường", "+Phước* +Đường*", new[] { "Phước", "Đường" })]
    public void Turns_typed_words_into_required_prefix_words_and_quoted_phrases_into_required_phrases(string typed, string expected, string[] words)
    {
        var terms = SearchTerms.Parse(typed);

        Assert.Equal(expected, terms.Boolean);
        Assert.Equal(words, terms.Words);
    }

    [Theory]
    [InlineData("the of to")]                           // stop words the index does not hold: a required one would match nothing
    [InlineData("a b 5")]                                 // shorter than the index's smallest word
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("+ - * ~ < > ( ) @")]
    public void Drops_what_could_never_match_and_reports_nothing_left(string typed) => Assert.True(SearchTerms.Parse(typed).IsEmpty);

    [Fact]
    public void Keeps_only_letters_and_digits_so_nothing_typed_is_read_as_a_search_operator()
    {
        var terms = SearchTerms.Parse("+ambush -track* (\"x\") ~bunker >patrol @@ 'quote' ;drop table");

        Assert.Equal("+ambush* +track* +bunker* +patrol* +quote* +drop*", terms.Boolean);
        Assert.DoesNotContain('(', terms.Boolean);
        Assert.DoesNotContain(';', terms.Boolean);
    }

    [Fact]
    public void Stops_at_six_terms()
    {
        var terms = SearchTerms.Parse("alpha bravo charlie delta echo foxtrot golf hotel");

        Assert.Equal(6, terms.Boolean.Split(' ').Length);
        Assert.Equal(6, terms.Words.Count);
    }

    [Fact]
    public void A_stop_word_inside_a_phrase_is_kept_as_typed()
    {
        Assert.Equal("+\"battle of long tan\"", SearchTerms.Parse("\"battle of long tan\"").Boolean);
    }

    [Theory]
    [InlineData("Claymores were sited along the track", "claymor", true)]
    [InlineData("Claymores were sited along the track", "claymor track", true)]
    [InlineData("Claymores were sited along the track", "claymor helicopter", false)]
    [InlineData("Ambush near Phước Tuy", "phuoc", true)]                  // accents and case do not matter
    [InlineData("Patrol along Đường Nguyễn Trãi", "duong nguyen", true)]
    [InlineData("The ambushed platoon", "bush", false)]                   // a word matches by its start, not its middle
    public void Matches_words_by_their_start_ignoring_case_and_accents(string text, string typed, bool expected) =>
        Assert.Equal(expected, SearchTerms.Parse(typed).Matches(text));

    [Fact]
    public void A_snippet_is_a_short_stretch_round_the_first_match_with_the_matches_marked()
    {
        var body = string.Concat(Enumerable.Repeat("The platoon moved along the track at first light. ", 12)) + "A claymore was found beside the bunker. " + string.Concat(Enumerable.Repeat("Nothing more was seen. ", 12));

        var parts = SearchTerms.Parse("claymor bunker").Snippet(body);

        var text = string.Concat(parts.Select(p => p.Text));
        Assert.StartsWith("…", text);
        Assert.EndsWith("…", text);
        Assert.InRange(text.Length, 100, 170);
        Assert.Equal(["claymore", "bunker"], parts.Where(p => p.Match).Select(p => p.Text));
    }

    [Fact]
    public void A_match_near_the_start_needs_no_leading_ellipsis_and_a_short_text_none_at_all()
    {
        var parts = SearchTerms.Parse("ambush").Snippet("Ambush at the crossing.");

        Assert.Equal([new SnippetPart("Ambush", true), new SnippetPart(" at the crossing.", false)], parts);
    }
}

public class CommunitySearchTests
{
    private static async Task<CommunitySearchResult> Search(AvwDbContext db, string text, int limit = 5) => await new CommunitySearch(db).SearchAsync(text, limit, default);

    [Fact]
    public async Task Finds_notes_by_their_approved_text_and_never_by_an_edit_still_waiting_or_a_note_never_approved()
    {
        var db = SearchFixtures.Db();
        db.Notes.AddRange(
            SearchFixtures.Note("Ambush site", "Claymores were sited along the track.", waiting: "A helicopter landed here."),
            SearchFixtures.Note("Unapproved", "Claymores everywhere.", everApproved: false));
        await db.SaveChangesAsync();

        var found = await Search(db, "claymor");
        var note = Assert.Single(found.Notes);
        Assert.Equal(("Ambush site", 2, 1), (note.Title, note.ContactId, found.NoteTotal));
        Assert.Contains(note.Snippet, p => p is { Match: true, Text: "Claymores" });
        Assert.Empty((await Search(db, "helicopter")).Notes);                              // the edit is not public yet
    }

    [Fact]
    public async Task Every_word_must_be_present_and_the_title_is_searched_too()
    {
        var db = SearchFixtures.Db();
        db.Notes.Add(SearchFixtures.Note("Bunker system", "Found beside the creek."));
        await db.SaveChangesAsync();

        Assert.Single((await Search(db, "bunker creek")).Notes);
        Assert.Empty((await Search(db, "bunker helicopter")).Notes);
    }

    [Fact]
    public async Task Finds_across_accents_and_reports_the_total_when_only_the_best_few_are_returned()
    {
        var db = SearchFixtures.Db();
        db.Notes.AddRange(Enumerable.Range(1, 7).Select(i => SearchFixtures.Note($"Note {i}", $"Contact near Phước Tuy number {i}.")));
        await db.SaveChangesAsync();

        var found = await Search(db, "phuoc", limit: 3);

        Assert.Equal((3, 7), (found.Notes.Count, found.NoteTotal));
    }

    [Fact]
    public async Task Finds_approved_pictures_by_caption_or_credit_and_gives_where_they_are()
    {
        var db = SearchFixtures.Db();
        db.IncidentMedia.AddRange(
            SearchFixtures.Picture("A patrol at Nui Dat", "AWM", contact: 2, lat: 10.55, lon: 107.16, sha: "aa"),
            SearchFixtures.Picture("A patrol in the wet", "Private collection", status: MediaStatus.Pending, sha: "bb"),
            SearchFixtures.Picture("Helicopter landing", "Sgt Smith", sha: "cc"));
        await db.SaveChangesAsync();

        var byCaption = await Search(db, "patrol");
        var hit = Assert.Single(byCaption.Pictures);
        Assert.Equal(("A patrol at Nui Dat", "AWM", 2, 10.55), (hit.Caption, hit.Credit, hit.ContactId, hit.Lat));
        Assert.StartsWith("/media/uploads/aa/", hit.ThumbUrl);
        Assert.EndsWith("-480.jpg", hit.ThumbUrl);
        Assert.Single((await Search(db, "smith")).Pictures);
        Assert.Empty((await Search(db, "wet")).Pictures);                                    // not approved
    }

    [Fact]
    public async Task Finds_nothing_for_words_that_cannot_match()
    {
        var db = SearchFixtures.Db();
        db.Notes.Add(SearchFixtures.Note("Anything", "The platoon moved."));
        await db.SaveChangesAsync();

        var found = await Search(db, "the of");

        Assert.Equal((0, 0, 0, 0), (found.Notes.Count, found.NoteTotal, found.Pictures.Count, found.PictureTotal));
    }
}

public class GeoTests
{
    [Fact]
    public void One_degree_of_latitude_is_about_111_kilometres_and_a_place_is_nought_away_from_itself()
    {
        Assert.InRange(Geo.DistanceMetres(10, 107, 11, 107), 111_000, 111_400);
        Assert.Equal(0, Geo.DistanceMetres(10.55, 107.16, 10.55, 107.16), 6);
    }

    [Fact]
    public void A_degree_of_longitude_is_shorter_away_from_the_equator()
    {
        Assert.InRange(Geo.DistanceMetres(60, 10, 60, 11), 55_000, 56_000);
    }

    [Theory]
    [InlineData(10.55, 107.16, 2000)]
    [InlineData(60, 10, 5000)]
    public void The_box_holds_every_point_within_the_radius(double lat, double lon, double radius)
    {
        var (minLat, minLon, maxLat, maxLon) = Geo.Box(lat, lon, radius);

        foreach (var bearing in Enumerable.Range(0, 36).Select(i => i * 10 * Math.PI / 180))
        {
            var dLat = radius * 0.999 * Math.Cos(bearing) / 111_320.0;
            var dLon = radius * 0.999 * Math.Sin(bearing) / (111_320.0 * Math.Cos(lat * Math.PI / 180));
            Assert.InRange(lat + dLat, minLat, maxLat);
            Assert.InRange(lon + dLon, minLon, maxLon);
        }
    }
}

public sealed class CommunitySearchEndpointTests : IDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };
    private readonly ApiFactory _factory = new();

    public void Dispose() => _factory.Dispose();

    private HttpClient Http() => _factory.CreateClient();

    private void Seed(Action<AvwDbContext> add)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AvwDbContext>();
        db.Users.Add(new AppUser { Id = 1, Subject = "a", DisplayName = "Ann" });
        add(db);
        db.SaveChanges();
    }

    [Fact]
    public async Task Searches_notes_and_pictures_in_one_call_and_lets_it_be_cached_for_a_minute()
    {
        Seed(db =>
        {
            db.Notes.Add(SearchFixtures.Note("Ambush site", "Claymores were sited along the track."));
            db.IncidentMedia.Add(SearchFixtures.Picture("Claymore display", contact: 2, lat: 10.5, lon: 107.2));
        });

        var res = await Http().GetAsync("/api/community-search?q=claymor");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("max-age=60", res.Headers.CacheControl!.ToString());
        var body = (await res.Content.ReadFromJsonAsync<CommunitySearchResult>(Json))!;
        Assert.Equal(("Ambush site", 1, "Claymore display", 1), (body.Notes.Single().Title, body.NoteTotal, body.Pictures.Single().Caption, body.PictureTotal));
    }

    [Theory]
    [InlineData("")]
    [InlineData("a")]
    public async Task Refuses_search_text_that_is_too_short(string q) =>
        Assert.Equal(HttpStatusCode.BadRequest, (await Http().GetAsync($"/api/community-search?q={q}")).StatusCode);

    [Fact]
    public async Task Refuses_search_text_that_is_too_long_and_answers_a_query_of_only_stop_words_with_nothing()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await Http().GetAsync($"/api/community-search?q={new string('x', 101)}")).StatusCode);

        var body = (await Http().GetFromJsonAsync<CommunitySearchResult>("/api/community-search?q=the%20of", Json))!;
        Assert.Empty(body.Notes);
    }

    [Fact]
    public async Task Limits_a_client_to_a_generous_number_of_searches_a_minute()
    {
        var http = Http();
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 125; i++)
        {
            statuses.Add((await http.GetAsync("/api/community-search?q=ambush")).StatusCode);
        }

        Assert.Equal(120, statuses.Count(s => s == HttpStatusCode.OK));
        Assert.All(statuses.Skip(120), s => Assert.Equal(HttpStatusCode.TooManyRequests, s));
    }

    // ---------------------------------------------------------------- pictures near an incident (incident 2 is at 10.5525, 107.1653)

    private void SeedNearby() => Seed(db => db.IncidentMedia.AddRange(
        SearchFixtures.Picture("A: 560 m north, no incident", lat: 10.5575, lon: 107.1653, sha: "a1"),
        SearchFixtures.Picture("B: 1.1 km north, of incident 9", contact: 9, lat: 10.5625, lon: 107.1653, sha: "b1"),
        SearchFixtures.Picture("C: of this incident, so left out", contact: 2, lat: 10.5526, lon: 107.1653, sha: "c1"),
        SearchFixtures.Picture("D: 55 km away", lat: 11.05, lon: 107.1653, sha: "d1"),
        SearchFixtures.Picture("E: near but not approved", status: MediaStatus.Pending, lat: 10.5526, lon: 107.1654, sha: "e1"),
        SearchFixtures.Picture("F: no position", sha: "f1")));

    [Fact]
    public async Task Lists_pictures_near_an_incident_nearest_first_leaving_out_its_own_and_far_or_unapproved_or_unplaced_ones()
    {
        SeedNearby();

        var near = (await Http().GetFromJsonAsync<List<NearbyPicture>>("/api/contacts/2/nearby-media", Json))!;

        Assert.Equal(["A: 560 m north, no incident", "B: 1.1 km north, of incident 9"], near.Select(n => n.Caption));
        Assert.InRange(near[0].DistanceMetres, 550, 565);
        Assert.InRange(near[1].DistanceMetres, 1100, 1125);
        Assert.Equal((null, 9), (near[0].ContactId, near[1].ContactId));
    }

    [Fact]
    public async Task The_radius_and_the_number_returned_can_be_chosen()
    {
        SeedNearby();

        Assert.Single((await Http().GetFromJsonAsync<List<NearbyPicture>>("/api/contacts/2/nearby-media?radiusKm=0.8", Json))!);
        Assert.Single((await Http().GetFromJsonAsync<List<NearbyPicture>>("/api/contacts/2/nearby-media?limit=1", Json))!);
        Assert.Equal(2, (await Http().GetFromJsonAsync<List<NearbyPicture>>("/api/contacts/2/nearby-media?radiusKm=25&limit=24", Json))!.Count);      // A and B: D is 55 km away, so even the widest radius leaves it out
    }

    [Fact]
    public async Task Refuses_a_silly_radius_and_an_incident_that_does_not_exist()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await Http().GetAsync("/api/contacts/2/nearby-media?radiusKm=0.01")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Http().GetAsync("/api/contacts/2/nearby-media?radiusKm=30")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http().GetAsync("/api/contacts/999/nearby-media")).StatusCode);
    }
}

/// <summary>The real thing: full-text search on a real MySQL, in a database made for the test from the migrations (which also proves they run from nothing).</summary>
public sealed class MySqlFullTextTests : IAsyncLifetime
{
    private readonly string _database = "avw_test_" + Guid.NewGuid().ToString("N")[..10];
    private string? _admin;
    private AvwDbContext? _db;

    public async Task InitializeAsync()
    {
        _admin = Environment.GetEnvironmentVariable(MySqlFactAttribute.Variable);
        if (string.IsNullOrWhiteSpace(_admin))
        {
            return;
        }

        await using (var admin = new MySql.Data.MySqlClient.MySqlConnection(_admin))
        {
            await admin.OpenAsync();
            await using var create = new MySql.Data.MySqlClient.MySqlCommand($"CREATE DATABASE `{_database}` CHARACTER SET utf8mb4", admin);
            await create.ExecuteNonQueryAsync();
        }

        _db = new AvwDbContext(new DbContextOptionsBuilder<AvwDbContext>().UseMySQL($"{_admin.TrimEnd(';')};Database={_database}").Options);
        await _db.Database.MigrateAsync();
        _db.Users.Add(new AppUser { Id = 1, Subject = "s1", DisplayName = "Ann" });
        await _db.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        if (_db is null)
        {
            return;
        }

        await _db.DisposeAsync();
        await using var admin = new MySql.Data.MySqlClient.MySqlConnection(_admin);
        await admin.OpenAsync();
        await using var drop = new MySql.Data.MySqlClient.MySqlCommand($"DROP DATABASE IF EXISTS `{_database}`", admin);
        await drop.ExecuteNonQueryAsync();
    }

    [MySqlFact]
    public async Task Notes_are_found_by_whole_and_partial_words_phrases_and_accents_and_only_by_their_approved_text()
    {
        _db!.Notes.AddRange(
            SearchFixtures.Note("Ambush site", "Claymores were sited along the track near Phước Tuy. The Nui Dat task force was nearby.", waiting: "A helicopter landed at the crossing."),
            SearchFixtures.Note("Bunker system", "Bunkers found beside the creek, on Đường Nguyễn Trãi."),
            SearchFixtures.Note("Never approved", "Claymores claymores claymores.", everApproved: false));
        await _db.SaveChangesAsync();
        var search = new CommunitySearch(_db);
        async Task<(int Hits, int Total)> Try(string q) { var r = await search.SearchAsync(q, 10, default); return (r.Notes.Count, r.NoteTotal); }

        Assert.Equal((1, 1), await Try("claymore"));                                         // the exact word
        Assert.Equal((1, 1), await Try("claymor"));                                          // its start
        Assert.Equal((1, 1), await Try("claymor track"));                                    // every word
        Assert.Equal((0, 0), await Try("claymor creek"));                                    // not all in one note
        Assert.Equal((1, 1), await Try("\"Nui Dat\""));                                      // a phrase
        Assert.Equal((0, 0), await Try("\"Dat Nui\""));                                      // in the wrong order
        Assert.Equal((1, 1), await Try("phuoc"));                                            // accents do not matter, either way round
        Assert.Equal((1, 1), await Try("Phước"));
        Assert.Equal((1, 1), await Try("duong nguyen"));
        Assert.Equal((0, 0), await Try("helicopter"));                                       // an edit that is still waiting
        Assert.Equal((0, 0), await Try("\"battle of long tan\" -x (\"; DROP TABLE incident_notes"));      // nothing typed is an operator or reaches the SQL
        Assert.Equal(2, (await _db.Notes.CountAsync(n => n.ApprovedVersionNo != null)));      // the table is still there
    }

    [MySqlFact]
    public async Task Notes_are_ranked_by_relevance_and_the_snippet_marks_the_words()
    {
        _db!.Notes.AddRange(
            SearchFixtures.Note("Passing mention", "One claymore was mentioned in passing, among a great deal of other reporting about the day and the weather and the road."),
            SearchFixtures.Note("Claymore claymore", "The claymore field: claymore after claymore."));
        await _db.SaveChangesAsync();

        var found = await new CommunitySearch(_db).SearchAsync("claymore", 10, default);

        Assert.Equal(["Claymore claymore", "Passing mention"], found.Notes.Select(n => n.Title));
        Assert.Contains(found.Notes[0].Snippet, p => p is { Match: true });
    }

    [MySqlFact]
    public async Task Pictures_are_found_by_caption_or_credit_only_when_approved()
    {
        _db!.IncidentMedia.AddRange(
            SearchFixtures.Picture("A patrol at Nui Dat", "AWM", sha: "aa"),
            SearchFixtures.Picture("A patrol in the wet", "Private collection", status: MediaStatus.Pending, sha: "bb"),
            SearchFixtures.Picture("Bunker", "Sgt Nguyễn", sha: "cc"));
        await _db.SaveChangesAsync();
        var search = new CommunitySearch(_db);

        Assert.Equal(1, (await search.SearchAsync("patrol", 5, default)).PictureTotal);
        Assert.Equal(1, (await search.SearchAsync("nguyen", 5, default)).PictureTotal);         // credit, across accents
        Assert.Equal(0, (await search.SearchAsync("wet", 5, default)).PictureTotal);            // not approved
    }

    [MySqlFact]
    public async Task Pictures_near_an_incident_come_back_through_the_latitude_and_longitude_index()
    {
        _db!.IncidentMedia.AddRange(
            SearchFixtures.Picture("Near", lat: 10.5575, lon: 107.1653, sha: "aa"),
            SearchFixtures.Picture("Far", lat: 11.05, lon: 107.1653, sha: "bb"));
        await _db.SaveChangesAsync();
        var media = new IncidentMediaService(_db, null!, new FakeContactSource(), TimeProvider.System, new RecordingNotifier());

        var near = await media.NearbyAsync(2, 2000, 8, default);

        Assert.Equal(["Near"], near!.Select(n => n.Caption));
    }

    [MySqlFact]
    public async Task The_honour_roll_is_searched_sorted_and_counted_by_mysql_including_stop_words_and_short_names()
    {
        var extra = new[]
        {
            """{"_source":{"ServiceNumber":"55","FirstName":"Anh","LastName":"LE","Rank":"Private","Branch":"Royal Australian Infantry Corps","Death":{"Date":"1970-01-01"}}}""",
            """{"_source":{"ServiceNumber":"66","FirstName":"Will","LastName":"WILLIAMS","Rank":"Sapper","Branch":"Royal Australian Engineers","Death":{"Date":"1970-01-01"}}}""",
        };
        await RollFixtures.LoadedAsync(RollFixtures.Json(RollFixtures.Records.Concat(extra)), _db);
        var store = new HonourRollStore(_db!, Options.Create(new MediaOptions { RootPath = Path.GetTempPath() }));
        async Task<string[]> Find(string text, HonourFilter? filter = null) =>
            (await store.SearchAsync(text, filter ?? HonourFilter.None, false, 1, 50, default)).Items.Select(i => i.ServiceNumber).ToArray();

        Assert.Equal(["1111", "2222", "66"], await Find("will"));                 // "will" is a stop word the index does not hold, and is the start of William and Williams
        Assert.Equal(["1111", "2222", "66"], await Find("wil"));                  // an indexed word: found by the full-text index itself
        Assert.Equal(["2222"], await Find("will smi"));                           // a stop word and an indexed word together
        Assert.Equal(["55"], await Find("le"));                                   // two letters are not in the index either
        Assert.Equal(["55"], await Find("anh le"));
        Assert.Equal(["39426"], await Find("donald"));
        Assert.Equal(["5715978"], await Find("57159"));
        Assert.Equal(["5715978"], await Find("mungo"));
        Assert.Empty(await Find("ill"));

        var page = await store.SearchAsync(null, HonourFilter.None, true, 1, 50, default);
        Assert.Equal(7, page.Total);
        Assert.Equal(7, page.Items.Count);
        Assert.Equal(page.Items.Select(i => i.SortName!.ToLowerInvariant()).Order(StringComparer.Ordinal), page.Items.Select(i => i.SortName!.ToLowerInvariant()));      // by surname, whatever the case
        Assert.Equal([("Army", 4), ("Navy", 1), ("Air Force", 1)], page.Facets!.Services.Select(o => (o.Value, o.Count)));

        var soldiers = await store.SearchAsync("will", new HonourFilter(Service: "Army"), true, 1, 50, default);
        Assert.Equal(["66"], soldiers.Items.Select(i => i.ServiceNumber));
        Assert.Equal([("Army", 1), ("Navy", 1), ("Air Force", 1)], soldiers.Facets!.Services.Select(o => (o.Value, o.Count)));
        Assert.Equal(["Sapper"], soldiers.Facets.Ranks.Select(o => o.Value));
    }
}
