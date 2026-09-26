using Avw.Core.Content;
using Avw.Api.Cms;
using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Avw.Api.Tests;

public class ArticleServiceTests
{
    private static readonly DateTime T0 = new(2026, 9, 20, 9, 0, 0, DateTimeKind.Utc);

    private sealed class Clock(DateTime now) : TimeProvider
    {
        public DateTime Now { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => new(Now, TimeSpan.Zero);
    }

    private static readonly Actor Author = new(1, false);
    private static readonly Actor OtherAuthor = new(2, false);
    private static readonly Actor Editor = new(3, true);

    private sealed record Fixture(AvwDbContext Db, ArticleService Svc, Clock Clock);

    private static Fixture Make()
    {
        var db = new AvwDbContext(new DbContextOptionsBuilder<AvwDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        db.Users.AddRange(
            new AppUser { Id = 1, Subject = "a", DisplayName = "Ann Author" },
            new AppUser { Id = 2, Subject = "b", DisplayName = "Bo Author" },
            new AppUser { Id = 3, Subject = "e", DisplayName = "Ed Editor" },
            new AppUser { Id = 4, Subject = "f", DisplayName = "Flo Editor" });
        db.SaveChanges();
        var clock = new Clock(T0);
        return new Fixture(db, new ArticleService(db, new ArticleMarkdown(new ContentSanitizer()), clock), clock);
    }

    private static ArticleInput Input(string title = "The Battle of Long Tan", string body = "<p>Text.</p>", int version = 0, string? slug = null,
        string[]? tags = null, long? category = null, long? parent = null, bool feature = false) =>
        new(title, slug, null, body, category, null, feature, parent, 0, null, null, tags, version);

    private static async Task<ArticleEdit> Create(Fixture f, Actor actor, ArticleInput? input = null, ContentKind kind = ContentKind.Article)
    {
        var r = await f.Svc.CreateAsync(kind, input ?? Input(), actor, default);
        Assert.True(r.Ok, r.Message);
        return r.Value!;
    }

    // ------------------------------------------------------------ creating

    [Fact]
    public async Task Creates_a_draft_with_a_slug_an_excerpt_and_a_first_revision()
    {
        var f = Make();

        var a = await Create(f, Author, Input(body: "<h1>Heading</h1><p>Something happened on the day.</p>"));

        Assert.Equal((ArticleStatus.Draft, "the-battle-of-long-tan", 1), (a.Status, a.Slug, a.Version));
        Assert.Equal("Heading Something happened on the day.", a.Excerpt);
        Assert.Equal("<h2>Heading</h2><p>Something happened on the day.</p>", a.BodyHtml);
        Assert.Equal("Ann Author", a.AuthorName);
        Assert.Equal(T0, a.CreatedUtc);
        var revisions = (await f.Svc.RevisionsAsync(a.Id, Author, default)).Value!;
        Assert.Single(revisions);
        Assert.Equal(1, revisions[0].RevisionNo);
    }

    [Fact]
    public async Task Sanitises_the_body_on_every_save()
    {
        var f = Make();

        var a = await Create(f, Author, Input(body: "<p onclick=\"x()\">Hi</p><script>alert(1)</script>"));
        var updated = (await f.Svc.UpdateAsync(a.Id, Input(body: "<img src=\"javascript:x\"><p>Bye</p>", version: a.Version), Author, default)).Value!;

        Assert.Equal("<p>Hi</p>", a.BodyHtml);
        Assert.Equal("<p>Bye</p>", updated.BodyHtml);
    }

    [Fact]
    public async Task Gives_a_second_article_with_the_same_title_a_numbered_slug()
    {
        var f = Make();

        var one = await Create(f, Author);
        var two = await Create(f, OtherAuthor);

        Assert.Equal(("the-battle-of-long-tan", "the-battle-of-long-tan-2"), (one.Slug, two.Slug));
    }

    [Fact]
    public async Task A_page_and_an_article_may_share_a_slug()
    {
        var f = Make();

        var article = await Create(f, Editor, Input("About"));
        var page = await Create(f, Editor, Input("About"), ContentKind.Page);

        Assert.Equal(("about", "about"), (article.Slug, page.Slug));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Requires_a_title(string title)
    {
        var f = Make();

        var r = await f.Svc.CreateAsync(ContentKind.Article, Input(title), Author, default);

        Assert.Equal((CmsError.Invalid, "title"), (r.Error, r.Field));
    }

    [Fact]
    public async Task Rejects_an_unknown_category_and_too_many_tags()
    {
        var f = Make();

        Assert.Equal("categoryId", (await f.Svc.CreateAsync(ContentKind.Article, Input(category: 99), Author, default)).Field);
        var tags = Enumerable.Range(0, ArticleService.MaxTags + 1).Select(i => $"tag {i}").ToArray();
        Assert.Equal("tags", (await f.Svc.CreateAsync(ContentKind.Article, Input(tags: tags), Author, default)).Field);
    }

    [Fact]
    public async Task Stores_tags_once_however_they_are_written_and_can_change_them()
    {
        var f = Make();

        var a = await Create(f, Author, Input(tags: ["Long Tan", "long  tan", "Nui Dat"]));
        Assert.Equal(["Long Tan", "Nui Dat"], a.Tags);

        var b = await Create(f, OtherAuthor, Input("Another", tags: ["Nui Dat"]));
        Assert.Equal(2, await f.Db.Tags.CountAsync());                       // shared, not duplicated
        Assert.Equal(["Nui Dat"], b.Tags);

        var changed = (await f.Svc.UpdateAsync(a.Id, Input(version: a.Version, tags: ["Nui Dat", "Anzac"]), Author, default)).Value!;
        Assert.Equal(["Anzac", "Nui Dat"], changed.Tags);
        Assert.Equal(3, await f.Db.Tags.CountAsync());
    }

    // ------------------------------------------------------------ roles

    [Fact]
    public async Task Only_editors_create_pages()
    {
        var f = Make();

        Assert.Equal(CmsError.Forbidden, (await f.Svc.CreateAsync(ContentKind.Page, Input(), Author, default)).Error);
        Assert.True((await f.Svc.CreateAsync(ContentKind.Page, Input(), Editor, default)).Ok);
    }

    [Fact]
    public async Task An_author_cannot_choose_a_slug_or_feature_an_article()
    {
        var f = Make();

        var a = await Create(f, Author, Input(slug: "my-own", feature: true));

        Assert.Equal(("the-battle-of-long-tan", false), (a.Slug, a.FeatureOnHomepage));
    }

    [Fact]
    public async Task An_editor_can_choose_a_slug_but_not_a_taken_or_untidy_one()
    {
        var f = Make();
        await Create(f, Author);

        var ok = await f.Svc.CreateAsync(ContentKind.Article, Input("Other", slug: "chosen"), Editor, default);
        var taken = await f.Svc.CreateAsync(ContentKind.Article, Input("Other", slug: "the-battle-of-long-tan"), Editor, default);
        var untidy = await f.Svc.CreateAsync(ContentKind.Article, Input("Other", slug: "Not Tidy!"), Editor, default);

        Assert.Equal("chosen", ok.Value!.Slug);
        Assert.Equal((CmsError.Invalid, "slug"), (taken.Error, taken.Field));
        Assert.Equal((CmsError.Invalid, "slug"), (untidy.Error, untidy.Field));
    }

    [Fact]
    public async Task A_top_level_page_cannot_take_a_name_the_application_uses()
    {
        var f = Make();

        Assert.Equal("slug", (await f.Svc.CreateAsync(ContentKind.Page, Input("Studio", slug: "studio"), Editor, default)).Field);
        var automatic = await Create(f, Editor, Input("Battlemap"), ContentKind.Page);
        Assert.Equal("battlemap-page", automatic.Slug);
    }

    [Fact]
    public async Task Authors_see_and_edit_only_their_own_drafts()
    {
        var f = Make();
        var mine = await Create(f, Author);

        Assert.Equal(CmsError.NotFound, (await f.Svc.GetAsync(mine.Id, OtherAuthor, default)).Error);
        Assert.Equal(CmsError.NotFound, (await f.Svc.UpdateAsync(mine.Id, Input(version: 1), OtherAuthor, default)).Error);
        Assert.True((await f.Svc.UpdateAsync(mine.Id, Input("Better title", version: 1), Author, default)).Ok);
        Assert.Equal(1, (await f.Svc.ListAsync(new ArticleQuery(null, null, null, 1, 25), Author, default)).Total);
        Assert.Equal(0, (await f.Svc.ListAsync(new ArticleQuery(null, null, null, 1, 25), OtherAuthor, default)).Total);
        Assert.Equal(1, (await f.Svc.ListAsync(new ArticleQuery(null, null, null, 1, 25), Editor, default)).Total);
    }

    [Fact]
    public async Task An_author_cannot_edit_once_it_is_submitted_but_can_withdraw_it()
    {
        var f = Make();
        var a = await Create(f, Author);

        var submitted = (await f.Svc.TransitionAsync(a.Id, new(ArticleStatus.InReview, null, a.Version), Author, default)).Value!;
        Assert.Equal((ArticleStatus.InReview, false), (submitted.Status, submitted.CanEdit));
        Assert.Equal(CmsError.Forbidden, (await f.Svc.UpdateAsync(a.Id, Input("Sneaky", version: submitted.Version), Author, default)).Error);

        var withdrawn = (await f.Svc.TransitionAsync(a.Id, new(ArticleStatus.Draft, null, submitted.Version), Author, default)).Value!;
        Assert.Equal((ArticleStatus.Draft, true), (withdrawn.Status, withdrawn.CanEdit));
    }

    [Theory]
    [InlineData(ArticleStatus.Published)]
    [InlineData(ArticleStatus.Scheduled)]
    [InlineData(ArticleStatus.Archived)]
    public async Task An_author_cannot_publish_schedule_or_archive(ArticleStatus target)
    {
        var f = Make();
        var a = await Create(f, Author);

        var r = await f.Svc.TransitionAsync(a.Id, new(target, T0.AddDays(1), a.Version), Author, default);

        Assert.Equal(CmsError.Forbidden, r.Error);
    }

    [Fact]
    public async Task An_author_cannot_move_someone_elses_item_and_the_offered_transitions_match_the_role()
    {
        var f = Make();
        var a = await Create(f, Author);

        Assert.Equal(CmsError.NotFound, (await f.Svc.TransitionAsync(a.Id, new(ArticleStatus.InReview, null, 1), OtherAuthor, default)).Error);
        Assert.Equal([ArticleStatus.InReview], a.Transitions);
        Assert.Equal([ArticleStatus.InReview, ArticleStatus.Scheduled, ArticleStatus.Published, ArticleStatus.Archived],
            (await f.Svc.GetAsync(a.Id, Editor, default)).Value!.Transitions);
    }

    [Fact]
    public async Task An_editor_may_edit_anything_and_can_feature_it()
    {
        var f = Make();
        var a = await Create(f, Author);

        var edited = (await f.Svc.UpdateAsync(a.Id, Input("Edited by editor", version: a.Version, feature: true), Editor, default)).Value!;

        Assert.Equal(("Edited by editor", true, "Ann Author"), (edited.Title, edited.FeatureOnHomepage, edited.AuthorName));
    }

    // ------------------------------------------------------------ workflow

    [Fact]
    public async Task Publishing_sets_the_date_and_unpublishing_keeps_it()
    {
        var f = Make();
        var a = await Create(f, Author);

        var published = (await f.Svc.TransitionAsync(a.Id, new(ArticleStatus.Published, null, a.Version), Editor, default)).Value!;
        f.Clock.Now = T0.AddDays(3);
        var draft = (await f.Svc.TransitionAsync(a.Id, new(ArticleStatus.Draft, null, published.Version), Editor, default)).Value!;
        var again = (await f.Svc.TransitionAsync(a.Id, new(ArticleStatus.Published, null, draft.Version), Editor, default)).Value!;

        Assert.Equal(T0, published.PublishedUtc);
        Assert.Equal(T0, draft.PublishedUtc);
        Assert.Equal(T0, again.PublishedUtc);                              // the original date stands, so the article does not jump the queue
    }

    [Fact]
    public async Task Scheduling_needs_a_future_time_and_publishing_early_takes_the_current_time()
    {
        var f = Make();
        var a = await Create(f, Author);

        Assert.Equal("scheduledUtc", (await f.Svc.TransitionAsync(a.Id, new(ArticleStatus.Scheduled, null, 1), Editor, default)).Field);
        Assert.Equal("scheduledUtc", (await f.Svc.TransitionAsync(a.Id, new(ArticleStatus.Scheduled, T0.AddMinutes(-1), 1), Editor, default)).Field);

        var scheduled = (await f.Svc.TransitionAsync(a.Id, new(ArticleStatus.Scheduled, T0.AddDays(2), 1), Editor, default)).Value!;
        Assert.Equal((ArticleStatus.Scheduled, T0.AddDays(2), null), (scheduled.Status, scheduled.ScheduledUtc, scheduled.PublishedUtc));

        f.Clock.Now = T0.AddHours(1);
        var early = (await f.Svc.TransitionAsync(a.Id, new(ArticleStatus.Published, null, scheduled.Version), Editor, default)).Value!;
        Assert.Equal((ArticleStatus.Published, T0.AddHours(1), null), (early.Status, early.PublishedUtc, early.ScheduledUtc));
    }

    [Theory]
    [InlineData(ArticleStatus.Published, ArticleStatus.Scheduled)]
    [InlineData(ArticleStatus.Archived, ArticleStatus.InReview)]
    [InlineData(ArticleStatus.Draft, ArticleStatus.Draft)]
    public async Task An_editor_cannot_make_a_move_the_workflow_does_not_allow(ArticleStatus from, ArticleStatus to)
    {
        var f = Make();
        var a = await Create(f, Editor);
        var article = await f.Db.Articles.FindAsync(a.Id);
        article!.Status = from;
        article.PublishedUtc = from == ArticleStatus.Published ? T0 : null;
        await f.Db.SaveChangesAsync();

        var r = await f.Svc.TransitionAsync(a.Id, new(to, T0.AddDays(1), article.Version), Editor, default);

        Assert.Equal(CmsError.Invalid, r.Error);
    }

    [Fact]
    public async Task Only_a_draft_or_archived_item_can_be_deleted_and_a_page_with_children_cannot()
    {
        var f = Make();
        var a = await Create(f, Author);
        var published = (await f.Svc.TransitionAsync(a.Id, new(ArticleStatus.Published, null, 1), Editor, default)).Value!;

        Assert.Equal(CmsError.Forbidden, (await f.Svc.DeleteAsync(a.Id, Editor, default)).Error);
        var archived = (await f.Svc.TransitionAsync(a.Id, new(ArticleStatus.Archived, null, published.Version), Editor, default)).Value!;
        Assert.Equal(CmsError.Forbidden, (await f.Svc.DeleteAsync(a.Id, Author, default)).Error);     // not theirs to delete once archived
        Assert.True((await f.Svc.DeleteAsync(a.Id, Editor, default)).Ok);
        Assert.Equal(ArticleStatus.Archived, archived.Status);
        Assert.Empty(f.Db.Articles);
        Assert.Empty(f.Db.ArticleRevisions);                                                          // revisions go with it

        var parent = await Create(f, Editor, Input("Parent"), ContentKind.Page);
        await Create(f, Editor, Input("Child", parent: parent.Id), ContentKind.Page);
        Assert.Equal(CmsError.Conflict, (await f.Svc.DeleteAsync(parent.Id, Editor, default)).Error);
    }

    [Fact]
    public async Task An_author_can_delete_their_own_draft()
    {
        var f = Make();
        var a = await Create(f, Author);

        Assert.True((await f.Svc.DeleteAsync(a.Id, Author, default)).Ok);
        Assert.Equal(CmsError.NotFound, (await f.Svc.GetAsync(a.Id, Author, default)).Error);
    }

    // ------------------------------------------------------------ concurrency and revisions

    [Fact]
    public async Task Refuses_a_save_made_from_an_out_of_date_copy()
    {
        var f = Make();
        var a = await Create(f, Editor);
        await f.Svc.UpdateAsync(a.Id, Input("First edit", version: a.Version), Editor, default);

        var stale = await f.Svc.UpdateAsync(a.Id, Input("Second edit", version: a.Version), Editor, default);
        var staleMove = await f.Svc.TransitionAsync(a.Id, new(ArticleStatus.Published, null, a.Version), Editor, default);

        Assert.Equal(CmsError.Conflict, stale.Error);
        Assert.Equal(CmsError.Conflict, staleMove.Error);
        Assert.Equal("First edit", (await f.Svc.GetAsync(a.Id, Editor, default)).Value!.Title);
    }

    [Fact]
    public async Task Every_save_moves_the_version_on_and_a_revision_is_kept_only_when_the_text_changed()
    {
        var f = Make();
        var a = await Create(f, Editor);

        var same = (await f.Svc.UpdateAsync(a.Id, Input(version: a.Version, feature: true), Editor, default)).Value!;       // only a flag changed
        f.Clock.Now = T0 + ArticleService.RevisionWindow + TimeSpan.FromMinutes(1);
        var text = (await f.Svc.UpdateAsync(a.Id, Input(body: "<p>New text.</p>", version: same.Version), Editor, default)).Value!;

        Assert.Equal((2, 3), (same.Version, text.Version));
        var revisions = (await f.Svc.RevisionsAsync(a.Id, Editor, default)).Value!;
        Assert.Equal([2, 1], revisions.Select(r => r.RevisionNo));
    }

    [Fact]
    public async Task Autosaves_by_the_same_person_shortly_after_each_other_share_one_revision()
    {
        var f = Make();
        var a = await Create(f, Author, Input(body: "<p>One.</p>"));

        var second = (await f.Svc.UpdateAsync(a.Id, Input(body: "<p>One. Two.</p>", version: a.Version), Author, default)).Value!;
        f.Clock.Now = T0.AddMinutes(9);
        var third = (await f.Svc.UpdateAsync(a.Id, Input(body: "<p>One. Two. Three.</p>", version: second.Version), Author, default)).Value!;

        Assert.Equal(3, third.Version);                                            // every save is still a new version of the record
        var revisions = (await f.Svc.RevisionsAsync(a.Id, Author, default)).Value!;
        Assert.Single(revisions);
        Assert.Equal("<p>One. Two. Three.</p>", (await f.Svc.RevisionAsync(a.Id, 1, Author, default)).Value!.BodyHtml);
    }

    [Fact]
    public async Task A_save_after_the_window_or_by_someone_else_starts_a_new_revision()
    {
        var f = Make();
        var a = await Create(f, Editor, Input(body: "<p>One.</p>"));

        var byOther = (await f.Svc.UpdateAsync(a.Id, Input(body: "<p>Two.</p>", version: a.Version), new Actor(4, true), default)).Value!;
        f.Clock.Now = T0 + ArticleService.RevisionWindow + TimeSpan.FromSeconds(1);
        var later = (await f.Svc.UpdateAsync(a.Id, Input(body: "<p>Three.</p>", version: byOther.Version), new Actor(4, true), default)).Value!;

        Assert.Equal([3, 2, 1], (await f.Svc.RevisionsAsync(a.Id, Editor, default)).Value!.Select(r => r.RevisionNo));
        Assert.Equal(3, later.Version);
    }

    [Fact]
    public async Task Restores_an_old_revision_as_a_new_one()
    {
        var f = Make();
        var a = await Create(f, Editor, Input("Original", "<p>First.</p>"));
        f.Clock.Now = T0 + ArticleService.RevisionWindow + TimeSpan.FromMinutes(1);
        var b = (await f.Svc.UpdateAsync(a.Id, Input("Changed", "<p>Second.</p>", a.Version), Editor, default)).Value!;

        var restored = (await f.Svc.RestoreAsync(a.Id, 1, new(b.Version), Editor, default)).Value!;

        Assert.Equal(("Original", "<p>First.</p>", 3), (restored.Title, restored.BodyHtml, restored.Version));
        Assert.Equal([3, 2, 1], (await f.Svc.RevisionsAsync(a.Id, Editor, default)).Value!.Select(r => r.RevisionNo));
        Assert.Equal("<p>Second.</p>", (await f.Svc.RevisionAsync(a.Id, 2, Editor, default)).Value!.BodyHtml);       // nothing was lost
        Assert.Equal(CmsError.NotFound, (await f.Svc.RestoreAsync(a.Id, 9, new(restored.Version), Editor, default)).Error);
        Assert.Equal(CmsError.Conflict, (await f.Svc.RestoreAsync(a.Id, 1, new(b.Version), Editor, default)).Error);
    }

    [Fact]
    public async Task Restoring_sanitises_again_in_case_an_old_revision_is_unsafe()
    {
        var f = Make();
        var a = await Create(f, Editor);
        f.Db.ArticleRevisions.Add(new ArticleRevision { ArticleId = a.Id, RevisionNo = 2, Title = "Old", BodyMarkdown = "<p>Hi</p><script>x</script>", CreatedById = 3, CreatedUtc = T0 });
        await f.Db.SaveChangesAsync();

        var restored = (await f.Svc.RestoreAsync(a.Id, 2, new(a.Version), Editor, default)).Value!;

        Assert.Equal("<p>Hi</p>", restored.BodyHtml);
    }

    // ------------------------------------------------------------ pages

    [Fact]
    public async Task Pages_nest_but_not_under_themselves_or_too_deep_or_under_an_article()
    {
        var f = Make();
        var article = await Create(f, Editor, Input("An article"));
        var p1 = await Create(f, Editor, Input("One"), ContentKind.Page);
        var p2 = await Create(f, Editor, Input("Two", parent: p1.Id), ContentKind.Page);

        Assert.Equal("parentId", (await f.Svc.UpdateAsync(p1.Id, Input("One", version: p1.Version, parent: p1.Id), Editor, default)).Field);
        Assert.Equal("parentId", (await f.Svc.UpdateAsync(p1.Id, Input("One", version: p1.Version, parent: p2.Id), Editor, default)).Field);    // would make a loop
        Assert.Equal("parentId", (await f.Svc.CreateAsync(ContentKind.Page, Input("Odd", parent: article.Id), Editor, default)).Field);
        Assert.Equal("parentId", (await f.Svc.CreateAsync(ContentKind.Page, Input("Missing", parent: 999), Editor, default)).Field);

        var deepest = p2;
        for (var level = 3; level <= ArticleService.MaxPageDepth; level++)
        {
            deepest = await Create(f, Editor, Input($"Level {level}", parent: deepest.Id), ContentKind.Page);
        }

        Assert.Equal("parentId", (await f.Svc.CreateAsync(ContentKind.Page, Input("Too deep", parent: deepest.Id), Editor, default)).Field);
    }

    // ------------------------------------------------------------ categories and helpers

    [Fact]
    public async Task Editors_add_categories_and_repeating_a_name_returns_the_same_one()
    {
        var f = Make();

        Assert.Equal(CmsError.Forbidden, (await f.Svc.CreateCategoryAsync("Battles", Author, default)).Error);
        Assert.Equal("name", (await f.Svc.CreateCategoryAsync("  ", Editor, default)).Field);
        var one = (await f.Svc.CreateCategoryAsync("Bà Rịa", Editor, default)).Value!;
        var two = (await f.Svc.CreateCategoryAsync("bà rịa", Editor, default)).Value!;

        Assert.Equal(("ba-ria", one.Id), (one.Slug, two.Id));
        var a = await Create(f, Author, Input(category: one.Id));
        Assert.Equal(one.Id, a.CategoryId);
    }

    [Theory]
    [InlineData("<p>Short.</p>", "Short.")]
    [InlineData("<p>One</p><p>Two &amp; three</p>", "One Two & three")]
    [InlineData("<p>&lt;b&gt;not markup&lt;/b&gt;</p>", "<b>not markup</b>")]
    public void Reduces_html_to_text_for_excerpts(string html, string expected) => Assert.Equal(expected, ArticleService.PlainText(html, 200));

    [Fact]
    public void Cuts_long_text_at_a_word_boundary_with_an_ellipsis()
    {
        var text = ArticleService.PlainText("<p>" + string.Join(' ', Enumerable.Repeat("infantry", 60)) + "</p>", 50);

        Assert.True(text.Length <= 51);
        Assert.EndsWith("infantry…", text);
    }
}
