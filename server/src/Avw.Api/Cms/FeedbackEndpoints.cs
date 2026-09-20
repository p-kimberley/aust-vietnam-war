using System.Net.Mail;
using System.Threading.RateLimiting;
using Avw.Api.Auth;
using Avw.Data;
using Avw.Data.Entities;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace Avw.Api.Cms;

/// <summary>What a visitor sends. <see cref="Website"/> is a decoy field a person never sees; only a bot fills it in.</summary>
public sealed record FeedbackInput(string? Name, string? Email, string? Message, string? Website);

public sealed record FeedbackRow(long Id, string? Name, string? Email, string Message, DateTime CreatedUtc, bool Handled);

public sealed record HandledRequest(bool Handled);

/// <summary>The site's feedback form and the editors' inbox for it.</summary>
public static class FeedbackEndpoints
{
    public const string Policy = "feedback";
    public const int MinMessage = 10;
    public const int MaxMessage = 2000;

    public static IServiceCollection AddAvwFeedback(this IServiceCollection services, IConfiguration config)
    {
        // A handful per visitor per ten minutes is plenty for a person and useless to a bot.
        var permits = config.GetValue<int?>("Feedback:PermitsPer10Minutes") ?? 5;
        services.AddRateLimiter(o => o.AddPolicy(Policy, ctx => RateLimitPartition.GetFixedWindowLimiter(
            ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = permits, Window = TimeSpan.FromMinutes(10), QueueLimit = 0 })));
        return services;
    }

    public static void MapFeedbackEndpoints(this IEndpointRouteBuilder api)
    {
        api.MapPost("/feedback", async (FeedbackInput input, AvwDbContext db, TimeProvider clock, CancellationToken ct) =>
            {
                // A bot filled in the decoy: answer as if it worked so it learns nothing, and keep nothing.
                if (!string.IsNullOrWhiteSpace(input.Website))
                {
                    return Results.Accepted();
                }

                var message = input.Message?.Trim() ?? "";
                var errors = new Dictionary<string, string[]>();
                if (message.Length < MinMessage || message.Length > MaxMessage)
                {
                    errors["message"] = [$"Write between {MinMessage} and {MaxMessage} characters."];
                }

                var email = input.Email?.Trim();
                if (!string.IsNullOrEmpty(email) && !IsEmail(email))
                {
                    errors["email"] = ["That does not look like an email address."];
                }

                if ((input.Name?.Length ?? 0) > 100)
                {
                    errors["name"] = ["Use a name of up to 100 characters."];
                }

                if (errors.Count > 0)
                {
                    return Results.ValidationProblem(errors);
                }

                db.Feedback.Add(new FeedbackMessage
                {
                    Name = Blank(input.Name),
                    Email = string.IsNullOrEmpty(email) ? null : email,
                    Message = message,
                    CreatedUtc = clock.GetUtcNow().UtcDateTime,
                });
                await db.SaveChangesAsync(ct);
                return Results.Accepted();
            })
            .RequireRateLimiting(Policy)
            .WithName("SendFeedback")
            .WithTags("Content")
            .Produces(StatusCodes.Status202Accepted)
            .ProducesValidationProblem();

        var studio = api.MapGroup("/studio/feedback").WithTags("Studio").RequireAuthorization(Policies.Editor);

        studio.MapGet("/", async (AvwDbContext db, bool? handled, CancellationToken ct) =>
            {
                var q = db.Feedback.AsNoTracking().AsQueryable();
                if (handled is { } h)
                {
                    q = q.Where(f => f.Handled == h);
                }

                return await q.OrderBy(f => f.Handled).ThenByDescending(f => f.CreatedUtc).Take(200)
                    .Select(f => new FeedbackRow(f.Id, f.Name, f.Email, f.Message, f.CreatedUtc, f.Handled))
                    .ToListAsync(ct);
            })
            .WithName("StudioListFeedback")
            .Produces<List<FeedbackRow>>();

        studio.MapPost("/{id:long}/handled", async (long id, HandledRequest request, AvwDbContext db, TimeProvider clock, CancellationToken ct) =>
            {
                var f = await db.Feedback.FirstOrDefaultAsync(x => x.Id == id, ct);
                if (f is null)
                {
                    return Results.NotFound();
                }

                f.Handled = request.Handled;
                f.HandledUtc = request.Handled ? clock.GetUtcNow().UtcDateTime : null;
                await db.SaveChangesAsync(ct);
                return Results.Ok(new FeedbackRow(f.Id, f.Name, f.Email, f.Message, f.CreatedUtc, f.Handled));
            })
            .WithName("StudioMarkFeedback")
            .Produces<FeedbackRow>();
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static bool IsEmail(string s) =>
        s.Length <= 200 && MailAddress.TryCreate(s, out var m) && m.Address == s && m.Host.Contains('.');
}
