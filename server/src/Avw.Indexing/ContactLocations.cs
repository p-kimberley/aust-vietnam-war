using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Avw.Indexing;

/// <summary>Where an incident is on the map, which is where a note about it is placed in the notes index.</summary>
public interface IContactLocations
{
    /// <returns>Null when the incident is not found or cannot be read: a note is indexed without a place rather than not at all.</returns>
    Task<(double Lat, double Lon)?> FindAsync(int contactId, CancellationToken ct);
}

/// <summary>Reads one incident's place from the contacts index, with the read-only key the site already uses.</summary>
public sealed class ElasticsearchContactLocations(HttpClient http, IOptions<IndexingOptions> options, ILogger<ElasticsearchContactLocations> logger) : IContactLocations
{
    public async Task<(double Lat, double Lon)?> FindAsync(int contactId, CancellationToken ct)
    {
        try
        {
            using var response = await http.GetAsync($"{options.Value.ContactsIndex}/_doc/{contactId}?_source_includes=Location", ct);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            var location = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct))?["_source"]?["Location"];
            return location?["lat"] is { } lat && location["lon"] is { } lon ? (lat.GetValue<double>(), lon.GetValue<double>()) : null;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException or FormatException)
        {
            logger.LogWarning(ex, "Could not find where incident {ContactId} is; its note is indexed without a place", contactId);
            return null;
        }
    }
}
