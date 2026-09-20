using System.ComponentModel.DataAnnotations;

namespace Avw.Api.Map;

public sealed class ElasticsearchOptions
{
    public const string Section = "Elasticsearch";

    [Required, Url]
    public string Url { get; set; } = "";

    /// <summary>Base64 API key (`id:key` encoded), sent as <c>Authorization: ApiKey</c>. Empty for an open dev cluster.</summary>
    public string? ApiKey { get; set; }

    /// <summary>
    /// PEM/DER file of the private CA that signed the cluster's certificate. When set, only certificates chaining to it
    /// are trusted for this connection. Leave empty when the cluster uses a publicly trusted certificate.
    /// </summary>
    public string? CaCertificatePath { get; set; }

    public string ContactsIndex { get; set; } = "avw_contacts";

    /// <summary>The nominal roll, read for the personnel charts.</summary>
    public string PersonnelIndex { get; set; } = "avw_nomroll";

    /// <summary>Elasticsearch's default result window; the whole dataset (about 6,200 contacts) fits in one request.</summary>
    [Range(1, 10_000)]
    public int MaxContacts { get; set; } = 10_000;

    /// <summary>How long the built contact payload is reused before Elasticsearch is asked again.</summary>
    [Range(1, 86_400)]
    public int ContactsCacheSeconds { get; set; } = 600;
}
