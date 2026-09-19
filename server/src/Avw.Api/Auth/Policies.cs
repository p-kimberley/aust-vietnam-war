using Microsoft.AspNetCore.Authorization;

namespace Avw.Api.Auth;

/// <summary>Realm role names as issued by Keycloak in the <c>roles</c> claim.</summary>
public static class Roles
{
    public const string Member = "member";
    public const string Author = "author";
    public const string Editor = "editor";
    public const string Admin = "admin";
}

/// <summary>
/// Policies are hierarchical: an editor can do everything an author can, an admin everything an editor can.
/// Keycloak also models this with composite roles (that is what drives the MFA condition), but the API does
/// not depend on it.
/// </summary>
public static class Policies
{
    public const string Member = nameof(Member);
    public const string Author = nameof(Author);
    public const string Editor = nameof(Editor);
    public const string Admin = nameof(Admin);

    public static void AddAvwPolicies(this AuthorizationOptions options)
    {
        options.AddPolicy(Member, p => p.RequireRole(Roles.Member, Roles.Author, Roles.Editor, Roles.Admin));
        options.AddPolicy(Author, p => p.RequireRole(Roles.Author, Roles.Editor, Roles.Admin));
        options.AddPolicy(Editor, p => p.RequireRole(Roles.Editor, Roles.Admin));
        options.AddPolicy(Admin, p => p.RequireRole(Roles.Admin));
    }
}
