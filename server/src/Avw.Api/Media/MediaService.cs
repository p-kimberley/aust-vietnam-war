using Avw.Api.Cms;
using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Avw.Api.Media;

public sealed record MediaView(
    long Id,
    string Url,
    string ThumbUrl,
    int Width,
    int Height,
    string? Caption,
    string? Credit,
    MediaStatus Status,
    string UploadedByName,
    bool Mine,
    DateTime CreatedUtc);

public sealed record MediaUpdate(string? Caption, string? Credit);

public sealed record MediaStatusRequest(MediaStatus Status);

/// <summary>The media library: uploading, listing and approving pictures. Editors' uploads are approved at once; others wait for an editor.</summary>
public sealed class MediaService(AvwDbContext db, MediaProcessor processor, IOptions<MediaOptions> options, TimeProvider clock)
{
    private readonly MediaOptions _options = options.Value;

    public async Task<CmsResult<MediaView>> UploadAsync(Stream file, string? caption, string? credit, Actor actor, CancellationToken ct)
    {
        if ((caption?.Length ?? 0) > 500 || (credit?.Length ?? 0) > 200)
        {
            return CmsResult<MediaView>.Invalid("caption", "The caption can be up to 500 characters and the credit up to 200.");
        }

        ProcessedImage image;
        try
        {
            image = await processor.ProcessAsync(file, ct);
        }
        catch (MediaException e)
        {
            return CmsResult<MediaView>.Fail(e.Error switch
            {
                MediaError.Busy => CmsError.Unavailable,
                MediaError.TooLarge => CmsError.TooLarge,
                _ => CmsError.Invalid,
            }, e.Message, "file");
        }

        // The same picture uploaded twice is one row: the file name is its hash.
        var asset = await db.MediaAssets.Include(m => m.UploadedBy).FirstOrDefaultAsync(m => m.Sha256 == image.Sha256, ct);
        if (asset is null)
        {
            asset = new MediaAsset
            {
                Sha256 = image.Sha256,
                Width = image.Width,
                Height = image.Height,
                ByteSize = image.ByteSize,
                Caption = Blank(caption),
                Credit = Blank(credit),
                Status = actor.IsEditor ? MediaStatus.Approved : MediaStatus.Pending,
                UploadedById = actor.Id,
                CreatedUtc = clock.GetUtcNow().UtcDateTime,
            };
            db.MediaAssets.Add(asset);
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                // Two uploads of the same picture raced on the unique hash: use the one that won.
                db.Entry(asset).State = EntityState.Detached;
                asset = await db.MediaAssets.Include(m => m.UploadedBy).FirstAsync(m => m.Sha256 == image.Sha256, ct);
            }
        }

        return CmsResult<MediaView>.Success(await ViewAsync(asset.Id, actor, ct));
    }

    public async Task<Paged<MediaView>> ListAsync(MediaStatus? status, string? text, int page, int pageSize, Actor actor, CancellationToken ct)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var q = db.MediaAssets.AsNoTracking().AsQueryable();
        if (!actor.IsEditor)
        {
            // Authors see their own uploads and everything approved (so they can reuse it).
            q = q.Where(m => m.UploadedById == actor.Id || m.Status == MediaStatus.Approved);
        }

        if (status is { } s)
        {
            q = q.Where(m => m.Status == s);
        }

        if (!string.IsNullOrWhiteSpace(text))
        {
            var t = text.Trim();
            q = q.Where(m => (m.Caption != null && m.Caption.Contains(t)) || (m.Credit != null && m.Credit.Contains(t)));
        }

        var total = await q.CountAsync(ct);
        var rows = await q.OrderByDescending(m => m.CreatedUtc).ThenByDescending(m => m.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(m => new { m.Id, m.Sha256, m.Width, m.Height, m.Caption, m.Credit, m.Status, Name = m.UploadedBy.DisplayName, m.UploadedById, m.CreatedUtc })
            .ToListAsync(ct);
        return new Paged<MediaView>(rows.Select(r => Map(r.Id, r.Sha256, r.Width, r.Height, r.Caption, r.Credit, r.Status, r.Name, r.UploadedById == actor.Id, r.CreatedUtc)).ToList(), total, page, pageSize);
    }

    public async Task<CmsResult<MediaView>> SetStatusAsync(long id, MediaStatus status, Actor actor, CancellationToken ct)
    {
        if (!actor.IsEditor)
        {
            return CmsResult<MediaView>.Fail(CmsError.Forbidden, "Only editors can approve or reject pictures.");
        }

        var asset = await db.MediaAssets.FirstOrDefaultAsync(m => m.Id == id, ct);
        if (asset is null)
        {
            return CmsResult<MediaView>.Fail(CmsError.NotFound, "There is no such picture.");
        }

        asset.Status = status;
        await db.SaveChangesAsync(ct);
        return CmsResult<MediaView>.Success(await ViewAsync(id, actor, ct));
    }

    public async Task<CmsResult<MediaView>> UpdateAsync(long id, MediaUpdate update, Actor actor, CancellationToken ct)
    {
        if ((update.Caption?.Length ?? 0) > 500 || (update.Credit?.Length ?? 0) > 200)
        {
            return CmsResult<MediaView>.Invalid("caption", "The caption can be up to 500 characters and the credit up to 200.");
        }

        var asset = await db.MediaAssets.FirstOrDefaultAsync(m => m.Id == id, ct);
        if (asset is null || !actor.IsEditor && asset.UploadedById != actor.Id)
        {
            return CmsResult<MediaView>.Fail(CmsError.NotFound, "There is no such picture.");
        }

        asset.Caption = Blank(update.Caption);
        asset.Credit = Blank(update.Credit);
        await db.SaveChangesAsync(ct);
        return CmsResult<MediaView>.Success(await ViewAsync(id, actor, ct));
    }

    private async Task<MediaView> ViewAsync(long id, Actor actor, CancellationToken ct)
    {
        var m = await db.MediaAssets.AsNoTracking().Include(x => x.UploadedBy).FirstAsync(x => x.Id == id, ct);
        return Map(m.Id, m.Sha256, m.Width, m.Height, m.Caption, m.Credit, m.Status, m.UploadedBy.DisplayName, m.UploadedById == actor.Id, m.CreatedUtc);
    }

    private MediaView Map(long id, string sha, int width, int height, string? caption, string? credit, MediaStatus status, string name, bool mine, DateTime created) =>
        new(id, PublicContent.MediaUrl(sha), $"/media/{sha[..2]}/{sha}-{_options.ThumbnailWidth}.jpg", width, height, caption, credit, status, name, mine, created);

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
