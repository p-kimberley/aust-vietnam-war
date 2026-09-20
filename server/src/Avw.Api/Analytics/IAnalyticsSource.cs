namespace Avw.Api.Analytics;

/// <summary>Where the charts get their data: the contacts and the nominal roll.</summary>
public interface IAnalyticsSource
{
    Task<IReadOnlyList<IncidentRow>> LoadIncidentsAsync(CancellationToken ct);

    Task<IReadOnlyList<PersonRow>> LoadPeopleAsync(CancellationToken ct);
}
