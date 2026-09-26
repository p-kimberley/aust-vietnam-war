using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Avw.Features;

/// <summary>
/// Writes a unit's history (content/features/unit-histories/&lt;unit&gt;/history.md) from its fact sheet and the summaries of its
/// notable contacts' reports: front matter for the page's head, then the history in plain Markdown, every link a site address.
/// The page shows it as it is: each <c>##</c> section is an entry in its contents, and each sub-unit's <c>###</c> heading is the
/// section its address opens at (the heading's words, as a slug, are its id).
/// </summary>
public static partial class HistoryMarkdown
{
    private static readonly string[] Months =
        ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    private static readonly Dictionary<string, string> ArmNames = new()
    {
        ["infantry"] = "Infantry", ["cavalry"] = "Cavalry", ["armour"] = "Armour", ["special-air-service"] = "Special Air Service",
        ["headquarters"] = "Formation headquarters", ["artillery"] = "Artillery", ["engineers"] = "Engineers",
    };

    public static string Render(FactSheet s, ReportSummaries summaries)
    {
        var md = new StringBuilder();
        var u = s.Unit;
        var f = s.Figures;

        // The page's head: what it shows above the history.
        md.Append("---\n");
        Front("unit", u.Slug);
        Front("id", u.Id.ToString(CultureInfo.InvariantCulture));
        Front("title", u.Title);
        Front("short", u.Short);
        Front("arm", ArmNames.GetValueOrDefault(u.Arm, u.Arm));
        Front("tours", ToursText(u.Tours));
        Front("record", u.Record ?? "");
        Front("map", u.MapUrl);
        Front("contacts", Num(f.Contacts));
        Front("operations", Num(f.Operations));
        Front("dead", Num(s.Dead.Count));
        Front("wounded", Num(f.FriendlyWounded));
        Front("enemyKilled", Num(f.EnemyKilled));
        md.Append("---\n");

        // Year by year.
        Section("Year by year");
        Line($"{f.Contacts} contacts are recorded for the unit and sub-units, from {Day(f.First)} to {Day(f.Last)}." +
             (f.Supported > 0 ? $" It was the unit in contact in {f.Led} of them, and took part in {f.Supported} led by other units." : ""));
        Table(["Year", "Contacts"], [false, true], s.PerYear.Select(y => new[]
        {
            MapLink(Num(y.Year), $"from={y.Year}-01-01&to={y.Year}-12-31"), Num(y.Contacts),
        }));

        // Unit actions.
        Section("Unit actions");
        if (s.Activity.Count > 0)
        {
            Line("In the contacts it led, by the task the report records:");
            Table(["Task", "Contacts", "Share"], [false, true, true], s.Activity.Select(a => new[]
            {
                a.Filter is { } filter ? MapLink(Esc(a.Name), filter) : Esc(a.Name), Num(a.Count), Percent(a.Share),
            }));
        }

        foreach (var k in s.Support)
        {
            Line($"**{Esc(k.Kind)}** in {k.Contacts} contacts led by other units: " +
                 string.Join(", ", k.For.Select(x => $"{Esc(x.Unit)} ({x.Contacts})")) + ".");
        }

        // Operations.
        if (s.Operations.Count > 0)
        {
            Section("Operations");
            // In the order they began; the page shows the first rows of a long table, and the rest on request.
            var listed = s.Operations.OrderBy(o => o.First, StringComparer.Ordinal).ThenBy(o => o.Name, StringComparer.Ordinal);
            Table(["Operation", "Dates", "Contacts", "Australians killed", "Enemy killed"], [false, false, true, true, true],
                listed.Select(o => new[]
                {
                    MapLink(Esc(o.Name), "ops=" + Uri.EscapeDataString(o.Name)), o.First == o.Last ? Day(o.First) : $"{Day(o.First)} – {Day(o.Last)}", Num(o.Contacts), Num(o.FriendlyKilled),
                    Num(o.EnemyKilled),
                }));
        }

        // Notable contacts, each with the summary of its report.
        if (s.Notable.Count > 0)
        {
            Section("Notable contacts");
            Line("Each report is summarised in plain English by an AI model from the original, which is full of abbreviations and " +
                 "soldiers' shorthand; the original is on the Battle Map.");
            foreach (var c in s.Notable)
            {
                var title = $"{Day(c.Dtg)}: {Esc(c.Task ?? "Contact")}" + (c.Operation is { } op ? $", Operation {Esc(op)}" : "");
                md.Append("\n### ").Append(title).Append('\n');
                Line($"*{string.Join(" · ", c.Why.Select(WhyText))}* · {Esc(RoleText(c, u.Short))}");
                if (Casualties(c.FriendlyKilled, c.FriendlyWounded, c.EnemyKilled, c.EnemyWounded) is { Length: > 0 } cas)
                {
                    Line(cas);
                }

                Line(summaries.For(c.Id, c.Report) is { } summary ? Esc(summary) : "*No summary of the report yet.*");
                Line($"[Open on the Battle Map]({c.Url})" + (c.ArchivalSource is { Length: > 0 } src ? $" · Report's sources: {Esc(OneLine(src))}" : ""));
            }
        }

        // Sub-units.
        if (s.SubUnits.Count > 0)
        {
            Section("Sub-units");
            foreach (var sub in s.SubUnits)
            {
                md.Append("\n### ").Append(Esc(sub.Title)).Append('\n');
                var g = sub.Figures;
                Line($"{g.Contacts} contacts, {Day(g.First)} to {Day(g.Last)}" + (g.Operations > 0 ? $"; {g.Operations} operations" : "") + "." +
                     (Casualties(g.FriendlyKilled, g.FriendlyWounded, g.EnemyKilled, g.EnemyWounded) is { Length: > 0 } cas ? " " + cas : ""));
                var did = sub.Activity.Where(a => a.Name != "Not recorded").Take(5).ToList();
                if (did.Count > 0)
                {
                    Line("Actions: " + string.Join(", ", did.Select(a => $"{Esc(a.Name.ToLowerInvariant())} {Percent(a.Share)}")) + ".");
                }

                if (sub.Notable.Count > 0)
                {
                    Line("Most significant contacts:");
                    foreach (var n in sub.Notable)
                    {
                        var what = n.Activity == "Not recorded" ? "contact" : n.Activity.ToLowerInvariant();
                        var nCas = Casualties(n.FriendlyKilled, n.FriendlyWounded, n.EnemyKilled, 0);
                        md.Append($"- [{Day(n.Date)}]({n.Url}): {Esc(what)}")
                            .Append(n.Operation is { } op ? $", Operation {Esc(op)}" : "").Append('.')
                            .Append(nCas.Length > 0 ? " " + nCas : "").Append('\n');
                    }
                }

                Line($"[View {Esc(sub.Title)} on the Battle Map]({sub.MapUrl})");
            }
        }

        // Roll of honour: shown as a gallery of portraits.
        if (s.Dead.Count > 0)
        {
            Section("Roll of honour");
            Line($"The unit's {s.Dead.Count} dead on the honour roll: those on a tour with the unit when they died, and reinforcements " +
                 "killed in the unit's contacts. Each opens their entry on the honour roll.");
            md.Append('\n');
            foreach (var p in s.Dead)
            {
                // Name, rank and date of death, each on a line of its own (a "\" at the end of a line breaks it).
                var lines = new[]
                {
                    $"[{Esc(p.Name)}](/battlemap?person={Uri.EscapeDataString(p.ServiceNumber)})",
                    p.Rank is { Length: > 0 } rank ? Esc(rank) : null,
                    p.Died is { } died ? Day(died) : null,
                }.OfType<string>();
                md.Append("- ").Append(p.Portrait is { } src ? $"![]({src}) " : "").Append(string.Join("\\\n  ", lines)).Append('\n');
            }
        }

        // Photographs: shown as a gallery.
        if (s.Pictures.Count > 0)
        {
            Section("Photographs");
            Line("From the site's collection: pictures linked to the unit's contacts, and others taken near them at the time. Each opens on the Battle Map.");
            md.Append('\n');
            foreach (var p in s.Pictures)
            {
                // The picture's description is its whole caption; the words beside it, the start of it.
                var caption = Esc(OneLine(p.Caption ?? ""));
                var shown = Esc(Shorten(OneLine(p.Caption ?? ""), CaptionChars));
                var credit = string.Join(", ", new[] { p.Credit, p.DateTaken is { } d ? Day(d) : null }.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => Esc(x!)));
                md.Append($"- [![{caption}]({p.ThumbUrl})](/battlemap?picture={p.Id})").Append(shown.Length > 0 ? $" {shown}" : "")
                    .Append(credit.Length > 0 ? $" *{credit}*" : "").Append('\n');
            }
        }

        // Sources.
        Section("Sources");
        md.Append('\n');
        if (u.Record is { } record)
        {
            md.Append($"- Tours and arm: [the Australian War Memorial's record of the unit]({record}).\n");
        }

        md.Append($"- Contacts: the Battle Map's records of {f.Contacts} contacts, each report citing the archival source (most often the commanders' diaries, AWM95).\n");
        md.Append("- The dead: the honour roll, with tours of duty from the nominal roll.\n");
        md.Append("- Summaries of the reports: written by an AI model (Claude) from the reports, and reviewed.\n");
        return md.ToString();

        // The Battle Map with the unit's contacts, narrowed by another of its filters (a year, a task, an operation). A Markdown link
        // ends at a bracket, so the address's brackets are escaped.
        string MapLink(string text, string filter) =>
            $"[{text}](/battlemap?units={u.Id}&{filter.Replace("(", "%28").Replace(")", "%29")})";
        void Front(string key, string value) => md.Append(key).Append(": ").Append(OneLine(value)).Append('\n');
        void Section(string title) => md.Append("\n## ").Append(title).Append('\n');
        void Line(string text) => md.Append('\n').Append(text).Append('\n');
        void Table(string[] head, bool[] right, IEnumerable<string[]> rows)
        {
            md.Append('\n').Append("| ").Append(string.Join(" | ", head)).Append(" |\n")
                .Append('|').Append(string.Join('|', right.Select(r => r ? " --: " : " --- "))).Append("|\n");
            foreach (var row in rows)
            {
                md.Append("| ").Append(string.Join(" | ", row.Select(c => c.Replace("|", "\\|")))).Append(" |\n");
            }
        }
    }

    /// <summary>"1966-04..1967-05; 1969-02..1970-02" → "April 1966 – May 1967, February 1969 – February 1970".</summary>
    public static string ToursText(IEnumerable<TourSpan> tours) =>
        string.Join(", ", tours.Select(t => $"{MonthYear(t.From)} – {MonthYear(t.To)}"));

    private static string MonthYear(string yyyyMm) => $"{Months[int.Parse(yyyyMm[5..7], CultureInfo.InvariantCulture) - 1]} {yyyyMm[..4]}";

    /// <summary>"1966-08-18" (or a date-time) → "18 August 1966".</summary>
    public static string Day(string? date) =>
        date is { Length: >= 10 }
            ? $"{int.Parse(date[8..10], CultureInfo.InvariantCulture)} {Months[int.Parse(date[5..7], CultureInfo.InvariantCulture) - 1]} {date[..4]}"
            : "";

    private static string Day(DateOnly date) => Day(date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));

    private static string Num(int n) => n.ToString(CultureInfo.InvariantCulture);

    private static string Percent(double share) => $"{Math.Round(share * 100).ToString(CultureInfo.InvariantCulture)}%";

    private static string WhyText(string why) =>
        why.StartsWith("typical:", StringComparison.Ordinal) ? $"Typical: {why["typical:".Length..].ToLowerInvariant()}"
        : why switch { "significant" => "Significant", "first" => "First", "last" => "Last", _ => why };

    /// <summary>What the unit did in the contact: it was the unit in contact, or what it gave another unit.</summary>
    public static string RoleText(NotableContact c, string unit) => c.Role switch
    {
        "led" => $"{unit} in contact",
        "In another unit's contact" => c.LedBy is { } by ? $"In {by}'s contact" : "In another unit's contact",
        _ => c.LedBy is { } by ? $"{c.Role} for {by}" : c.Role,
    };

    /// <summary>"Australian: 2 killed, 5 wounded. Enemy: 12 killed." — only what was recorded.</summary>
    public static string Casualties(int frKilled, int frWounded, int enKilled, int enWounded)
    {
        static string Side(string label, int killed, int wounded)
        {
            var parts = new[] { killed > 0 ? $"{killed} killed" : "", wounded > 0 ? $"{wounded} wounded" : "" }.Where(p => p.Length > 0).ToList();
            return parts.Count > 0 ? $"{label}: {string.Join(", ", parts)}." : "";
        }

        return string.Join(" ", new[] { Side("Australian", frKilled, frWounded), Side("Enemy", enKilled, enWounded) }.Where(p => p.Length > 0));
    }

    /// <summary>How much of a photograph's caption is shown beside it.</summary>
    public const int CaptionChars = 160;

    /// <summary>The start of a text, cut at a word, with an ellipsis when there is more.</summary>
    public static string Shorten(string text, int max)
    {
        if (text.Length <= max) return text;
        var cut = text[..max];
        var space = cut.LastIndexOf(' ');
        return (space > max * 0.8 ? cut[..space] : cut).TrimEnd(' ', ',', ';', '.') + " …";
    }

    private static string OneLine(string text) => WhiteSpace().Replace(text, " ").Trim();

    /// <summary>Text from the data, made safe to put in Markdown: its characters that mean something there are escaped.</summary>
    public static string Esc(string text) => MarkdownSpecial().Replace(OneLine(text), @"\$1");

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhiteSpace();

    [GeneratedRegex(@"([\\`*_\[\]<>#|])")]
    private static partial Regex MarkdownSpecial();
}
