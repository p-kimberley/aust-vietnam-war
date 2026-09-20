using Avw.Data;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.Extensions.Options;
using System.Security.Claims;

namespace Avw.Api.Auth;

public static class AuthSetup
{
    public const string CookieScheme = CookieAuthenticationDefaults.AuthenticationScheme;
    public const string OidcScheme = OpenIdConnectDefaults.AuthenticationScheme;

    /// <summary>
    /// Cookie session plus an OIDC (authorization code + PKCE) challenge against Keycloak. The browser only ever
    /// holds the HttpOnly session cookie; no tokens reach the Angular app.
    /// </summary>
    public static IServiceCollection AddAvwAuth(this IServiceCollection services, IHostEnvironment env)
    {
        services
            .AddAuthentication(CookieScheme)
            .AddCookie(CookieScheme, o =>
            {
                o.Cookie.Name = env.IsDevelopment() ? "avw.session" : "__Host-avw.session";
                o.Cookie.Path = "/";
                o.Cookie.HttpOnly = true;
                o.Cookie.SameSite = SameSiteMode.Lax;
                o.Cookie.SecurePolicy = env.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
                o.ExpireTimeSpan = TimeSpan.FromHours(8);
                o.SlidingExpiration = true;

                // This is an API: answer 401/403, never redirect to a login page.
                o.Events.OnRedirectToLogin = ctx =>
                {
                    ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return Task.CompletedTask;
                };
                o.Events.OnRedirectToAccessDenied = ctx =>
                {
                    ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
                    return Task.CompletedTask;
                };
            })
            .AddOpenIdConnect(OidcScheme, _ => { });

        services.AddOptions<OpenIdConnectOptions>(OidcScheme)
            .Configure<IOptions<AuthOptions>>((o, auth) =>
            {
                var a = auth.Value;
                o.SignInScheme = CookieScheme;
                o.Authority = a.Authority;
                o.ClientId = a.ClientId;
                o.ClientSecret = a.ClientSecret;
                o.RequireHttpsMetadata = a.RequireHttpsMetadata;

                o.ResponseType = "code";
                // Query (not form_post) keeps the callback a top-level GET, so SameSite=Lax cookies are enough.
                o.ResponseMode = "query";
                o.UsePkce = true;
                o.SaveTokens = false;
                o.GetClaimsFromUserInfoEndpoint = false;
                o.MapInboundClaims = false;

                o.Scope.Clear();
                o.Scope.Add("openid");
                o.Scope.Add("profile");
                o.Scope.Add("email");

                o.CallbackPath = "/api/auth/signin-oidc";
                o.SignedOutCallbackPath = "/api/auth/signout-callback-oidc";

                // Keycloak's "roles" mapper puts the user's effective realm roles in the ID token as `roles`.
                o.TokenValidationParameters.NameClaimType = "name";
                o.TokenValidationParameters.RoleClaimType = "roles";

                o.Events.OnTokenValidated = async ctx =>
                {
                    var db = ctx.HttpContext.RequestServices.GetRequiredService<AvwDbContext>();
                    var clock = ctx.HttpContext.RequestServices.GetRequiredService<TimeProvider>();
                    var user = await UserSync.UpsertAsync(db, ctx.Principal!, clock, ctx.HttpContext.RequestAborted);
                    ((ClaimsIdentity)ctx.Principal!.Identity!).AddClaim(new Claim(UserSync.LocalIdClaim, user.Id.ToString()));
                    // Content migrated from the legacy site belongs to whoever proves (by verified email) that it was theirs.
                    await Avw.Api.Community.LegacyContentLinker.LinkAsync(db, user, ctx.HttpContext.RequestAborted);
                };
            });

        services.AddAuthorization(o => o.AddAvwPolicies());
        return services;
    }
}
