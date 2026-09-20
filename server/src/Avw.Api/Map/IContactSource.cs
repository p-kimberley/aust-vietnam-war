namespace Avw.Api.Map;

public interface IContactSource
{
    /// <summary>Every contact that has a location, with the units recorded on them.</summary>
    Task<ContactSet> GetAllAsync(CancellationToken ct);

    /// <summary>One contact in full, or <c>null</c> when it does not exist.</summary>
    Task<ContactDetail?> GetAsync(int id, CancellationToken ct);

    /// <summary>Ids of the contacts whose incident report contains every word of <paramref name="text"/>.</summary>
    Task<int[]> SearchAsync(string text, CancellationToken ct);

    /// <summary>The best few matches for <paramref name="text"/>, most relevant first, each with an excerpt.</summary>
    Task<FindResult> FindAsync(string text, int limit, CancellationToken ct);
}
