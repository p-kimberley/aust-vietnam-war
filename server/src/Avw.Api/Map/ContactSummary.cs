namespace Avw.Api.Map;

/// <summary>
/// The compact per-contact record the map loads up front and filters client-side. Anything heavier (description,
/// grid reference, weapons) is fetched per incident. Names are stored once in the <see cref="FilterCatalogue"/> and
/// referenced here by position, which keeps the list small.
/// </summary>
/// <param name="Id">Elasticsearch document id, which is the legacy contact id.</param>
/// <param name="Dtg">Local date-time group as recorded, without a zone (for example <c>1966-03-03T19:50:00</c>).</param>
/// <param name="Fr">Friendly force present.</param>
/// <param name="FrCas">Total friendly casualties.</param>
/// <param name="En">Enemy force.</param>
/// <param name="EnCas">Total enemy casualties.</param>
/// <param name="Units">Ids of the friendly units involved, for the unit filter.</param>
/// <param name="Op">1-based position in <see cref="FilterCatalogue.Operations"/>; 0 when no operation is recorded.</param>
/// <param name="Task">1-based position in <see cref="FilterCatalogue.Tasks"/>; 0 when no task is recorded.</param>
/// <param name="Series">1-based position in <see cref="FilterCatalogue.Series"/>; 0 when unknown.</param>
/// <param name="Mine">0 when not recorded, 1 for no mine incident, 2 for a mine incident.</param>
public sealed record ContactSummary(
    int Id,
    string Dtg,
    double Lat,
    double Lon,
    int Fr,
    int FrCas,
    int En,
    int EnCas,
    int[] Units,
    int Op = 0,
    int Task = 0,
    int Series = 0,
    int Mine = 0);
