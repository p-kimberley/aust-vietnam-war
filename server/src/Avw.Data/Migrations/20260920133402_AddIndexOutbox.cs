using System;
using Microsoft.EntityFrameworkCore.Migrations;
using MySql.EntityFrameworkCore.Metadata;

#nullable disable

namespace Avw.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddIndexOutbox : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "index_outbox",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    Kind = table.Column<int>(type: "int", nullable: false),
                    EntityId = table.Column<long>(type: "bigint", nullable: false),
                    EsId = table.Column<long>(type: "bigint", nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    Attempts = table.Column<int>(type: "int", nullable: false),
                    NextAttemptUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    LastError = table.Column<string>(type: "varchar(1000)", maxLength: 1000, nullable: true),
                    FailedUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_index_outbox", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_index_outbox_FailedUtc_NextAttemptUtc",
                table: "index_outbox",
                columns: new[] { "FailedUtc", "NextAttemptUtc" });

            // Notes and pictures migrated from the old site keep its ids as their document ids in Elasticsearch, so anything new is
            // numbered from well above them. (MySQL ignores a value at or below the highest id already there, so this is safe to run
            // on a table that has content; it is meant for the empty table of a first install.)
            migrationBuilder.Sql("ALTER TABLE incident_notes AUTO_INCREMENT = 100000;");
            migrationBuilder.Sql("ALTER TABLE incident_media AUTO_INCREMENT = 100000;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "index_outbox");
        }
    }
}
