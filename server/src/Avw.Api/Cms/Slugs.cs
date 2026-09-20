using System.Globalization;
using System.Text;

namespace Avw.Api.Cms;

/// <summary>URL slugs: lower-case ASCII words joined by hyphens, with accents removed (Vietnamese titles included).</summary>
public static class Slugs
{
    public const int MaxLength = 80;

    /// <summary>First path segments that belong to the application, so a top-level page cannot shadow them.</summary>
    public static readonly string[] Reserved =
        ["api", "studio", "battlemap", "articles", "media", "forbidden", "feed", "sitemap", "login", "logout", "vendor", "assets"];

    public static string From(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return "untitled";
        }

        var sb = new StringBuilder(text.Length);
        var lastHyphen = true;
        foreach (var c in text.Normalize(NormalizationForm.FormD))
        {
            var category = CharUnicodeInfo.GetUnicodeCategory(c);
            if (category == UnicodeCategory.NonSpacingMark)
            {
                continue;                                             // the accent of a decomposed letter
            }

            var letter = c switch { 'đ' or 'Đ' => 'd', 'ø' or 'Ø' => 'o', 'ł' or 'Ł' => 'l', _ => c };
            if (letter is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                sb.Append(letter);
                lastHyphen = false;
            }
            else if (letter is >= 'A' and <= 'Z')
            {
                sb.Append(char.ToLowerInvariant(letter));
                lastHyphen = false;
            }
            else if (!lastHyphen && letter != '\'' && letter != '’')
            {
                sb.Append('-');
                lastHyphen = true;
            }
        }

        var slug = sb.ToString().Trim('-');
        if (slug.Length > MaxLength)
        {
            // Cut at a word boundary where there is one.
            var cut = slug.LastIndexOf('-', MaxLength - 1);
            slug = (cut > MaxLength / 2 ? slug[..cut] : slug[..MaxLength]).Trim('-');
        }

        return slug.Length == 0 ? "untitled" : slug;
    }

    /// <summary>The first of <paramref name="slug"/>, <c>slug-2</c>, <c>slug-3</c>... that <paramref name="taken"/> does not report as used.</summary>
    public static string Unique(string slug, Func<string, bool> taken)
    {
        var candidate = slug;
        for (var n = 2; taken(candidate); n++)
        {
            var suffix = $"-{n}";
            candidate = (slug.Length + suffix.Length > MaxLength ? slug[..(MaxLength - suffix.Length)] : slug) + suffix;
        }

        return candidate;
    }

    public static bool IsReserved(string slug) => Reserved.Contains(slug, StringComparer.OrdinalIgnoreCase);

    /// <summary>True for a slug an editor may type: lower-case letters, digits and single hyphens.</summary>
    public static bool IsValid(string? slug) =>
        !string.IsNullOrEmpty(slug) && slug.Length <= MaxLength
        && slug.All(c => c is >= 'a' and <= 'z' or >= '0' and <= '9' or '-')
        && !slug.StartsWith('-') && !slug.EndsWith('-') && !slug.Contains("--");
}
