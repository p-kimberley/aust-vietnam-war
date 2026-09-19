using System;
using Microsoft.EntityFrameworkCore.Migrations;
using MySql.EntityFrameworkCore.Metadata;

#nullable disable

namespace Avw.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "categories",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    Slug = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: false),
                    Name = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_categories", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "data_protection_keys",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    FriendlyName = table.Column<string>(type: "longtext", nullable: true),
                    Xml = table.Column<string>(type: "longtext", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_data_protection_keys", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "tags",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    Slug = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: false),
                    Name = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tags", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    Subject = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false),
                    DisplayName = table.Column<string>(type: "varchar(200)", maxLength: 200, nullable: false),
                    EmailHash = table.Column<string>(type: "char(64)", fixedLength: true, maxLength: 64, nullable: true),
                    CreatedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    LastSeenUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_users", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "media_assets",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    Sha256 = table.Column<string>(type: "char(64)", fixedLength: true, maxLength: 64, nullable: false),
                    ContentType = table.Column<string>(type: "varchar(50)", maxLength: 50, nullable: false),
                    Width = table.Column<int>(type: "int", nullable: false),
                    Height = table.Column<int>(type: "int", nullable: false),
                    ByteSize = table.Column<long>(type: "bigint", nullable: false),
                    Caption = table.Column<string>(type: "varchar(500)", maxLength: 500, nullable: true),
                    Credit = table.Column<string>(type: "varchar(200)", maxLength: 200, nullable: true),
                    Status = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    UploadedById = table.Column<long>(type: "bigint", nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_media_assets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_media_assets_users_UploadedById",
                        column: x => x.UploadedById,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "articles",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    Kind = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    Slug = table.Column<string>(type: "varchar(200)", maxLength: 200, nullable: false),
                    Title = table.Column<string>(type: "varchar(300)", maxLength: 300, nullable: false),
                    Excerpt = table.Column<string>(type: "varchar(1000)", maxLength: 1000, nullable: true),
                    BodyHtml = table.Column<string>(type: "longtext", nullable: false),
                    Status = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    AuthorId = table.Column<long>(type: "bigint", nullable: false),
                    CategoryId = table.Column<long>(type: "bigint", nullable: true),
                    FeaturedMediaId = table.Column<long>(type: "bigint", nullable: true),
                    FeatureOnHomepage = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    ParentId = table.Column<long>(type: "bigint", nullable: true),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    SeoTitle = table.Column<string>(type: "varchar(200)", maxLength: 200, nullable: true),
                    SeoDescription = table.Column<string>(type: "varchar(400)", maxLength: 400, nullable: true),
                    PublishedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    ScheduledUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    Version = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_articles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_articles_articles_ParentId",
                        column: x => x.ParentId,
                        principalTable: "articles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_articles_categories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_articles_media_assets_FeaturedMediaId",
                        column: x => x.FeaturedMediaId,
                        principalTable: "media_assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_articles_users_AuthorId",
                        column: x => x.AuthorId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "article_revisions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    ArticleId = table.Column<long>(type: "bigint", nullable: false),
                    RevisionNo = table.Column<int>(type: "int", nullable: false),
                    Title = table.Column<string>(type: "varchar(300)", maxLength: 300, nullable: false),
                    BodyHtml = table.Column<string>(type: "longtext", nullable: false),
                    CreatedById = table.Column<long>(type: "bigint", nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_article_revisions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_article_revisions_articles_ArticleId",
                        column: x => x.ArticleId,
                        principalTable: "articles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_article_revisions_users_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "article_tags",
                columns: table => new
                {
                    ArticleId = table.Column<long>(type: "bigint", nullable: false),
                    TagId = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_article_tags", x => new { x.ArticleId, x.TagId });
                    table.ForeignKey(
                        name: "FK_article_tags_articles_ArticleId",
                        column: x => x.ArticleId,
                        principalTable: "articles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_article_tags_tags_TagId",
                        column: x => x.TagId,
                        principalTable: "tags",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_article_revisions_ArticleId_RevisionNo",
                table: "article_revisions",
                columns: new[] { "ArticleId", "RevisionNo" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_article_revisions_CreatedById",
                table: "article_revisions",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_article_tags_TagId",
                table: "article_tags",
                column: "TagId");

            migrationBuilder.CreateIndex(
                name: "IX_articles_AuthorId",
                table: "articles",
                column: "AuthorId");

            migrationBuilder.CreateIndex(
                name: "IX_articles_CategoryId",
                table: "articles",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_articles_FeaturedMediaId",
                table: "articles",
                column: "FeaturedMediaId");

            migrationBuilder.CreateIndex(
                name: "IX_articles_Kind_Slug",
                table: "articles",
                columns: new[] { "Kind", "Slug" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_articles_Kind_Status_PublishedUtc",
                table: "articles",
                columns: new[] { "Kind", "Status", "PublishedUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_articles_ParentId",
                table: "articles",
                column: "ParentId");

            migrationBuilder.CreateIndex(
                name: "IX_articles_Status_ScheduledUtc",
                table: "articles",
                columns: new[] { "Status", "ScheduledUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_categories_Slug",
                table: "categories",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_media_assets_Sha256",
                table: "media_assets",
                column: "Sha256",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_media_assets_UploadedById",
                table: "media_assets",
                column: "UploadedById");

            migrationBuilder.CreateIndex(
                name: "IX_tags_Slug",
                table: "tags",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_users_EmailHash",
                table: "users",
                column: "EmailHash");

            migrationBuilder.CreateIndex(
                name: "IX_users_Subject",
                table: "users",
                column: "Subject",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "article_revisions");

            migrationBuilder.DropTable(
                name: "article_tags");

            migrationBuilder.DropTable(
                name: "data_protection_keys");

            migrationBuilder.DropTable(
                name: "articles");

            migrationBuilder.DropTable(
                name: "tags");

            migrationBuilder.DropTable(
                name: "categories");

            migrationBuilder.DropTable(
                name: "media_assets");

            migrationBuilder.DropTable(
                name: "users");
        }
    }
}
