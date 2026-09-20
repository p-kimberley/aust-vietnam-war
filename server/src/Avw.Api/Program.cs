using System.Security.Cryptography.X509Certificates;
using System.Text.Json.Serialization;
using Avw.Api.Auth;
using Avw.Api.Cms;
using Avw.Api.Map;
using Avw.Api.Media;
using Avw.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var services = builder.Services;

// The map catalogue (basemaps, overlays, terrain) is deployment configuration. In the cluster it arrives as a mounted
// ConfigMap so it can change without a new image; it is optional so local runs use appsettings.
builder.Configuration.AddJsonFile(
    builder.Configuration["MapConfigFile"] ?? "/etc/avw/map/map.json", optional: true, reloadOnChange: true);

services.AddOptions<AuthOptions>()
    .Bind(builder.Configuration.GetSection(AuthOptions.Section))
    .ValidateDataAnnotations()
    .ValidateOnStart();

services.AddDbContext<AvwDbContext>(o => o.UseMySQL(
    builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default is not configured.")));

// Keys live in MySQL so every replica (and every restart) can read the same auth cookies. They are encrypted
// with a certificate, otherwise anyone who can read the table could forge session cookies.
var dataProtection = services.AddDataProtection()
    .SetApplicationName("avw")
    .PersistKeysToDbContext<AvwDbContext>();

var keyCertPath = builder.Configuration["DataProtection:CertificatePath"];
if (!string.IsNullOrWhiteSpace(keyCertPath))
{
    dataProtection.ProtectKeysWithCertificate(X509CertificateLoader.LoadPkcs12FromFile(
        keyCertPath, builder.Configuration["DataProtection:CertificatePassword"]));
}
else if (!builder.Configuration.GetValue<bool>("DataProtection:AllowUnencryptedKeys"))
{
    throw new InvalidOperationException(
        "DataProtection:CertificatePath is required. Set DataProtection:AllowUnencryptedKeys=true only for local development.");
}

services.AddSingleton(TimeProvider.System);
services.AddAvwMap(builder.Configuration);
services.AddAvwAuth(builder.Environment);
services.AddAvwCms();
services.AddAvwFeedback(builder.Configuration);
services.AddAvwMedia(builder.Configuration);

services.AddHealthChecks()
    .AddDbContextCheck<AvwDbContext>("mysql", tags: ["ready"]);

// The contact list is about 800 KB of JSON and compresses roughly tenfold. Only public, non-personalised data is
// served this way; per-user responses (auth) are tiny and not affected in practice.
services.AddResponseCompression(o => o.EnableForHttps = true);
services.AddOpenApi();
services.AddProblemDetails();
services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

// TLS ends at the ingress. Trust its forwarded headers so redirect URIs and cookies use https and the public host.
// Safe because the API is only reachable through the ingress inside the cluster.
services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

var app = builder.Build();

app.UseForwardedHeaders();
app.UseResponseCompression();
app.UseExceptionHandler();
app.UseStatusCodePages();

app.UseAvwMedia();
app.UseRateLimiter();

app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<CsrfHeaderMiddleware>();

var api = app.MapGroup("/api");
api.MapAuthEndpoints();
api.MapMapEndpoints();
api.MapPoiEndpoints();
api.MapCmsEndpoints(builder.Configuration);
api.MapMediaEndpoints();
api.MapFeedbackEndpoints();
api.MapOpenApi("/openapi/{documentName}.json");

api.MapHealthChecks("/health/live", new() { Predicate = _ => false });
api.MapHealthChecks("/health/ready", new() { Predicate = c => c.Tags.Contains("ready") });

app.Run();

// Exposed for WebApplicationFactory in the test project.
public partial class Program;
