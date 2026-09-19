using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Avw.Api.Map;

/// <summary>A serialised contact list plus the validator clients use to skip re-downloading it.</summary>
public sealed record ContactPayload(byte[] Json, string ETag, int Count);

/// <summary>
/// Builds the contact payload once per cache window and serves the same bytes to every request. Concurrent requests
/// share a single Elasticsearch call, and a failed refresh keeps serving the previous payload.
/// </summary>
public sealed class ContactCatalogue(
    IContactSource source, IOptions<ElasticsearchOptions> options, TimeProvider clock, ILogger<ContactCatalogue> logger)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private ContactPayload? _payload;
    private DateTimeOffset _expires;

    public async Task<ContactPayload> GetAsync(CancellationToken ct)
    {
        if (_payload is { } fresh && clock.GetUtcNow() < _expires)
        {
            return fresh;
        }

        await _gate.WaitAsync(ct);
        try
        {
            if (_payload is { } current && clock.GetUtcNow() < _expires)
            {
                return current;
            }

            try
            {
                var contacts = await source.GetAllAsync(ct);
                var json = JsonSerializer.SerializeToUtf8Bytes(contacts, Json);
                var etag = $"\"{Convert.ToHexString(SHA256.HashData(json))[..32].ToLowerInvariant()}\"";
                _payload = new ContactPayload(json, etag, contacts.Count);
                _expires = clock.GetUtcNow().AddSeconds(options.Value.ContactsCacheSeconds);
            }
            catch (Exception ex) when (_payload is not null && ex is not OperationCanceledException)
            {
                // Stale beats an error page for data that has not changed since 1971. Retry after a short pause.
                logger.LogError(ex, "Refreshing contacts failed; serving the previous payload");
                _expires = clock.GetUtcNow().AddSeconds(30);
            }

            return _payload!;
        }
        finally
        {
            _gate.Release();
        }
    }
}
