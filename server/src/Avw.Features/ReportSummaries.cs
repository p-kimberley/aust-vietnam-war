using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Avw.Features;

/// <summary>
/// Plain-English summaries of the notable contacts' reports (content/features/unit-histories/summaries.json), written by a language
/// model from each report and reviewed in the repository: the reports are full of abbreviations and soldiers' shorthand. Each is
/// kept with a fingerprint of the report it was written from, so a report that has changed since shows as needing a new one.
/// </summary>
public sealed class ReportSummaries(IReadOnlyDictionary<int, ReportSummary> entries)
{
    public IReadOnlyDictionary<int, ReportSummary> Entries { get; } = entries;

    /// <summary>The summary of this report, or null when there is none or it was written from a different report.</summary>
    public string? For(int contactId, string? report) =>
        Entries.TryGetValue(contactId, out var s) && s.Report == Fingerprint(report) ? s.Summary : null;

    /// <summary>A short fingerprint of a report's text (its line endings and surrounding space aside).</summary>
    public static string Fingerprint(string? report) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes((report ?? "").Replace("\r\n", "\n").Trim())))[..12];

    public static ReportSummaries Parse(string json)
    {
        var raw = JsonSerializer.Deserialize<Dictionary<string, ReportSummary>>(json, JsonOptions) ?? [];
        return new(raw.ToDictionary(kv => int.Parse(kv.Key), kv => kv.Value));
    }

    public static ReportSummaries Empty { get; } = new(new Dictionary<int, ReportSummary>());

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
}

/// <param name="Report">The <see cref="ReportSummaries.Fingerprint"/> of the report it was written from.</param>
public sealed record ReportSummary(string Report, string Summary);
