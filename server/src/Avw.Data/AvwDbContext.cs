using Avw.Data.Entities;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Avw.Data;

public class AvwDbContext(DbContextOptions<AvwDbContext> options) : DbContext(options), IDataProtectionKeyContext
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<Article> Articles => Set<Article>();
    public DbSet<ArticleRevision> ArticleRevisions => Set<ArticleRevision>();
    public DbSet<ArticleTag> ArticleTags => Set<ArticleTag>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Tag> Tags => Set<Tag>();
    public DbSet<MediaAsset> MediaAssets => Set<MediaAsset>();
    public DbSet<Poi> Pois => Set<Poi>();

    /// <summary>Shared ASP.NET Data Protection keys, so every API replica can read the auth cookie.</summary>
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        // Every table needs a primary key: InnoDB Cluster (Group Replication) rejects tables without one.
        b.Entity<AppUser>(e =>
        {
            e.ToTable("users");
            e.Property(x => x.Subject).HasMaxLength(64);
            e.Property(x => x.DisplayName).HasMaxLength(200);
            e.Property(x => x.EmailHash).HasMaxLength(64).IsFixedLength();
            e.HasIndex(x => x.Subject).IsUnique();
            e.HasIndex(x => x.EmailHash);
        });

        b.Entity<Poi>(e =>
        {
            e.ToTable("points_of_interest");
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.Type).HasMaxLength(16);
            e.Property(x => x.Name).HasMaxLength(100);
            e.Property(x => x.Details).HasColumnType("text");
            e.HasIndex(x => x.Visible);
        });

        b.Entity<Category>(e =>
        {
            e.ToTable("categories");
            e.Property(x => x.Slug).HasMaxLength(100);
            e.Property(x => x.Name).HasMaxLength(100);
            e.HasIndex(x => x.Slug).IsUnique();
        });

        b.Entity<Tag>(e =>
        {
            e.ToTable("tags");
            e.Property(x => x.Slug).HasMaxLength(100);
            e.Property(x => x.Name).HasMaxLength(100);
            e.HasIndex(x => x.Slug).IsUnique();
        });

        b.Entity<MediaAsset>(e =>
        {
            e.ToTable("media_assets");
            e.Property(x => x.Sha256).HasMaxLength(64).IsFixedLength();
            e.Property(x => x.ContentType).HasMaxLength(50);
            e.Property(x => x.Caption).HasMaxLength(500);
            e.Property(x => x.Credit).HasMaxLength(200);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.Sha256).IsUnique();
            e.HasOne(x => x.UploadedBy).WithMany().HasForeignKey(x => x.UploadedById).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Article>(e =>
        {
            e.ToTable("articles");
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Slug).HasMaxLength(200);
            e.Property(x => x.Title).HasMaxLength(300);
            e.Property(x => x.Excerpt).HasMaxLength(1000);
            e.Property(x => x.BodyHtml).HasColumnType("longtext");
            e.Property(x => x.SeoTitle).HasMaxLength(200);
            e.Property(x => x.SeoDescription).HasMaxLength(400);
            e.Property(x => x.Version).IsConcurrencyToken();

            // Slugs are unique per kind. Page paths are resolved by walking Parent, so sibling uniqueness
            // is enforced in the API rather than by an index (MySQL unique indexes allow duplicate NULLs).
            e.HasIndex(x => new { x.Kind, x.Slug }).IsUnique();
            e.HasIndex(x => new { x.Kind, x.Status, x.PublishedUtc });
            e.HasIndex(x => new { x.Status, x.ScheduledUtc });

            e.HasOne(x => x.Author).WithMany().HasForeignKey(x => x.AuthorId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Category).WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.FeaturedMedia).WithMany().HasForeignKey(x => x.FeaturedMediaId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Parent).WithMany().HasForeignKey(x => x.ParentId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<ArticleTag>(e =>
        {
            e.ToTable("article_tags");
            e.HasKey(x => new { x.ArticleId, x.TagId });
            e.HasOne(x => x.Article).WithMany(a => a.Tags).HasForeignKey(x => x.ArticleId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Tag).WithMany().HasForeignKey(x => x.TagId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ArticleRevision>(e =>
        {
            e.ToTable("article_revisions");
            e.Property(x => x.Title).HasMaxLength(300);
            e.Property(x => x.BodyHtml).HasColumnType("longtext");
            e.HasIndex(x => new { x.ArticleId, x.RevisionNo }).IsUnique();
            e.HasOne(x => x.Article).WithMany(a => a.Revisions).HasForeignKey(x => x.ArticleId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.CreatedBy).WithMany().HasForeignKey(x => x.CreatedById).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<DataProtectionKey>().ToTable("data_protection_keys");
    }
}
