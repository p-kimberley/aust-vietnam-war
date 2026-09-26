using Avw.Core.Content;
using System.Net;
using System.Text.RegularExpressions;
using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Avw.Api.Cms;

/// <summary>
/// Saves and moves articles and pages through their workflow. The rules live here rather than in the endpoints so they
/// can be tested without HTTP, and so nothing (Studio, importer) can bypass sanitising, revisions or the role limits.
/// </summary>
/// <remarks>
/// An author creates and edits their own drafts and submits them for review. An editor or admin does everything else:
/// edits any item, publishes, schedules, archives, manages pages and the homepage feature flag.
/// </remarks>
public sealed partial class ArticleService(AvwDbContext db, ArticleMarkdown markdown, TimeProvider clock)
{
    public const int MaxBodyChars = 1_000_000;
    public const int MaxTags = 20;
    public const int MaxPageDepth = 5;
    private const int ExcerptChars = 200;

    /// <summary>How long one person's saves are folded into a single revision.</summary>
    public static readonly TimeSpan RevisionWindow = TimeSpan.FromMinutes(10);

    /// <summary>What may follow each status. Editors may take any of these; authors only the first two rows, on their own items.</summary>
    private static readonly Dictionary<ArticleStatus, ArticleStatus[]> Next = new()
    {
        [ArticleStatus.Draft] = [ArticleStatus.InReview, ArticleStatus.Scheduled, ArticleStatus.Published, ArticleStatus.Archived],
        [ArticleStatus.InReview] = [ArticleStatus.Draft, ArticleStatus.Scheduled, ArticleStatus.Published, ArticleStatus.Archived],
        [ArticleStatus.Scheduled] = [ArticleStatus.Draft, ArticleStatus.Published, ArticleStatus.Archived],
        [ArticleStatus.Published] = [ArticleStatus.Draft, ArticleStatus.Archived],
        [ArticleStatus.Archived] = [ArticleStatus.Draft, ArticleStatus.Published],
    };

    /// <summary>The statuses <paramref name="actor"/> may move <paramref name="article"/> to right now.</summary>
    public static ArticleStatus[] Transitions(Article article, Actor actor)
    {
        if (actor.IsEditor)
        {
            return Next[article.Status];
        }

        if (article.Kind != ContentKind.Article || article.AuthorId != actor.Id)
        {
            return [];
        }

        return article.Status switch
        {
            ArticleStatus.Draft => [ArticleStatus.InReview],
            ArticleStatus.InReview => [ArticleStatus.Draft],
            _ => [],
        };
    }

    public static bool CanEdit(Article article, Actor actor) =>
        actor.IsEditor || article is { Kind: ContentKind.Article, Status: ArticleStatus.Draft } && article.AuthorId == actor.Id;

    // ---------------------------------------------------------------- reading

    public async Task<CmsResult<ArticleEdit>> GetAsync(long id, Actor actor, CancellationToken ct)
    {
        var article = await db.Articles.AsNoTracking().Include(a => a.Author).Include(a => a.FeaturedMedia).Include(a => a.Tags).ThenInclude(t => t.Tag)
            .FirstOrDefaultAsync(a => a.Id == id, ct);
        return article is null || !CanSee(article, actor)
            ? CmsResult<ArticleEdit>.Fail(CmsError.NotFound, "There is no such item.")
            : CmsResult<ArticleEdit>.Success(ToEdit(article, actor));
    }

    public async Task<Paged<ArticleRow>> ListAsync(ArticleQuery q, Actor actor, CancellationToken ct)
    {
        var page = Math.Max(1, q.Page);
        var size = Math.Clamp(q.PageSize, 1, 100);

        var rows = db.Articles.AsNoTracking().AsQueryable();
        if (!actor.IsEditor)
        {
            rows = rows.Where(a => a.AuthorId == actor.Id && a.Kind == ContentKind.Article);
        }

        if (q.Kind is { } kind)
        {
            rows = rows.Where(a => a.Kind == kind);
        }

        if (q.Status is { } status)
        {
            rows = rows.Where(a => a.Status == status);
        }

        if (!string.IsNullOrWhiteSpace(q.Text))
        {
            var text = q.Text.Trim();
            rows = rows.Where(a => a.Title.Contains(text) || a.Slug.Contains(text));
        }

        var total = await rows.CountAsync(ct);
        var items = await rows
            .OrderByDescending(a => a.UpdatedUtc).ThenByDescending(a => a.Id)
            .Skip((page - 1) * size).Take(size)
            .Select(a => new ArticleRow(a.Id, a.Kind, a.Slug, a.Title, a.Status, a.Author.DisplayName,
                a.Category != null ? a.Category.Name : null, a.PublishedUtc, a.ScheduledUtc, a.UpdatedUtc))
            .ToListAsync(ct);
        return new Paged<ArticleRow>(items, total, page, size);
    }

    // ---------------------------------------------------------------- saving

    public async Task<CmsResult<ArticleEdit>> CreateAsync(ContentKind kind, ArticleInput input, Actor actor, CancellationToken ct)
    {
        if (kind == ContentKind.Page && !actor.IsEditor)
        {
            return CmsResult<ArticleEdit>.Fail(CmsError.Forbidden, "Only editors can create pages.");
        }

        var now = clock.GetUtcNow().UtcDateTime;
        var article = new Article
        {
            Kind = kind,
            Status = ArticleStatus.Draft,
            AuthorId = actor.Id,
            CreatedUtc = now,
            UpdatedUtc = now,
            Version = 1,
        };

        var applied = await ApplyAsync(article, input, actor, isNew: true, ct);
        if (applied is not null)
        {
            return CmsResult<ArticleEdit>.Invalid(applied.Value.Field, applied.Value.Message);
        }

        db.Articles.Add(article);
        AddRevision(article, actor, 1);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return CmsResult<ArticleEdit>.Fail(CmsError.Conflict, "That web address has just been taken by another item.", "slug");
        }

        return await GetAsync(article.Id, actor, ct);
    }

    public async Task<CmsResult<ArticleEdit>> UpdateAsync(long id, ArticleInput input, Actor actor, CancellationToken ct)
    {
        var article = await Load(id, ct);
        if (article is null || !CanSee(article, actor))
        {
            return CmsResult<ArticleEdit>.Fail(CmsError.NotFound, "There is no such item.");
        }

        if (!CanEdit(article, actor))
        {
            return CmsResult<ArticleEdit>.Fail(CmsError.Forbidden, "You cannot edit this item in its current state.");
        }

        if (input.Version != article.Version)
        {
            return Stale();
        }

        var oldTitle = article.Title;
        var oldBody = article.BodyMarkdown;
        var invalid = await ApplyAsync(article, input, actor, isNew: false, ct);
        if (invalid is not null)
        {
            return CmsResult<ArticleEdit>.Invalid(invalid.Value.Field, invalid.Value.Message);
        }

        if (article.Title != oldTitle || article.BodyMarkdown != oldBody)
        {
            await RecordRevisionAsync(article, actor, ct);
        }

        Touch(article);
        return await SaveAsync(article, actor, ct);
    }

    /// <summary>Moves an item to <paramref name="target"/> if the workflow and the actor's role allow it.</summary>
    public async Task<CmsResult<ArticleEdit>> TransitionAsync(long id, TransitionRequest request, Actor actor, CancellationToken ct)
    {
        var article = await Load(id, ct);
        if (article is null || !CanSee(article, actor))
        {
            return CmsResult<ArticleEdit>.Fail(CmsError.NotFound, "There is no such item.");
        }

        if (request.Version != article.Version)
        {
            return Stale();
        }

        var target = request.Status;
        if (!Transitions(article, actor).Contains(target))
        {
            return CmsResult<ArticleEdit>.Fail(
                actor.IsEditor ? CmsError.Invalid : CmsError.Forbidden,
                $"An item that is {article.Status} cannot be moved to {target} by you.");
        }

        var now = clock.GetUtcNow().UtcDateTime;
        if (target == ArticleStatus.Scheduled)
        {
            if (request.ScheduledUtc is not { } at || at <= now)
            {
                return CmsResult<ArticleEdit>.Invalid("scheduledUtc", "Choose a time in the future.");
            }

            article.ScheduledUtc = DateTime.SpecifyKind(at, DateTimeKind.Utc);
        }
        else
        {
            article.ScheduledUtc = null;
        }

        if (target == ArticleStatus.Published)
        {
            // A scheduled item published early takes today's date; one restored from the archive keeps its original.
            article.PublishedUtc = article.Status == ArticleStatus.Scheduled ? now : article.PublishedUtc ?? now;
        }

        article.Status = target;
        Touch(article);
        return await SaveAsync(article, actor, ct);
    }

    public async Task<CmsResult<ArticleEdit>> DeleteAsync(long id, Actor actor, CancellationToken ct)
    {
        var article = await Load(id, ct);
        if (article is null || !CanSee(article, actor))
        {
            return CmsResult<ArticleEdit>.Fail(CmsError.NotFound, "There is no such item.");
        }

        // Published work is archived rather than deleted, so a link that was shared never silently disappears.
        var deletable = article.Status is ArticleStatus.Draft or ArticleStatus.Archived;
        if (!deletable || !CanEdit(article, actor))
        {
            return CmsResult<ArticleEdit>.Fail(CmsError.Forbidden, "Only a draft or an archived item can be deleted.");
        }

        if (await db.Articles.AnyAsync(a => a.ParentId == id, ct))
        {
            return CmsResult<ArticleEdit>.Fail(CmsError.Conflict, "This page has child pages. Move or delete them first.");
        }

        var snapshot = ToEdit(article, actor);
        db.Articles.Remove(article);
        await db.SaveChangesAsync(ct);
        return CmsResult<ArticleEdit>.Success(snapshot);
    }

    // ---------------------------------------------------------------- revisions

    public async Task<CmsResult<List<RevisionSummary>>> RevisionsAsync(long id, Actor actor, CancellationToken ct)
    {
        var article = await db.Articles.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id, ct);
        if (article is null || !CanSee(article, actor))
        {
            return CmsResult<List<RevisionSummary>>.Fail(CmsError.NotFound, "There is no such item.");
        }

        var list = await db.ArticleRevisions.AsNoTracking()
            .Where(r => r.ArticleId == id)
            .OrderByDescending(r => r.RevisionNo)
            .Select(r => new RevisionSummary(r.RevisionNo, r.Title, r.CreatedBy.DisplayName, r.CreatedUtc))
            .ToListAsync(ct);
        return CmsResult<List<RevisionSummary>>.Success(list);
    }

    public async Task<CmsResult<RevisionDetail>> RevisionAsync(long id, int revisionNo, Actor actor, CancellationToken ct)
    {
        var article = await db.Articles.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id, ct);
        if (article is null || !CanSee(article, actor))
        {
            return CmsResult<RevisionDetail>.Fail(CmsError.NotFound, "There is no such item.");
        }

        var revision = await db.ArticleRevisions.AsNoTracking()
            .Where(r => r.ArticleId == id && r.RevisionNo == revisionNo)
            .Select(r => new { r.RevisionNo, r.Title, r.BodyMarkdown, Author = r.CreatedBy.DisplayName, r.CreatedUtc })
            .FirstOrDefaultAsync(ct);
        return revision is null
            ? CmsResult<RevisionDetail>.Fail(CmsError.NotFound, "There is no such revision.")
            : CmsResult<RevisionDetail>.Success(new RevisionDetail(
                revision.RevisionNo, revision.Title, revision.BodyMarkdown, markdown.ToHtml(revision.BodyMarkdown), revision.Author, revision.CreatedUtc));
    }

    /// <summary>Copies an old revision back as the current text. That is itself recorded as a new revision, so nothing is lost.</summary>
    public async Task<CmsResult<ArticleEdit>> RestoreAsync(long id, int revisionNo, RestoreRequest request, Actor actor, CancellationToken ct)
    {
        var article = await Load(id, ct);
        if (article is null || !CanSee(article, actor))
        {
            return CmsResult<ArticleEdit>.Fail(CmsError.NotFound, "There is no such item.");
        }

        if (!CanEdit(article, actor))
        {
            return CmsResult<ArticleEdit>.Fail(CmsError.Forbidden, "You cannot edit this item in its current state.");
        }

        if (request.Version != article.Version)
        {
            return Stale();
        }

        var revision = await db.ArticleRevisions.AsNoTracking()
            .FirstOrDefaultAsync(r => r.ArticleId == id && r.RevisionNo == revisionNo, ct);
        if (revision is null)
        {
            return CmsResult<ArticleEdit>.Fail(CmsError.NotFound, "There is no such revision.");
        }

        article.Title = revision.Title;
        article.BodyMarkdown = revision.BodyMarkdown;
        article.BodyHtml = markdown.ToHtml(revision.BodyMarkdown);          // rendered again, in case the rules have tightened since
        AddRevision(article, actor, await NextRevisionNo(id, ct));
        Touch(article);
        return await SaveAsync(article, actor, ct);
    }

    // ---------------------------------------------------------------- taxonomy

    public async Task<List<CategoryView>> CategoriesAsync(CancellationToken ct) =>
        await db.Categories.AsNoTracking().OrderBy(c => c.Name).Select(c => new CategoryView(c.Id, c.Slug, c.Name)).ToListAsync(ct);

    public async Task<CmsResult<CategoryView>> CreateCategoryAsync(string? name, Actor actor, CancellationToken ct)
    {
        if (!actor.IsEditor)
        {
            return CmsResult<CategoryView>.Fail(CmsError.Forbidden, "Only editors can add categories.");
        }

        name = name?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > 100)
        {
            return CmsResult<CategoryView>.Invalid("name", "Give the category a name of up to 100 characters.");
        }

        var slug = Slugs.From(name);
        var existing = await db.Categories.FirstOrDefaultAsync(c => c.Slug == slug, ct);
        if (existing is not null)
        {
            return CmsResult<CategoryView>.Success(new CategoryView(existing.Id, existing.Slug, existing.Name));
        }

        var category = new Category { Slug = slug, Name = name };
        db.Categories.Add(category);
        await db.SaveChangesAsync(ct);
        return CmsResult<CategoryView>.Success(new CategoryView(category.Id, category.Slug, category.Name));
    }

    public async Task<List<TagView>> TagsAsync(CancellationToken ct) =>
        await db.Tags.AsNoTracking().OrderBy(t => t.Name).Select(t => new TagView(t.Slug, t.Name)).ToListAsync(ct);

    // ---------------------------------------------------------------- internals

    private static bool CanSee(Article article, Actor actor) =>
        actor.IsEditor || article.Kind == ContentKind.Article && article.AuthorId == actor.Id;

    private Task<Article?> Load(long id, CancellationToken ct) =>
        db.Articles.Include(a => a.Tags).ThenInclude(t => t.Tag).Include(a => a.Author).Include(a => a.FeaturedMedia).FirstOrDefaultAsync(a => a.Id == id, ct);

    private static CmsResult<ArticleEdit> Stale() =>
        CmsResult<ArticleEdit>.Fail(CmsError.Conflict, "Someone else has changed this item since you opened it. Reload it to see their changes.");

    private void Touch(Article article)
    {
        article.UpdatedUtc = clock.GetUtcNow().UtcDateTime;
        article.Version++;
    }

    /// <summary>
    /// Autosave saves every few seconds of pause, so a revision per save would bury the history. Saves by the same person
    /// within <see cref="RevisionWindow"/> of the revision's start update it in place; the next save after that starts a
    /// new one. Restoring an old version is a deliberate act and always starts a new revision.
    /// </summary>
    private async Task RecordRevisionAsync(Article article, Actor actor, CancellationToken ct)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var last = await db.ArticleRevisions.OrderByDescending(r => r.RevisionNo).FirstOrDefaultAsync(r => r.ArticleId == article.Id, ct);
        if (last is not null && last.CreatedById == actor.Id && now - last.CreatedUtc < RevisionWindow)
        {
            last.Title = article.Title;
            last.BodyMarkdown = article.BodyMarkdown;
            return;
        }

        AddRevision(article, actor, (last?.RevisionNo ?? 0) + 1);
    }

    private async Task<int> NextRevisionNo(long articleId, CancellationToken ct) =>
        (await db.ArticleRevisions.Where(r => r.ArticleId == articleId).MaxAsync(r => (int?)r.RevisionNo, ct) ?? 0) + 1;

    private void AddRevision(Article article, Actor actor, int no) =>
        article.Revisions.Add(new ArticleRevision
        {
            RevisionNo = no,
            Title = article.Title,
            BodyMarkdown = article.BodyMarkdown,
            CreatedById = actor.Id,
            CreatedUtc = clock.GetUtcNow().UtcDateTime,
        });

    private async Task<CmsResult<ArticleEdit>> SaveAsync(Article article, Actor actor, CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Stale();
        }
        catch (DbUpdateException) when (article.Id != 0)
        {
            // The only unique constraint a save can trip is the slug, and a concurrent editor took it first.
            return CmsResult<ArticleEdit>.Fail(CmsError.Conflict, "That web address has just been taken by another item.", "slug");
        }

        return CmsResult<ArticleEdit>.Success(ToEdit(article, actor));
    }

    /// <summary>Validates <paramref name="input"/> and copies it onto <paramref name="article"/>. Returns the first problem, or null.</summary>
    private async Task<(string Field, string Message)?> ApplyAsync(Article article, ArticleInput input, Actor actor, bool isNew, CancellationToken ct)
    {
        var title = (input.Title ?? "").Trim();
        if (title.Length == 0 || title.Length > 300)
        {
            return ("title", "Give it a title of up to 300 characters.");
        }

        if ((input.BodyMarkdown?.Length ?? 0) > MaxBodyChars)
        {
            return ("bodyMarkdown", "The text is too long.");
        }

        if ((input.Excerpt?.Length ?? 0) > 1000 || (input.SeoTitle?.Length ?? 0) > 200 || (input.SeoDescription?.Length ?? 0) > 400)
        {
            return ("seo", "The summary or search-engine text is too long.");
        }

        var tagNames = (input.Tags ?? []).Select(t => t.Trim()).Where(t => t.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (tagNames.Count > MaxTags || tagNames.Any(t => t.Length > 100))
        {
            return ("tags", $"Use at most {MaxTags} tags of up to 100 characters each.");
        }

        var category = input.CategoryId;
        if (category is not null && !await db.Categories.AnyAsync(c => c.Id == category, ct))
        {
            return ("categoryId", "That category does not exist.");
        }

        if (input.FeaturedMediaId is { } media && !await db.MediaAssets.AnyAsync(m => m.Id == media && m.Status == MediaStatus.Approved, ct))
        {
            return ("featuredMediaId", "That image is not available.");
        }

        if (article.Kind == ContentKind.Page)
        {
            var parentProblem = await CheckParentAsync(article, input.ParentId, ct);
            if (parentProblem is not null)
            {
                return ("parentId", parentProblem);
            }
        }

        // The web address: an author never chooses it, and it does not follow later title edits (links must not move).
        var topLevelPage = article.Kind == ContentKind.Page && input.ParentId is null;
        var slugWanted = actor.IsEditor && !string.IsNullOrWhiteSpace(input.Slug) ? input.Slug.Trim() : null;
        if (slugWanted is not null && (!Slugs.IsValid(slugWanted) || topLevelPage && Slugs.IsReserved(slugWanted)))
        {
            return ("slug", "Use lower-case letters, digits and single hyphens, and not a name the site already uses.");
        }

        if (isNew || slugWanted is not null && slugWanted != article.Slug)
        {
            var baseSlug = slugWanted ?? Slugs.From(title);
            if (topLevelPage && Slugs.IsReserved(baseSlug))
            {
                baseSlug += "-page";
            }

            var kind = article.Kind;
            var self = article.Id;
            var taken = (await db.Articles.Where(a => a.Kind == kind && a.Id != self && a.Slug.StartsWith(baseSlug)).Select(a => a.Slug).ToListAsync(ct)).ToHashSet();
            if (slugWanted is not null && taken.Contains(slugWanted))
            {
                return ("slug", "Another item already uses that web address.");
            }

            article.Slug = Slugs.Unique(baseSlug, taken.Contains);
        }

        // The Markdown is kept as written; readers get it rendered and sanitised.
        article.BodyMarkdown = ArticleMarkdown.Normalise(input.BodyMarkdown);
        var body = markdown.ToHtml(article.BodyMarkdown);
        article.Title = title;
        article.BodyHtml = body;
        article.Excerpt = string.IsNullOrWhiteSpace(input.Excerpt) ? PlainText(body, ExcerptChars) : input.Excerpt.Trim();
        article.SeoTitle = Blank(input.SeoTitle);
        article.SeoDescription = Blank(input.SeoDescription);
        article.CategoryId = category;
        article.FeaturedMediaId = input.FeaturedMediaId;

        if (actor.IsEditor)
        {
            article.FeatureOnHomepage = input.FeatureOnHomepage;
            if (article.Kind == ContentKind.Page)
            {
                article.ParentId = input.ParentId;
                article.SortOrder = input.SortOrder;
            }
        }

        await SetTagsAsync(article, tagNames, ct);
        return null;
    }

    /// <summary>A page's parent must be a page that is not the page itself or one of its descendants, and the tree stays shallow.</summary>
    private async Task<string?> CheckParentAsync(Article page, long? parentId, CancellationToken ct)
    {
        var depth = 1;
        for (var cursor = parentId; cursor is not null; depth++)
        {
            if (cursor == page.Id && page.Id != 0)
            {
                return "A page cannot sit under itself.";
            }

            var parent = await db.Articles.AsNoTracking().Where(a => a.Id == cursor && a.Kind == ContentKind.Page)
                .Select(a => new { a.ParentId }).FirstOrDefaultAsync(ct);
            if (parent is null)
            {
                return "That parent page does not exist.";
            }

            if (depth >= MaxPageDepth)
            {
                return $"Pages can be nested at most {MaxPageDepth} levels deep.";
            }

            cursor = parent.ParentId;
        }

        return null;
    }

    private async Task SetTagsAsync(Article article, List<string> names, CancellationToken ct)
    {
        var wanted = names.Select(n => (Name: n, Slug: Slugs.From(n))).DistinctBy(t => t.Slug).ToList();
        var slugs = wanted.Select(t => t.Slug).ToList();
        var known = await db.Tags.Where(t => slugs.Contains(t.Slug)).ToDictionaryAsync(t => t.Slug, ct);

        // Change only the difference: removing and re-adding a link with the same key in one save upsets EF's tracking.
        foreach (var gone in article.Tags.Where(t => !slugs.Contains(t.Tag.Slug)).ToList())
        {
            article.Tags.Remove(gone);
        }

        var kept = article.Tags.Select(t => t.Tag.Slug).ToHashSet();
        foreach (var (name, slug) in wanted.Where(t => !kept.Contains(t.Slug)))
        {
            if (!known.TryGetValue(slug, out var tag))
            {
                tag = new Tag { Slug = slug, Name = name };
                db.Tags.Add(tag);
            }

            article.Tags.Add(new ArticleTag { Tag = tag });
        }
    }

    private static ArticleEdit ToEdit(Article a, Actor actor) => new(
        a.Id, a.Kind, a.Slug, a.Title, a.Excerpt, a.BodyMarkdown, a.BodyHtml, a.Status, a.AuthorId, a.Author?.DisplayName ?? "",
        a.CategoryId, a.FeaturedMediaId, a.FeaturedMedia is null ? null : PublicContent.MediaUrl(a.FeaturedMedia.Sha256), a.FeatureOnHomepage, a.ParentId, a.SortOrder, a.SeoTitle, a.SeoDescription,
        a.Tags.Select(t => t.Tag.Name).OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToArray(),
        a.PublishedUtc, a.ScheduledUtc, a.CreatedUtc, a.UpdatedUtc, a.Version, CanEdit(a, actor), Transitions(a, actor));

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    [GeneratedRegex("<[^>]*>")]
    private static partial Regex Tag();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();

    /// <summary>Where one block ends and the next begins, so words in adjacent paragraphs or headings do not run together.</summary>
    [GeneratedRegex(@"</(p|h[1-6]|li|blockquote|tr|div|figcaption|pre)>|<br\s*/?>", RegexOptions.IgnoreCase)]
    private static partial Regex BlockEnd();

    /// <summary>The visible text of sanitised HTML, cut at a word boundary. Used for excerpts and feeds.</summary>
    public static string PlainText(string html, int max)
    {
        var text = Spaces().Replace(WebUtility.HtmlDecode(Tag().Replace(BlockEnd().Replace(html, " "), "")), " ").Trim();
        if (text.Length <= max)
        {
            return text;
        }

        var cut = text.LastIndexOf(' ', max);
        return text[..(cut > max / 2 ? cut : max)].TrimEnd(' ', ',', ';', ':', '.') + "…";
    }
}
