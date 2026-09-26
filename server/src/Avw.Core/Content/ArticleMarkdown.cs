using Markdig;
using ReverseMarkdown;

namespace Avw.Core.Content;

/// <summary>
/// Article bodies are kept as Markdown, which is what editors write (or the Studio's visual editor writes for them), what
/// revisions hold, and what is easy to read and maintain. Readers get HTML: rendered from the Markdown when an article is
/// saved, then put through <see cref="ContentSanitizer"/>, which stays the line between an editor's text and a reader's browser.
/// </summary>
/// <remarks>
/// The Markdown is CommonMark with GitHub's tables, strikethrough and bare links. Anything Markdown cannot say (a video embed)
/// is written as a line of HTML, which the sanitizer lets through only when it is on its allowlist.
/// </remarks>
public sealed partial class ArticleMarkdown(ContentSanitizer sanitizer)
{
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UsePipeTables()
        .UseEmphasisExtras()
        .UseAutoLinks()
        .Build();

    private static readonly Converter HtmlConverter = new(new Config
    {
        GithubFlavored = true,
        // A video frame has no Markdown form, so it stays as HTML (and the sanitizer decides whether it may).
        UnknownTags = Config.UnknownTagsOption.PassThrough,
        RemoveComments = true,
        SmartHrefHandling = true,
    });

    /// <summary>Safe HTML for a Markdown body; blank gives an empty string.</summary>
    public string ToHtml(string? markdown)
    {
        var md = Normalise(markdown);
        // A paragraph left empty by what the sanitiser took out (an unsafe picture on its own) is not content.
        return md.Length == 0 ? "" : EmptyParagraph().Replace(sanitizer.Sanitize(Markdown.ToHtml(md, Pipeline)), "").Trim();
    }

    [System.Text.RegularExpressions.GeneratedRegex(@"<p>\s*</p>\s*")]
    private static partial System.Text.RegularExpressions.Regex EmptyParagraph();

    /// <summary>
    /// Markdown for an HTML body (an article written before bodies were Markdown). The HTML is cleaned first, so nothing the
    /// sanitizer would refuse is carried over.
    /// </summary>
    public string FromHtml(string? html)
    {
        var clean = sanitizer.Sanitize(html);
        return clean.Length == 0 ? "" : Normalise(HtmlConverter.Convert(clean));
    }

    /// <summary>One kind of line ending, and no blank lines at either end, so that the same text always compares equal.</summary>
    public static string Normalise(string? markdown) =>
        (markdown ?? "").Replace("\r\n", "\n").Replace('\r', '\n').Trim('\n', ' ', '\t');

    /// <summary>Whether a stored body is still HTML (written before bodies were Markdown).</summary>
    public static bool LooksLikeHtml(string? body)
    {
        var t = (body ?? "").TrimStart();
        return t.StartsWith('<') && System.Text.RegularExpressions.Regex.IsMatch(t, @"^<(p|h\d|ul|ol|blockquote|figure|table|div|img|iframe|pre)\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    }
}
