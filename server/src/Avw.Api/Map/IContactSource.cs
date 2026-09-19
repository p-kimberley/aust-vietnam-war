namespace Avw.Api.Map;

public interface IContactSource
{
    /// <summary>Every contact, in the compact shape the map draws.</summary>
    Task<IReadOnlyList<ContactSummary>> GetAllAsync(CancellationToken ct);

    /// <summary>One contact in full, or <c>null</c> when it does not exist.</summary>
    Task<ContactDetail?> GetAsync(int id, CancellationToken ct);
}
