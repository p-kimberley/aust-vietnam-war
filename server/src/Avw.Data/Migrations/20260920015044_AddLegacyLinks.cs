using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Avw.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLegacyLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "LegacyId",
                table: "tributes",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LegacyId",
                table: "note_comments",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LegacyId",
                table: "incident_notes",
                type: "int",
                nullable: true);

            migrationBuilder.AlterColumn<int>(
                name: "ContactId",
                table: "incident_media",
                type: "int",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "int");

            migrationBuilder.AddColumn<string>(
                name: "AuthorEmailHash",
                table: "incident_media",
                type: "char(64)",
                fixedLength: true,
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AuthorName",
                table: "incident_media",
                type: "varchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "Lat",
                table: "incident_media",
                type: "double",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LegacyId",
                table: "incident_media",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LegacyLikes",
                table: "incident_media",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<double>(
                name: "Lon",
                table: "incident_media",
                type: "double",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LegacyId",
                table: "casualty_submissions",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_tributes_LegacyId",
                table: "tributes",
                column: "LegacyId");

            migrationBuilder.CreateIndex(
                name: "IX_note_comments_LegacyId",
                table: "note_comments",
                column: "LegacyId");

            migrationBuilder.CreateIndex(
                name: "IX_incident_notes_LegacyId",
                table: "incident_notes",
                column: "LegacyId");

            migrationBuilder.CreateIndex(
                name: "IX_incident_media_AuthorEmailHash",
                table: "incident_media",
                column: "AuthorEmailHash");

            migrationBuilder.CreateIndex(
                name: "IX_incident_media_Lat_Lon",
                table: "incident_media",
                columns: new[] { "Lat", "Lon" });

            migrationBuilder.CreateIndex(
                name: "IX_incident_media_LegacyId",
                table: "incident_media",
                column: "LegacyId");

            migrationBuilder.CreateIndex(
                name: "IX_casualty_submissions_LegacyId",
                table: "casualty_submissions",
                column: "LegacyId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_tributes_LegacyId",
                table: "tributes");

            migrationBuilder.DropIndex(
                name: "IX_note_comments_LegacyId",
                table: "note_comments");

            migrationBuilder.DropIndex(
                name: "IX_incident_notes_LegacyId",
                table: "incident_notes");

            migrationBuilder.DropIndex(
                name: "IX_incident_media_AuthorEmailHash",
                table: "incident_media");

            migrationBuilder.DropIndex(
                name: "IX_incident_media_Lat_Lon",
                table: "incident_media");

            migrationBuilder.DropIndex(
                name: "IX_incident_media_LegacyId",
                table: "incident_media");

            migrationBuilder.DropIndex(
                name: "IX_casualty_submissions_LegacyId",
                table: "casualty_submissions");

            migrationBuilder.DropColumn(
                name: "LegacyId",
                table: "tributes");

            migrationBuilder.DropColumn(
                name: "LegacyId",
                table: "note_comments");

            migrationBuilder.DropColumn(
                name: "LegacyId",
                table: "incident_notes");

            migrationBuilder.DropColumn(
                name: "AuthorEmailHash",
                table: "incident_media");

            migrationBuilder.DropColumn(
                name: "AuthorName",
                table: "incident_media");

            migrationBuilder.DropColumn(
                name: "Lat",
                table: "incident_media");

            migrationBuilder.DropColumn(
                name: "LegacyId",
                table: "incident_media");

            migrationBuilder.DropColumn(
                name: "LegacyLikes",
                table: "incident_media");

            migrationBuilder.DropColumn(
                name: "Lon",
                table: "incident_media");

            migrationBuilder.DropColumn(
                name: "LegacyId",
                table: "casualty_submissions");

            migrationBuilder.AlterColumn<int>(
                name: "ContactId",
                table: "incident_media",
                type: "int",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "int",
                oldNullable: true);
        }
    }
}
