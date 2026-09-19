namespace Avw.Api.Map;

public interface IContactSource
{
    Task<IReadOnlyList<ContactSummary>> GetAllAsync(CancellationToken ct);
}
