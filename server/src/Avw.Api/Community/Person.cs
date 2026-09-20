using System.Security.Claims;
using Avw.Api.Auth;
using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Avw.Api.Community;

/// <summary>Who is acting on community content, as the API sees them. Editors and admins may do what members cannot.</summary>
public sealed record Person(long Id, string Name, bool IsEditor)
{
    public const string DefaultName = "Member";

    public static Person? From(ClaimsPrincipal user)
    {
        if (!long.TryParse(user.FindFirstValue(UserSync.LocalIdClaim), out var id))
        {
            return null;
        }

        var name = user.FindFirstValue("name") ?? user.FindFirstValue("preferred_username") ?? DefaultName;
        return new Person(id, name.Length > 200 ? name[..200] : name, user.IsInRole(Roles.Editor) || user.IsInRole(Roles.Admin));
    }
}

/// <summary>
/// Content migrated from the legacy site keeps only a hash of its author's email. When someone signs in with a <em>verified</em>
/// email that hashes the same, the old notes, comments, tributes and pictures become theirs, so they can edit or delete them.
/// </summary>
public static class LegacyContentLinker
{
    /// <returns>How many items were linked.</returns>
    public static async Task<int> LinkAsync(AvwDbContext db, AppUser user, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(user.EmailHash))
        {
            return 0;
        }

        var hash = user.EmailHash;
        var linked = 0;
        foreach (var note in await db.Notes.Where(n => n.AuthorId == null && n.AuthorEmailHash == hash).ToListAsync(ct))
        {
            note.AuthorId = user.Id;
            linked++;
        }

        foreach (var comment in await db.NoteComments.Where(c => c.AuthorId == null && c.AuthorEmailHash == hash).ToListAsync(ct))
        {
            comment.AuthorId = user.Id;
            linked++;
        }

        foreach (var tribute in await db.Tributes.Where(t => t.AuthorId == null && t.AuthorEmailHash == hash).ToListAsync(ct))
        {
            tribute.AuthorId = user.Id;
            linked++;
        }

        foreach (var picture in await db.IncidentMedia.Where(m => m.AttachedById == null && m.AuthorEmailHash == hash).ToListAsync(ct))
        {
            picture.AttachedById = user.Id;
            linked++;
        }

        if (linked > 0)
        {
            await db.SaveChangesAsync(ct);
        }

        return linked;
    }
}
