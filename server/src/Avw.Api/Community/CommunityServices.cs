using Avw.Api.Cms;
using Avw.Api.Map;
using Avw.Api.Media;
using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Avw.Api.Community;

public sealed record IncidentMediaView(
    long Id,
    long MediaId,
    int? ContactId,
    string Url,
    string ThumbUrl,
    int Width,
    int Height,
    string? Caption,
    string? Credit,
    DateOnly? DateTaken,
    double? Lat,
    double? Lon,
    MediaStatus Status,
    int Likes,
    bool LikedByMe,
    bool Mine,
    bool CanRemove);

public sealed record LikeResult(int Likes, bool Liked);

/// <summary>A picture taken near an incident (not one of the incident's own), with how far away, for the incident's "nearby photos".</summary>
public sealed record NearbyPicture(long Id, int? ContactId, string ThumbUrl, string? Caption, string? Credit, double Lat, double Lon, int DistanceMetres);

public sealed record TributeInput(string? Message);

public sealed record TributeView(long Id, string AuthorName, string Message, DateTime CreatedUtc, bool Mine, bool CanDelete);

public sealed record TributePage(IReadOnlyList<TributeView> Items, int Total, int Page, int PageSize);

public sealed record CasualtyInput(string? ServiceNumber, string? CasualtyType, string? Comment);

public sealed record CasualtyRow(long Id, int ContactId, string? ServiceNumber, string CasualtyType, string Comment, string SubmittedByName, DateTime CreatedUtc, bool Handled);

public sealed record HandledInput(bool Handled);

/// <summary>Pictures that members attach to an incident. Files go through the same pipeline as the Studio; approval is the same too.</summary>
public sealed class IncidentMediaService(AvwDbContext db, MediaService media, IContactSource contacts, TimeProvider clock, INotifier notifier)
{
    public async Task<List<IncidentMediaView>> ListAsync(int contactId, Person? viewer, CancellationToken ct)
    {
        var rows = await db.IncidentMedia.AsNoTracking()
            .Where(m => m.ContactId == contactId
                        && (m.Media.Status == MediaStatus.Approved || viewer != null && (viewer.IsEditor || m.Media.UploadedById == viewer.Id)))
            .OrderByDescending(m => m.CreatedUtc).ThenByDescending(m => m.Id)
            .Select(m => new { Link = m, m.Media })
            .ToListAsync(ct);
        var ids = rows.Select(r => r.Media.Id).ToList();
        var likes = await db.MediaLikes.AsNoTracking().Where(l => ids.Contains(l.MediaId)).Select(l => new { l.MediaId, l.UserId }).ToListAsync(ct);
        return rows.Select(r => ToView(r.Link, r.Media, likes.Count(l => l.MediaId == r.Media.Id) + r.Link.LegacyLikes, viewer is not null && likes.Any(l => l.MediaId == r.Media.Id && l.UserId == viewer.Id), viewer)).ToList();
    }

    /// <summary>The most pictures one box returns. The migrated set is about 330, so the whole map fits; a larger set would need the box to be smaller.</summary>
    public const int MaxInArea = 500;

    /// <summary>One picture as one viewer sees it (their like, whether they can remove it). Pictures nobody but the uploader or an editor may see are not found.</summary>
    public async Task<IncidentMediaView?> GetAsync(long id, Person? viewer, CancellationToken ct)
    {
        var link = await db.IncidentMedia.AsNoTracking().Include(m => m.Media).FirstOrDefaultAsync(m => m.Id == id, ct);
        if (link is null || link.Media.Status != MediaStatus.Approved && !(viewer is not null && (viewer.IsEditor || link.Media.UploadedById == viewer.Id)))
        {
            return null;
        }

        var likes = await db.MediaLikes.AsNoTracking().Where(l => l.MediaId == link.MediaId).Select(l => l.UserId).ToListAsync(ct);
        return ToView(link, link.Media, likes.Count + link.LegacyLikes, viewer is not null && likes.Contains(viewer.Id), viewer);
    }

    /// <summary>Approved pictures whose place falls inside a box, newest first (at most <see cref="MaxInArea"/>). For the map's picture layer.</summary>
    public async Task<List<IncidentMediaView>> InAreaAsync(double minLat, double minLon, double maxLat, double maxLon, CancellationToken ct)
    {
        var rows = await db.IncidentMedia.AsNoTracking()
            .Where(m => m.Media.Status == MediaStatus.Approved && m.Lat != null && m.Lon != null && m.Lat >= minLat && m.Lat <= maxLat && m.Lon >= minLon && m.Lon <= maxLon)
            .OrderByDescending(m => m.CreatedUtc).ThenByDescending(m => m.Id).Take(MaxInArea)
            .Select(m => new { Link = m, m.Media })
            .ToListAsync(ct);
        return rows.Select(r => ToView(r.Link, r.Media, r.Link.LegacyLikes, false, null)).ToList();
    }

    /// <summary>
    /// Approved pictures placed within <paramref name="radiusMetres"/> of an incident, nearest first, leaving out the incident's own.
    /// The database narrows them to a box round the incident (using the latitude and longitude index) and the distance is then measured
    /// exactly. Null when there is no such incident.
    /// </summary>
    public async Task<List<NearbyPicture>?> NearbyAsync(int contactId, double radiusMetres, int limit, CancellationToken ct)
    {
        if (await contacts.GetAsync(contactId, ct) is not { } incident)
        {
            return null;
        }

        var (minLat, minLon, maxLat, maxLon) = Geo.Box(incident.Lat, incident.Lon, radiusMetres);
        var rows = await db.IncidentMedia.AsNoTracking()
            .Where(m => m.Media.Status == MediaStatus.Approved && m.Lat != null && m.Lon != null && m.Lat >= minLat && m.Lat <= maxLat && m.Lon >= minLon && m.Lon <= maxLon
                        && (m.ContactId == null || m.ContactId != contactId))
            .Select(m => new { m.Id, m.ContactId, m.Media.Sha256, m.Media.Caption, m.Media.Credit, Lat = m.Lat!.Value, Lon = m.Lon!.Value })
            .ToListAsync(ct);
        return [.. rows
            .Select(r => (Row: r, Metres: Geo.DistanceMetres(incident.Lat, incident.Lon, r.Lat, r.Lon)))
            .Where(x => x.Metres <= radiusMetres)
            .OrderBy(x => x.Metres).ThenBy(x => x.Row.Id)
            .Take(limit)
            .Select(x => new NearbyPicture(x.Row.Id, x.Row.ContactId, $"/media/{x.Row.Sha256[..2]}/{x.Row.Sha256}-480.jpg", x.Row.Caption, x.Row.Credit, x.Row.Lat, x.Row.Lon, (int)Math.Round(x.Metres)))];
    }

    public async Task<CmsResult<IncidentMediaView>> UploadAsync(int contactId, Stream file, string? caption, string? credit, string? dateTaken, Person person, CancellationToken ct)
    {
        if (await contacts.GetAsync(contactId, ct) is not { } incident)
        {
            return CmsResult<IncidentMediaView>.Fail(CmsError.NotFound, "There is no such incident.");
        }

        DateOnly? taken = null;
        if (!string.IsNullOrWhiteSpace(dateTaken))
        {
            if (!DateOnly.TryParseExact(dateTaken.Trim(), "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out var parsed))
            {
                return CmsResult<IncidentMediaView>.Invalid("dateTaken", "Give the date as year-month-day, for example 1966-08-18.");
            }

            taken = parsed;
        }

        var uploaded = await media.UploadAsync(file, PlainText.Clean(caption), PlainText.Clean(credit), new Actor(person.Id, person.IsEditor), ct);
        if (!uploaded.Ok)
        {
            return CmsResult<IncidentMediaView>.Fail(uploaded.Error, uploaded.Message ?? "The picture could not be added.", uploaded.Field);
        }

        var mediaId = uploaded.Value!.Id;
        var link = await db.IncidentMedia.FirstOrDefaultAsync(m => m.ContactId == contactId && m.MediaId == mediaId, ct);
        if (link is null)
        {
            // A picture of an incident is placed where the incident is, so it can be found on the map and by distance like any other
            // (pictures migrated from the old site carry a position of their own).
            link = new IncidentMedia
            {
                ContactId = contactId, MediaId = mediaId, AttachedById = person.Id, DateTaken = taken, Lat = incident.Lat, Lon = incident.Lon,
                CreatedUtc = clock.GetUtcNow().UtcDateTime,
            };
            db.IncidentMedia.Add(link);
            await db.SaveChangesAsync(ct);
            if (uploaded.Value.Status == MediaStatus.Pending)
            {
                notifier.Notify(new Notification($"A picture is waiting for approval (incident {contactId})", $"{person.Name} added a picture to incident {contactId}.\n\nIncident: {{site}}/battlemap?incident={contactId}\nModerate it in the Studio: {{site}}/studio/moderation"));
            }
        }

        return await ViewAsync(link.Id, person, ct);
    }

    /// <summary>Takes a picture off an incident (the file stays in the library). The person who added it, or an editor, may.</summary>
    public async Task<CmsResult<bool>> RemoveAsync(long id, Person person, CancellationToken ct)
    {
        var link = await db.IncidentMedia.FirstOrDefaultAsync(m => m.Id == id, ct);
        if (link is null)
        {
            return CmsResult<bool>.Fail(CmsError.NotFound, "There is no such picture.");
        }

        if (!person.IsEditor && link.AttachedById != person.Id)
        {
            return CmsResult<bool>.Fail(CmsError.Forbidden, "Only the person who added a picture, or an editor, can remove it.");
        }

        db.IncidentMedia.Remove(link);
        await db.SaveChangesAsync(ct);
        return CmsResult<bool>.Success(true);
    }

    /// <summary>Likes a picture, or takes the like back if there already is one. Only pictures the person can see can be liked.</summary>
    public async Task<CmsResult<LikeResult>> ToggleLikeAsync(long incidentMediaId, Person person, CancellationToken ct)
    {
        var link = await db.IncidentMedia.Include(m => m.Media).FirstOrDefaultAsync(m => m.Id == incidentMediaId, ct);
        if (link is null || link.Media.Status != MediaStatus.Approved && !person.IsEditor)
        {
            return CmsResult<LikeResult>.Fail(CmsError.NotFound, "There is no such picture.");
        }

        var existing = await db.MediaLikes.FirstOrDefaultAsync(l => l.MediaId == link.MediaId && l.UserId == person.Id, ct);
        if (existing is null)
        {
            db.MediaLikes.Add(new MediaLike { MediaId = link.MediaId, UserId = person.Id, CreatedUtc = clock.GetUtcNow().UtcDateTime });
        }
        else
        {
            db.MediaLikes.Remove(existing);
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // A double click raced itself: the like exists now, which is what was asked for.
            db.ChangeTracker.Clear();
        }

        return CmsResult<LikeResult>.Success(new LikeResult(await db.MediaLikes.CountAsync(l => l.MediaId == link.MediaId, ct) + link.LegacyLikes, existing is null));
    }

    private async Task<CmsResult<IncidentMediaView>> ViewAsync(long id, Person person, CancellationToken ct)
    {
        var link = await db.IncidentMedia.AsNoTracking().Include(m => m.Media).FirstAsync(m => m.Id == id, ct);
        var likes = await db.MediaLikes.AsNoTracking().Where(l => l.MediaId == link.MediaId).Select(l => l.UserId).ToListAsync(ct);
        return CmsResult<IncidentMediaView>.Success(ToView(link, link.Media, likes.Count + link.LegacyLikes, likes.Contains(person.Id), person));
    }

    private static IncidentMediaView ToView(IncidentMedia link, MediaAsset m, int likes, bool liked, Person? viewer) => new(
        link.Id, m.Id, link.ContactId, PublicContent.MediaUrl(m.Sha256), $"/media/{m.Sha256[..2]}/{m.Sha256}-480.jpg", m.Width, m.Height,
        m.Caption, m.Credit, link.DateTaken, link.Lat, link.Lon, m.Status, likes, liked,
        viewer is not null && m.UploadedById == viewer.Id, viewer is not null && (viewer.IsEditor || link.AttachedById == viewer.Id));
}

/// <summary>Poppies: short messages left for people on the honour roll.</summary>
public sealed class TributeService(AvwDbContext db, IHonourRollSource roll, TimeProvider clock)
{
    public const int MaxMessage = 500;
    public const int PageSize = 20;

    public async Task<TributePage> ListAsync(string serviceNumber, int page, Person? viewer, CancellationToken ct)
    {
        page = Math.Max(1, page);
        var q = db.Tributes.AsNoTracking().Where(t => t.ServiceNumber == serviceNumber);
        var total = await q.CountAsync(ct);
        // Poppies with words first (they say more), then the wordless ones, each newest first.
        var items = await q.OrderByDescending(t => t.Message != "").ThenByDescending(t => t.CreatedUtc).ThenByDescending(t => t.Id).Skip((page - 1) * PageSize).Take(PageSize).ToListAsync(ct);
        return new TributePage(items.Select(t => new TributeView(t.Id, t.AuthorName, t.Message, t.CreatedUtc, viewer is not null && t.AuthorId == viewer.Id, viewer is not null && (viewer.IsEditor || t.AuthorId == viewer.Id))).ToList(), total, page, PageSize);
    }

    public async Task<CmsResult<TributeView>> LeaveAsync(string serviceNumber, TributeInput input, Person person, CancellationToken ct)
    {
        var message = PlainText.Clean(input.Message).Replace('\n', ' ');
        if (message.Length is 0 or > MaxMessage)
        {
            return CmsResult<TributeView>.Invalid("message", $"Write a message of up to {MaxMessage} characters.");
        }

        if (await roll.GetAsync(serviceNumber, ct) is null)
        {
            return CmsResult<TributeView>.Fail(CmsError.NotFound, "There is no such person on the honour roll.");
        }

        var tribute = new Tribute
        {
            ServiceNumber = serviceNumber,
            AuthorId = person.Id,
            AuthorName = person.Name,
            Message = message,
            CreatedUtc = clock.GetUtcNow().UtcDateTime,
        };
        db.Tributes.Add(tribute);
        await db.SaveChangesAsync(ct);
        return CmsResult<TributeView>.Success(new TributeView(tribute.Id, tribute.AuthorName, tribute.Message, tribute.CreatedUtc, true, true));
    }

    public async Task<CmsResult<bool>> DeleteAsync(long id, Person person, CancellationToken ct)
    {
        var tribute = await db.Tributes.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (tribute is null)
        {
            return CmsResult<bool>.Fail(CmsError.NotFound, "There is no such tribute.");
        }

        if (!person.IsEditor && tribute.AuthorId != person.Id)
        {
            return CmsResult<bool>.Fail(CmsError.Forbidden, "Only the person who left a tribute, or an editor, can remove it.");
        }

        db.Tributes.Remove(tribute);
        await db.SaveChangesAsync(ct);
        return CmsResult<bool>.Success(true);
    }
}

/// <summary>Members telling us about a casualty in an incident. Editors read these in the Studio and act on them by hand.</summary>
public sealed class CasualtyService(AvwDbContext db, IContactSource contacts, IHonourRollSource roll, TimeProvider clock, INotifier notifier)
{
    public static readonly string[] Types = CommunityLimits.CasualtyTypes;

    public async Task<CmsResult<CasualtyRow>> SubmitAsync(int contactId, CasualtyInput input, Person person, CancellationToken ct)
    {
        var type = input.CasualtyType?.Trim();
        if (type is null || !Types.Contains(type))
        {
            return CmsResult<CasualtyRow>.Invalid("casualtyType", "Choose what happened to them.");
        }

        var comment = PlainText.Clean(input.Comment);
        if (comment.Length is 0 or > 2000)
        {
            return CmsResult<CasualtyRow>.Invalid("comment", "Tell us what you know, in up to 2,000 characters.");
        }

        var serviceNumber = string.IsNullOrWhiteSpace(input.ServiceNumber) ? null : input.ServiceNumber.Trim();
        if (serviceNumber is { Length: > 32 })
        {
            return CmsResult<CasualtyRow>.Invalid("serviceNumber", "That service number is too long.");
        }

        if (await contacts.GetAsync(contactId, ct) is null)
        {
            return CmsResult<CasualtyRow>.Fail(CmsError.NotFound, "There is no such incident.");
        }

        var row = new CasualtySubmission
        {
            ContactId = contactId,
            ServiceNumber = serviceNumber,
            CasualtyType = type,
            Comment = comment,
            SubmittedById = person.Id,
            SubmittedByName = person.Name,
            CreatedUtc = clock.GetUtcNow().UtcDateTime,
        };
        db.CasualtySubmissions.Add(row);
        await db.SaveChangesAsync(ct);
        notifier.Notify(new Notification($"Casualty information received (incident {contactId})", $"{person.Name} sent information about a casualty ({type}) on incident {contactId}.\n\nIncident: {{site}}/battlemap?incident={contactId}\nRead it in the Studio: {{site}}/studio/moderation"));
        return CmsResult<CasualtyRow>.Success(ToRow(row));
    }

    public async Task<List<CasualtyRow>> ListAsync(bool? handled, CancellationToken ct)
    {
        var q = db.CasualtySubmissions.AsNoTracking().AsQueryable();
        if (handled is { } h)
        {
            q = q.Where(c => c.Handled == h);
        }

        return (await q.OrderBy(c => c.Handled).ThenByDescending(c => c.CreatedUtc).Take(200).ToListAsync(ct)).Select(ToRow).ToList();
    }

    public async Task<CmsResult<CasualtyRow>> MarkAsync(long id, bool handled, CancellationToken ct)
    {
        var row = await db.CasualtySubmissions.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (row is null)
        {
            return CmsResult<CasualtyRow>.Fail(CmsError.NotFound, "There is no such submission.");
        }

        row.Handled = handled;
        row.HandledUtc = handled ? clock.GetUtcNow().UtcDateTime : null;
        await db.SaveChangesAsync(ct);
        return CmsResult<CasualtyRow>.Success(ToRow(row));
    }

    /// <summary>The people on the honour roll who became casualties in this incident.</summary>
    public async Task<IReadOnlyList<HonourSummary>> CasualtiesOfAsync(int contactId, CancellationToken ct)
    {
        var numbers = await db.CasualtyLinks.AsNoTracking().Where(l => l.ContactId == contactId).Select(l => l.ServiceNumber).ToListAsync(ct);
        return await roll.GetManyAsync(numbers, ct);
    }

    private static CasualtyRow ToRow(CasualtySubmission c) => new(c.Id, c.ContactId, c.ServiceNumber, c.CasualtyType, c.Comment, c.SubmittedByName, c.CreatedUtc, c.Handled);
}
