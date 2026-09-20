namespace Avw.Data;

/// <summary>
/// Tidies the shared media folder. Uploads are copied into <c>.incoming/</c> and renamed into place, so a pod that dies half way
/// leaves a file there; every API pod also leaves a small health-check marker named after itself, and pods are replaced on each
/// release. Neither is ever served, and both are safe to delete once they are old enough.
/// </summary>
public static class MediaSweeper
{
    public const string IncomingFolder = ".incoming";
    public const string HealthMarkerPrefix = ".avw-health-";

    /// <returns>How many files were removed.</returns>
    public static int Sweep(string mediaRoot, DateTime nowUtc, TimeSpan incomingMaxAge, TimeSpan markerMaxAge)
    {
        if (!Directory.Exists(mediaRoot))
        {
            return 0;
        }

        var removed = 0;
        var incoming = Path.Combine(mediaRoot, IncomingFolder);
        if (Directory.Exists(incoming))
        {
            removed += DeleteOlderThan(Directory.EnumerateFiles(incoming), nowUtc - incomingMaxAge);
        }

        // Only the top level: a marker is never inside a hash folder, and nothing else here is touched.
        removed += DeleteOlderThan(
            Directory.EnumerateFiles(mediaRoot, HealthMarkerPrefix + "*", SearchOption.TopDirectoryOnly), nowUtc - markerMaxAge);
        return removed;
    }

    private static int DeleteOlderThan(IEnumerable<string> files, DateTime cutoffUtc)
    {
        var removed = 0;
        foreach (var file in files)
        {
            try
            {
                if (File.GetLastWriteTimeUtc(file) < cutoffUtc)
                {
                    File.Delete(file);
                    removed++;
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // Being written, already gone, or not ours to delete: leave it for the next pass.
            }
        }

        return removed;
    }
}
