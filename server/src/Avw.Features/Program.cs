using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Avw.Api.Map;
using Avw.Api.Media;
using Avw.Data;
using Avw.Data.Entities;
using Avw.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

// Tools for the site's Features, run from a developer's machine; they read the live data (read-only) and write the files committed
// under content/features/. They are never part of the site.
//
//   Avw.Features unit-histories facts [--content <folder>] [--portraits <folder>] [--only <slug>]
//       Works out each unit's fact sheet (content/features/unit-histories/<unit>/facts.json) from the contacts (Elasticsearch), the
//       honour roll, casualty links, pictures and bases (the database), and the deployed portraits (a folder of <service number>.jpg,
//       by default .ai/kia-portraits), and the page's list of them (index.json). Reports which sheets changed, then renders the
//       histories (below).
//       Needs ConnectionStrings__Default and Elasticsearch__Url (with Elasticsearch__ApiKey and Elasticsearch__CaCertificatePath), as
//       the API does.
//
//   Avw.Features unit-histories render [--content <folder>] [--only <slug>]
//       Writes each unit's history (<unit>/history.md), which the site shows, from its fact sheet and the summaries of its notable
//       contacts' reports (summaries.json). Reads only those files. Reports the notable contacts with no summary, or one written from
//       a report that has since changed.

var config = new ConfigurationBuilder().AddEnvironmentVariables().AddCommandLine(args).Build();
var positional = args.Where((a, i) => !a.StartsWith("--") && (i == 0 || !args[i - 1].StartsWith("--"))).ToArray();
if (positional is not ["unit-histories", "facts" or "render"])
{
    Console.Error.WriteLine("Usage: Avw.Features unit-histories facts [--content <folder>] [--portraits <folder>] [--only <slug>]");
    Console.Error.WriteLine("       Avw.Features unit-histories render [--content <folder>] [--only <slug>]");
    return 2;
}

var repo = FindRepo(Directory.GetCurrentDirectory());
var contentDir = Arg("--content") ?? Path.Combine(repo, "content", "features");
var portraitsDir = Arg("--portraits") ?? Path.Combine(repo, ".ai", "kia-portraits");
var only = Arg("--only");
var unitsDir = Path.Combine(contentDir, "unit-histories");
var table = UnitsTable.Parse(await File.ReadAllTextAsync(Path.Combine(unitsDir, "units.csv")));
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.Never };
if (positional[1] == "render")
{
    await Render();
    return 0;
}

// ---------------------------------------------------------------- the contacts, as the Battle Map has them

var es = new ElasticsearchOptions
{
    Url = config["Elasticsearch:Url"] ?? throw new InvalidOperationException("Elasticsearch__Url is not set."),
    ApiKey = config["Elasticsearch:ApiKey"],
    CaCertificatePath = config["Elasticsearch:CaCertificatePath"],
};
var handler = new SocketsHttpHandler();
if (!string.IsNullOrWhiteSpace(es.CaCertificatePath))
{
    var validation = PrivateCaValidation.FromFile(es.CaCertificatePath);
    handler.SslOptions.RemoteCertificateValidationCallback = (_, cert, chain, errors) => validation.Validate(cert, chain, errors);
}

using var http = new HttpClient(handler) { BaseAddress = new Uri(es.Url.TrimEnd('/') + "/"), Timeout = TimeSpan.FromMinutes(2) };
if (!string.IsNullOrWhiteSpace(es.ApiKey))
{
    http.DefaultRequestHeaders.Authorization = new("ApiKey", es.ApiKey);
}

var source = new ElasticsearchContactSource(http, Options.Create(es), NullLogger<ElasticsearchContactSource>.Instance);
var (contacts, catalogue) = CatalogueBuilder.Build(await source.GetAllAsync(CancellationToken.None));
var roles = await ContactRoles.ReadAsync(http, es.ContactsIndex, CancellationToken.None);
Console.WriteLine($"Contacts: {contacts.Length} (who led and supported read for {roles.Count}); units in the tree: {catalogue.Units.Length}.");

// ---------------------------------------------------------------- the database

var connection = config.GetConnectionString("Default") ?? throw new InvalidOperationException("ConnectionStrings__Default is not set.");
await using var db = new AvwDbContext(new DbContextOptionsBuilder<AvwDbContext>().UseMySQL(connection).Options);

var roll = (await db.HonourRoll.AsNoTracking().Select(p => new { p.ServiceNumber, p.Name, p.Rank, p.DeathDate, p.Tours }).ToListAsync())
    .Select(p => new RollPerson(p.ServiceNumber, p.Name, p.Rank, p.DeathDate, ParseTours(p.Tours)))
    .ToList();
var links = (await db.CasualtyLinks.AsNoTracking().Select(l => new { l.ServiceNumber, l.ContactId }).ToListAsync())
    .ToLookup(l => l.ServiceNumber, l => l.ContactId);
var pictures = (await db.IncidentMedia.AsNoTracking()
        .Where(m => m.Media.Status == MediaStatus.Approved)
        .Select(m => new { m.Id, m.Media.Sha256, m.Media.Caption, m.Media.Credit, m.DateTaken, m.Lat, m.Lon, m.ContactId })
        .ToListAsync())
    .Select(m => new SitePicture(m.Id, MediaPaths.ImageUrl(m.Sha256), MediaPaths.ThumbnailUrl(m.Sha256), m.Caption, m.Credit, m.DateTaken, m.Lat, m.Lon, m.ContactId))
    .ToList();
var places = (await db.Pois.AsNoTracking().Where(p => p.Visible).Select(p => new { p.Name, p.Type, p.Lat, p.Lon }).ToListAsync())
    .Select(p => new Place(p.Name, p.Type, p.Lat, p.Lon))
    .ToList();
var portraits = Directory.Exists(portraitsDir)
    ? Directory.EnumerateFiles(portraitsDir, "*.jpg").Select(Path.GetFileNameWithoutExtension).OfType<string>().ToHashSet()
    : [];
if (portraits.Count == 0)
{
    Console.WriteLine($"No portraits found in {portraitsDir}: the sheets will show none.");
}

Console.WriteLine($"Honour roll: {roll.Count}; casualty links: {links.Sum(g => g.Count())}; pictures: {pictures.Count}; places: {places.Count}; portraits: {portraits.Count}.");

// ---------------------------------------------------------------- the sheets

var builder = new FactSheetBuilder(table, new FactInputs(contacts, catalogue, roles, roll, links, pictures, places, portraits));
var reports = new Dictionary<int, ContactDetail>();
var changed = 0;
foreach (var unit in table.Histories.Where(u => only is null || u.Slug == only))
{
    foreach (var id in builder.Candidates(unit).Where(id => !reports.ContainsKey(id)))
    {
        if (await source.GetAsync(id, CancellationToken.None) is { } detail)
        {
            reports[id] = detail;
        }
    }

    var sheet = builder.Build(unit, reports);
    var dir = Path.Combine(unitsDir, unit.Slug);
    Directory.CreateDirectory(dir);
    var path = Path.Combine(dir, "facts.json");
    var text = JsonSerializer.Serialize(sheet, json).Replace("\r\n", "\n") + "\n";
    var before = File.Exists(path) ? (await File.ReadAllTextAsync(path)).Replace("\r\n", "\n") : null;
    if (before != text)
    {
        await File.WriteAllTextAsync(path, text);
        changed++;
    }

    Console.WriteLine(
        $"{unit.Slug,-20} {(before is null ? "new" : before == text ? "unchanged" : "changed"),-9} " +
        $"{sheet.Figures.Contacts,5} contacts, {sheet.SubUnits.Count,2} sub-units, {sheet.Notable.Count,2} notable, " +
        $"{sheet.Dead.Count,3} dead ({sheet.Dead.Count(d => d.Portrait is not null)} with portraits), {sheet.Pictures.Count,2} pictures");
}

// The page's list, from every sheet on disk (so that one rebuilt alone with --only still leaves the list whole).
var sheets = table.Histories
    .Select(h => (h.Slug, Path: Path.Combine(unitsDir, h.Slug, "facts.json")))
    .Where(x => File.Exists(x.Path))
    .ToDictionary(x => x.Slug, x => JsonSerializer.Deserialize<FactSheet>(File.ReadAllText(x.Path), json)!);
var indexPath = Path.Combine(unitsDir, "index.json");
var indexText = JsonSerializer.Serialize(UnitIndex.Build(table, sheets), json).Replace("\r\n", "\n") + "\n";
if (!File.Exists(indexPath) || (await File.ReadAllTextAsync(indexPath)).Replace("\r\n", "\n") != indexText)
{
    await File.WriteAllTextAsync(indexPath, indexText);
    changed++;
}

Console.WriteLine($"{changed} file(s) written.");
await Render();
return 0;

// Each unit's history.md, from its fact sheet and the report summaries.
async Task Render()
{
    var summariesPath = Path.Combine(unitsDir, "summaries.json");
    var summaries = File.Exists(summariesPath) ? ReportSummaries.Parse(await File.ReadAllTextAsync(summariesPath)) : ReportSummaries.Empty;
    var written = 0;
    var missing = new SortedSet<int>();
    foreach (var unit in table.Histories.Where(u => only is null || u.Slug == only))
    {
        var factsPath = Path.Combine(unitsDir, unit.Slug, "facts.json");
        if (!File.Exists(factsPath))
        {
            Console.WriteLine($"{unit.Slug,-20} no fact sheet: run `unit-histories facts` first");
            continue;
        }

        var sheet = JsonSerializer.Deserialize<FactSheet>(await File.ReadAllTextAsync(factsPath), json)!;
        missing.UnionWith(sheet.Notable.Where(c => summaries.For(c.Id, c.Report) is null).Select(c => c.Id));
        var path = Path.Combine(unitsDir, unit.Slug, "history.md");
        var text = HistoryMarkdown.Render(sheet, summaries);
        var before = File.Exists(path) ? (await File.ReadAllTextAsync(path)).Replace("\r\n", "\n") : null;
        if (before != text)
        {
            await File.WriteAllTextAsync(path, text);
            written++;
        }
    }

    Console.WriteLine($"{written} history file(s) written.");
    if (missing.Count > 0)
    {
        Console.WriteLine($"{missing.Count} notable contact(s) have no summary of their report, or one written from a report that has " +
                          $"since changed (summaries.json): {string.Join(", ", missing)}");
    }
}

string? Arg(string name)
{
    var i = Array.IndexOf(args, name);
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
}

static string FindRepo(string from)
{
    for (var dir = new DirectoryInfo(from); dir is not null; dir = dir.Parent)
    {
        if (Directory.Exists(Path.Combine(dir.FullName, "content", "features")))
        {
            return dir.FullName;
        }
    }

    throw new InvalidOperationException("Run this from inside the repository (no content/features folder was found above here), or pass --content.");
}

// The nominal roll writes tour dates as dd/MM/yyyy.
static IReadOnlyList<Tour> ParseTours(string json)
{
    static DateOnly? Date(string? s) =>
        DateOnly.TryParseExact(s, "dd/MM/yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
    return doc.RootElement.EnumerateArray()
        .Select(t => new Tour(
            t.TryGetProperty("Unit", out var u) ? u.GetString() ?? "" : "",
            Date(t.TryGetProperty("Start", out var s) ? s.GetString() : null),
            Date(t.TryGetProperty("End", out var e) ? e.GetString() : null)))
        .ToList();
}
