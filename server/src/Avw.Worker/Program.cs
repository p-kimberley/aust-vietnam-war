using Avw.Data;
using Avw.Data.Indexing;
using Avw.Worker;
using Microsoft.EntityFrameworkCore;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddDbContext<AvwDbContext>(o => o.UseMySQL(
    builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default is not configured.")));
builder.Services.AddSingleton(new IndexingSwitch(builder.Configuration.GetValue<bool>("Indexing:Enabled")));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHostedService<Worker>();
builder.Services.AddHostedService<MediaSweepService>();
builder.Services.AddAvwIndexing(builder.Configuration);

builder.Build().Run();
