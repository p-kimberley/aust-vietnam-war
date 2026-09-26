using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Avw.Data.Migrations
{
    /// <inheritdoc />
    public partial class ArticleMarkdownBodies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // A plain rename: the provider's RenameColumn writes CHANGE ... DEFAULT '', which MySQL refuses for a text column.
            // The revisions' bodies are still HTML until the migrator (ArticleBodyConverter) converts them.
            migrationBuilder.Sql("ALTER TABLE `article_revisions` RENAME COLUMN `BodyHtml` TO `BodyMarkdown`;");

            // Added empty and then made required: MySQL gives a text column no default, which a required column needs for the rows
            // already there. The migrator (ArticleBodyConverter) then fills it from the HTML.
            migrationBuilder.AddColumn<string>(
                name: "BodyMarkdown",
                table: "articles",
                type: "longtext",
                nullable: true);

            migrationBuilder.Sql("UPDATE `articles` SET `BodyMarkdown` = '' WHERE `BodyMarkdown` IS NULL;");

            migrationBuilder.AlterColumn<string>(
                name: "BodyMarkdown",
                table: "articles",
                type: "longtext",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "longtext",
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BodyMarkdown",
                table: "articles");

            migrationBuilder.Sql("ALTER TABLE `article_revisions` RENAME COLUMN `BodyMarkdown` TO `BodyHtml`;");
        }
    }
}
