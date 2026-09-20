using System.Security.Claims;
using System.Threading.RateLimiting;
using Avw.Api.Auth;
using Avw.Api.Cms;
using Avw.Api.Map;
using Avw.Api.Media;
using Avw.Data;
using Avw.Data.Entities;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Avw.Api.Community;

public sealed record PendingNote(long Id, int ContactId, string Title, string Body, string AuthorName, DateTime UpdatedUtc, bool IsChange);

public sealed record PendingPicture(long IncidentMediaId, long MediaId, int? ContactId, string Url, string ThumbUrl, string? Caption, string? Credit, string UploadedByName);

/// <summary>Everything an editor has to look at: notes and pictures waiting for approval, and casualty information not yet dealt with.</summary>
public sealed record ModerationQueue(IReadOnlyList<PendingNote> Notes, IReadOnlyList<PendingPicture> Pictures, IReadOnlyList<CasualtyRow> Casualties);

public static class CommunityEndpoints
{
    public const string TributePolicy = "tribute";
    public const string WritePolicy = "community-write";
    public const string CommunitySearchPolicy = "community-search";

    public static IServiceCollection AddAvwCommunity(this IServiceCollection services, IConfiguration config)
    {
        services.AddOptions<SmtpOptions>().Bind(config.GetSection(SmtpOptions.Section));
        services.AddOptions<NotificationOptions>().Bind(config.GetSection(NotificationOptions.Section));
        services.AddSingleton<EmailNotifier>();
        services.AddSingleton<INotifier>(sp => sp.GetRequiredService<EmailNotifier>());
        services.AddHostedService(sp => sp.GetRequiredService<EmailNotifier>());

        services.AddScoped<NoteService>();
        services.AddScoped<IncidentMediaService>();
        services.AddScoped<TributeService>();
        services.AddScoped<CasualtyService>();
        services.AddScoped<CommunitySearch>();

        var client = services.AddHttpClient<IHonourRollSource, ElasticsearchHonourRoll>(MapEndpoints.ConfigureElasticsearchClient(TimeSpan.FromSeconds(30)));
        client.ConfigurePrimaryHttpMessageHandler(MapEndpoints.ElasticsearchHandler);

        // Per signed-in person (or address): enough for a keen contributor, too little for spam.
        static string Who(HttpContext ctx) => ctx.User.FindFirstValue(UserSync.LocalIdClaim) ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        services.AddRateLimiter(o =>
        {
            o.AddPolicy(TributePolicy, ctx => RateLimitPartition.GetFixedWindowLimiter(Who(ctx), _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromHours(1), QueueLimit = 0 }));
            // Searching notes and pictures is MySQL, not Elasticsearch, so it has its own allowance rather than sharing the search one.
            o.AddPolicy(CommunitySearchPolicy, ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 120, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
            o.AddPolicy(WritePolicy, ctx => RateLimitPartition.GetFixedWindowLimiter(Who(ctx), _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
        });
        return services;
    }

    public static void MapCommunityEndpoints(this IEndpointRouteBuilder api)
    {
        MapNotes(api);
        MapPictures(api);
        MapHonourRoll(api);
        MapModeration(api);
    }

    private static IResult Forbidden() => Results.Forbid();

    // ---------------------------------------------------------------- notes

    private static void MapNotes(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/").WithTags("Community");

        // What a viewer sees depends on who they are (their own pending notes, an editor's queue), so nothing is cached.
        g.MapGet("/contacts/{id:int:min(1)}/notes", async (int id, NoteService notes, ClaimsPrincipal user, HttpContext ctx, CancellationToken ct) =>
            {
                ctx.Response.Headers.CacheControl = "no-store";
                return Results.Ok(await notes.ListAsync(id, Person.From(user), ct));
            })
            .WithName("ListNotes")
            .Produces<List<NoteView>>();

        g.MapPost("/contacts/{id:int:min(1)}/notes", async (int id, NoteInput input, NoteService notes, IContactSource contacts, ClaimsPrincipal user, CancellationToken ct) =>
            {
                if (Person.From(user) is not { } person)
                {
                    return Forbidden();
                }

                if (await contacts.GetAsync(id, ct) is null)
                {
                    return Results.Problem(detail: "There is no such incident.", statusCode: StatusCodes.Status404NotFound);
                }

                return CmsEndpoints.Respond(await notes.CreateAsync(id, input, person, ct), created: true);
            })
            .RequireAuthorization(Policies.Member).RequireRateLimiting(WritePolicy)
            .WithName("CreateNote").Produces<NoteView>(StatusCodes.Status201Created);

        g.MapPut("/notes/{id:long}", async (long id, NoteInput input, NoteService notes, ClaimsPrincipal user, CancellationToken ct) =>
                Person.From(user) is { } person ? CmsEndpoints.Respond(await notes.UpdateAsync(id, input, person, ct)) : Forbidden())
            .RequireAuthorization(Policies.Member).RequireRateLimiting(WritePolicy)
            .WithName("UpdateNote").Produces<NoteView>();

        g.MapDelete("/notes/{id:long}", async (long id, NoteService notes, ClaimsPrincipal user, CancellationToken ct) =>
            {
                if (Person.From(user) is not { } person)
                {
                    return Forbidden();
                }

                var result = await notes.DeleteAsync(id, person, ct);
                return result.Ok ? Results.NoContent() : CmsEndpoints.Respond(result);
            })
            .RequireAuthorization(Policies.Member)
            .WithName("DeleteNote");

        g.MapGet("/notes/{id:long}/versions", async (long id, NoteService notes, ClaimsPrincipal user, CancellationToken ct) =>
                Person.From(user) is { } person ? CmsEndpoints.Respond(await notes.VersionsAsync(id, person, ct)) : Forbidden())
            .RequireAuthorization(Policies.Member)
            .WithName("ListNoteVersions").Produces<List<VersionView>>();

        g.MapPost("/notes/{id:long}/comments", async (long id, CommentInput input, NoteService notes, ClaimsPrincipal user, CancellationToken ct) =>
                Person.From(user) is { } person ? CmsEndpoints.Respond(await notes.AddCommentAsync(id, input, person, ct), created: true) : Forbidden())
            .RequireAuthorization(Policies.Member).RequireRateLimiting(WritePolicy)
            .WithName("AddNoteComment").Produces<NoteView>(StatusCodes.Status201Created);

        g.MapDelete("/comments/{id:long}", async (long id, NoteService notes, ClaimsPrincipal user, CancellationToken ct) =>
                Person.From(user) is { } person ? CmsEndpoints.Respond(await notes.DeleteCommentAsync(id, person, ct)) : Forbidden())
            .RequireAuthorization(Policies.Member)
            .WithName("DeleteNoteComment").Produces<NoteView>();

        g.MapPost("/notes/{id:long}/status", async (long id, ModerationRequest request, NoteService notes, ClaimsPrincipal user, CancellationToken ct) =>
                Person.From(user) is { } person ? CmsEndpoints.Respond(await notes.ModerateAsync(id, request.Status, person, ct)) : Forbidden())
            .RequireAuthorization(Policies.Editor)
            .WithName("ModerateNote").Produces<NoteView>();

        g.MapPost("/notes/{id:long}/comments-open", async (long id, CommentsOpenRequest request, NoteService notes, ClaimsPrincipal user, CancellationToken ct) =>
                Person.From(user) is { } person ? CmsEndpoints.Respond(await notes.SetCommentsOpenAsync(id, request.Open, person, ct)) : Forbidden())
            .RequireAuthorization(Policies.Editor)
            .WithName("SetNoteCommentsOpen").Produces<NoteView>();
    }

    // ---------------------------------------------------------------- pictures

    private static void MapPictures(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/").WithTags("Community");

        g.MapGet("/contacts/{id:int:min(1)}/media", async (int id, IncidentMediaService media, ClaimsPrincipal user, HttpContext ctx, CancellationToken ct) =>
            {
                ctx.Response.Headers.CacheControl = "no-store";
                return Results.Ok(await media.ListAsync(id, Person.From(user), ct));
            })
            .WithName("ListIncidentMedia")
            .Produces<List<IncidentMediaView>>();

        // Notes and pictures found by their words: what the public can see only (approved notes' approved text, approved pictures).
        g.MapGet("/community-search", async (string? q, int? limit, CommunitySearch search, HttpContext ctx, CancellationToken ct) =>
            {
                var text = q?.Trim() ?? "";
                if (text.Length < MapEndpoints.MinSearchLength || text.Length > MapEndpoints.MaxSearchLength)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["q"] = [$"Search text must be {MapEndpoints.MinSearchLength} to {MapEndpoints.MaxSearchLength} characters."] });
                }

                ctx.Response.Headers.CacheControl = "public, max-age=60";
                return Results.Ok(await search.SearchAsync(text, limit ?? 5, ct));
            })
            .RequireRateLimiting(CommunitySearchPolicy)
            .WithName("SearchCommunity")
            .Produces<CommunitySearchResult>()
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status429TooManyRequests);

        // Pictures taken near an incident, nearest first, so a place can be explored beyond the incident's own pictures.
        g.MapGet("/contacts/{id:int:min(1)}/nearby-media", async (int id, double? radiusKm, int? limit, IncidentMediaService media, HttpContext ctx, CancellationToken ct) =>
            {
                var km = radiusKm ?? 2;
                if (km is < 0.1 or > 25)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["radiusKm"] = ["Give a distance from 0.1 to 25 kilometres."] });
                }

                if (await media.NearbyAsync(id, km * 1000, Math.Clamp(limit ?? 8, 1, 24), ct) is not { } near)
                {
                    return Results.NotFound();
                }

                ctx.Response.Headers.CacheControl = "public, max-age=60";
                return Results.Ok(near);
            })
            .WithName("ListNearbyMedia")
            .Produces<List<NearbyPicture>>()
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status404NotFound);

        // Pictures placed on the map, for a picture layer. A small box only: at most 500 come back.
        g.MapGet("/community-media", async (double minLat, double minLon, double maxLat, double maxLon, IncidentMediaService media, HttpContext ctx, CancellationToken ct) =>
            {
                if (minLat > maxLat || minLon > maxLon || minLat < -90 || maxLat > 90 || minLon < -180 || maxLon > 180)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["box"] = ["Give a box as minLat, minLon, maxLat, maxLon in degrees."] });
                }

                ctx.Response.Headers.CacheControl = "public, max-age=60";
                return Results.Ok(await media.InAreaAsync(minLat, minLon, maxLat, maxLon, ct));
            })
            .WithName("ListCommunityMediaInArea")
            .Produces<List<IncidentMediaView>>()
            .ProducesValidationProblem();

        g.MapPost("/contacts/{id:int:min(1)}/media", async (int id, HttpContext ctx, IncidentMediaService media, ClaimsPrincipal user, CancellationToken ct) =>
            {
                if (Person.From(user) is not { } person)
                {
                    return Forbidden();
                }

                if (!ctx.Request.HasFormContentType)
                {
                    return Results.Problem(detail: "Send the picture as a multipart form.", statusCode: StatusCodes.Status415UnsupportedMediaType);
                }

                IFormCollection form;
                try
                {
                    form = await ctx.Request.ReadFormAsync(ct);
                }
                catch (InvalidDataException)
                {
                    return Results.Problem(detail: "That file is too large.", statusCode: StatusCodes.Status413PayloadTooLarge, extensions: new Dictionary<string, object?> { ["field"] = "file" });
                }

                if (form.Files.Count != 1)
                {
                    return Results.Problem(detail: "Send exactly one picture.", statusCode: StatusCodes.Status400BadRequest, extensions: new Dictionary<string, object?> { ["field"] = "file" });
                }

                await using var stream = form.Files[0].OpenReadStream();
                return CmsEndpoints.Respond(await media.UploadAsync(id, stream, form["caption"], form["credit"], form["dateTaken"], person, ct), created: true);
            })
            .DisableAntiforgery()
            .RequireAuthorization(Policies.Member).RequireRateLimiting(MediaEndpoints.UploadPolicy)
            .WithName("AddIncidentMedia").Accepts<IFormFile>("multipart/form-data").Produces<IncidentMediaView>(StatusCodes.Status201Created);

        // One picture as the viewer sees it, for the map's picture panel. Per person (their like), so never cached.
        g.MapGet("/incident-media/{id:long}", async (long id, IncidentMediaService media, ClaimsPrincipal user, HttpContext ctx, CancellationToken ct) =>
            {
                ctx.Response.Headers.CacheControl = "no-store";
                return await media.GetAsync(id, Person.From(user), ct) is { } view ? Results.Ok(view) : Results.NotFound();
            })
            .WithName("GetIncidentMedia")
            .Produces<IncidentMediaView>()
            .Produces(StatusCodes.Status404NotFound);

        g.MapDelete("/incident-media/{id:long}", async (long id, IncidentMediaService media, ClaimsPrincipal user, CancellationToken ct) =>
            {
                if (Person.From(user) is not { } person)
                {
                    return Forbidden();
                }

                var result = await media.RemoveAsync(id, person, ct);
                return result.Ok ? Results.NoContent() : CmsEndpoints.Respond(result);
            })
            .RequireAuthorization(Policies.Member)
            .WithName("RemoveIncidentMedia");

        g.MapPost("/incident-media/{id:long}/like", async (long id, IncidentMediaService media, ClaimsPrincipal user, CancellationToken ct) =>
                Person.From(user) is { } person ? CmsEndpoints.Respond(await media.ToggleLikeAsync(id, person, ct)) : Forbidden())
            .RequireAuthorization(Policies.Member).RequireRateLimiting(WritePolicy)
            .WithName("ToggleMediaLike").Produces<LikeResult>();
    }

    // ---------------------------------------------------------------- honour roll

    private static void MapHonourRoll(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/").WithTags("Community");

        g.MapGet("/honour-roll", async (string? q, int? page, int? pageSize, IHonourRollSource roll, HttpContext ctx, CancellationToken ct) =>
            {
                ctx.Response.Headers.CacheControl = "public, max-age=300";
                return Results.Ok(await roll.SearchAsync(q, page ?? 1, pageSize ?? 20, ct));
            })
            .RequireRateLimiting(MapEndpoints.SearchPolicy)
            .WithName("SearchHonourRoll").Produces<HonourPage>();

        g.MapGet("/honour-roll/{serviceNumber}", async (string serviceNumber, IHonourRollSource roll, AvwDbContext db, HttpContext ctx, CancellationToken ct) =>
            {
                var person = await roll.GetAsync(serviceNumber, ct);
                if (person is null)
                {
                    return Results.NotFound();
                }

                var incidents = await db.CasualtyLinks.AsNoTracking().Where(l => l.ServiceNumber == person.ServiceNumber).Select(l => l.ContactId).OrderBy(c => c).ToListAsync(ct);
                var tributes = await db.Tributes.CountAsync(t => t.ServiceNumber == person.ServiceNumber, ct);
                ctx.Response.Headers.CacheControl = "no-store";                        // the tribute count changes as people leave poppies
                return Results.Ok(person with { Incidents = incidents, Tributes = tributes });
            })
            .RequireRateLimiting(MapEndpoints.SearchPolicy)
            .WithName("GetHonourRollPerson").Produces<HonourPerson>().Produces(StatusCodes.Status404NotFound);

        g.MapGet("/contacts/{id:int:min(1)}/casualties", async (int id, CasualtyService casualties, HttpContext ctx, CancellationToken ct) =>
            {
                ctx.Response.Headers.CacheControl = "public, max-age=300";
                return Results.Ok(await casualties.CasualtiesOfAsync(id, ct));
            })
            .WithName("ListIncidentCasualties").Produces<IReadOnlyList<HonourSummary>>();

        g.MapGet("/honour-roll/{serviceNumber}/tributes", async (string serviceNumber, int? page, TributeService tributes, ClaimsPrincipal user, HttpContext ctx, CancellationToken ct) =>
            {
                ctx.Response.Headers.CacheControl = "no-store";
                return Results.Ok(await tributes.ListAsync(serviceNumber, page ?? 1, Person.From(user), ct));
            })
            .WithName("ListTributes").Produces<TributePage>();

        g.MapPost("/honour-roll/{serviceNumber}/tributes", async (string serviceNumber, TributeInput input, TributeService tributes, ClaimsPrincipal user, CancellationToken ct) =>
                Person.From(user) is { } person ? CmsEndpoints.Respond(await tributes.LeaveAsync(serviceNumber, input, person, ct), created: true) : Forbidden())
            .RequireAuthorization(Policies.Member).RequireRateLimiting(TributePolicy)
            .WithName("LeaveTribute").Produces<TributeView>(StatusCodes.Status201Created);

        g.MapDelete("/tributes/{id:long}", async (long id, TributeService tributes, ClaimsPrincipal user, CancellationToken ct) =>
            {
                if (Person.From(user) is not { } person)
                {
                    return Forbidden();
                }

                var result = await tributes.DeleteAsync(id, person, ct);
                return result.Ok ? Results.NoContent() : CmsEndpoints.Respond(result);
            })
            .RequireAuthorization(Policies.Member)
            .WithName("DeleteTribute");

        g.MapPost("/contacts/{id:int:min(1)}/casualty-submissions", async (int id, CasualtyInput input, CasualtyService casualties, ClaimsPrincipal user, CancellationToken ct) =>
                Person.From(user) is { } person ? CmsEndpoints.Respond(await casualties.SubmitAsync(id, input, person, ct), created: true) : Forbidden())
            .RequireAuthorization(Policies.Member).RequireRateLimiting(WritePolicy)
            .WithName("SubmitCasualty").Produces<CasualtyRow>(StatusCodes.Status201Created);
    }

    // ---------------------------------------------------------------- moderation

    private static void MapModeration(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/studio").WithTags("Studio").RequireAuthorization(Policies.Editor);

        g.MapGet("/moderation", async (AvwDbContext db, CasualtyService casualties, CancellationToken ct) =>
            {
                var notes = await db.Notes.AsNoTracking().Where(n => n.Status == ModerationStatus.Pending)
                    .OrderBy(n => n.UpdatedUtc).Take(200).ToListAsync(ct);
                var ids = notes.Select(n => n.Id).ToList();
                var versions = await db.NoteVersions.AsNoTracking().Where(v => ids.Contains(v.NoteId)).ToListAsync(ct);
                var pendingNotes = notes.Select(n =>
                {
                    var v = versions.First(x => x.NoteId == n.Id && x.VersionNo == n.LatestVersionNo);
                    return new PendingNote(n.Id, n.ContactId, v.Title, v.Body, n.AuthorName, n.UpdatedUtc, n.ApprovedVersionNo is not null);
                }).ToList();

                var pictures = await db.IncidentMedia.AsNoTracking().Where(m => m.Media.Status == MediaStatus.Pending)
                    .OrderBy(m => m.CreatedUtc).Take(200)
                    .Select(m => new { m.Id, m.MediaId, m.ContactId, m.Media.Sha256, m.Media.Caption, m.Media.Credit, Uploader = m.Media.UploadedBy.DisplayName })
                    .ToListAsync(ct);

                return new ModerationQueue(
                    pendingNotes,
                    pictures.Select(p => new PendingPicture(p.Id, p.MediaId, p.ContactId, PublicContent.MediaUrl(p.Sha256), $"/media/{p.Sha256[..2]}/{p.Sha256}-480.jpg", p.Caption, p.Credit, p.Uploader)).ToList(),
                    await casualties.ListAsync(false, ct));
            })
            .WithName("GetModerationQueue").Produces<ModerationQueue>();

        g.MapPost("/casualty-submissions/{id:long}/handled", async (long id, HandledInput input, CasualtyService casualties, CancellationToken ct) =>
                CmsEndpoints.Respond(await casualties.MarkAsync(id, input.Handled, ct)))
            .WithName("MarkCasualtyHandled").Produces<CasualtyRow>();
    }
}
