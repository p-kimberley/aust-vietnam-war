namespace Avw.Api.Map;

/// <summary>A friendly unit as recorded on contacts. <see cref="Path"/> lists its ancestors, top first, joined by <c>|</c>.</summary>
public sealed record UnitInfo(
    int Id, int? Parent, string? Title, string? ShortTypeName, string? ShortName, string? LongName, string? Path);

/// <summary>One contact as read from the data store, before it is reduced to the compact list the map loads.</summary>
public sealed record ContactRecord(
    int Id,
    string Dtg,
    double Lat,
    double Lon,
    int Fr,
    int FrCas,
    int En,
    int EnCas,
    int[] Units,
    string? Operation,
    string? Task,
    string? Series,
    bool? Mine);

/// <summary>Everything the catalogue is built from, read in one request.</summary>
public sealed record ContactSet(IReadOnlyList<ContactRecord> Contacts, IReadOnlyList<UnitInfo> Units);

/// <summary>A node of the unit tree. Synthetic nodes group units whose parent is not itself recorded on any contact.</summary>
/// <param name="Id">The unit id, or a negative number for a synthetic node.</param>
/// <param name="Parent">The parent node id; <c>null</c> for a root.</param>
/// <param name="Label">Short display label, for example <c>D Coy</c>.</param>
/// <param name="Name">Full name, shown as a tooltip.</param>
public sealed record UnitNode(int Id, int? Parent, string Label, string Name, bool Synthetic);

public sealed record NamedCount(string Name, int Count);

public sealed record RangeInfo(int Min, int Max);

/// <summary>What the filter panel needs to describe the data: bounds, choices with counts, and the unit tree.</summary>
/// <param name="DateMin">Earliest contact date (<c>yyyy-MM-dd</c>).</param>
/// <param name="DateMax">Latest contact date.</param>
/// <param name="Series">Data sources, in the order that <see cref="ContactSummary.Series"/> indexes (1-based).</param>
/// <param name="Operations">Operation names, in the order that <see cref="ContactSummary.Op"/> indexes (1-based).</param>
/// <param name="Tasks">Unit task names, in the order that <see cref="ContactSummary.Task"/> indexes (1-based).</param>
/// <param name="Units">Unit tree in depth-first order, siblings sorted naturally.</param>
public sealed record FilterCatalogue(
    string DateMin,
    string DateMax,
    RangeInfo Fr,
    RangeInfo FrCas,
    RangeInfo En,
    RangeInfo EnCas,
    NamedCount[] Series,
    NamedCount[] Operations,
    NamedCount[] Tasks,
    UnitNode[] Units);

/// <summary>The contact ids that match a text search.</summary>
public sealed record SearchResult(int[] Ids);
