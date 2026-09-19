using System.Security.Claims;
using Avw.Api.Auth;
using Avw.Data;
using Microsoft.EntityFrameworkCore;

namespace Avw.Api.Tests;

public class UserSyncTests
{
    private static AvwDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AvwDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static ClaimsPrincipal Principal(string sub, string? name, string? email = null, string? verified = null)
    {
        var claims = new List<Claim> { new("sub", sub) };
        if (name is not null) claims.Add(new("name", name));
        if (email is not null) claims.Add(new("email", email));
        if (verified is not null) claims.Add(new("email_verified", verified));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "test"));
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    [Fact]
    public async Task First_login_creates_the_user_and_later_logins_update_it()
    {
        await using var db = NewDb();
        var clock = new FixedClock(new(2026, 9, 19, 0, 0, 0, TimeSpan.Zero));

        var first = await UserSync.UpsertAsync(db, Principal("abc", "Pat"), clock, default);
        var again = await UserSync.UpsertAsync(db, Principal("abc", "Pat K"), clock, default);

        Assert.Equal(first.Id, again.Id);
        Assert.Equal(1, await db.Users.CountAsync());
        Assert.Equal("Pat K", again.DisplayName);
    }

    [Fact]
    public async Task Email_hash_is_stored_only_for_verified_emails()
    {
        await using var db = NewDb();

        var unverified = await UserSync.UpsertAsync(db, Principal("u1", "A", "a@example.com", "false"), TimeProvider.System, default);
        var verified = await UserSync.UpsertAsync(db, Principal("u2", "B", "  B@Example.com ", "true"), TimeProvider.System, default);

        Assert.Null(unverified.EmailHash);
        Assert.Equal(UserSync.HashEmail("b@example.com"), verified.EmailHash);
        Assert.Equal(64, verified.EmailHash!.Length);
    }

    [Fact]
    public async Task A_verified_hash_is_kept_when_a_later_token_has_no_verified_email()
    {
        await using var db = NewDb();

        await UserSync.UpsertAsync(db, Principal("u1", "A", "a@example.com", "true"), TimeProvider.System, default);
        var later = await UserSync.UpsertAsync(db, Principal("u1", "A"), TimeProvider.System, default);

        Assert.Equal(UserSync.HashEmail("a@example.com"), later.EmailHash);
    }

    [Fact]
    public async Task Display_name_falls_back_to_username_then_a_default()
    {
        await using var db = NewDb();
        var withUsername = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim("sub", "u1"), new Claim("preferred_username", "pkim")], "test"));

        var a = await UserSync.UpsertAsync(db, withUsername, TimeProvider.System, default);
        var b = await UserSync.UpsertAsync(db, Principal("u2", null), TimeProvider.System, default);

        Assert.Equal("pkim", a.DisplayName);
        Assert.Equal("Member", b.DisplayName);
    }
}
