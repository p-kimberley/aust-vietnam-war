namespace Avw.Data.Entities;

/// <summary>
/// Local projection of a Keycloak identity. Created on first login so content can reference an author.
/// Roles are never stored here: Keycloak is the source of truth.
/// </summary>
public class AppUser
{
    public long Id { get; set; }

    /// <summary>The OIDC <c>sub</c> claim.</summary>
    public string Subject { get; set; } = "";

    public string DisplayName { get; set; } = "";

    /// <summary>
    /// SHA-256 of the trimmed, lower-cased verified email. Used to link content migrated from the legacy site
    /// (which stores only a hash, never the address) to the person who later registers with that email.
    /// </summary>
    public string? EmailHash { get; set; }

    public DateTime CreatedUtc { get; set; }
    public DateTime LastSeenUtc { get; set; }
}
