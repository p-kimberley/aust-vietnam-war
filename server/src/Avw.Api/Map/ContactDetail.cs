namespace Avw.Api.Map;

/// <summary>A friendly unit involved in a contact.</summary>
public sealed record ContactUnit(int Id, string ShortName, string LongName);

/// <summary>
/// Everything the incident panel shows for one contact. Fetched on demand, so the up-front contact list stays small.
/// </summary>
/// <param name="Dtg">Local date-time group as recorded, without a zone.</param>
/// <param name="GridRef">Reported location as a grid reference (for example <c>YS374671</c>).</param>
/// <param name="Units">Friendly units involved. Units flagged hidden in the data are never returned.</param>
/// <param name="Description">The original incident report text.</param>
/// <param name="SourceUrl">An external source link, only ever an absolute http(s) URL.</param>
/// <param name="Summary">The report in plain English, written by an AI model from the original (the index's <c>Incident_Summary</c>),
/// or null where there is none.</param>
public sealed record ContactDetail(
    int Id,
    string Dtg,
    double Lat,
    double Lon,
    string? GridRef,
    string? Operation,
    string? UnitTask,
    ContactUnit[] Units,
    int FrForce,
    int EnForce,
    int FrKia,
    int FrWia,
    int EnKia,
    int EnWia,
    string? Description,
    string? ArchivalSource,
    string? SourceUrl,
    string? Summary = null);
