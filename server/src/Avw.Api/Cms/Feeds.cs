using System.Globalization;
using System.Text;
using System.Xml;

namespace Avw.Api.Cms;

/// <summary>Builds the RSS feed and the sitemap. XML is written with <see cref="XmlWriter"/> so every value is escaped.</summary>
public static class Feeds
{
    private static readonly XmlWriterSettings Settings = new()
    {
        Indent = true,
        Encoding = new UTF8Encoding(false),
        Async = false,
        OmitXmlDeclaration = false,
    };

    public static string Rss(string siteName, string description, string baseUrl, IEnumerable<(ArticleCard Card, string BodyHtml)> items)
    {
        var sb = new StringBuilder();
        using (var w = XmlWriter.Create(new Utf8StringWriter(sb), Settings))
        {
            w.WriteStartDocument();
            w.WriteStartElement("rss");
            w.WriteAttributeString("version", "2.0");
            w.WriteAttributeString("xmlns", "atom", null, "http://www.w3.org/2005/Atom");
            w.WriteStartElement("channel");
            w.WriteElementString("title", siteName);
            w.WriteElementString("link", baseUrl + "/");
            w.WriteElementString("description", description);
            w.WriteElementString("language", "en-AU");

            w.WriteStartElement("link", "http://www.w3.org/2005/Atom");
            w.WriteAttributeString("href", baseUrl + "/feed.xml");
            w.WriteAttributeString("rel", "self");
            w.WriteAttributeString("type", "application/rss+xml");
            w.WriteEndElement();

            foreach (var (card, body) in items)
            {
                var url = baseUrl + "/articles/" + card.Slug;
                w.WriteStartElement("item");
                w.WriteElementString("title", card.Title);
                w.WriteElementString("link", url);
                w.WriteStartElement("guid");
                w.WriteAttributeString("isPermaLink", "true");
                w.WriteString(url);
                w.WriteEndElement();
                w.WriteElementString("pubDate", card.PublishedUtc.ToString("R", CultureInfo.InvariantCulture));
                if (card.CategoryName is not null)
                {
                    w.WriteElementString("category", card.CategoryName);
                }

                w.WriteElementString("description", card.Excerpt ?? ArticleService.PlainText(body, 300));
                w.WriteEndElement();
            }

            w.WriteEndElement();
            w.WriteEndElement();
            w.WriteEndDocument();
        }

        return sb.ToString();
    }

    public static string Sitemap(string baseUrl, IEnumerable<SitemapEntry> entries)
    {
        var sb = new StringBuilder();
        using (var w = XmlWriter.Create(new Utf8StringWriter(sb), Settings))
        {
            w.WriteStartDocument();
            w.WriteStartElement("urlset", "http://www.sitemaps.org/schemas/sitemap/0.9");

            foreach (var path in new[] { "/", "/articles", "/battlemap" })
            {
                w.WriteStartElement("url");
                w.WriteElementString("loc", baseUrl + path);
                w.WriteEndElement();
            }

            foreach (var e in entries)
            {
                w.WriteStartElement("url");
                w.WriteElementString("loc", baseUrl + e.Path);
                w.WriteElementString("lastmod", e.UpdatedUtc.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
                w.WriteEndElement();
            }

            w.WriteEndElement();
            w.WriteEndDocument();
        }

        return sb.ToString();
    }

    /// <summary>A StringWriter that says it is UTF-8, so the XML declaration matches how the text is sent.</summary>
    private sealed class Utf8StringWriter(StringBuilder sb) : StringWriter(sb, CultureInfo.InvariantCulture)
    {
        public override Encoding Encoding => Settings.Encoding;
    }
}
