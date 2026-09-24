using Avw.Data;

namespace Avw.Api.Tests;

public sealed class MediaSweeperTests : IDisposable
{
    private static readonly DateTime Now = new(2026, 9, 20, 12, 0, 0, DateTimeKind.Utc);
    private readonly string _root = Path.Combine(Path.GetTempPath(), "avw-sweep-" + Guid.NewGuid().ToString("N"));

    public MediaSweeperTests() => Directory.CreateDirectory(Path.Combine(_root, ".incoming"));

    public void Dispose()
    {
        try
        {
            Directory.Delete(_root, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    private string Touch(string relative, TimeSpan age)
    {
        var path = Path.Combine(_root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, "x");
        File.SetLastWriteTimeUtc(path, Now - age);
        return path;
    }

    private static int Sweep(string root) => MediaSweeper.Sweep(root, Now, TimeSpan.FromHours(6), TimeSpan.FromDays(2));

    [Fact]
    public void Removes_stale_partial_uploads_and_keeps_recent_ones()
    {
        var stale = Touch(".incoming/old", TimeSpan.FromHours(7));
        var fresh = Touch(".incoming/new", TimeSpan.FromMinutes(5));

        Assert.Equal(1, Sweep(_root));

        Assert.False(File.Exists(stale));
        Assert.True(File.Exists(fresh));
    }

    [Fact]
    public void Removes_old_health_markers_left_by_replaced_pods()
    {
        var old = Touch(".avw-health-avw-api-7d9f-abcde", TimeSpan.FromDays(3));
        var current = Touch(".avw-health-avw-api-7d9f-fghij", TimeSpan.FromMinutes(1));

        Assert.Equal(1, Sweep(_root));

        Assert.False(File.Exists(old));
        Assert.True(File.Exists(current));
    }

    [Fact]
    public void Never_touches_published_pictures_or_files_of_any_age_elsewhere()
    {
        var picture = Touch("uploads/ab/abcdef.jpg", TimeSpan.FromDays(900));
        var thumb = Touch("uploads/ab/abcdef-480.jpg", TimeSpan.FromDays(900));
        var portrait = Touch("portraits/39426.jpg", TimeSpan.FromDays(900));
        var nested = Touch("uploads/ab/.avw-health-not-at-the-top", TimeSpan.FromDays(900));
        var other = Touch(".hidden-thing", TimeSpan.FromDays(900));

        Assert.Equal(0, Sweep(_root));

        Assert.All(new[] { picture, thumb, portrait, nested, other }, p => Assert.True(File.Exists(p), p));
    }

    [Fact]
    public void Copes_with_a_missing_folder_or_no_incoming_folder()
    {
        Assert.Equal(0, Sweep(Path.Combine(_root, "nowhere")));
        Directory.Delete(Path.Combine(_root, ".incoming"));
        Assert.Equal(0, Sweep(_root));
    }
}
