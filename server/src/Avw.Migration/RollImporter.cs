using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Avw.Migration;

/// <summary>Reads the legacy nominal roll from Elasticsearch, where it has been kept and which is meant to be retired.</summary>
public static class LegacyRollReader
{
    private static readonly JsonSerializerOptions RequestJson = new() { PropertyNamingPolicy = null };

    /// <summary>Elasticsearch's default result window. The roll (about 520 people who died) is far under it.</summary>
    public const int MaxPeople = 10_000;

    /// <summary>Every record that has a date of death, from a client already pointed at the cluster (address, key and certificate authority).</summary>
    public static async Task<IReadOnlyList<NomRollRecord>> ReadAsync(HttpClient http, string index, CancellationToken ct = default)
    {
        var body = new { size = MaxPeople, query = new { exists = new { field = "Death.Date" } } };
        using var res = await http.PostAsJsonAsync($"{Uri.EscapeDataString(index)}/_search", body, RequestJson, ct);
        if (!res.IsSuccessStatusCode)
        {
            var detail = await res.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException($"Elasticsearch answered {(int)res.StatusCode}: {(detail.Length > 300 ? detail[..300] : detail)}");
        }

        var result = await res.Content.ReadFromJsonAsync<SearchResult>(ct) ?? throw new InvalidOperationException("Elasticsearch returned an empty response.");
        return result.Hits.Hits.Select(h => h.Source).ToList();
    }

    private sealed record Hit([property: JsonPropertyName("_source")] NomRollRecord Source);

    private sealed record HitList([property: JsonPropertyName("hits")] List<Hit> Hits);

    private sealed record SearchResult([property: JsonPropertyName("hits")] HitList Hits);
}

/// <summary>
/// Copies the roll of those who died in service into the <c>honour_roll</c> table, which is where the roll is searched, and where it
/// will be kept once the Elasticsearch index is retired. Safe to run repeatedly: people are matched on service number and only written
/// when they differ. Nobody is ever removed, so the table can be added to or corrected by other means after the first import.
/// </summary>
public static class RollImporter
{
    public static async Task<ImportReport> ImportAsync(IEnumerable<NomRollRecord> records, AvwDbContext db, bool dryRun, CancellationToken ct = default)
    {
        var report = new ImportReport("honour roll", dryRun);
        var existing = await db.HonourRoll.ToDictionaryAsync(p => p.ServiceNumber, StringComparer.Ordinal, ct);
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var record in records)
        {
            var row = HonourRollRows.From(record);
            if (row is null)
            {
                report.Skip(string.IsNullOrWhiteSpace(record.ServiceNumber) ? "without a service number" : "who did not die");
                continue;
            }

            if (!seen.Add(row.ServiceNumber))
            {
                report.Skip("with a service number already seen");
                continue;
            }

            if (!existing.TryGetValue(row.ServiceNumber, out var current))
            {
                report.Added++;
                if (!dryRun)
                {
                    db.HonourRoll.Add(row);
                }

                continue;
            }

            var entry = db.Entry(current);
            entry.CurrentValues.SetValues(row);                   // only what differs is written
            if (entry.State == EntityState.Modified)
            {
                report.Updated++;
            }
            else
            {
                report.Unchanged++;
            }
        }

        if (dryRun)
        {
            db.ChangeTracker.Clear();
        }
        else
        {
            await db.SaveChangesAsync(ct);
        }

        return report;
    }
}
