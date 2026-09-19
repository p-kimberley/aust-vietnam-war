namespace Avw.Data.Entities;

public class Category
{
    public long Id { get; set; }
    public string Slug { get; set; } = "";
    public string Name { get; set; } = "";
}

public class Tag
{
    public long Id { get; set; }
    public string Slug { get; set; } = "";
    public string Name { get; set; } = "";
}

public class ArticleTag
{
    public long ArticleId { get; set; }
    public Article Article { get; set; } = null!;
    public long TagId { get; set; }
    public Tag Tag { get; set; } = null!;
}
