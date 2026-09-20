using System.Net;
using System.Text.RegularExpressions;

namespace Avw.Migration;

/// <summary>Reduces legacy HTML to plain text. Legacy fields mixed prose with markup and images from external hosts, none of which should be carried over.</summary>
public static partial class HtmlText
{
    public static string? ToPlain(string? html)
    {
        if (string.IsNullOrWhiteSpace(html))
        {
            return null;
        }

        var text = ParagraphEnd().Replace(html, "\n\n");
        text = LineBreak().Replace(text, "\n");
        text = Tag().Replace(text, "");
        text = WebUtility.HtmlDecode(text).Replace(' ', ' ');
        text = Spaces().Replace(text, " ");
        text = BlankLines().Replace(text, "\n\n").Trim();
        return text.Length == 0 ? null : text;
    }

    [GeneratedRegex(@"<\s*/p\s*>", RegexOptions.IgnoreCase)]
    private static partial Regex ParagraphEnd();

    [GeneratedRegex(@"<\s*(br\s*/?|/div|/li)\s*>", RegexOptions.IgnoreCase)]
    private static partial Regex LineBreak();

    [GeneratedRegex(@"<[^>]*>")]
    private static partial Regex Tag();

    [GeneratedRegex(@"[ \t\r\f\v]+")]
    private static partial Regex Spaces();

    [GeneratedRegex(@"[ \t]*\n[ \t]*(\n[ \t]*)+")]
    private static partial Regex BlankLines();
}
