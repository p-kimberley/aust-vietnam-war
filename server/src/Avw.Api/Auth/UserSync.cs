using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Avw.Api.Auth;

/// <summary>Creates or refreshes the local <see cref="AppUser"/> for a freshly authenticated Keycloak identity.</summary>
public static class UserSync
{
    /// <summary>Claim added to the session principal carrying the local <see cref="AppUser.Id"/>.</summary>
    public const string LocalIdClaim = "avw_uid";

    public static async Task<AppUser> UpsertAsync(AvwDbContext db, ClaimsPrincipal principal, TimeProvider clock, CancellationToken ct)
    {
        var subject = principal.FindFirstValue("sub") ?? throw new InvalidOperationException("Token has no sub claim.");
        var now = clock.GetUtcNow().UtcDateTime;

        var displayName = principal.FindFirstValue("name")
                          ?? principal.FindFirstValue("preferred_username")
                          ?? "Member";
        var emailHash = VerifiedEmailHash(principal);

        var user = await db.Users.SingleOrDefaultAsync(u => u.Subject == subject, ct);
        if (user is null)
        {
            user = new AppUser { Subject = subject, CreatedUtc = now };
            db.Users.Add(user);
        }

        user.DisplayName = displayName.Length > 200 ? displayName[..200] : displayName;
        user.EmailHash = emailHash ?? user.EmailHash;
        user.LastSeenUtc = now;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException) when (user.Id == 0)
        {
            // Two first logins raced on the unique subject index: the other one won, so reload it.
            db.Entry(user).State = EntityState.Detached;
            user = await db.Users.SingleAsync(u => u.Subject == subject, ct);
            user.LastSeenUtc = now;
            await db.SaveChangesAsync(ct);
        }

        return user;
    }

    /// <summary>Hash of the email, but only when Keycloak has verified it, so nobody can claim legacy content by typing an address.</summary>
    public static string? VerifiedEmailHash(ClaimsPrincipal principal)
    {
        var email = principal.FindFirstValue("email");
        var verified = string.Equals(principal.FindFirstValue("email_verified"), "true", StringComparison.OrdinalIgnoreCase);
        return verified && !string.IsNullOrWhiteSpace(email) ? HashEmail(email) : null;
    }

    public static string HashEmail(string email) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(email.Trim().ToLowerInvariant())));
}
