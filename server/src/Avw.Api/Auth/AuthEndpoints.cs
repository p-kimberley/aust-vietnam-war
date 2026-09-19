using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;

namespace Avw.Api.Auth;

public sealed record MeResponse(bool Authenticated, long? Id, string? Name, string[] Roles);

public sealed record LogoutResponse(string RedirectUrl);

public static class AuthEndpoints
{
    private static readonly string[] KnownRoles = [Roles.Member, Roles.Author, Roles.Editor, Roles.Admin];

    public static void MapAuthEndpoints(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/auth").WithTags("Auth");

        g.MapGet("/login", (string? returnUrl) =>
                Results.Challenge(Properties(returnUrl), [AuthSetup.OidcScheme]))
            .WithName("Login")
            .ExcludeFromDescription();

        // Keycloak shows its registration form first when prompt=create is sent.
        g.MapGet("/register", (string? returnUrl) =>
            {
                var props = Properties(returnUrl);
                props.SetParameter(OpenIdConnectParameterNames.Prompt, "create");
                return Results.Challenge(props, [AuthSetup.OidcScheme]);
            })
            .WithName("Register")
            .ExcludeFromDescription();

        g.MapGet("/me", (ClaimsPrincipal user, HttpContext ctx) =>
            {
                ctx.Response.Headers.CacheControl = "no-store";
                return user.Identity?.IsAuthenticated == true ? Me(user) : new MeResponse(false, null, null, []);
            })
            .WithName("GetCurrentUser")
            .Produces<MeResponse>();

        // Clears the local session and returns the Keycloak end-session URL for the SPA to navigate to. This is a
        // POST (guarded by the CSRF header) so a third-party page cannot log people out with an image tag.
        g.MapPost("/logout", async (HttpContext ctx, IOptionsMonitor<OpenIdConnectOptions> oidcOptions) =>
            {
                if (ctx.User.Identity?.IsAuthenticated != true)
                {
                    return Results.Ok(new LogoutResponse("/"));
                }

                await ctx.SignOutAsync(AuthSetup.CookieScheme);

                var oidc = oidcOptions.Get(AuthSetup.OidcScheme);
                var config = await oidc.ConfigurationManager!.GetConfigurationAsync(ctx.RequestAborted);

                var home = $"{ctx.Request.Scheme}://{ctx.Request.Host}/";
                var url = QueryHelpers.AddQueryString(config.EndSessionEndpoint, new Dictionary<string, string?>
                {
                    ["client_id"] = oidc.ClientId,
                    ["post_logout_redirect_uri"] = home,
                });
                return Results.Ok(new LogoutResponse(url));
            })
            .WithName("Logout")
            .Produces<LogoutResponse>();
    }

    private static MeResponse Me(ClaimsPrincipal user)
    {
        long? id = long.TryParse(user.FindFirstValue(UserSync.LocalIdClaim), out var parsed) ? parsed : null;
        var roles = user.FindAll("roles").Select(c => c.Value).Where(KnownRoles.Contains).Distinct().ToArray();
        return new MeResponse(true, id, user.FindFirstValue("name") ?? user.FindFirstValue("preferred_username"), roles);
    }

    private static AuthenticationProperties Properties(string? returnUrl) =>
        new() { RedirectUri = IsSafeLocalPath(returnUrl) ? returnUrl : "/" };

    /// <summary>Only same-site absolute paths are allowed as post-login destinations (no open redirect).</summary>
    public static bool IsSafeLocalPath(string? path) =>
        !string.IsNullOrEmpty(path)
        && path[0] == '/'
        && (path.Length == 1 || (path[1] != '/' && path[1] != '\\'))
        && !path.Any(char.IsControl);
}
