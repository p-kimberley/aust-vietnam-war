using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Avw.Api.Tests;

public class DateOnlyMappingTests
{
    [Fact]
    public void A_date_crosses_the_connector_as_a_DateTime_at_midnight_and_comes_back_unchanged()
    {
        var converter = new AvwDbContext.DateOnlyConverter();
        var date = new DateOnly(1966, 8, 18);

        var stored = (DateTime)converter.ConvertToProvider(date)!;

        Assert.Equal(new DateTime(1966, 8, 18, 0, 0, 0), stored);
        Assert.Equal(date, (DateOnly)converter.ConvertFromProvider(stored)!);
        Assert.Equal(DateOnly.MinValue, (DateOnly)converter.ConvertFromProvider(DateTime.MinValue)!);
    }

    [Fact]
    public void Every_DateOnly_property_uses_the_converter()
    {
        using var db = new AvwDbContext(new DbContextOptionsBuilder<AvwDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

        var property = db.Model.FindEntityType(typeof(IncidentMedia))!.FindProperty(nameof(IncidentMedia.DateTaken))!;

        Assert.IsType<AvwDbContext.DateOnlyConverter>(property.GetValueConverter());
    }
}
