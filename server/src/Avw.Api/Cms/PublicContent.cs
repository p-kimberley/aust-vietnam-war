using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Avw.Api.Cms;

public sealed record ArticleCard(
    string Slug,
    string Title,
    string? Excerpt,
    DateTime PublishedUtc,
    string AuthorName,
    string? CategorySlug,
    string? CategoryName,
    string? ImageUrl,
    string? ImageCaption);

public sealed record ArticleView(
    string Slug,
    string Title,
    string? Excerpt,
    string BodyHtml,
    DateTime PublishedUtc,
    DateTime UpdatedUtc,
    string AuthorName,
    string? CategorySlug,
    string? CategoryName,
    string? ImageUrl,
    string? ImageCaption,
    string? SeoTitle,
    string? SeoDescription,
    IReadOnlyList<TagView> Tags,
    IReadOnlyList<ArticleCard> Related);

public sealed record PageLink(string Title, string Path);

public sealed record PageNode(string Title, string Path, IReadOnlyList<PageNode> Children);

public sealed record PageView(
    string Title,
    string Path,
    string BodyHtml,
    DateTime UpdatedUtc,
    string? SeoTitle,
    string? SeoDescription,
    IReadOnlyList<PageLink> Breadcrumbs,
    IReadOnlyList<PageLink> Children);

public sealed record SitemapEntry(string Path, DateTime UpdatedUtc);

/// <summary>Read-only queries behind the public site. Only published items whose time has come are ever visible.</summary>
public sealed class PublicContent(AvwDbContext db, TimeProvider clock)
{
    public const int MaxPageSize = 50;
    public const int MaxSearchChars = 100;

    /// <summary>Where a media asset is served from: <c>/media/&lt;first two hex&gt;/&lt;sha256&gt;.jpg</c> (see docs/rebuild-plan.md, section 6).</summary>
    public static string MediaUrl(string sha256) => $"/media/{sha256[..2]}/{sha256}.jpg";

    private IQueryable<Article> Live(ContentKind kind)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        return db.Articles.AsNoTracking()
            .Where(a => a.Kind == kind && a.Status == ArticleStatus.Published && a.PublishedUtc != null && a.PublishedUtc <= now);
    }

    public async Task<Paged<ArticleCard>> ArticlesAsync(string? category, string? tag, bool? featured, int page, int pageSize, CancellationToken ct, string? text = null)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        var q = Live(ContentKind.Article);
        if (!string.IsNullOrWhiteSpace(category))
        {
            q = q.Where(a => a.Category != null && a.Category.Slug == category);
        }

        if (!string.IsNullOrWhiteSpace(tag))
        {
            q = q.Where(a => a.Tags.Any(t => t.Tag.Slug == tag));
        }

        if (featured is true)
        {
            q = q.Where(a => a.FeatureOnHomepage);
        }

        if (text?.Trim() is { Length: > 0 } needle)
        {
            needle = needle.Length > MaxSearchChars ? needle[..MaxSearchChars] : needle;
            q = q.Where(a => a.Title.Contains(needle) || (a.Excerpt != null && a.Excerpt.Contains(needle)) || a.BodyHtml.Contains(needle));
        }

        var total = await q.CountAsync(ct);
        var rows = await q.OrderByDescending(a => a.PublishedUtc).ThenByDescending(a => a.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(a => new CardRow(a.Slug, a.Title, a.Excerpt, a.PublishedUtc!.Value, a.Author.DisplayName,
                a.Category != null ? a.Category.Slug : null, a.Category != null ? a.Category.Name : null,
                a.FeaturedMedia != null && a.FeaturedMedia.Status == MediaStatus.Approved ? a.FeaturedMedia.Sha256 : null,
                a.FeaturedMedia != null ? a.FeaturedMedia.Caption : null))
            .ToListAsync(ct);
        return new Paged<ArticleCard>(rows.Select(ToCard).ToList(), total, page, pageSize);
    }

    public async Task<ArticleView?> ArticleAsync(string slug, CancellationToken ct)
    {
        var a = await Live(ContentKind.Article).Where(x => x.Slug == slug)
            .Select(x => new
            {
                x.Id, x.Slug, x.Title, x.Excerpt, x.BodyHtml, Published = x.PublishedUtc!.Value, x.UpdatedUtc,
                Author = x.Author.DisplayName, x.CategoryId,
                CategorySlug = x.Category != null ? x.Category.Slug : null,
                CategoryName = x.Category != null ? x.Category.Name : null,
                Sha = x.FeaturedMedia != null && x.FeaturedMedia.Status == MediaStatus.Approved ? x.FeaturedMedia.Sha256 : null,
                Caption = x.FeaturedMedia != null ? x.FeaturedMedia.Caption : null,
                x.SeoTitle, x.SeoDescription,
                Tags = x.Tags.Select(t => new TagView(t.Tag.Slug, t.Tag.Name)).ToList(),
            })
            .FirstOrDefaultAsync(ct);
        if (a is null)
        {
            return null;
        }

        // Up to three more from the same category, newest first, so a reader has somewhere to go next.
        var related = a.CategoryId is null
            ? []
            : (await ArticlesAsync(a.CategorySlug, null, null, 1, 4, ct)).Items.Where(c => c.Slug != a.Slug).Take(3).ToList();

        return new ArticleView(a.Slug, a.Title, a.Excerpt, a.BodyHtml, a.Published, a.UpdatedUtc, a.Author, a.CategorySlug, a.CategoryName,
            a.Sha is null ? null : MediaUrl(a.Sha), a.Caption, a.SeoTitle, a.SeoDescription,
            a.Tags.OrderBy(t => t.Name).ToList(), related);
    }

    public async Task<List<CategoryView>> CategoriesAsync(CancellationToken ct)
    {
        // Only categories that have something to read.
        var now = clock.GetUtcNow().UtcDateTime;
        return await db.Categories.AsNoTracking()
            .Where(c => db.Articles.Any(a => a.CategoryId == c.Id && a.Kind == ContentKind.Article
                                             && a.Status == ArticleStatus.Published && a.PublishedUtc <= now))
            .OrderBy(c => c.Name)
            .Select(c => new CategoryView(c.Id, c.Slug, c.Name))
            .ToListAsync(ct);
    }

    // ---------------------------------------------------------------- pages

    private sealed record PageRow(long Id, long? ParentId, string Slug, string Title, int SortOrder);

    private async Task<List<PageRow>> PageRowsAsync(CancellationToken ct) =>
        await Live(ContentKind.Page).OrderBy(p => p.SortOrder).ThenBy(p => p.Title)
            .Select(p => new PageRow(p.Id, p.ParentId, p.Slug, p.Title, p.SortOrder)).ToListAsync(ct);

    /// <summary>The published pages as a tree. A page whose parent is not published is hidden with it.</summary>
    public async Task<IReadOnlyList<PageNode>> PageTreeAsync(CancellationToken ct)
    {
        var rows = await PageRowsAsync(ct);
        var byParent = rows.ToLookup(r => r.ParentId);

        List<PageNode> Build(long? parent, string prefix) =>
            byParent[parent].Select(r =>
            {
                var path = prefix + r.Slug;
                return new PageNode(r.Title, path, Build(r.Id, path + "/"));
            }).ToList();

        return Build(null, "");
    }

    /// <summary>Finds the page at <paramref name="path"/> (for example <c>about/team</c>). The whole chain must match and be published.</summary>
    public async Task<PageView?> PageAsync(string path, CancellationToken ct)
    {
        var segments = path.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0 || segments.Length > ArticleService.MaxPageDepth)
        {
            return null;
        }

        var rows = await PageRowsAsync(ct);

        PageRow? current = null;
        var crumbs = new List<PageLink>();
        var built = "";
        foreach (var segment in segments)
        {
            var parentId = current?.Id;
            current = rows.FirstOrDefault(r => r.ParentId == parentId && r.Slug == segment);
            if (current is null)
            {
                return null;
            }

            built += (built.Length == 0 ? "" : "/") + segment;
            crumbs.Add(new PageLink(current.Title, built));
        }

        var page = await Live(ContentKind.Page).Where(p => p.Id == current!.Id)
            .Select(p => new { p.BodyHtml, p.UpdatedUtc, p.SeoTitle, p.SeoDescription })
            .FirstAsync(ct);
        var children = rows.Where(r => r.ParentId == current!.Id).Select(r => new PageLink(r.Title, built + "/" + r.Slug)).ToList();
        return new PageView(current!.Title, built, page.BodyHtml, page.UpdatedUtc, page.SeoTitle, page.SeoDescription, crumbs.SkipLast(1).ToList(), children);
    }

    // ---------------------------------------------------------------- feeds

    public async Task<List<(ArticleCard Card, string BodyHtml)>> FeedAsync(int count, CancellationToken ct)
    {
        var rows = await Live(ContentKind.Article).OrderByDescending(a => a.PublishedUtc).ThenByDescending(a => a.Id).Take(count)
            .Select(a => new { Card = new CardRow(a.Slug, a.Title, a.Excerpt, a.PublishedUtc!.Value, a.Author.DisplayName,
                a.Category != null ? a.Category.Slug : null, a.Category != null ? a.Category.Name : null, null, null), a.BodyHtml })
            .ToListAsync(ct);
        return rows.Select(r => (ToCard(r.Card), r.BodyHtml)).ToList();
    }

    public async Task<List<SitemapEntry>> SitemapAsync(CancellationToken ct)
    {
        var articles = await Live(ContentKind.Article).Select(a => new { a.Slug, a.UpdatedUtc }).ToListAsync(ct);
        var tree = await PageTreeAsync(ct);
        var pages = await Live(ContentKind.Page).Select(a => new { a.Slug, a.UpdatedUtc }).ToListAsync(ct);
        var updated = pages.ToDictionary(p => p.Slug, p => p.UpdatedUtc);

        var entries = new List<SitemapEntry>();
        void Walk(IEnumerable<PageNode> nodes)
        {
            foreach (var n in nodes)
            {
                entries.Add(new SitemapEntry("/" + n.Path, updated.GetValueOrDefault(n.Path.Split('/')[^1])));
                Walk(n.Children);
            }
        }

        Walk(tree);
        entries.AddRange(articles.Select(a => new SitemapEntry("/articles/" + a.Slug, a.UpdatedUtc)));
        return entries;
    }

    private sealed record CardRow(string Slug, string Title, string? Excerpt, DateTime Published, string Author,
        string? CategorySlug, string? CategoryName, string? Sha, string? Caption);

    private static ArticleCard ToCard(CardRow r) => new(r.Slug, r.Title, r.Excerpt, r.Published, r.Author,
        r.CategorySlug, r.CategoryName, r.Sha is null ? null : MediaUrl(r.Sha), r.Caption);
}
