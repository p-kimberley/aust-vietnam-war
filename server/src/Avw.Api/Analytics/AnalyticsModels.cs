namespace Avw.Api.Analytics;

/// <summary>One weapon's part in a contact: who used it, how many rounds, at what range, with what result.</summary>
public sealed record WeaponEffectRow(string? Weapon, string? Category, string? Actor, int Range, int Rounds, int Casualties);

/// <summary>The slice of a contact that the charts use.</summary>
public sealed record IncidentRow(
    int Id,
    DateTime Dtg,
    int FrKia,
    int FrWia,
    int EnKia,
    int EnWia,
    int FrCas,
    int EnCas,
    string? Task,
    string? FiredFirst,
    WeaponEffectRow[] Effects);

/// <summary>One person on the nominal roll: dates and the start of each tour of duty.</summary>
public sealed record PersonRow(DateOnly? Birth, DateOnly? Death, string? Branch, DateOnly[] TourStarts);

public enum XKind
{
    /// <summary>X values are UTC midnight in milliseconds since 1970.</summary>
    Time,

    /// <summary>X values are hours of the day, 0 to 23.</summary>
    Hour,

    /// <summary>X values are plain numbers, for example a range in metres.</summary>
    Value,

    /// <summary>X values are positions in <see cref="ChartResult.Categories"/>.</summary>
    Category,
}

public enum ChartShape
{
    Area,
    StackedArea,
    Line,
    Bar,
    StackedBar,
}

/// <summary>A named line, area or set of bars. Each point is <c>[x, y]</c>.</summary>
public sealed record ChartSeries(string Name, double[][] Points);

/// <summary>Everything a chart needs to draw itself.</summary>
/// <param name="Rows">How many incidents (or people) the chart was drawn from.</param>
/// <param name="Note">Something a reader should know about how to read this chart, or null.</param>
public sealed record ChartResult(
    string Id,
    string Title,
    ChartShape Shape,
    XKind X,
    string XLabel,
    string YLabel,
    string[]? Categories,
    ChartSeries[] Series,
    int Rows,
    string? Note);

public enum ChartGroup
{
    Casualties,
    Frequency,
    Weapons,
    Personnel,
}

/// <summary>A chart the API can draw. Personnel charts ignore the map's filters.</summary>
public sealed record ChartInfo(string Id, string Title, ChartGroup Group, string Description, bool UsesFilter);

/// <summary>The filter every contact chart shares: the ids the map currently shows, or <c>null</c> for every contact.</summary>
public sealed record ChartFilter(int[]? Ids);
