using System.Net.Http.Headers;
using Avw.Api.Map;
using Avw.Indexing;
using Microsoft.Extensions.Options;

namespace Avw.Worker;

public static class IndexingSetup
{
    /// <summary>
    /// Registers what the indexer needs. The write key and the read-only key are separate: writes go to <c>Indexing</c>'s address and key,
    /// and the lookup of where an incident is uses the <c>Elasticsearch</c> section the site itself reads with. Where the indexing section
    /// leaves the address or the CA empty, the site's is used.
    /// </summary>
    public static IServiceCollection AddAvwIndexing(this IServiceCollection services, IConfiguration config)
    {
        services.Configure<IndexingOptions>(config.GetSection(IndexingOptions.Section));

        var read = config.GetSection("Elasticsearch");
        string? Setting(string name) => config.GetSection(IndexingOptions.Section)[name] is { Length: > 0 } own ? own : read[name];

        services.AddHttpClient<IIndexWriter, ElasticsearchWriter>(http => Configure(http, Setting("Url"), config[$"{IndexingOptions.Section}:ApiKey"], TimeSpan.FromSeconds(60)))
            .ConfigurePrimaryHttpMessageHandler(() => Handler(Setting("CaCertificatePath")));

        services.AddHttpClient<IContactLocations, ElasticsearchContactLocations>(http => Configure(http, read["Url"], read["ApiKey"], TimeSpan.FromSeconds(15)))
            .ConfigurePrimaryHttpMessageHandler(() => Handler(read["CaCertificatePath"]));

        services.AddScoped<IndexProcessor>();
        services.AddHostedService<IndexingService>();
        return services;
    }

    private static void Configure(HttpClient http, string? url, string? apiKey, TimeSpan timeout)
    {
        // Left unset, the client points nowhere: the service does nothing while indexing is off, and says so if it is on without an address.
        http.BaseAddress = string.IsNullOrWhiteSpace(url) ? new Uri("http://localhost:9200/") : new Uri(url.TrimEnd('/') + "/");
        http.Timeout = timeout;
        if (!string.IsNullOrWhiteSpace(apiKey))
        {
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("ApiKey", apiKey);
        }
    }

    /// <summary>Trusts only the private CA the cluster's certificate chains to, when one is given.</summary>
    private static HttpMessageHandler Handler(string? caPath)
    {
        var handler = new SocketsHttpHandler();
        if (!string.IsNullOrWhiteSpace(caPath))
        {
            var validation = PrivateCaValidation.FromFile(caPath);
            handler.SslOptions.RemoteCertificateValidationCallback = (_, cert, chain, errors) => validation.Validate(cert, chain, errors);
        }

        return handler;
    }
}
