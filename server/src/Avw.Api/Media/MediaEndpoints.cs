using System.Threading.RateLimiting;
using Avw.Api.Auth;
using Avw.Api.Cms;
using Avw.Data.Entities;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using System.Security.Claims;

namespace Avw.Api.Media;

public static class MediaEndpoints
{
    public const string UploadPolicy = "media-upload";

    public static IServiceCollection AddAvwMedia(this IServiceCollection services, IConfiguration config)
    {
        services.AddOptions<MediaOptions>().Bind(config.GetSection(MediaOptions.Section));
        services.AddSingleton<MediaProcessor>();
        services.AddScoped<MediaService>();
        services.AddHealthChecks().AddCheck<MediaStorageHealthCheck>("media", tags: ["ready"]);

        // Uploads are the one expensive thing a signed-in author can trigger, so they are limited per person.
        services.AddRateLimiter(o => o.AddPolicy(UploadPolicy, ctx => RateLimitPartition.GetFixedWindowLimiter(
            ctx.User.FindFirstValue(UserSync.LocalIdClaim) ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })));

        var max = config.GetSection(MediaOptions.Section).Get<MediaOptions>()?.MaxUploadBytes ?? new MediaOptions().MaxUploadBytes;
        services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(o => o.MultipartBodyLengthLimit = max + 64 * 1024);
        return services;
    }

    /// <summary>Serves the final images at <c>/media</c>. Names are content hashes, so they never change and may be cached for good.</summary>
    public static void UseAvwMedia(this WebApplication app)
    {
        var root = Path.GetFullPath(app.Services.GetRequiredService<IOptions<MediaOptions>>().Value.RootPath);
        Directory.CreateDirectory(root);
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = new PhysicalFileProvider(root),
            RequestPath = "/media",
            ServeUnknownFileTypes = false,                       // temporary files carry no extension, so are never served
            OnPrepareResponse = ctx =>
            {
                ctx.Context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
                ctx.Context.Response.Headers.XContentTypeOptions = "nosniff";
            },
        });
    }

    public static void MapMediaEndpoints(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/studio/media").WithTags("Studio").RequireAuthorization(Policies.Author);

        g.MapGet("/", async (MediaService svc, ClaimsPrincipal user, MediaStatus? status, string? q, int? page, int? pageSize, CancellationToken ct) =>
                Actor.From(user) is { } actor
                    ? Results.Ok(await svc.ListAsync(status, q, page ?? 1, pageSize ?? 24, actor, ct))
                    : Results.Forbid())
            .WithName("StudioListMedia")
            .Produces<Paged<MediaView>>();

        g.MapPost("/", async (HttpContext ctx, MediaService svc, ClaimsPrincipal user, CancellationToken ct) =>
            {
                if (Actor.From(user) is not { } actor)
                {
                    return Results.Forbid();
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
                    // The multipart body was longer than the limit set in AddAvwMedia.
                    return Results.Problem(detail: "That file is too large.", statusCode: StatusCodes.Status413PayloadTooLarge, extensions: new Dictionary<string, object?> { ["field"] = "file" });
                }

                if (form.Files.Count != 1)
                {
                    return Results.Problem(detail: "Send exactly one picture.", statusCode: StatusCodes.Status400BadRequest, extensions: new Dictionary<string, object?> { ["field"] = "file" });
                }

                await using var stream = form.Files[0].OpenReadStream();
                var result = await svc.UploadAsync(stream, form["caption"], form["credit"], actor, ct);
                return CmsEndpoints.Respond(result, created: true);
            })
            .DisableAntiforgery()                                // the CSRF header (see CsrfHeaderMiddleware) protects this instead
            .RequireRateLimiting(UploadPolicy)
            .WithName("StudioUploadMedia")
            .Accepts<IFormFile>("multipart/form-data")
            .Produces<MediaView>(StatusCodes.Status201Created);

        g.MapPut("/{id:long}", async (long id, MediaUpdate update, MediaService svc, ClaimsPrincipal user, CancellationToken ct) =>
                Actor.From(user) is { } actor ? CmsEndpoints.Respond(await svc.UpdateAsync(id, update, actor, ct)) : Results.Forbid())
            .WithName("StudioUpdateMedia")
            .Produces<MediaView>();

        g.MapPost("/{id:long}/status", async (long id, MediaStatusRequest request, MediaService svc, ClaimsPrincipal user, CancellationToken ct) =>
                Actor.From(user) is { } actor ? CmsEndpoints.Respond(await svc.SetStatusAsync(id, request.Status, actor, ct)) : Results.Forbid())
            .WithName("StudioSetMediaStatus")
            .Produces<MediaView>();
    }
}

/// <summary>
/// Not ready if either volume cannot be written and read back: a read-only or root-squashed mount would otherwise only show
/// up when the first author tries to upload.
/// </summary>
public sealed class MediaStorageHealthCheck(IOptions<MediaOptions> options) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        foreach (var (name, path) in new[] { ("media", options.Value.RootPath), ("scratch", options.Value.ScratchPath) })
        {
            try
            {
                Directory.CreateDirectory(path);
                var marker = Path.Combine(path, $".avw-health-{Environment.MachineName}");
                var token = Guid.NewGuid().ToString("N");
                await File.WriteAllTextAsync(marker, token, ct);
                if (await File.ReadAllTextAsync(marker, ct) != token)
                {
                    return HealthCheckResult.Unhealthy($"The {name} volume did not return what was written.");
                }
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                return HealthCheckResult.Unhealthy($"The {name} volume is not writable.", e);
            }
        }

        return HealthCheckResult.Healthy();
    }
}
