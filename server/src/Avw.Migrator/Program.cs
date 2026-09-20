using Avw.Data;
using Avw.Migration;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using MySql.Data.MySqlClient;

// Schema and data migration job. Runs as a Helm pre-install/pre-upgrade hook and by hand.
//
//   Avw.Migrator [--dry-run]                       apply pending EF migrations (or list them with --dry-run)
//   Avw.Migrator import-poi [--dry-run]            import points of interest from the legacy database
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
var command = args.FirstOrDefault(a => !a.StartsWith("--"));

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

    default:
        Console.Error.WriteLine($"Unknown command '{command}'. Commands: import-poi.");
        return 2;
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
