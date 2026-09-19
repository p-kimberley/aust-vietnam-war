using System.Security.Claims;
using System.Text.Encodings.Web;
using Avw.Api.Map;
using Avw.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;

namespace Avw.Api.Tests;

/// <summary>Runs the real API in-process with an in-memory database and a stubbed Keycloak configuration.</summary>
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    public const string TestScheme = "Test";
    private readonly string _dbName = Guid.NewGuid().ToString();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        // Read eagerly by Program.cs, so it must be a host setting rather than an app-configuration override.
        builder.UseSetting("DataProtection:AllowUnencryptedKeys", "true");
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Default"] = "Server=unused;Database=unused",
            ["Auth:Authority"] = "https://auth.test/realms/avw",
            ["Auth:ClientId"] = "avw-api",
            ["Auth:ClientSecret"] = "test-secret",
            ["Elasticsearch:Url"] = "http://es.test",
            ["Map:Basemaps:0:Id"] = "plain",
            ["Map:Basemaps:0:Name"] = "Plain",
            ["Map:Basemaps:0:Style"] = "https://tiles.test/styles/plain/style.json",
            ["Map:Basemaps:0:Default"] = "true",
        }));

        builder.ConfigureServices(services =>
        {
            // EF Core 9+ keeps provider configuration in IDbContextOptionsConfiguration<T>; drop both so the
            // MySQL and in-memory providers are never registered together.
            services.RemoveAll<DbContextOptions<AvwDbContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<AvwDbContext>>();
            services.RemoveAll<IContactSource>();
            services.AddSingleton<FakeContactSource>();
            services.AddSingleton<IContactSource>(sp => sp.GetRequiredService<FakeContactSource>());
            services.AddDbContext<AvwDbContext>(o => o.UseInMemoryDatabase(_dbName));

            // No network: give the OIDC handler a fixed discovery document.
            services.PostConfigure<OpenIdConnectOptions>(AuthSetupSchemes.Oidc, o =>
            {
                o.ConfigurationManager = new StaticConfigurationManager<OpenIdConnectConfiguration>(
                    new OpenIdConnectConfiguration
                    {
                        Issuer = "https://auth.test/realms/avw",
                        AuthorizationEndpoint = "https://auth.test/realms/avw/protocol/openid-connect/auth",
                        TokenEndpoint = "https://auth.test/realms/avw/protocol/openid-connect/token",
                        EndSessionEndpoint = "https://auth.test/realms/avw/protocol/openid-connect/logout",
                    });
            });

            // A header-driven scheme lets tests act as any user without talking to Keycloak.
            services.AddAuthentication().AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestScheme, _ => { });
            services.PostConfigure<AuthenticationOptions>(o => o.DefaultAuthenticateScheme = TestScheme);
        });
    }
}

internal static class AuthSetupSchemes
{
    public const string Oidc = Avw.Api.Auth.AuthSetup.OidcScheme;
}

/// <summary>Authenticates when <c>X-Test-User</c> is present; <c>X-Test-Roles</c> is a comma-separated list.</summary>
public sealed class TestAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("X-Test-User", out var name))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var claims = new List<Claim> { new("sub", "test-sub"), new("name", name.ToString()), new("avw_uid", "42") };
        foreach (var role in Request.Headers["X-Test-Roles"].ToString().Split(',', StringSplitOptions.RemoveEmptyEntries))
        {
            claims.Add(new Claim("roles", role));
        }

        var identity = new ClaimsIdentity(claims, TestScheme, "name", "roles");
        return Task.FromResult(AuthenticateResult.Success(
            new AuthenticationTicket(new ClaimsPrincipal(identity), TestScheme)));
    }

    private const string TestScheme = ApiFactory.TestScheme;
}
