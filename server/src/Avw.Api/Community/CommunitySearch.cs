using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Avw.Api.Map;
using Avw.Api.Media;
using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Avw.Api.Community;

public sealed record NoteHit(long Id, int ContactId, string Title, IReadOnlyList<SnippetPart> Snippet, string AuthorName, DateTime CreatedUtc);

public sealed record PictureHit(long Id, int? ContactId, string ThumbUrl, string? Caption, string? Credit, double? Lat, double? Lon);

/// <summary>One page of approved pictures, for the map's picture panel.</summary>
public sealed record PicturePage(IReadOnlyList<PictureHit> Items, int Total, int Page, int PageSize);

public sealed record CommunitySearchResult(IReadOnlyList<NoteHit> Notes, int NoteTotal, IReadOnlyList<PictureHit> Pictures, int PictureTotal);

/// <summary>
/// What a person typed, turned into a MySQL full-text query. Every word must be found and a word matches anything that starts with it
/// (so "claymor" finds "claymores"); a phrase in quotes must be found as written. Anything that is not a letter or a digit is dropped, so
/// nothing typed can be read as MySQL's own search operators.
/// </summary>
public sealed partial record SearchTerms(string Boolean, IReadOnlyList<string> Words)
{
    /// <summary>InnoDB ignores words shorter than this when indexing, so one that short would make a required word that can never match.</summary>
    public const int MinWordLength = 3;

    public const int MaxTerms = 6;

    // InnoDB's built-in list of words it does not index. A required stop word would match nothing at all.
    private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "a", "about", "an", "are", "as", "at", "be", "by", "com", "de", "en", "for", "from", "how", "i", "in", "is", "it", "la", "of", "on", "or",
        "that", "the", "this", "to", "was", "what", "when", "where", "who", "will", "with", "und", "www",
    };

    [GeneratedRegex("\"([^\"]*)\"")]
    private static partial Regex Quoted();

    [GeneratedRegex(@"[\p{L}\p{N}]+")]
    private static partial Regex Word();

    /// <summary>Whether the full-text index holds a word like this one: a shorter word, or a stop word, is not in it, so it cannot be searched for there.</summary>
    public static bool CanBeIndexed(string word) => word.Length >= MinWordLength && !StopWords.Contains(word);

    public bool IsEmpty => Words.Count == 0;

    public static SearchTerms Parse(string? text)
    {
        var terms = new List<string>();
        var words = new List<string>();
        var rest = text ?? "";

        foreach (Match quoted in Quoted().Matches(rest))
        {
            var inside = Word().Matches(quoted.Groups[1].Value).Select(m => m.Value).ToList();
            if (inside.Count > 1)
            {
                terms.Add($"+\"{string.Join(' ', inside)}\"");
                words.AddRange(inside.Where(w => w.Length >= MinWordLength));
            }
            else if (inside.Count == 1)
            {
                Add(inside[0]);
            }
        }

        foreach (Match m in Word().Matches(Quoted().Replace(rest, " ")))
        {
            Add(m.Value);
        }

        return new SearchTerms(string.Join(' ', terms.Take(MaxTerms)), [.. words.Distinct(StringComparer.OrdinalIgnoreCase).Take(MaxTerms)]);

        void Add(string word)
        {
            if (CanBeIndexed(word))
            {
                terms.Add($"+{word}*");
                words.Add(word);
            }
        }
    }

    /// <summary>Whether <paramref name="text"/> contains every word (as the start of one of its words), ignoring case and accents. What the MySQL query means, for the tests and the in-memory database.</summary>
    public bool Matches(string? text) => Score(text) == Words.Count && Words.Count > 0;

    /// <summary>How many of the words <paramref name="text"/> has.</summary>
    public int Score(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return 0;
        }

        var tokens = Word().Matches(text).Select(m => m.Value).ToList();
        return Words.Count(w => tokens.Any(t => StartsWith(t, w)));
    }

    internal static bool StartsWith(string token, string prefix) =>
        CultureInfo.InvariantCulture.CompareInfo.IsPrefix(token, prefix, CompareOptions.IgnoreCase | CompareOptions.IgnoreNonSpace);

    /// <summary>A short stretch of <paramref name="text"/> around the first word found, split so the words that matched can be marked.</summary>
    public IReadOnlyList<SnippetPart> Snippet(string text, int length = 150)
    {
        var flat = Regex.Replace(text, @"\s+", " ").Trim();
        var first = Word().Matches(flat).FirstOrDefault(m => Words.Any(w => StartsWith(m.Value, w)));
        var start = first is null ? 0 : Math.Max(0, first.Index - length / 3);
        if (start > 0)
        {
            // Begin at a word, not in the middle of one, as long as that does not skip past the match.
            var space = flat.IndexOf(' ', start);
            if (space >= 0 && first is not null && space < first.Index)
            {
                start = space + 1;
            }
        }

        var end = Math.Min(flat.Length, start + length);
        if (end < flat.Length)
        {
            var space = flat.LastIndexOf(' ', end - 1);
            if (space > start + length / 2)
            {
                end = space;
            }
        }

        var excerpt = (start > 0 ? "…" : "") + flat[start..end] + (end < flat.Length ? "…" : "");
        var parts = new List<SnippetPart>();
        var at = 0;
        foreach (Match m in Word().Matches(excerpt))
        {
            if (!Words.Any(w => StartsWith(m.Value, w)))
            {
                continue;
            }

            if (m.Index > at)
            {
                parts.Add(new SnippetPart(excerpt[at..m.Index], false));
            }

            parts.Add(new SnippetPart(m.Value, true));
            at = m.Index + m.Length;
        }

        if (at < excerpt.Length)
        {
            parts.Add(new SnippetPart(excerpt[at..], false));
        }

        return parts;
    }
}

/// <summary>
/// Searches the words of notes and the captions and credits of pictures, using MySQL's own full-text indexes. Only what the public can
/// see is searched: a note's approved text (never an edit still waiting for a moderator) and approved pictures.
/// </summary>
public sealed class CommunitySearch(AvwDbContext db)
{
    public const int MaxLimit = 20;

    private sealed class NoteRow
    {
        public long Id { get; set; }
        public int ContactId { get; set; }
        public string Title { get; set; } = "";
        public string Body { get; set; } = "";
        public string AuthorName { get; set; } = "";
        public DateTime CreatedUtc { get; set; }
    }

    private sealed class PictureRow
    {
        public long Id { get; set; }
        public int? ContactId { get; set; }
        public string Sha256 { get; set; } = "";
        public string? Caption { get; set; }
        public string? Credit { get; set; }
        public double? Lat { get; set; }
        public double? Lon { get; set; }
    }

    public async Task<CommunitySearchResult> SearchAsync(string? text, int limit, CancellationToken ct)
    {
        var terms = SearchTerms.Parse(text);
        limit = Math.Clamp(limit, 1, MaxLimit);
        if (terms.IsEmpty)
        {
            return new CommunitySearchResult([], 0, [], 0);
        }

        var (notes, noteTotal) = db.Database.IsRelational() ? await NotesInMySqlAsync(terms, limit, ct) : await NotesInMemoryAsync(terms, limit, ct);
        var (pictures, pictureTotal) = db.Database.IsRelational() ? await PicturesInMySqlAsync(terms, limit, ct) : await PicturesInMemoryAsync(terms, limit, ct);
        return new CommunitySearchResult(
            [.. notes.Select(n => new NoteHit(n.Id, n.ContactId, n.Title, terms.Snippet(n.Body), n.AuthorName, DateTime.SpecifyKind(n.CreatedUtc, DateTimeKind.Utc)))], noteTotal,
            [.. pictures.Select(p => new PictureHit(p.Id, p.ContactId, MediaPaths.ThumbnailUrl(p.Sha256), p.Caption, p.Credit, p.Lat, p.Lon))], pictureTotal);
    }

    public const int MaxPageSize = 48;

    /// <summary>
    /// Approved pictures a page at a time: those whose caption or credit has every word typed, best match first, or with nothing typed,
    /// all of them, newest first.
    /// </summary>
    public async Task<PicturePage> PicturePageAsync(string? text, int page, int pageSize, CancellationToken ct)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);
        var skip = (page - 1) * pageSize;
        var terms = SearchTerms.Parse(text);
        List<PictureRow> rows;
        int total;
        if (terms.IsEmpty)
        {
            var approved = db.IncidentMedia.AsNoTracking().Where(m => m.Media.Status == MediaStatus.Approved);
            total = await approved.CountAsync(ct);
            rows = await approved.OrderByDescending(m => m.CreatedUtc).ThenByDescending(m => m.Id).Skip(skip).Take(pageSize)
                .Select(m => new PictureRow { Id = m.Id, ContactId = m.ContactId, Sha256 = m.Media.Sha256, Caption = m.Media.Caption, Credit = m.Media.Credit, Lat = m.Lat, Lon = m.Lon })
                .ToListAsync(ct);
        }
        else
        {
            (rows, total) = db.Database.IsRelational() ? await PicturesInMySqlAsync(terms, pageSize, ct, skip) : await PicturesInMemoryAsync(terms, pageSize, ct, skip);
        }

        return new PicturePage([.. rows.Select(p => new PictureHit(p.Id, p.ContactId, MediaPaths.ThumbnailUrl(p.Sha256), p.Caption, p.Credit, p.Lat, p.Lon))], total, page, pageSize);
    }

    // ---------------------------------------------------------------- MySQL

    private async Task<(List<NoteRow>, int)> NotesInMySqlAsync(SearchTerms terms, int limit, CancellationToken ct)
    {
        var q = terms.Boolean;
        var rows = await db.Database.SqlQuery<NoteRow>($"""
            SELECT n.Id, n.ContactId, v.Title, v.Body, n.AuthorName, n.CreatedUtc
            FROM incident_note_versions v
            JOIN incident_notes n ON n.Id = v.NoteId AND v.VersionNo = n.ApprovedVersionNo
            WHERE MATCH(v.Title, v.Body) AGAINST ({q} IN BOOLEAN MODE)
            ORDER BY MATCH(v.Title, v.Body) AGAINST ({q} IN BOOLEAN MODE) DESC, n.Id
            LIMIT {limit}
            """).ToListAsync(ct);
        var total = await db.Database.SqlQuery<int>($"""
            SELECT COUNT(*) AS `Value`
            FROM incident_note_versions v
            JOIN incident_notes n ON n.Id = v.NoteId AND v.VersionNo = n.ApprovedVersionNo
            WHERE MATCH(v.Title, v.Body) AGAINST ({q} IN BOOLEAN MODE)
            """).SingleAsync(ct);
        return (rows, total);
    }

    private async Task<(List<PictureRow>, int)> PicturesInMySqlAsync(SearchTerms terms, int limit, CancellationToken ct, int skip = 0)
    {
        var q = terms.Boolean;
        var approved = MediaStatus.Approved.ToString();
        var rows = await db.Database.SqlQuery<PictureRow>($"""
            SELECT m.Id, m.ContactId, a.Sha256, a.Caption, a.Credit, m.Lat, m.Lon
            FROM media_assets a
            JOIN incident_media m ON m.MediaId = a.Id
            WHERE a.Status = {approved} AND MATCH(a.Caption, a.Credit) AGAINST ({q} IN BOOLEAN MODE)
            ORDER BY MATCH(a.Caption, a.Credit) AGAINST ({q} IN BOOLEAN MODE) DESC, m.Id
            LIMIT {limit} OFFSET {skip}
            """).ToListAsync(ct);
        var total = await db.Database.SqlQuery<int>($"""
            SELECT COUNT(*) AS `Value`
            FROM media_assets a
            JOIN incident_media m ON m.MediaId = a.Id
            WHERE a.Status = {approved} AND MATCH(a.Caption, a.Credit) AGAINST ({q} IN BOOLEAN MODE)
            """).SingleAsync(ct);
        return (rows, total);
    }

    // ---------------------------------------------------------------- the in-memory database (tests): the same meaning, without full-text indexes

    private async Task<(List<NoteRow>, int)> NotesInMemoryAsync(SearchTerms terms, int limit, CancellationToken ct)
    {
        var approved = await db.Notes.AsNoTracking().Where(n => n.ApprovedVersionNo != null).Include(n => n.Versions).ToListAsync(ct);
        var hits = approved
            .Select(n => (Note: n, Version: n.Versions.First(v => v.VersionNo == n.ApprovedVersionNo)))
            .Where(x => terms.Matches(x.Version.Title + " " + x.Version.Body))
            .OrderByDescending(x => terms.Score(x.Version.Title + " " + x.Version.Body)).ThenBy(x => x.Note.Id)
            .ToList();
        return ([.. hits.Take(limit).Select(x => new NoteRow { Id = x.Note.Id, ContactId = x.Note.ContactId, Title = x.Version.Title, Body = x.Version.Body, AuthorName = x.Note.AuthorName, CreatedUtc = x.Note.CreatedUtc })], hits.Count);
    }

    private async Task<(List<PictureRow>, int)> PicturesInMemoryAsync(SearchTerms terms, int limit, CancellationToken ct, int skip = 0)
    {
        var links = await db.IncidentMedia.AsNoTracking().Include(m => m.Media).Where(m => m.Media.Status == MediaStatus.Approved).ToListAsync(ct);
        var hits = links.Where(m => terms.Matches(m.Media.Caption + " " + m.Media.Credit)).OrderBy(m => m.Id).ToList();
        return ([.. hits.Skip(skip).Take(limit).Select(m => new PictureRow { Id = m.Id, ContactId = m.ContactId, Sha256 = m.Media.Sha256, Caption = m.Media.Caption, Credit = m.Media.Credit, Lat = m.Lat, Lon = m.Lon })], hits.Count);
    }
}

/// <summary>Distances on the earth's surface.</summary>
public static class Geo
{
    private const double EarthRadiusMetres = 6_371_000;

    /// <summary>Great-circle distance, by the haversine formula: right to within a fraction of a percent, which is plenty for "how far apart are these two photos".</summary>
    public static double DistanceMetres(double lat1, double lon1, double lat2, double lon2)
    {
        static double Rad(double d) => d * Math.PI / 180;
        var dLat = Rad(lat2 - lat1);
        var dLon = Rad(lon2 - lon1);
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) + Math.Cos(Rad(lat1)) * Math.Cos(Rad(lat2)) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return 2 * EarthRadiusMetres * Math.Asin(Math.Min(1, Math.Sqrt(a)));
    }

    /// <summary>The box (in degrees) that contains every point within <paramref name="radiusMetres"/> of a place, for narrowing a query before measuring exactly.</summary>
    public static (double MinLat, double MinLon, double MaxLat, double MaxLon) Box(double lat, double lon, double radiusMetres)
    {
        var dLat = radiusMetres / 111_320.0;
        var dLon = radiusMetres / (111_320.0 * Math.Max(0.01, Math.Cos(lat * Math.PI / 180)));
        return (lat - dLat, lon - dLon, lat + dLat, lon + dLon);
    }
}
