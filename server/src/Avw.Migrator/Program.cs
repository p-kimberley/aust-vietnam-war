using Avw.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

// Schema migration job. Runs as a Helm pre-install/pre-upgrade hook and by hand:
//   Avw.Migrator                apply pending EF migrations
//   Avw.Migrator --dry-run      list what would be applied, change nothing
// Legacy data import commands (idempotent, dry-run capable) are added here in phase 6.

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

await using var db = new AvwDbContext(new DbContextOptionsBuilder<AvwDbContext>().UseMySQL(connectionString).Options);

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
