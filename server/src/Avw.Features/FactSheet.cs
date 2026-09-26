namespace Avw.Features;

// What a unit's history is drafted from: written to content/features/unit-histories/<unit>/facts.json. Everything a reader will
// be shown is here as a plain site address (a contact's Battle Map link, a portrait's or a picture's /media address), so the page
// needs nothing else to show it.

public sealed record FactSheet(
    UnitFacts Unit,
    Figures Figures,
    IReadOnlyList<YearCount> PerYear,
    IReadOnlyList<ShareCount> Activity,
    IReadOnlyList<SupportFacts> Support,
    IReadOnlyList<ShareCount> DataSources,
    IReadOnlyList<OperationFacts> Operations,
    IReadOnlyList<AreaFacts> Areas,
    IReadOnlyList<NotableContact> Notable,
    IReadOnlyList<SubUnitFacts> SubUnits,
    IReadOnlyList<Fallen> Dead,
    IReadOnlyList<PictureFacts> Pictures,
    SourceCounts Sources);

/// <param name="MapUrl">The Battle Map filtered to the unit and everything under it.</param>
/// <param name="Arm">What the unit was (see <see cref="UnitRow.Arm"/>).</param>
/// <param name="Record">Its Australian War Memorial record, the official source for its arm, its tours and its role.</param>
/// <param name="Tours">Its official tours (see <see cref="UnitRow.Tours"/>), or empty until they are checked.</param>
/// <param name="OutsideTours">Contacts recorded against it outside its official tours (with their ids, to check): an error in the data, a
/// detachment that stayed, or a unit named wrongly. Empty when its tours are not yet checked.</param>
/// <param name="Corrected">Contacts put right, to or from this unit: recorded against a unit outside its tours, and counted for the unit
/// with a history that the report names and that was in Vietnam then, or left out where it names a New Zealand company first.</param>
public sealed record UnitFacts(
    int Id, string Slug, string Title, string Short, string Arm, string? Record, IReadOnlyList<TourSpan> Tours, IReadOnlyList<int> OutsideTours,
    IReadOnlyList<CorrectedContact> Corrected, string MapUrl);

/// <param name="RecordedAgainst">The slugs of the units the data files it under (outside their tours).</param>
/// <param name="CountedFor">The slug of the unit its report names, which it is counted for; null when the report names a unit left out
/// (a New Zealand company), so that it is in no history.</param>
public sealed record CorrectedContact(int Id, string Date, string RecordedAgainst, string? CountedFor);

/// <param name="Led">Contacts in which one of the unit's own (it, or one of its sub-units) was the unit in contact: the first listed.</param>
/// <param name="Supported">Contacts it took part in behind another unit: firing in support, carrying, or with another unit's patrol.</param>
public sealed record Figures(
    int Contacts, int Led, int Supported, string? First, string? Last, int Operations,
    int FriendlyKilled, int FriendlyWounded, int EnemyKilled, int EnemyWounded, int MineIncidents);

/// <summary>What the unit did for other units: the kind of support (from its arm, and the contact's support records), and whom.</summary>
public sealed record SupportFacts(string Kind, int Contacts, IReadOnlyList<SupportedUnit> For);

/// <param name="Unit">The short name of the unit supported (a history's, or the top of its tree: "US Army").</param>
public sealed record SupportedUnit(string Unit, int Contacts);

public sealed record YearCount(int Year, int Contacts);

/// <param name="Share">Of the contacts counted (for activity, those the unit led), 0 to 1, to two places.</param>
public sealed record ShareCount(string Name, int Count, double Share);

public sealed record OperationFacts(string Name, int Contacts, string First, string Last, int FriendlyKilled, int EnemyKilled);

/// <summary>Where the unit's contacts were: counted against the nearest base or landing zone on the map, within 15 km.</summary>
public sealed record AreaFacts(string Place, string Type, int Contacts, double Share);

/// <summary>
/// A contact that may be named in the account: one of the unit's most significant (by casualties and the forces involved), its
/// first or last, or one chosen as typical of an activity it did often (with a report substantial enough to say so).
/// </summary>
/// <param name="Why">Why it is here: <c>significant</c>, <c>first</c>, <c>last</c>, <c>typical:&lt;task&gt;</c>.</param>
/// <param name="SubUnits">The slugs of the sub-unit sections it belongs to.</param>
/// <param name="Role"><c>led</c>, or the kind of support it gave (as in <see cref="SupportFacts.Kind"/>).</param>
/// <param name="LedBy">The unit in contact, when it was not one of this unit's own.</param>
public sealed record NotableContact(
    int Id,
    string Url,
    string Dtg,
    IReadOnlyList<string> Why,
    string Role,
    string? LedBy,
    string? Operation,
    string? Task,
    string? GridRef,
    int FriendlyForce,
    int EnemyForce,
    int FriendlyKilled,
    int FriendlyWounded,
    int EnemyKilled,
    int EnemyWounded,
    IReadOnlyList<string> Units,
    IReadOnlyList<string> SubUnits,
    string? Report,
    string? ArchivalSource);

/// <param name="Parent">The slug of the section it sits under (a troop under its squadron), or null when directly under the unit.</param>
public sealed record SubUnitFacts(
    int Id, string Slug, string? Parent, string Title, string MapUrl, Figures Figures, IReadOnlyList<ShareCount> Activity,
    IReadOnlyList<SupportFacts> Support, IReadOnlyList<int> Notable);

/// <summary>One of the unit's dead: on a tour with it when they died, or linked to one of its contacts.</summary>
/// <param name="Via"><c>tour</c>, <c>contact</c>, or both.</param>
/// <param name="Portrait">The deployed portrait's address, or null when there is none.</param>
public sealed record Fallen(
    string ServiceNumber, string Name, string? Rank, string? Died, IReadOnlyList<string> Via, IReadOnlyList<int> Contacts, IReadOnlyList<string> SubUnits, string? Portrait);

/// <param name="How"><c>linked</c> to one of the unit's contacts, or <c>near</c> its contacts (and in its time, where dated).</param>
public sealed record PictureFacts(
    long Id, string Url, string ThumbUrl, string? Caption, string? Credit, string? DateTaken, int? Contact, string How, int NearbyContacts);

/// <summary>How much the sheet was drawn from, so a change in the data shows as a change in the file.</summary>
public sealed record SourceCounts(int Contacts, int Units, int RollPeople, int CasualtyLinks, int Pictures, int Places, int Portraits);
