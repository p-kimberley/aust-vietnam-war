using System.Security.Claims;
using Avw.Api.Auth;
using Avw.Data.Entities;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Avw.Api.Cms;

public static class CmsEndpoints
{
    public const string DefaultSiteName = "Australia's Vietnam War";
    private const string PublicCache = "public, max-age=60, stale-while-revalidate=300";

    public static IServiceCollection AddAvwCms(this IServiceCollection services)
    {
        services.AddSingleton<ContentSanitizer>();
        services.AddScoped<ArticleService>();
        services.AddScoped<PublicContent>();
        return services;
    }

    public static void MapCmsEndpoints(this IEndpointRouteBuilder api, IConfiguration config)
    {
        MapPublic(api, config);
        MapStudio(api);
    }

    // ---------------------------------------------------------------- public

    private static void MapPublic(IEndpointRouteBuilder api, IConfiguration config)
    {
        var siteName = config["Site:Name"] ?? DefaultSiteName;
        var g = api.MapGroup("/content").WithTags("Content");

        // Short shared caching: a publish shows within a minute, and a burst of readers costs one query.
        g.MapGet("/articles", async (PublicContent content, HttpContext ctx, string? category, string? tag, bool? featured, string? q, int? page, int? pageSize, CancellationToken ct) =>
            {
                ctx.Response.Headers.CacheControl = PublicCache;
                return await content.ArticlesAsync(category, tag, featured, page ?? 1, pageSize ?? 12, ct, q);
            })
            .WithName("GetArticles")
            .Produces<Paged<ArticleCard>>();

        g.MapGet("/articles/{slug}", async (string slug, PublicContent content, HttpContext ctx, CancellationToken ct) =>
            {
                var article = await content.ArticleAsync(slug, ct);
                if (article is null)
                {
                    return Results.NotFound();
                }

                ctx.Response.Headers.CacheControl = PublicCache;
                return Results.Ok(article);
            })
            .WithName("GetArticle")
            .Produces<ArticleView>()
            .Produces(StatusCodes.Status404NotFound);

        g.MapGet("/categories", async (PublicContent content, HttpContext ctx, CancellationToken ct) =>
            {
                ctx.Response.Headers.CacheControl = PublicCache;
                return await content.CategoriesAsync(ct);
            })
            .WithName("GetCategories")
            .Produces<List<CategoryView>>();

        g.MapGet("/pages", async (PublicContent content, HttpContext ctx, CancellationToken ct) =>
            {
                ctx.Response.Headers.CacheControl = PublicCache;
                return await content.PageTreeAsync(ct);
            })
            .WithName("GetPageTree")
            .Produces<IReadOnlyList<PageNode>>();

        // A catch-all so a nested path such as about/team is one request.
        g.MapGet("/page/{**path}", async (string path, PublicContent content, HttpContext ctx, CancellationToken ct) =>
            {
                var page = await content.PageAsync(path, ct);
                if (page is null)
                {
                    return Results.NotFound();
                }

                ctx.Response.Headers.CacheControl = PublicCache;
                return Results.Ok(page);
            })
            .WithName("GetPage")
            .Produces<PageView>()
            .Produces(StatusCodes.Status404NotFound);

        g.MapGet("/feed.xml", async (PublicContent content, HttpContext ctx, CancellationToken ct) =>
            {
                var items = await content.FeedAsync(30, ct);
                ctx.Response.Headers.CacheControl = PublicCache;
                return Results.Text(
                    Feeds.Rss(siteName, "Stories and research about Australians in the Vietnam War.", BaseUrl(ctx), items),
                    "application/rss+xml; charset=utf-8");
            })
            .WithName("GetFeed")
            .ExcludeFromDescription();

        g.MapGet("/sitemap.xml", async (PublicContent content, HttpContext ctx, CancellationToken ct) =>
            {
                ctx.Response.Headers.CacheControl = PublicCache;
                return Results.Text(Feeds.Sitemap(BaseUrl(ctx), await content.SitemapAsync(ct)), "application/xml; charset=utf-8");
            })
            .WithName("GetSitemap")
            .ExcludeFromDescription();
    }

    /// <summary>The public origin, taken from the forwarded headers the ingress sets.</summary>
    private static string BaseUrl(HttpContext ctx) => $"{ctx.Request.Scheme}://{ctx.Request.Host}";

    // ---------------------------------------------------------------- studio

    private static void MapStudio(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/studio").WithTags("Studio").RequireAuthorization(Policies.Author);

        g.MapGet("/articles", async (ArticleService svc, ClaimsPrincipal user, ContentKind? kind, ArticleStatus? status, string? q, int? page, int? pageSize, CancellationToken ct) =>
                Acting(user, out var actor)
                    ? Results.Ok(await svc.ListAsync(new ArticleQuery(kind, status, q, page ?? 1, pageSize ?? 25), actor, ct))
                    : Results.Forbid())
            .WithName("StudioListArticles")
            .Produces<Paged<ArticleRow>>();

        g.MapGet("/articles/{id:long}", async (long id, ArticleService svc, ClaimsPrincipal user, CancellationToken ct) =>
                Acting(user, out var actor) ? Respond(await svc.GetAsync(id, actor, ct)) : Results.Forbid())
            .WithName("StudioGetArticle")
            .Produces<ArticleEdit>();

        g.MapPost("/articles", async (ArticleInput input, ContentKind? kind, ArticleService svc, ClaimsPrincipal user, CancellationToken ct) =>
                Acting(user, out var actor)
                    ? Respond(await svc.CreateAsync(kind ?? ContentKind.Article, input, actor, ct), created: true)
                    : Results.Forbid())
            .WithName("StudioCreateArticle")
            .Produces<ArticleEdit>(StatusCodes.Status201Created);

        g.MapPut("/articles/{id:long}", async (long id, ArticleInput input, ArticleService svc, ClaimsPrincipal user, CancellationToken ct) =>
                Acting(user, out var actor) ? Respond(await svc.UpdateAsync(id, input, actor, ct)) : Results.Forbid())
            .WithName("StudioUpdateArticle")
            .Produces<ArticleEdit>();

        g.MapPost("/articles/{id:long}/status", async (long id, TransitionRequest request, ArticleService svc, ClaimsPrincipal user, CancellationToken ct) =>
                Acting(user, out var actor) ? Respond(await svc.TransitionAsync(id, request, actor, ct)) : Results.Forbid())
            .WithName("StudioTransitionArticle")
            .Produces<ArticleEdit>();

        g.MapDelete("/articles/{id:long}", async (long id, ArticleService svc, ClaimsPrincipal user, CancellationToken ct) =>
            {
                if (!Acting(user, out var actor))
                {
                    return Results.Forbid();
                }

                var result = await svc.DeleteAsync(id, actor, ct);
                return result.Ok ? Results.NoContent() : Respond(result);
            })
            .WithName("StudioDeleteArticle");

        g.MapGet("/articles/{id:long}/revisions", async (long id, ArticleService svc, ClaimsPrincipal user, CancellationToken ct) =>
                Acting(user, out var actor) ? Respond(await svc.RevisionsAsync(id, actor, ct)) : Results.Forbid())
            .WithName("StudioListRevisions")
            .Produces<List<RevisionSummary>>();

        g.MapGet("/articles/{id:long}/revisions/{no:int}", async (long id, int no, ArticleService svc, ClaimsPrincipal user, CancellationToken ct) =>
                Acting(user, out var actor) ? Respond(await svc.RevisionAsync(id, no, actor, ct)) : Results.Forbid())
            .WithName("StudioGetRevision")
            .Produces<RevisionDetail>();

        g.MapPost("/articles/{id:long}/revisions/{no:int}/restore", async (long id, int no, RestoreRequest request, ArticleService svc, ClaimsPrincipal user, CancellationToken ct) =>
                Acting(user, out var actor) ? Respond(await svc.RestoreAsync(id, no, request, actor, ct)) : Results.Forbid())
            .WithName("StudioRestoreRevision")
            .Produces<ArticleEdit>();

        g.MapGet("/categories", async (ArticleService svc, CancellationToken ct) => await svc.CategoriesAsync(ct))
            .WithName("StudioListCategories")
            .Produces<List<CategoryView>>();

        g.MapPost("/categories", async (NewCategory request, ArticleService svc, ClaimsPrincipal user, CancellationToken ct) =>
                Acting(user, out var actor) ? Respond(await svc.CreateCategoryAsync(request.Name, actor, ct)) : Results.Forbid())
            .WithName("StudioCreateCategory")
            .Produces<CategoryView>();

        g.MapGet("/tags", async (ArticleService svc, CancellationToken ct) => await svc.TagsAsync(ct))
            .WithName("StudioListTags")
            .Produces<List<TagView>>();
    }

    public sealed record NewCategory(string? Name);

    private static bool Acting(ClaimsPrincipal user, out Actor actor)
    {
        actor = Actor.From(user)!;
        return actor is not null;
    }

    /// <summary>Turns a service outcome into a response. Studio responses are never cached.</summary>
    public static IResult Respond<T>(CmsResult<T> result, bool created = false)
    {
        if (result.Ok)
        {
            return created ? Results.Json(result.Value, statusCode: StatusCodes.Status201Created) : Results.Ok(result.Value);
        }

        var status = result.Error switch
        {
            CmsError.NotFound => StatusCodes.Status404NotFound,
            CmsError.Forbidden => StatusCodes.Status403Forbidden,
            CmsError.Conflict => StatusCodes.Status409Conflict,
            CmsError.TooLarge => StatusCodes.Status413PayloadTooLarge,
            CmsError.Unavailable => StatusCodes.Status503ServiceUnavailable,
            _ => StatusCodes.Status400BadRequest,
        };

        var extensions = result.Field is null ? null : new Dictionary<string, object?> { ["field"] = result.Field };
        return Results.Problem(detail: result.Message, statusCode: status, extensions: extensions);
    }
}
