using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Avw.Indexing;

/// <summary>One thing to do to one document: put these fields in it (creating it if it is not there), or remove it.</summary>
public sealed record IndexOperation(string Index, long Id, JsonObject? Fields)
{
    public bool IsDelete => Fields is null;
    public static IndexOperation Upsert(string index, long id, JsonObject fields) => new(index, id, fields);
    public static IndexOperation Delete(string index, long id) => new(index, id, null);
}

/// <summary>What became of one operation.</summary>
/// <param name="Done">Elasticsearch has it (or, for a removal, it was not there to begin with).</param>
/// <param name="Retry">It failed in a way that may pass (Elasticsearch busy or down), so try again later. False means retrying will not help.</param>
public sealed record IndexResult(bool Done, bool Retry, string? Error)
{
    public static readonly IndexResult Ok = new(true, false, null);
}

public interface IIndexWriter
{
    /// <returns>One result per operation, in order. Throws when the request as a whole could not be made or was refused.</returns>
    Task<IReadOnlyList<IndexResult>> WriteAsync(IReadOnlyList<IndexOperation> operations, CancellationToken ct);
}

/// <summary>
/// Writes to Elasticsearch with the bulk API. Fields are <em>merged</em> into a document (an update that creates it if missing), never
/// replacing it, so fields this site does not know about, such as the old site's author id on migrated content, are left as they were.
/// </summary>
public sealed class ElasticsearchWriter(HttpClient http) : IIndexWriter
{
    public async Task<IReadOnlyList<IndexResult>> WriteAsync(IReadOnlyList<IndexOperation> operations, CancellationToken ct)
    {
        if (operations.Count == 0)
        {
            return [];
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, "_bulk") { Content = new StringContent(Body(operations), Encoding.UTF8) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/x-ndjson");
        using var response = await http.SendAsync(request, ct);
        var text = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"Elasticsearch answered {(int)response.StatusCode} to the bulk request: {Trim(text)}", null, response.StatusCode);
        }

        return Results(text, operations.Count);
    }

    /// <summary>The request body: for each operation an action line, then for a change the fields on a line of their own.</summary>
    public static string Body(IReadOnlyList<IndexOperation> operations)
    {
        var body = new StringBuilder();
        foreach (var op in operations)
        {
            var target = new JsonObject { ["_index"] = op.Index, ["_id"] = op.Id.ToString() };
            if (op.IsDelete)
            {
                body.Append(new JsonObject { ["delete"] = target }.ToJsonString()).Append('\n');
            }
            else
            {
                body.Append(new JsonObject { ["update"] = target }.ToJsonString()).Append('\n');
                body.Append(new JsonObject { ["doc"] = op.Fields!.DeepClone(), ["doc_as_upsert"] = true }.ToJsonString()).Append('\n');
            }
        }

        return body.ToString();
    }

    /// <summary>Reads the per-item answers. A removal of a document that was not there is fine; busy or down is worth another try; anything else is not.</summary>
    public static IReadOnlyList<IndexResult> Results(string responseBody, int expected)
    {
        var items = JsonNode.Parse(responseBody)?["items"]?.AsArray()
                    ?? throw new HttpRequestException($"Elasticsearch's bulk answer had no items: {Trim(responseBody)}");
        if (items.Count != expected)
        {
            throw new HttpRequestException($"Elasticsearch answered {items.Count} items to {expected} operations.");
        }

        var results = new List<IndexResult>(expected);
        foreach (var item in items)
        {
            var (action, detail) = item!.AsObject().First();
            var status = detail?["status"]?.GetValue<int>() ?? 0;
            if (status is >= 200 and < 300 || action == "delete" && status == 404)
            {
                results.Add(IndexResult.Ok);
                continue;
            }

            var reason = detail?["error"] is JsonObject error ? $"{error["type"]}: {error["reason"]}" : detail?["error"]?.ToString();
            results.Add(new IndexResult(false, status is 429 or >= 500 or 0, Trim(reason)));
        }

        return results;
    }

    private static string Trim(string? s) => s is null ? "" : s.Length > 500 ? s[..500] : s;
}
