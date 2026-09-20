using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Avw.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPointsOfInterest : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "points_of_interest",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false),
                    Type = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                    Name = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: false),
                    Visible = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    Established = table.Column<int>(type: "int", nullable: true),
                    Details = table.Column<string>(type: "text", nullable: true),
                    Lat = table.Column<double>(type: "double", nullable: false),
                    Lon = table.Column<double>(type: "double", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_points_of_interest", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_points_of_interest_Visible",
                table: "points_of_interest",
                column: "Visible");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "points_of_interest");
        }
    }
}
