namespace Avw.Data.Entities;

public enum ContentKind
{
    Article,
    Page,
}

public enum ArticleStatus
{
    Draft,
    InReview,
    Scheduled,
    Published,
    Archived,
}

/// <summary>An article or a hierarchical page. Both share one table (see docs/rebuild-plan.md 4.2).</summary>
public class Article
{
    public long Id { get; set; }
    public ContentKind Kind { get; set; }
    public string Slug { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Excerpt { get; set; }

    /// <summary>The body as Markdown: what editors write, and what revisions keep.</summary>
    public string BodyMarkdown { get; set; } = "";

    /// <summary>
    /// The body as readers get it: rendered from <see cref="BodyMarkdown"/> on every save and put through the allowlist
    /// sanitiser. Never edited directly.
    /// </summary>
    public string BodyHtml { get; set; } = "";

    public ArticleStatus Status { get; set; }

    public long AuthorId { get; set; }
    public AppUser Author { get; set; } = null!;

    public long? CategoryId { get; set; }
    public Category? Category { get; set; }

    public long? FeaturedMediaId { get; set; }
    public MediaAsset? FeaturedMedia { get; set; }

    public bool FeatureOnHomepage { get; set; }

    /// <summary>Pages only: parent page and ordering among siblings.</summary>
    public long? ParentId { get; set; }
    public Article? Parent { get; set; }
    public int SortOrder { get; set; }

    public string? SeoTitle { get; set; }
    public string? SeoDescription { get; set; }

    public DateTime? PublishedUtc { get; set; }
    public DateTime? ScheduledUtc { get; set; }
    public DateTime CreatedUtc { get; set; }
    public DateTime UpdatedUtc { get; set; }

    /// <summary>Optimistic concurrency token, incremented on every save.</summary>
    public int Version { get; set; }

    public List<ArticleTag> Tags { get; set; } = [];
    public List<ArticleRevision> Revisions { get; set; } = [];
}

public class ArticleRevision
{
    public long Id { get; set; }
    public long ArticleId { get; set; }
    public Article Article { get; set; } = null!;
    public int RevisionNo { get; set; }
    public string Title { get; set; } = "";

    /// <summary>The body as Markdown, as it was at this revision.</summary>
    public string BodyMarkdown { get; set; } = "";
    public long CreatedById { get; set; }
    public AppUser CreatedBy { get; set; } = null!;
    public DateTime CreatedUtc { get; set; }
}
