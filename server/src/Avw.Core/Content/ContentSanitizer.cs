using AngleSharp.Dom;
using Ganss.Xss;

namespace Avw.Core.Content;

/// <summary>
/// Reduces editor HTML to a small allowlist before it is stored. Article bodies are published as HTML, so this is the
/// line between an editor's text and script running in a reader's browser: every save goes through it, whatever the
/// editor sent.
/// </summary>
/// <remarks>
/// No inline styles, classes, event handlers or scripts survive. Links may only be <c>http</c>, <c>https</c> or
/// <c>mailto</c>; images may only be <c>https</c> or site-relative (never <c>data:</c>); and frames survive only for the
/// approved video hosts. External links are hardened with <c>rel="noopener noreferrer"</c>.
/// </remarks>
public sealed partial class ContentSanitizer
{
    /// <summary>Hosts whose embeds are allowed. Privacy-enhanced YouTube and Vimeo's player only.</summary>
    public static readonly string[] EmbedHosts = ["www.youtube-nocookie.com", "player.vimeo.com"];

    private static readonly string[] Tags =
    [
        "p", "br", "hr", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "del", "sub", "sup", "ul", "ol", "li", "blockquote",
        "a", "img", "figure", "figcaption", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "code", "pre", "div", "span", "iframe",
    ];

    private static readonly string[] Attributes =
    [
        "href", "title", "alt", "src", "width", "height", "colspan", "rowspan", "target", "rel", "allowfullscreen", "loading",
    ];

    private readonly HtmlSanitizer _sanitizer = Build();

    [System.Text.RegularExpressions.GeneratedRegex(@"(<p>\s*(<br>)?\s*</p>\s*)+$")]
    private static partial System.Text.RegularExpressions.Regex TrailingEmptyParagraphs();

    /// <summary>Returns safe HTML for <paramref name="html"/>. Null and blank input give an empty string.</summary>
    public string Sanitize(string? html)
    {
        if (string.IsNullOrWhiteSpace(html))
        {
            return "";
        }

        // The page title is the h1, so a body h1 becomes an h2 rather than losing its text.
        html = System.Text.RegularExpressions.Regex.Replace(html, @"<(/?)h1(?=[\s>/])", "<$1h2", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        // The editor leaves an empty paragraph after the last block so there is somewhere to click; it is not content.
        return TrailingEmptyParagraphs().Replace(_sanitizer.Sanitize(html).Trim(), "").Trim();
    }

    private static HtmlSanitizer Build()
    {
        var s = new HtmlSanitizer();
        s.AllowedTags.Clear();
        s.AllowedAttributes.Clear();
        s.AllowedCssProperties.Clear();
        s.AllowedClasses.Clear();
        s.AllowedSchemes.Clear();
        foreach (var tag in Tags) s.AllowedTags.Add(tag);
        foreach (var attribute in Attributes) s.AllowedAttributes.Add(attribute);
        foreach (var scheme in new[] { "http", "https", "mailto" }) s.AllowedSchemes.Add(scheme);
        s.AllowDataAttributes = false;

        s.PostProcessNode += (_, e) =>
        {
            if (e.Node is not IElement element)
            {
                return;
            }

            switch (element.LocalName)
            {
                case "a":
                    HardenLink(element);
                    break;
                case "img":
                    KeepSafeImage(element);
                    break;
                case "iframe":
                    KeepApprovedEmbed(element);
                    break;
            }
        };
        return s;
    }

    private static void HardenLink(IElement a)
    {
        var href = a.GetAttribute("href");
        if (href is not null && Uri.TryCreate(href, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
        {
            a.SetAttribute("target", "_blank");
            a.SetAttribute("rel", "noopener noreferrer");
        }
        else
        {
            a.RemoveAttribute("target");
            a.RemoveAttribute("rel");
        }
    }

    /// <summary>An image with no usable source is removed; a remote one must be https so it cannot be downgraded.</summary>
    private static void KeepSafeImage(IElement img)
    {
        var src = img.GetAttribute("src");
        var ok = src is not null
                 && (src.StartsWith('/') && !src.StartsWith("//")
                     || Uri.TryCreate(src, UriKind.Absolute, out var uri) && uri.Scheme == "https");
        if (!ok)
        {
            img.Remove();
            return;
        }

        img.SetAttribute("loading", "lazy");
    }

    private static void KeepApprovedEmbed(IElement frame)
    {
        var src = frame.GetAttribute("src");
        if (src is null || !Uri.TryCreate(src, UriKind.Absolute, out var uri) || uri.Scheme != "https"
            || !EmbedHosts.Contains(uri.Host, StringComparer.OrdinalIgnoreCase))
        {
            frame.Remove();
            return;
        }

        frame.SetAttribute("loading", "lazy");
        frame.RemoveAttribute("width");
        frame.RemoveAttribute("height");
    }
}
