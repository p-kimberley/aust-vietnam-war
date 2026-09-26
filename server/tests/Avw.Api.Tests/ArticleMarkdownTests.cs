using Avw.Core.Content;
using Avw.Data;
using Avw.Data.Entities;
using Avw.Migration;
using Microsoft.EntityFrameworkCore;

namespace Avw.Api.Tests;

public class ArticleMarkdownTests
{
    private static readonly ArticleMarkdown Md = new(new ContentSanitizer());

    [Fact]
    public void Renders_headings_lists_quotes_emphasis_and_tables()
    {
        var html = Md.ToHtml("""
            ## Long Tan

            On **18 August 1966**, D Company *6 RAR*:

            - patrolled east
            - met a force of ~~hundreds~~ thousands

            > It rained.

            | Unit | KIA |
            |---|---|
            | D Coy | 17 |
            """);

        Assert.Contains("<h2>Long Tan</h2>", html);
        Assert.Contains("<strong>18 August 1966</strong>", html);
        Assert.Contains("<em>6 RAR</em>", html);
        Assert.Contains("<li>patrolled east</li>", html);
        Assert.Contains("<blockquote>", html);
        Assert.Contains("<td>D Coy</td>", html);
        Assert.Contains("<s>", html.Replace("<del>", "<s>"));       // strikethrough survives, whichever tag it is drawn with
    }

    [Fact]
    public void Keeps_the_sanitiser_as_the_line_raw_html_and_scripts_in_markdown_do_not_get_through()
    {
        var html = Md.ToHtml("""
            A [link](javascript:alert(1)) and <span onclick="x()">text</span>.

            <script>alert(1)</script>

            <iframe src="https://evil.example/x"></iframe>
            """);

        Assert.DoesNotContain("javascript:", html);
        Assert.DoesNotContain("onclick", html);
        Assert.DoesNotContain("<script", html);
        Assert.DoesNotContain("evil.example", html);
    }

    [Fact]
    public void Lets_an_approved_video_embed_through_as_a_line_of_html_and_hardens_links()
    {
        var html = Md.ToHtml("""
            See [the Memorial](https://www.awm.gov.au).

            <iframe src="https://www.youtube-nocookie.com/embed/abc123"></iframe>
            """);

        Assert.Contains("rel=\"noopener noreferrer\"", html);
        Assert.Contains("<iframe src=\"https://www.youtube-nocookie.com/embed/abc123\"", html);
    }

    [Fact]
    public void Renders_a_site_image_with_its_words_as_the_alt_text()
    {
        var html = Md.ToHtml("![Fire Support Base Coral](/media/ab/abc.jpg)");

        Assert.Contains("<img src=\"/media/ab/abc.jpg\" alt=\"Fire Support Base Coral\"", html);
    }

    [Fact]
    public void Turns_an_html_body_into_markdown_that_renders_back_to_the_same_content()
    {
        const string html = "<h2>Heading</h2><p>Some <strong>bold</strong> and a <a href=\"https://www.awm.gov.au\">link</a>.</p><ul><li>One</li><li>Two</li></ul>";

        var markdown = Md.FromHtml(html);

        Assert.Contains("## Heading", markdown);
        Assert.Contains("**bold**", markdown);
        Assert.Contains("[link](https://www.awm.gov.au)", markdown);
        Assert.Contains("- One", markdown);
        Assert.Equal(new ContentSanitizer().Sanitize(html), Md.ToHtml(markdown).Replace("\n", ""));
    }

    [Fact]
    public void Tells_an_old_html_body_from_markdown()
    {
        Assert.True(ArticleMarkdown.LooksLikeHtml("<p>Old.</p>"));
        Assert.False(ArticleMarkdown.LooksLikeHtml("## New\n\nText."));
        Assert.False(ArticleMarkdown.LooksLikeHtml("<https://www.awm.gov.au> is a bare link"));
    }

    [Fact]
    public async Task The_migrator_converts_html_articles_and_revisions_once()
    {
        var db = new AvwDbContext(new DbContextOptionsBuilder<AvwDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        db.Users.Add(new AppUser { Id = 1, DisplayName = "Ann" });
        db.Articles.Add(new Article { Id = 1, Title = "Old", Slug = "old", BodyHtml = "<h2>Heading</h2><p>Text.</p>", AuthorId = 1 });
        db.Articles.Add(new Article { Id = 2, Title = "New", Slug = "new", BodyMarkdown = "Already **Markdown**.", BodyHtml = "<p>Already <strong>Markdown</strong>.</p>", AuthorId = 1 });
        db.ArticleRevisions.Add(new ArticleRevision { ArticleId = 1, RevisionNo = 1, Title = "Old", BodyMarkdown = "<p>Old text.</p>", CreatedById = 1 });
        await db.SaveChangesAsync();

        var first = await ArticleBodyConverter.ConvertAsync(db, dryRun: false);
        var second = await ArticleBodyConverter.ConvertAsync(db, dryRun: false);

        Assert.Contains("converted 1 article(s) and 1 revision(s)", first);
        Assert.Contains("converted 0 article(s) and 0 revision(s)", second);
        var old = await db.Articles.SingleAsync(a => a.Id == 1);
        Assert.StartsWith("## Heading", old.BodyMarkdown);
        Assert.Contains("<h2>Heading</h2>", old.BodyHtml);
        Assert.Equal("Already **Markdown**.", (await db.Articles.SingleAsync(a => a.Id == 2)).BodyMarkdown);
        Assert.Equal("Old text.", (await db.ArticleRevisions.SingleAsync()).BodyMarkdown);
    }
}
