using System;
using Microsoft.EntityFrameworkCore.Migrations;
using MySql.EntityFrameworkCore.Metadata;

#nullable disable

namespace Avw.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCommunity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "casualty_links",
                columns: table => new
                {
                    ServiceNumber = table.Column<string>(type: "varchar(32)", maxLength: 32, nullable: false),
                    ContactId = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_casualty_links", x => new { x.ServiceNumber, x.ContactId });
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "casualty_submissions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    ContactId = table.Column<int>(type: "int", nullable: false),
                    ServiceNumber = table.Column<string>(type: "varchar(32)", maxLength: 32, nullable: true),
                    CasualtyType = table.Column<string>(type: "varchar(60)", maxLength: 60, nullable: false),
                    Comment = table.Column<string>(type: "varchar(4000)", maxLength: 4000, nullable: false),
                    SubmittedById = table.Column<long>(type: "bigint", nullable: true),
                    SubmittedByName = table.Column<string>(type: "varchar(200)", maxLength: 200, nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    Handled = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    HandledUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_casualty_submissions", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "incident_media",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    ContactId = table.Column<int>(type: "int", nullable: false),
                    MediaId = table.Column<long>(type: "bigint", nullable: false),
                    AttachedById = table.Column<long>(type: "bigint", nullable: true),
                    DateTaken = table.Column<DateOnly>(type: "date", nullable: true),
                    CreatedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_incident_media", x => x.Id);
                    table.ForeignKey(
                        name: "FK_incident_media_media_assets_MediaId",
                        column: x => x.MediaId,
                        principalTable: "media_assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "incident_notes",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    ContactId = table.Column<int>(type: "int", nullable: false),
                    AuthorId = table.Column<long>(type: "bigint", nullable: true),
                    AuthorName = table.Column<string>(type: "varchar(200)", maxLength: 200, nullable: false),
                    AuthorEmailHash = table.Column<string>(type: "char(64)", fixedLength: true, maxLength: 64, nullable: true),
                    Status = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    LatestVersionNo = table.Column<int>(type: "int", nullable: false),
                    ApprovedVersionNo = table.Column<int>(type: "int", nullable: true),
                    CommentsOpen = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    ModeratedById = table.Column<long>(type: "bigint", nullable: true),
                    ModeratedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_incident_notes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_incident_notes_users_AuthorId",
                        column: x => x.AuthorId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "media_likes",
                columns: table => new
                {
                    MediaId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_media_likes", x => new { x.MediaId, x.UserId });
                    table.ForeignKey(
                        name: "FK_media_likes_media_assets_MediaId",
                        column: x => x.MediaId,
                        principalTable: "media_assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_media_likes_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "tributes",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    ServiceNumber = table.Column<string>(type: "varchar(32)", maxLength: 32, nullable: false),
                    AuthorId = table.Column<long>(type: "bigint", nullable: true),
                    AuthorName = table.Column<string>(type: "varchar(200)", maxLength: 200, nullable: false),
                    AuthorEmailHash = table.Column<string>(type: "char(64)", fixedLength: true, maxLength: 64, nullable: true),
                    Message = table.Column<string>(type: "varchar(1000)", maxLength: 1000, nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tributes", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "incident_note_versions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    NoteId = table.Column<long>(type: "bigint", nullable: false),
                    VersionNo = table.Column<int>(type: "int", nullable: false),
                    Title = table.Column<string>(type: "varchar(200)", maxLength: 200, nullable: false),
                    Body = table.Column<string>(type: "text", nullable: false),
                    EditedById = table.Column<long>(type: "bigint", nullable: true),
                    EditedByName = table.Column<string>(type: "varchar(200)", maxLength: 200, nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_incident_note_versions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_incident_note_versions_incident_notes_NoteId",
                        column: x => x.NoteId,
                        principalTable: "incident_notes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "note_comments",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    NoteId = table.Column<long>(type: "bigint", nullable: false),
                    AuthorId = table.Column<long>(type: "bigint", nullable: true),
                    AuthorName = table.Column<string>(type: "varchar(200)", maxLength: 200, nullable: false),
                    AuthorEmailHash = table.Column<string>(type: "char(64)", fixedLength: true, maxLength: 64, nullable: true),
                    Body = table.Column<string>(type: "varchar(2000)", maxLength: 2000, nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_note_comments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_note_comments_incident_notes_NoteId",
                        column: x => x.NoteId,
                        principalTable: "incident_notes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_casualty_links_ContactId",
                table: "casualty_links",
                column: "ContactId");

            migrationBuilder.CreateIndex(
                name: "IX_casualty_submissions_ContactId",
                table: "casualty_submissions",
                column: "ContactId");

            migrationBuilder.CreateIndex(
                name: "IX_casualty_submissions_Handled_CreatedUtc",
                table: "casualty_submissions",
                columns: new[] { "Handled", "CreatedUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_incident_media_ContactId",
                table: "incident_media",
                column: "ContactId");

            migrationBuilder.CreateIndex(
                name: "IX_incident_media_ContactId_MediaId",
                table: "incident_media",
                columns: new[] { "ContactId", "MediaId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_incident_media_MediaId",
                table: "incident_media",
                column: "MediaId");

            migrationBuilder.CreateIndex(
                name: "IX_incident_note_versions_NoteId_VersionNo",
                table: "incident_note_versions",
                columns: new[] { "NoteId", "VersionNo" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_incident_notes_AuthorEmailHash",
                table: "incident_notes",
                column: "AuthorEmailHash");

            migrationBuilder.CreateIndex(
                name: "IX_incident_notes_AuthorId",
                table: "incident_notes",
                column: "AuthorId");

            migrationBuilder.CreateIndex(
                name: "IX_incident_notes_ContactId_Status",
                table: "incident_notes",
                columns: new[] { "ContactId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_incident_notes_Status",
                table: "incident_notes",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_media_likes_UserId",
                table: "media_likes",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_note_comments_AuthorEmailHash",
                table: "note_comments",
                column: "AuthorEmailHash");

            migrationBuilder.CreateIndex(
                name: "IX_note_comments_NoteId_CreatedUtc",
                table: "note_comments",
                columns: new[] { "NoteId", "CreatedUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_tributes_AuthorEmailHash",
                table: "tributes",
                column: "AuthorEmailHash");

            migrationBuilder.CreateIndex(
                name: "IX_tributes_ServiceNumber_CreatedUtc",
                table: "tributes",
                columns: new[] { "ServiceNumber", "CreatedUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "casualty_links");

            migrationBuilder.DropTable(
                name: "casualty_submissions");

            migrationBuilder.DropTable(
                name: "incident_media");

            migrationBuilder.DropTable(
                name: "incident_note_versions");

            migrationBuilder.DropTable(
                name: "media_likes");

            migrationBuilder.DropTable(
                name: "note_comments");

            migrationBuilder.DropTable(
                name: "tributes");

            migrationBuilder.DropTable(
                name: "incident_notes");
        }
    }
}
