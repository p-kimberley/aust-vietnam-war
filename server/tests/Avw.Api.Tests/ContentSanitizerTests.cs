using Avw.Core.Content;
using Avw.Api.Cms;

namespace Avw.Api.Tests;

public class ContentSanitizerTests
{
    private static readonly ContentSanitizer Sanitizer = new();
    private static string Clean(string? html) => Sanitizer.Sanitize(html);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   \n  ")]
    public void Blank_input_gives_an_empty_string(string? html) => Assert.Equal("", Clean(html));

    [Theory]
    [InlineData("<p>Plain <strong>bold</strong> and <em>italic</em>.</p>")]
    [InlineData("<h2>Heading</h2><h3>Sub</h3><ul><li>One</li><li>Two</li></ul><ol><li>A</li></ol>")]
    [InlineData("<blockquote><p>Quoted</p></blockquote><hr><pre><code>code</code></pre>")]
    [InlineData("<table><thead><tr><th>A</th></tr></thead><tbody><tr><td colspan=\"2\">B</td></tr></tbody></table>")]
    [InlineData("<figure><figcaption>Caption</figcaption></figure>")]
    [InlineData("<p>Trận Long Tân, Đồng Nai, Bà Rịa – Vũng Tàu.</p>")]
    public void Keeps_ordinary_formatting_and_all_the_text(string html) => Assert.Equal(html, Clean(html));

    [Theory]
    [InlineData("<script>alert(1)</script><p>ok</p>", "<p>ok</p>")]
    [InlineData("<p>ok</p><style>p{display:none}</style>", "<p>ok</p>")]
    [InlineData("<p onclick=\"evil()\" onmouseover=\"evil()\">t</p>", "<p>t</p>")]
    [InlineData("<p style=\"position:fixed;top:0\" class=\"x\" id=\"y\">t</p>", "<p>t</p>")]
    [InlineData("<p data-x=\"1\">t</p>", "<p>t</p>")]
    [InlineData("<p>a</p><!-- hidden --><p>b</p>", "<p>a</p><p>b</p>")]
    [InlineData("<svg onload=\"alert(1)\"><circle/></svg><p>t</p>", "<p>t</p>")]
    [InlineData("<math><mi>x</mi></math><p>t</p>", "<p>t</p>")]
    [InlineData("<object data=\"x\"></object><embed src=\"x\"><p>t</p>", "<p>t</p>")]
    [InlineData("<form action=\"/x\"><input name=\"a\"><button>go</button></form><p>t</p>", "<p>t</p>")]
    [InlineData("<meta http-equiv=\"refresh\" content=\"0;url=http://evil\"><link rel=\"stylesheet\" href=\"x\"><base href=\"//evil\"><p>t</p>", "<p>t</p>")]
    public void Removes_scripts_styles_handlers_and_dangerous_elements(string html, string expected) => Assert.Equal(expected, Clean(html));

    [Theory]
    [InlineData("<a href=\"javascript:alert(1)\">x</a>")]
    [InlineData("<a href=\"JaVaScRiPt:alert(1)\">x</a>")]
    [InlineData("<a href=\" javascript:alert(1)\">x</a>")]
    [InlineData("<a href=\"&#106;avascript:alert(1)\">x</a>")]
    [InlineData("<a href=\"jav&#x09;ascript:alert(1)\">x</a>")]
    [InlineData("<a href=\"vbscript:msgbox(1)\">x</a>")]
    [InlineData("<a href=\"data:text/html,<script>alert(1)</script>\">x</a>")]
    [InlineData("<a href=\"file:///etc/passwd\">x</a>")]
    public void Drops_the_href_of_script_and_other_unsafe_schemes(string html)
    {
        var clean = Clean(html);

        Assert.DoesNotContain("href", clean, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("javascript", clean, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(">x</a>", clean);
    }

    [Fact]
    public void Opens_external_links_safely_and_leaves_internal_and_mail_links_alone()
    {
        Assert.Equal(
            "<a href=\"https://example.com/x\" target=\"_blank\" rel=\"noopener noreferrer\">x</a>",
            Clean("<a href=\"https://example.com/x\">x</a>"));
        Assert.Equal("<a href=\"/articles/a\">x</a>", Clean("<a href=\"/articles/a\">x</a>"));
        Assert.Equal("<a href=\"mailto:a@example.com\">x</a>", Clean("<a href=\"mailto:a@example.com\">x</a>"));
    }

    [Fact]
    public void Cannot_be_talked_out_of_rel_or_target_on_an_internal_link()
    {
        var clean = Clean("<a href=\"/about\" target=\"_top\" rel=\"opener\">x</a>");
        Assert.Equal("<a href=\"/about\">x</a>", clean);
    }

    [Theory]
    [InlineData("<img src=\"x\" onerror=\"alert(1)\">")]
    [InlineData("<img src=\"data:image/svg+xml;base64,PHN2Zz4=\">")]
    [InlineData("<img src=\"http://insecure.example/a.png\">")]
    [InlineData("<img src=\"//evil.example/a.png\">")]
    [InlineData("<img src=\"javascript:alert(1)\">")]
    [InlineData("<img>")]
    public void Removes_images_that_are_not_https_or_site_relative(string html) => Assert.Equal("", Clean(html));

    [Fact]
    public void Keeps_site_and_https_images_without_handlers_and_lazy_loads_them()
    {
        var local = Clean("<img src=\"/media/aa/abc.jpg\" alt=\"A base\" width=\"600\" onerror=\"alert(1)\" style=\"x\">");
        Assert.Equal("<img src=\"/media/aa/abc.jpg\" alt=\"A base\" width=\"600\" loading=\"lazy\">", local);

        Assert.Contains("src=\"https://cdn.example/a.png\"", Clean("<img src=\"https://cdn.example/a.png\" alt=\"\">"));
    }

    [Theory]
    [InlineData("https://www.youtube-nocookie.com/embed/abc123")]
    [InlineData("https://player.vimeo.com/video/123")]
    public void Keeps_embeds_from_the_approved_video_hosts(string src)
    {
        var clean = Clean($"<iframe src=\"{src}\" width=\"560\" height=\"315\" allowfullscreen onload=\"evil()\"></iframe>");

        Assert.Contains($"src=\"{src}\"", clean);
        Assert.Contains("loading=\"lazy\"", clean);
        Assert.DoesNotContain("onload", clean);
        Assert.DoesNotContain("width", clean);                          // sizing is the page's job
    }

    [Theory]
    [InlineData("https://evil.example/embed")]
    [InlineData("http://www.youtube-nocookie.com/embed/a")]             // not https
    [InlineData("https://www.youtube.com/embed/a")]                     // the tracking host is not approved
    [InlineData("https://www.youtube-nocookie.com.evil.example/embed/a")]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:text/html,<script>alert(1)</script>")]
    [InlineData("/relative")]
    public void Removes_frames_from_anywhere_else(string src) =>
        Assert.Equal("<p>t</p>", Clean($"<iframe src=\"{src}\"></iframe><p>t</p>"));

    [Fact]
    public void A_frame_with_no_source_is_removed() => Assert.Equal("<p>t</p>", Clean("<iframe></iframe><p>t</p>"));

    [Theory]
    [InlineData("<p>Text</p><p></p>", "<p>Text</p>")]
    [InlineData("<ul><li><p>One</p></li></ul><p><br></p><p> </p>", "<ul><li><p>One</p></li></ul>")]
    [InlineData("<p>One</p><p></p><p>Two</p>", "<p>One</p><p></p><p>Two</p>")]      // a deliberate gap in the middle is left alone
    [InlineData("<p></p>", "")]
    public void Drops_the_empty_paragraph_an_editor_leaves_at_the_end(string html, string expected) => Assert.Equal(expected, Clean(html));

    [Fact]
    public void Turns_a_body_h1_into_an_h2_because_the_title_is_the_h1()
    {
        Assert.Equal("<h2>Heading</h2>", Clean("<h1>Heading</h1>"));
        Assert.Equal("<h2>Heading</h2>", Clean("<H1 class=\"x\">Heading</H1>"));
    }

    [Fact]
    public void Keeps_the_text_of_unknown_wrapper_elements_that_carry_no_risk()
    {
        Assert.Equal("<div>text</div>", Clean("<div class=\"x\" onclick=\"y()\">text</div>"));
        Assert.Equal("<span>text</span>", Clean("<span style=\"color:red\">text</span>"));
    }

    [Theory]
    [InlineData("<p>a</p><script>x</script>")]
    [InlineData("<a href=\"https://example.com\">x</a><img src=\"/media/a.jpg\">")]
    [InlineData("<iframe src=\"https://player.vimeo.com/video/1\"></iframe>")]
    [InlineData("<p onclick=\"x\">a &amp; b &lt; c</p>")]
    public void Sanitising_twice_changes_nothing(string html)
    {
        var once = Clean(html);
        Assert.Equal(once, Clean(once));
    }

    [Fact]
    public void Escaped_markup_stays_text_and_is_not_turned_back_into_tags()
    {
        var clean = Clean("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
        Assert.Equal("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>", clean);
    }

    [Fact]
    public void Survives_deeply_nested_and_malformed_input_without_leaving_script()
    {
        var nested = string.Concat(Enumerable.Repeat("<div>", 300)) + "<script>alert(1)</script>" + string.Concat(Enumerable.Repeat("</div>", 300));
        Assert.DoesNotContain("script", Clean(nested), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("<script", Clean("<<script>script>alert(1)<</script>/script>"), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("onerror", Clean("<img src=\"/a.jpg\"onerror=alert(1)//"), StringComparison.OrdinalIgnoreCase);
    }
}

public class SlugTests
{
    [Theory]
    [InlineData("The Battle of Long Tan", "the-battle-of-long-tan")]
    [InlineData("Trận Long Tân", "tran-long-tan")]
    [InlineData("Đồng Nai & Bà Rịa – Vũng Tàu", "dong-nai-ba-ria-vung-tau")]
    [InlineData("Digger's war: 1966", "diggers-war-1966")]
    [InlineData("  --Hello,   World!--  ", "hello-world")]
    [InlineData("Ünïcödé Café", "unicode-cafe")]
    [InlineData("!!!", "untitled")]
    [InlineData("", "untitled")]
    [InlineData(null, "untitled")]
    public void Makes_a_slug_from_a_title(string? title, string expected) => Assert.Equal(expected, Slugs.From(title));

    [Fact]
    public void Cuts_a_long_title_at_a_word_boundary_within_the_limit()
    {
        var slug = Slugs.From(string.Join(' ', Enumerable.Repeat("operation", 30)));

        Assert.True(slug.Length <= Slugs.MaxLength);
        Assert.False(slug.EndsWith('-'));
        Assert.Equal("operation", slug.Split('-')[^1]);                   // no half word at the end
    }

    [Fact]
    public void Cuts_a_long_single_word_hard()
    {
        Assert.Equal(Slugs.MaxLength, Slugs.From(new string('a', 200)).Length);
    }

    [Fact]
    public void Adds_the_first_free_number_when_a_slug_is_taken()
    {
        var used = new HashSet<string> { "battle", "battle-2", "battle-3" };

        Assert.Equal("battle-4", Slugs.Unique("battle", used.Contains));
        Assert.Equal("fresh", Slugs.Unique("fresh", used.Contains));
    }

    [Fact]
    public void Keeps_a_numbered_slug_within_the_limit()
    {
        var max = new string('a', Slugs.MaxLength);

        var unique = Slugs.Unique(max, s => s == max);

        Assert.Equal(Slugs.MaxLength, unique.Length);
        Assert.EndsWith("-2", unique);
    }

    [Theory]
    [InlineData("a", true)]
    [InlineData("long-tan-1966", true)]
    [InlineData("", false)]
    [InlineData(null, false)]
    [InlineData("-a", false)]
    [InlineData("a-", false)]
    [InlineData("a--b", false)]
    [InlineData("A", false)]
    [InlineData("a b", false)]
    [InlineData("a/b", false)]
    [InlineData("tân", false)]
    public void Accepts_only_tidy_lower_case_slugs(string? slug, bool valid) => Assert.Equal(valid, Slugs.IsValid(slug));

    [Theory]
    [InlineData("api", true)]
    [InlineData("STUDIO", true)]
    [InlineData("battlemap", true)]
    [InlineData("about", false)]
    public void Knows_which_first_segments_belong_to_the_application(string slug, bool reserved) =>
        Assert.Equal(reserved, Slugs.IsReserved(slug));
}
