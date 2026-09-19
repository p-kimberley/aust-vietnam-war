using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Avw.Data;

/// <summary>Lets <c>dotnet ef</c> create the context without a running host.</summary>
public class DesignTimeFactory : IDesignTimeDbContextFactory<AvwDbContext>
{
    public AvwDbContext CreateDbContext(string[] args)
    {
        var cs = Environment.GetEnvironmentVariable("ConnectionStrings__Default")
                 ?? "Server=localhost;Port=3306;Database=avw;User=avw;Password=avw";
        var options = new DbContextOptionsBuilder<AvwDbContext>().UseMySQL(cs).Options;
        return new AvwDbContext(options);
    }
}
