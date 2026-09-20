using System.Security.Claims;
using Avw.Api.Auth;
using Avw.Data.Entities;

namespace Avw.Api.Cms;

public enum CmsError
{
    None,
    NotFound,
    Forbidden,
    Conflict,
    Invalid,
    TooLarge,
    Unavailable,
}

/// <summary>The outcome of a CMS operation: a value, or an error the endpoint turns into a status code.</summary>
public sealed record CmsResult<T>(T? Value, CmsError Error = CmsError.None, string? Message = null, string? Field = null)
{
    public bool Ok => Error == CmsError.None;

    public static CmsResult<T> Success(T value) => new(value);
    public static CmsResult<T> Fail(CmsError error, string message, string? field = null) => new(default, error, message, field);
    public static CmsResult<T> Invalid(string field, string message) => new(default, CmsError.Invalid, message, field);
}

/// <summary>Who is acting. An editor (or admin) may do everything; an author only works on their own drafts.</summary>
public sealed record Actor(long Id, bool IsEditor)
{
    public static Actor? From(ClaimsPrincipal user)
    {
        if (!long.TryParse(user.FindFirstValue(UserSync.LocalIdClaim), out var id))
        {
            return null;
        }

        return new Actor(id, user.IsInRole(Roles.Editor) || user.IsInRole(Roles.Admin));
    }
}

/// <summary>What an editor sends when saving. <see cref="Version"/> is the version they loaded (0 for a new item).</summary>
public sealed record ArticleInput(
    string? Title,
    string? Slug,
    string? Excerpt,
    string? BodyHtml,
    long? CategoryId,
    long? FeaturedMediaId,
    bool FeatureOnHomepage,
    long? ParentId,
    int SortOrder,
    string? SeoTitle,
    string? SeoDescription,
    string[]? Tags,
    int Version);

/// <summary>Everything the Studio editor needs, including what the current user may do next.</summary>
public sealed record ArticleEdit(
    long Id,
    ContentKind Kind,
    string Slug,
    string Title,
    string? Excerpt,
    string BodyHtml,
    ArticleStatus Status,
    long AuthorId,
    string AuthorName,
    long? CategoryId,
    long? FeaturedMediaId,
    string? FeaturedMediaUrl,
    bool FeatureOnHomepage,
    long? ParentId,
    int SortOrder,
    string? SeoTitle,
    string? SeoDescription,
    string[] Tags,
    DateTime? PublishedUtc,
    DateTime? ScheduledUtc,
    DateTime CreatedUtc,
    DateTime UpdatedUtc,
    int Version,
    bool CanEdit,
    ArticleStatus[] Transitions);

/// <summary>One row of the Studio list.</summary>
public sealed record ArticleRow(
    long Id,
    ContentKind Kind,
    string Slug,
    string Title,
    ArticleStatus Status,
    string AuthorName,
    string? CategoryName,
    DateTime? PublishedUtc,
    DateTime? ScheduledUtc,
    DateTime UpdatedUtc);

public sealed record ArticleQuery(ContentKind? Kind, ArticleStatus? Status, string? Text, int Page, int PageSize);

public sealed record Paged<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);

public sealed record RevisionSummary(int RevisionNo, string Title, string AuthorName, DateTime CreatedUtc);

public sealed record RevisionDetail(int RevisionNo, string Title, string BodyHtml, string AuthorName, DateTime CreatedUtc);

public sealed record TransitionRequest(ArticleStatus Status, DateTime? ScheduledUtc, int Version);

public sealed record RestoreRequest(int Version);

public sealed record CategoryView(long Id, string Slug, string Name);

public sealed record TagView(string Slug, string Name);
