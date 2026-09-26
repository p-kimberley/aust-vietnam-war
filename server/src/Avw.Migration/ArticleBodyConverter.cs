using Avw.Core.Content;
using Avw.Data;
using Microsoft.EntityFrameworkCore;

namespace Avw.Migration;

/// <summary>
/// Article bodies used to be kept as HTML; they are now Markdown (see <see cref="ArticleMarkdown"/>). This converts what is
/// left: articles with no Markdown body yet (whose HTML is re-rendered from the new Markdown, so the two agree) and revisions
/// that still hold HTML. Run by the migrator after the schema migrations; safe to repeat, as converted rows are not touched again.
/// </summary>
public static class ArticleBodyConverter
{
    public static async Task<string> ConvertAsync(AvwDbContext db, bool dryRun, CancellationToken ct = default)
    {
        var markdown = new ArticleMarkdown(new ContentSanitizer());

        var articles = await db.Articles.Where(a => a.BodyMarkdown == "" && a.BodyHtml != "").ToListAsync(ct);
        foreach (var article in articles)
        {
            article.BodyMarkdown = markdown.FromHtml(article.BodyHtml);
            article.BodyHtml = markdown.ToHtml(article.BodyMarkdown);
        }

        var revisions = (await db.ArticleRevisions.Where(r => r.BodyMarkdown.StartsWith("<")).ToListAsync(ct))
            .Where(r => ArticleMarkdown.LooksLikeHtml(r.BodyMarkdown))
            .ToList();
        foreach (var revision in revisions)
        {
            revision.BodyMarkdown = markdown.FromHtml(revision.BodyMarkdown);
        }

        if (!dryRun)
        {
            await db.SaveChangesAsync(ct);
        }

        var verb = dryRun ? "would convert" : "converted";
        return $"Article bodies: {verb} {articles.Count} article(s) and {revisions.Count} revision(s) from HTML to Markdown.";
    }
}
