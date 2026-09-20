namespace Avw.Data.Entities;

/// <summary>A message sent through the site's feedback form. Editors read it in the Studio and mark it handled.</summary>
public class FeedbackMessage
{
    public long Id { get; set; }

    public string? Name { get; set; }

    /// <summary>Kept only so an editor can reply. Optional, and never shown publicly.</summary>
    public string? Email { get; set; }

    public string Message { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
    public bool Handled { get; set; }
    public DateTime? HandledUtc { get; set; }
}
