namespace Avw.Migration;

/// <summary>What an import did, or would do in a dry run. Counts only: legacy rows can hold personal data, so reports never print them.</summary>
public sealed class ImportReport(string name, bool dryRun)
{
    public string Name { get; } = name;
    public bool DryRun { get; } = dryRun;
    public int Added { get; set; }
    public int Updated { get; set; }
    public int Unchanged { get; set; }
    public Dictionary<string, int> Skipped { get; } = [];

    public void Skip(string reason) => Skipped[reason] = Skipped.GetValueOrDefault(reason) + 1;

    public override string ToString()
    {
        var skipped = Skipped.Count == 0 ? "" : ", skipped: " + string.Join(", ", Skipped.Select(s => $"{s.Value} {s.Key}"));
        return $"{Name}{(DryRun ? " (dry run)" : "")}: {Added} added, {Updated} updated, {Unchanged} unchanged{skipped}";
    }
}
