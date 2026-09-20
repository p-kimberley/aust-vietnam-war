using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Avw.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCommunitySearch : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // MySQL full-text indexes, which EF Core has no way to describe, so they are made here. They serve the search of notes (title and body of
            // each version; a query joins to the approved one) and of pictures (caption and credit). See CommunitySearch.
            migrationBuilder.Sql("CREATE FULLTEXT INDEX FT_incident_note_versions_Title_Body ON incident_note_versions (Title, Body);");
            migrationBuilder.Sql("CREATE FULLTEXT INDEX FT_media_assets_Caption_Credit ON media_assets (Caption, Credit);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX FT_media_assets_Caption_Credit ON media_assets;");
            migrationBuilder.Sql("DROP INDEX FT_incident_note_versions_Title_Body ON incident_note_versions;");
        }
    }
}
