using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Xml.Linq;
using Avw.Api.Cms;
using Avw.Data;
using Avw.Data.Entities;
using Microsoft.Extensions.DependencyInjection;

namespace Avw.Api.Tests;

/// <summary>A fresh in-memory site per test, because publishing in one test must not change what another sees.</summary>
public sealed class CmsEndpointTests : IDisposable
{
    private readonly ApiFactory factory = new();

    public void Dispose() => factory.Dispose();

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };
    private static readonly DateTime Past = DateTime.UtcNow.AddDays(-10);

    private HttpClient Client() => factory.CreateClient(new() { AllowAutoRedirect = false });

    private static HttpRequestMessage Req(HttpMethod method, string url, string? role = null, long uid = 1, object? body = null, bool csrf = true)
    {
        var req = new HttpRequestMessage(method, url);
        if (role is not null)
        {
            req.Headers.Add("X-Test-User", "Test User");
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

    private void Seed()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AvwDbContext>();
        if (db.Users.Any())
        {
            return;
        }

        db.Users.AddRange(new AppUser { Id = 1, Subject = "a", DisplayName = "Ann Author" }, new AppUser { Id = 3, Subject = "e", DisplayName = "Ed Editor" });
        var category = new Category { Id = 1, Slug = "battles", Name = "Battles" };
        db.Categories.Add(category);
        db.MediaAssets.Add(new MediaAsset { Id = 1, Sha256 = new string('a', 64), Status = MediaStatus.Approved, UploadedById = 1, Width = 800, Height = 600, Caption = "A patrol" });

        Article Make(long id, string slug, string title, ArticleStatus status, DateTime? published, ContentKind kind = ContentKind.Article,
            long? parent = null, bool feature = false, long? cat = null, long? media = null, int sort = 0) => new()
        {
            Id = id, Kind = kind, Slug = slug, Title = title, Status = status, PublishedUtc = published, AuthorId = 1, ParentId = parent,
            BodyHtml = $"<p>Body of {title} & more.</p>", Excerpt = $"About {title}", FeatureOnHomepage = feature, CategoryId = cat,
            FeaturedMediaId = media, SortOrder = sort, CreatedUtc = Past, UpdatedUtc = Past, Version = 1,
        };

        db.Articles.AddRange(
            Make(10, "long-tan", "Long Tan", ArticleStatus.Published, Past, feature: true, cat: 1, media: 1),
            Make(11, "coral", "Coral & Balmoral", ArticleStatus.Published, Past.AddDays(1), cat: 1),
            Make(12, "draft-piece", "Draft piece", ArticleStatus.Draft, null),
            Make(13, "in-review", "In review", ArticleStatus.InReview, null),
            Make(14, "future", "Future piece", ArticleStatus.Published, DateTime.UtcNow.AddDays(3)),
            Make(15, "old", "Archived piece", ArticleStatus.Archived, Past),
            Make(20, "about", "About", ArticleStatus.Published, Past, ContentKind.Page, sort: 1),
            Make(21, "team", "Team", ArticleStatus.Published, Past, ContentKind.Page, parent: 20),
            Make(22, "secret", "Secret page", ArticleStatus.Draft, null, ContentKind.Page, parent: 20),
            Make(23, "hidden-child", "Hidden child", ArticleStatus.Published, Past, ContentKind.Page, parent: 22),
            Make(24, "help", "Help", ArticleStatus.Published, Past, ContentKind.Page, sort: 2));
        db.SaveChanges();
    }

    private async Task<T> Get<T>(string url)
    {
        Seed();
        var res = await Client().GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<T>(Json))!;
    }

    // ------------------------------------------------------------ public

    [Fact]
    public async Task Lists_published_articles_newest_first_and_never_a_draft_a_future_or_an_archived_one()
    {
        var page = await Get<Paged<ArticleCard>>("/api/content/articles");

        Assert.Equal(["coral", "long-tan"], page.Items.Select(a => a.Slug));
        Assert.Equal(2, page.Total);
        Assert.Equal("Battles", page.Items[0].CategoryName);
        Assert.Equal("/media/aa/" + new string('a', 64) + ".jpg", page.Items[1].ImageUrl);
    }

    [Fact]
    public async Task Filters_by_category_and_by_the_homepage_flag_and_pages_the_results()
    {
        Assert.Equal(["long-tan"], (await Get<Paged<ArticleCard>>("/api/content/articles?featured=true")).Items.Select(a => a.Slug));
        Assert.Equal(2, (await Get<Paged<ArticleCard>>("/api/content/articles?category=battles")).Total);
        Assert.Empty((await Get<Paged<ArticleCard>>("/api/content/articles?category=nothing")).Items);

        var second = await Get<Paged<ArticleCard>>("/api/content/articles?pageSize=1&page=2");
        Assert.Equal(["long-tan"], second.Items.Select(a => a.Slug));
        Assert.Equal((2, 1), (second.Total, second.PageSize));
        Assert.Equal(PublicContent.MaxPageSize, (await Get<Paged<ArticleCard>>("/api/content/articles?pageSize=5000")).PageSize);
    }

    [Fact]
    public async Task Serves_a_published_article_with_related_reading_and_a_short_shared_cache()
    {
        Seed();
        var res = await Client().GetAsync("/api/content/articles/long-tan");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("max-age=60", res.Headers.CacheControl!.ToString());
        var article = (await res.Content.ReadFromJsonAsync<ArticleView>(Json))!;
        Assert.Equal(("Long Tan", "Ann Author", "A patrol"), (article.Title, article.AuthorName, article.ImageCaption));
        Assert.Equal(["coral"], article.Related.Select(r => r.Slug));
    }

    [Theory]
    [InlineData("draft-piece")]
    [InlineData("in-review")]
    [InlineData("future")]
    [InlineData("old")]
    [InlineData("about")]                          // a page is not an article
    [InlineData("nope")]
    public async Task Does_not_reveal_an_article_that_is_not_published_yet(string slug)
    {
        Seed();
        var res = await Client().GetAsync("/api/content/articles/" + slug);

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task Builds_the_page_tree_from_published_pages_only()
    {
        var tree = await Get<List<PageNode>>("/api/content/pages");

        Assert.Equal(["about", "help"], tree.Select(n => n.Path));
        Assert.Equal(["about/team"], tree[0].Children.Select(n => n.Path));       // the draft "secret" and its published child are both hidden
    }

    [Fact]
    public async Task Finds_a_nested_page_by_its_path_with_breadcrumbs_and_only_the_right_chain()
    {
        var team = await Get<PageView>("/api/content/page/about/team");
        Assert.Equal(("Team", "about/team"), (team.Title, team.Path));
        Assert.Equal(["about"], team.Breadcrumbs.Select(b => b.Path));

        var about = await Get<PageView>("/api/content/page/about");
        Assert.Equal(["about/team"], about.Children.Select(c => c.Path));

        Seed();
        foreach (var path in new[] { "team", "help/team", "about/secret", "about/secret/hidden-child", "missing" })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await Client().GetAsync("/api/content/page/" + path)).StatusCode);
        }
    }

    [Fact]
    public async Task Publishes_an_rss_feed_with_escaped_text_and_absolute_links()
    {
        Seed();
        var res = await Client().GetAsync("/api/content/feed.xml");

        Assert.Equal("application/rss+xml", res.Content.Headers.ContentType!.MediaType);
        var doc = XDocument.Parse(await res.Content.ReadAsStringAsync());
        var items = doc.Descendants("item").ToList();
        Assert.Equal(["Coral & Balmoral", "Long Tan"], items.Select(i => i.Element("title")!.Value));
        Assert.StartsWith("http://localhost/articles/coral", items[0].Element("link")!.Value);
        Assert.Equal("About Coral & Balmoral", items[0].Element("description")!.Value);
    }

    [Fact]
    public async Task Publishes_a_sitemap_of_the_public_pages_and_articles()
    {
        Seed();
        var res = await Client().GetAsync("/api/content/sitemap.xml");

        var doc = XDocument.Parse(await res.Content.ReadAsStringAsync());
        var locs = doc.Descendants().Where(e => e.Name.LocalName == "loc").Select(e => e.Value).ToList();
        Assert.Contains("http://localhost/articles/long-tan", locs);
        Assert.Contains("http://localhost/about/team", locs);
        Assert.Contains("http://localhost/battlemap", locs);
        Assert.DoesNotContain(locs, l => l.Contains("draft-piece") || l.Contains("secret") || l.Contains("future"));
    }

    // ------------------------------------------------------------ studio

    [Fact]
    public async Task Studio_is_closed_to_anonymous_visitors_and_to_plain_members()
    {
        Seed();

        Assert.NotEqual(HttpStatusCode.OK, (await Client().SendAsync(Req(HttpMethod.Get, "/api/studio/articles"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Client().SendAsync(Req(HttpMethod.Get, "/api/studio/articles", role: "member"))).StatusCode);
    }

    [Fact]
    public async Task An_author_creates_edits_and_submits_a_draft_over_http()
    {
        Seed();
        var http = Client();

        var created = await http.SendAsync(Req(HttpMethod.Post, "/api/studio/articles", "author", 1,
            new ArticleInput("My story", null, null, "<p>Once.</p><script>x</script>", null, null, false, null, 0, null, null, ["tag one"], 0)));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var a = (await created.Content.ReadFromJsonAsync<ArticleEdit>(Json))!;
        Assert.Equal(("my-story", "<p>Once.</p>", ArticleStatus.Draft), (a.Slug, a.BodyHtml, a.Status));

        var saved = await http.SendAsync(Req(HttpMethod.Put, $"/api/studio/articles/{a.Id}", "author", 1,
            new ArticleInput("My story, revised", null, null, "<p>Twice.</p>", null, null, false, null, 0, null, null, null, a.Version)));
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var b = (await saved.Content.ReadFromJsonAsync<ArticleEdit>(Json))!;

        var moved = await http.SendAsync(Req(HttpMethod.Post, $"/api/studio/articles/{a.Id}/status", "author", 1,
            new TransitionRequest(ArticleStatus.InReview, null, b.Version)));
        Assert.Equal(ArticleStatus.InReview, (await moved.Content.ReadFromJsonAsync<ArticleEdit>(Json))!.Status);

        var revisions = await http.SendAsync(Req(HttpMethod.Get, $"/api/studio/articles/{a.Id}/revisions", "author", 1));
        Assert.Equal(2, (await revisions.Content.ReadFromJsonAsync<List<RevisionSummary>>(Json))!.Count);
    }

    [Fact]
    public async Task Answers_with_the_right_status_for_each_kind_of_refusal()
    {
        Seed();
        var http = Client();
        var input = new ArticleInput("Odd", null, null, "", null, null, false, null, 0, null, null, null, 0);

        var invalid = await http.SendAsync(Req(HttpMethod.Post, "/api/studio/articles", "author", 1, input with { Title = "" }));
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal("title", JsonDocument.Parse(await invalid.Content.ReadAsStringAsync()).RootElement.GetProperty("field").GetString());

        Assert.Equal(HttpStatusCode.Forbidden, (await http.SendAsync(Req(HttpMethod.Post, "/api/studio/articles?kind=Page", "author", 1, input))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await http.SendAsync(Req(HttpMethod.Get, "/api/studio/articles/9999", "editor", 3))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await http.SendAsync(Req(HttpMethod.Put, "/api/studio/articles/12", "editor", 3, input with { Version = 7 }))).StatusCode);
    }

    [Fact]
    public async Task Rejects_a_change_that_does_not_carry_the_anti_forgery_header()
    {
        Seed();
        var input = new ArticleInput("Odd", null, null, "", null, null, false, null, 0, null, null, null, 0);

        var res = await Client().SendAsync(Req(HttpMethod.Post, "/api/studio/articles", "editor", 3, input, csrf: false));

        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }

    [Fact]
    public async Task An_editor_publishes_and_the_article_becomes_public()
    {
        Seed();
        var http = Client();
        var created = await http.SendAsync(Req(HttpMethod.Post, "/api/studio/articles", "editor", 3,
            new ArticleInput("Fresh news", null, "Summary", "<p>News.</p>", null, null, false, null, 0, null, null, null, 0)));
        var a = (await created.Content.ReadFromJsonAsync<ArticleEdit>(Json))!;
        Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync("/api/content/articles/" + a.Slug)).StatusCode);

        var pub = await http.SendAsync(Req(HttpMethod.Post, $"/api/studio/articles/{a.Id}/status", "editor", 3, new TransitionRequest(ArticleStatus.Published, null, a.Version)));
        Assert.Equal(HttpStatusCode.OK, pub.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await http.GetAsync("/api/content/articles/" + a.Slug)).StatusCode);
    }

    [Fact]
    public async Task Lists_studio_items_for_an_editor_with_filters()
    {
        Seed();
        var res = await Client().SendAsync(Req(HttpMethod.Get, "/api/studio/articles?status=Draft&kind=Article", "editor", 3));

        var page = (await res.Content.ReadFromJsonAsync<Paged<ArticleRow>>(Json))!;
        Assert.Contains(page.Items, r => r.Slug == "draft-piece");
        Assert.All(page.Items, r => Assert.Equal(ArticleStatus.Draft, r.Status));
    }
}
