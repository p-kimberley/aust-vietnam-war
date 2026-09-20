using Avw.Data;
using Microsoft.EntityFrameworkCore;

namespace Avw.Api.Map;

/// <summary>What the map draws for a point of interest.</summary>
public sealed record PoiSummary(int Id, string Type, string Name, int? Established, double Lat, double Lon);

/// <summary>A point of interest in full, for its detail panel.</summary>
public sealed record PoiDetail(int Id, string Type, string Name, int? Established, double Lat, double Lon, string? Details);

public static class PoiEndpoints
{
    public static void MapPoiEndpoints(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/pois").WithTags("Map");

        // About a hundred rows of reference data that changes only on import, so a short shared cache is plenty.
        g.MapGet("/", async (AvwDbContext db, HttpContext ctx, CancellationToken ct) =>
            {
                ctx.Response.Headers.CacheControl = "public, max-age=300";
                return await db.Pois.AsNoTracking()
                    .Where(p => p.Visible)
                    .OrderBy(p => p.Type).ThenBy(p => p.Name)
                    .Select(p => new PoiSummary(p.Id, p.Type, p.Name, p.Established, p.Lat, p.Lon))
                    .ToListAsync(ct);
            })
            .WithName("GetPois")
            .Produces<List<PoiSummary>>();

        g.MapGet("/{id:int:min(1)}", async (int id, AvwDbContext db, HttpContext ctx, CancellationToken ct) =>
            {
                var poi = await db.Pois.AsNoTracking()
                    .Where(p => p.Id == id && p.Visible)
                    .Select(p => new PoiDetail(p.Id, p.Type, p.Name, p.Established, p.Lat, p.Lon, p.Details))
                    .FirstOrDefaultAsync(ct);
                if (poi is null)
                {
                    return Results.NotFound();
                }

                ctx.Response.Headers.CacheControl = "public, max-age=300";
                return Results.Ok(poi);
            })
            .WithName("GetPoi")
            .Produces<PoiDetail>()
            .Produces(StatusCodes.Status404NotFound);
    }
}
