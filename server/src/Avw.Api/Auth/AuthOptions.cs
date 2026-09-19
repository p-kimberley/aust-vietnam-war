using System.ComponentModel.DataAnnotations;

namespace Avw.Api.Auth;

/// <summary>Keycloak OIDC client settings. The API is a confidential client and hosts the login (BFF).</summary>
public sealed class AuthOptions
{
    public const string Section = "Auth";

    /// <summary>Realm issuer URL, e.g. <c>https://auth.vietnam-war.au/realms/avw</c>.</summary>
    [Required]
    public string Authority { get; set; } = "";

    [Required]
    public string ClientId { get; set; } = "avw-api";

    [Required]
    public string ClientSecret { get; set; } = "";

    /// <summary>Set false only for local development against plain-http Keycloak.</summary>
    public bool RequireHttpsMetadata { get; set; } = true;
}
