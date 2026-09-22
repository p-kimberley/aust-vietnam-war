using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Avw.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddHonourRoll : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "honour_roll",
                columns: table => new
                {
                    ServiceNumber = table.Column<string>(type: "varchar(32)", maxLength: 32, nullable: false),
                    Name = table.Column<string>(type: "varchar(300)", maxLength: 300, nullable: false),
                    SortName = table.Column<string>(type: "varchar(300)", maxLength: 300, nullable: false),
                    SortKey = table.Column<string>(type: "varchar(300)", maxLength: 300, nullable: false),
                    Rank = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: true),
                    Corps = table.Column<string>(type: "varchar(150)", maxLength: 150, nullable: true),
                    Service = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: true),
                    BirthDate = table.Column<DateTime>(type: "date", nullable: true),
                    DeathDate = table.Column<DateTime>(type: "date", nullable: true),
                    BirthPlace = table.Column<string>(type: "varchar(150)", maxLength: 150, nullable: true),
                    BirthState = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: true),
                    BirthCountry = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: true),
                    NationalService = table.Column<bool>(type: "tinyint(1)", nullable: true),
                    Tours = table.Column<string>(type: "longtext", nullable: false),
                    SearchText = table.Column<string>(type: "varchar(500)", maxLength: 500, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_honour_roll", x => x.ServiceNumber);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_honour_roll_Corps",
                table: "honour_roll",
                column: "Corps");

            migrationBuilder.CreateIndex(
                name: "IX_honour_roll_Rank",
                table: "honour_roll",
                column: "Rank");

            migrationBuilder.CreateIndex(
                name: "IX_honour_roll_Service",
                table: "honour_roll",
                column: "Service");

            migrationBuilder.CreateIndex(
                name: "IX_honour_roll_SortKey",
                table: "honour_roll",
                column: "SortKey");

            // A MySQL full-text index, which EF Core has no way to describe. It serves the search of the roll by name (see HonourRollStore).
            migrationBuilder.Sql("CREATE FULLTEXT INDEX FT_honour_roll_SearchText ON honour_roll (SearchText);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX FT_honour_roll_SearchText ON honour_roll;");

            migrationBuilder.DropTable(
                name: "honour_roll");
        }
    }
}
