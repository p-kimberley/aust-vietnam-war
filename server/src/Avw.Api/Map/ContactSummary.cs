namespace Avw.Api.Map;

/// <summary>
/// The compact per-contact record the map loads up front and filters client-side. Anything heavier (description,
/// grid reference, weapons) is fetched per incident.
/// </summary>
/// <param name="Id">Elasticsearch document id, which is the legacy contact id.</param>
/// <param name="Dtg">Local date-time group as recorded, without a zone (for example <c>1966-03-03T19:50:00</c>).</param>
/// <param name="Fr">Friendly force present.</param>
/// <param name="FrCas">Total friendly casualties.</param>
/// <param name="En">Enemy force.</param>
/// <param name="EnCas">Total enemy casualties.</param>
/// <param name="Units">Ids of the friendly units involved, for the unit filter.</param>
public sealed record ContactSummary(
    int Id,
    string Dtg,
    double Lat,
    double Lon,
    int Fr,
    int FrCas,
    int En,
    int EnCas,
    int[] Units);
