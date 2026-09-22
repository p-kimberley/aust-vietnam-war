using Avw.Api.Map;
using Avw.Api.Media;
using Avw.Data;
using Avw.Migration;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using MySql.Data.MySqlClient;

// Schema and data migration job. Runs as a Helm pre-install/pre-upgrade hook and by hand.
//
//   Avw.Migrator [--dry-run]                       apply pending EF migrations (or list them with --dry-run)
//   Avw.Migrator import-poi [--dry-run]            import points of interest from the legacy database
//   Avw.Migrator import-community [--dry-run] [--media-root <folder>] [--skip-media]
//                                                  import notes, comments, tributes, casualty reports, links and pictures.
//                                                  Pictures are read from --media-root (the legacy uploads folder), processed
//                                                  like a new upload and written to Media__RootPath. Without --media-root,
//                                                  or with --skip-media, only the text content is imported.
//   Avw.Migrator import-roll [--dry-run]           copy the nominal roll of those who died in service from the legacy Elasticsearch
//                                                  index (avw_nomroll) into the honour_roll table, where it is searched. Once done,
//                                                  the application never asks Elasticsearch for the roll. Needs Elasticsearch__Url
//                                                  and, as for the API, Elasticsearch__ApiKey and Elasticsearch__CaCertificatePath.
//
// Import commands read the legacy database named by ConnectionStrings__Legacy, write to ConnectionStrings__Default, are
// idempotent (safe to repeat) and honour --dry-run, which reports counts and changes nothing. Reports never print rows,
// because legacy data can contain personal information.

var config = new ConfigurationBuilder()
    .AddJsonFile("appsettings.json", optional: true)
    .AddEnvironmentVariables()
    .AddCommandLine(args)
    .Build();

var connectionString = config.GetConnectionString("Default");
if (string.IsNullOrWhiteSpace(connectionString))
{
    Console.Error.WriteLine("ConnectionStrings__Default is not set.");
    return 2;
}

var dryRun = args.Contains("--dry-run");
var command = args.FirstOrDefault(a => !a.StartsWith("--") && a != ArgValue("--media-root"));

await using var db = new AvwDbContext(new DbContextOptionsBuilder<AvwDbContext>().UseMySQL(connectionString).Options);

switch (command)
{
    case null:
        return await ApplyMigrations();

    case "import-poi":
    {
        var legacy = config.GetConnectionString("Legacy");
        if (string.IsNullOrWhiteSpace(legacy))
        {
            Console.Error.WriteLine("ConnectionStrings__Legacy is not set.");
            return 2;
        }

        await using var source = new MySqlConnection(legacy);
        await source.OpenAsync();
        var rows = await LegacyReader.ReadPoisAsync(source);
        Console.WriteLine($"Read {rows.Count} rows from the legacy poi table.");
        Console.WriteLine(await PoiImporter.ImportAsync(rows, db, dryRun));
        return 0;
    }

    case "import-community":
    {
        var legacy = config.GetConnectionString("Legacy");
        if (string.IsNullOrWhiteSpace(legacy))
        {
            Console.Error.WriteLine("ConnectionStrings__Legacy is not set.");
            return 2;
        }

        await using var source = new MySqlConnection(legacy);
        await source.OpenAsync();
        var authors = new CommunityImporter.Authors(await LegacyCommunityReader.UsersAsync(source));

        var notes = await LegacyCommunityReader.NotesAsync(source);
        var versions = await LegacyCommunityReader.NoteVersionsAsync(source);
        var comments = await LegacyCommunityReader.CommentsAsync(source);
        Console.WriteLine($"Read {notes.Count} notes, {versions.Count} versions and {comments.Count} comments.");
        Console.WriteLine(await CommunityImporter.ImportNotesAsync(notes, versions, comments, authors, db, dryRun));

        var tributes = await LegacyCommunityReader.TributesAsync(source);
        Console.WriteLine(await CommunityImporter.ImportTributesAsync(tributes, authors, db, dryRun));

        var submissions = await LegacyCommunityReader.CasualtySubmissionsAsync(source);
        Console.WriteLine(await CommunityImporter.ImportCasualtySubmissionsAsync(submissions, authors, db, dryRun));

        var links = await LegacyCommunityReader.CasualtyLinksAsync(source);
        Console.WriteLine(await CommunityImporter.ImportCasualtyLinksAsync(links, db, dryRun));

        var mediaRoot = ArgValue("--media-root");
        if (args.Contains("--skip-media") || mediaRoot is null)
        {
            Console.WriteLine("Pictures skipped (give --media-root <legacy uploads folder> to import them).");
            return 0;
        }

        if (!Directory.Exists(mediaRoot))
        {
            Console.Error.WriteLine($"The media root '{mediaRoot}' does not exist.");
            return 2;
        }

        var options = new MediaOptions();
        config.GetSection(MediaOptions.Section).Bind(options);
        using var processor = new MediaProcessor(Options.Create(options));
        var pictures = await LegacyCommunityReader.MediaAsync(source);
        var likes = await LegacyCommunityReader.LikesAsync(source);
        Console.WriteLine($"Read {pictures.Count} pictures and {likes.Count} likes.");
        Console.WriteLine(await CommunityImporter.ImportMediaAsync(
            pictures, likes, authors, new DirectoryFiles(mediaRoot), processor, db, dryRun, TimeProvider.System));
        return 0;
    }

    case "import-roll":
    {
        var url = config["Elasticsearch:Url"];
        if (string.IsNullOrWhiteSpace(url))
        {
            Console.Error.WriteLine("Elasticsearch__Url is not set.");
            return 2;
        }

        var handler = new SocketsHttpHandler();
        var ca = config["Elasticsearch:CaCertificatePath"];
        if (!string.IsNullOrWhiteSpace(ca))
        {
            var validation = PrivateCaValidation.FromFile(ca);
            handler.SslOptions.RemoteCertificateValidationCallback = (_, cert, chain, errors) => validation.Validate(cert, chain, errors);
        }

        using var http = new HttpClient(handler) { BaseAddress = new Uri(url.TrimEnd('/') + "/"), Timeout = TimeSpan.FromSeconds(60) };
        if (!string.IsNullOrWhiteSpace(config["Elasticsearch:ApiKey"]))
        {
            http.DefaultRequestHeaders.Authorization = new("ApiKey", config["Elasticsearch:ApiKey"]);
        }

        var records = await LegacyRollReader.ReadAsync(http, config["Elasticsearch:PersonnelIndex"] ?? "avw_nomroll");
        Console.WriteLine($"Read {records.Count} people who died from the legacy roll.");
        Console.WriteLine(await RollImporter.ImportAsync(records, db, dryRun));
        return 0;
    }

    default:
        Console.Error.WriteLine($"Unknown command '{command}'. Commands: import-poi, import-community, import-roll.");
        return 2;
}

string? ArgValue(string name)
{
    var i = Array.IndexOf(args, name);
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
}

async Task<int> ApplyMigrations()
{
    var applied = (await db.Database.GetAppliedMigrationsAsync()).ToList();
    var pending = (await db.Database.GetPendingMigrationsAsync()).ToList();

    Console.WriteLine($"Applied migrations: {applied.Count}");
    foreach (var m in pending)
    {
        Console.WriteLine($"  pending: {m}");
    }

    if (pending.Count == 0)
    {
        Console.WriteLine("Database is up to date.");
        return 0;
    }

    if (dryRun)
    {
        Console.WriteLine($"Dry run: {pending.Count} migration(s) would be applied.");
        return 0;
    }

    await db.Database.MigrateAsync();
    Console.WriteLine($"Applied {pending.Count} migration(s).");
    return 0;
}
