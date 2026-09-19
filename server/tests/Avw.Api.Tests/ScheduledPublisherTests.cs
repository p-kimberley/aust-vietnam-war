using Avw.Data;
using Avw.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Avw.Api.Tests;

public class ScheduledPublisherTests
{
    private static readonly DateTime Now = new(2026, 9, 19, 12, 0, 0, DateTimeKind.Utc);

    private sealed class FixedClock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(Now);
    }

    private static Article Make(string slug, ArticleStatus status, DateTime? scheduled) => new()
    {
        Slug = slug, Title = slug, Kind = ContentKind.Article, Status = status, ScheduledUtc = scheduled,
        Author = new AppUser { Subject = "s-" + slug, DisplayName = "A" },
    };

    [Fact]
    public async Task Publishes_only_scheduled_articles_that_are_due()
    {
        await using var db = new AvwDbContext(new DbContextOptionsBuilder<AvwDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        db.Articles.AddRange(
            Make("due", ArticleStatus.Scheduled, Now.AddMinutes(-5)),
            Make("future", ArticleStatus.Scheduled, Now.AddHours(1)),
            Make("draft", ArticleStatus.Draft, Now.AddMinutes(-5)));
        await db.SaveChangesAsync();

        var count = await ScheduledPublisher.PublishDueAsync(db, new FixedClock(), default);

        Assert.Equal(1, count);
        var due = await db.Articles.SingleAsync(a => a.Slug == "due");
        Assert.Equal(ArticleStatus.Published, due.Status);
        Assert.Equal(Now.AddMinutes(-5), due.PublishedUtc);
        Assert.Null(due.ScheduledUtc);
        Assert.Equal(1, due.Version);
        Assert.Equal(ArticleStatus.Scheduled, (await db.Articles.SingleAsync(a => a.Slug == "future")).Status);
        Assert.Equal(ArticleStatus.Draft, (await db.Articles.SingleAsync(a => a.Slug == "draft")).Status);
    }

    [Fact]
    public async Task Running_twice_publishes_nothing_the_second_time()
    {
        await using var db = new AvwDbContext(new DbContextOptionsBuilder<AvwDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        db.Articles.Add(Make("due", ArticleStatus.Scheduled, Now.AddMinutes(-1)));
        await db.SaveChangesAsync();

        await ScheduledPublisher.PublishDueAsync(db, new FixedClock(), default);
        var second = await ScheduledPublisher.PublishDueAsync(db, new FixedClock(), default);

        Assert.Equal(0, second);
    }
}
