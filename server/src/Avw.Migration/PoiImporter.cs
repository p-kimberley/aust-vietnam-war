using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;
using MySql.Data.MySqlClient;

namespace Avw.Migration;

/// <summary>A row of the legacy <c>poi</c> table.</summary>
public sealed record LegacyPoi(int Id, string? Type, string? Name, string? Visible, int? Established, string? Details, double? Lon, double? Lat);

public static class LegacyReader
{
    public static async Task<List<LegacyPoi>> ReadPoisAsync(MySqlConnection connection, CancellationToken ct = default)
    {
        var rows = new List<LegacyPoi>();
        await using var cmd = new MySqlCommand("SELECT ID, Type, Name, Visible, Established, Details, Lon, Lat FROM poi ORDER BY ID", connection);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            rows.Add(new LegacyPoi(
                reader.GetInt32(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetInt32(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetDouble(6),
                reader.IsDBNull(7) ? null : reader.GetDouble(7)));
        }

        return rows;
    }
}

/// <summary>Imports points of interest. Safe to run repeatedly: rows are matched on the legacy id and only changed when they differ.</summary>
public static class PoiImporter
{
    public static async Task<ImportReport> ImportAsync(IEnumerable<LegacyPoi> rows, AvwDbContext db, bool dryRun, CancellationToken ct = default)
    {
        var report = new ImportReport("points of interest", dryRun);
        var existing = await db.Pois.ToDictionaryAsync(p => p.Id, ct);

        foreach (var row in rows)
        {
            if (row.Lat is null || row.Lon is null || row.Lat is < -90 or > 90 || row.Lon is < -180 or > 180)
            {
                report.Skip("without usable coordinates");
                continue;
            }

            if (string.IsNullOrWhiteSpace(row.Name))
            {
                report.Skip("without a name");
                continue;
            }

            var wanted = new Poi
            {
                Id = row.Id,
                Type = (row.Type ?? "").Trim(),
                Name = row.Name.Trim(),
                Visible = string.Equals(row.Visible?.Trim(), "Y", StringComparison.OrdinalIgnoreCase),
                Established = row.Established,
                Details = HtmlText.ToPlain(row.Details),
                Lat = row.Lat.Value,
                Lon = row.Lon.Value,
            };

            if (!existing.TryGetValue(row.Id, out var current))
            {
                report.Added++;
                if (!dryRun) db.Pois.Add(wanted);
            }
            else if (Same(current, wanted))
            {
                report.Unchanged++;
            }
            else
            {
                report.Updated++;
                if (!dryRun) db.Entry(current).CurrentValues.SetValues(wanted);
            }
        }

        if (!dryRun)
        {
            await db.SaveChangesAsync(ct);
        }

        return report;
    }

    private static bool Same(Poi a, Poi b) =>
        a.Type == b.Type && a.Name == b.Name && a.Visible == b.Visible && a.Established == b.Established
        && a.Details == b.Details && a.Lat == b.Lat && a.Lon == b.Lon;
}
