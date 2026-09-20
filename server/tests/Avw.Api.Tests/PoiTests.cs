using System.Net;
using System.Net.Http.Json;
using Avw.Api.Map;
using Avw.Data;
using Avw.Data.Entities;
using Avw.Migration;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Avw.Api.Tests;

public class HtmlTextTests
{
    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData("<img src=\"https://x.example/a.png\">", null)]
    [InlineData("FSB Le Loi - YS 45-76", "FSB Le Loi - YS 45-76")]
    [InlineData("<p>One</p><p>Two &amp; three</p>", "One\n\nTwo & three")]
    [InlineData("Line one<br/>line two<BR>line three", "Line one\nline two\nline three")]
    [InlineData("A&nbsp;&nbsp;B   C", "A B C")]
    public void Reduces_markup_to_plain_text(string? html, string? expected) =>
        Assert.Equal(expected, HtmlText.ToPlain(html));

    [Fact]
    public void Keeps_no_markup_and_treats_escaped_angle_brackets_as_text()
    {
        var text = HtmlText.ToPlain("<b>Bold</b> <a href=\"javascript:alert(1)\">link</a> &lt;not a tag&gt;");
        Assert.Equal("Bold link <not a tag>", text);
    }
}

public class PoiImporterTests
{
    private static AvwDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AvwDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static LegacyPoi Row(int id, string name = "Le Loi", string type = "FSB", string visible = "Y", double? lat = 10.63, double? lon = 107.24,
        string? details = "<p>History</p>", int? established = 1970) =>
        new(id, type, name, visible, established, details, lon, lat);

    [Fact]
    public async Task Adds_new_rows_with_their_legacy_ids_and_cleans_the_details()
    {
        await using var db = NewDb();

        var report = await PoiImporter.ImportAsync([Row(1), Row(2, "Coral", "FSB", "N")], db, dryRun: false);

        Assert.Equal(2, report.Added);
        var poi = await db.Pois.FindAsync(1);
        Assert.Equal(("FSB", "Le Loi", true, 1970, "History"), (poi!.Type, poi.Name, poi.Visible, poi.Established, poi.Details));
        Assert.False((await db.Pois.FindAsync(2))!.Visible);
    }

    [Fact]
    public async Task Repeating_the_import_changes_nothing()
    {
        await using var db = NewDb();
        await PoiImporter.ImportAsync([Row(1), Row(2, "Coral")], db, false);

        var again = await PoiImporter.ImportAsync([Row(1), Row(2, "Coral")], db, false);

        Assert.Equal((0, 0, 2), (again.Added, again.Updated, again.Unchanged));
        Assert.Equal(2, await db.Pois.CountAsync());
    }

    [Fact]
    public async Task Updates_only_the_rows_that_changed()
    {
        await using var db = NewDb();
        await PoiImporter.ImportAsync([Row(1), Row(2, "Coral")], db, false);

        var report = await PoiImporter.ImportAsync([Row(1, "Le Loi (renamed)"), Row(2, "Coral")], db, false);

        Assert.Equal((0, 1, 1), (report.Added, report.Updated, report.Unchanged));
        Assert.Equal("Le Loi (renamed)", (await db.Pois.FindAsync(1))!.Name);
    }

    [Fact]
    public async Task A_dry_run_reports_but_writes_nothing()
    {
        await using var db = NewDb();

        var report = await PoiImporter.ImportAsync([Row(1), Row(2, "Coral")], db, dryRun: true);

        Assert.True(report.DryRun);
        Assert.Equal(2, report.Added);
        Assert.Equal(0, await db.Pois.CountAsync());
        Assert.Contains("(dry run)", report.ToString());
    }

    [Fact]
    public async Task Skips_rows_that_cannot_be_placed_or_named_and_says_why()
    {
        await using var db = NewDb();

        var report = await PoiImporter.ImportAsync(
            [Row(1, lat: null), Row(2, lon: 500), Row(3, name: "  "), Row(4)], db, false);

        Assert.Equal(1, report.Added);
        Assert.Equal(2, report.Skipped["without usable coordinates"]);
        Assert.Equal(1, report.Skipped["without a name"]);
        Assert.Contains("skipped", report.ToString());
    }

    [Fact]
    public async Task Visible_means_the_legacy_flag_is_Y_in_any_case()
    {
        await using var db = NewDb();

        await PoiImporter.ImportAsync([Row(1, visible: "y"), Row(2, visible: "N"), Row(3, visible: "")], db, false);

        Assert.Equal([true, false, false], db.Pois.OrderBy(p => p.Id).Select(p => p.Visible));
    }
}

public class PoiEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private HttpClient Seeded()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AvwDbContext>();
        if (!db.Pois.Any())
        {
            db.Pois.AddRange(
                new Poi { Id = 1, Type = "FSB", Name = "Le Loi", Visible = true, Established = 1970, Details = "History", Lat = 10.63, Lon = 107.24 },
                new Poi { Id = 2, Type = "FSPB", Name = "Anderson", Visible = true, Lat = 10.7, Lon = 107.3 },
                new Poi { Id = 3, Type = "Base", Name = "Hidden base", Visible = false, Lat = 10.5, Lon = 107.1 });
            db.SaveChanges();
        }

        return factory.CreateClient();
    }

    [Fact]
    public async Task Lists_only_visible_points_in_a_stable_order_without_the_long_text()
    {
        var res = await Seeded().GetAsync("/api/pois");
        var list = await res.Content.ReadFromJsonAsync<List<PoiSummary>>();

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(["Le Loi", "Anderson"], list!.Select(p => p.Name));           // FSB before FSPB
        Assert.Equal(new PoiSummary(1, "FSB", "Le Loi", 1970, 10.63, 107.24), list![0]);
        Assert.Contains("public", res.Headers.CacheControl!.ToString());
        Assert.DoesNotContain("details", await res.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Returns_the_detail_of_a_visible_point()
    {
        var detail = await Seeded().GetFromJsonAsync<PoiDetail>("/api/pois/1");
        Assert.Equal("History", detail!.Details);
    }

    [Theory]
    [InlineData("/api/pois/3")]
    [InlineData("/api/pois/999")]
    [InlineData("/api/pois/0")]
    [InlineData("/api/pois/abc")]
    public async Task Hidden_unknown_and_malformed_points_are_not_found(string path)
    {
        var res = await Seeded().GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }
}
