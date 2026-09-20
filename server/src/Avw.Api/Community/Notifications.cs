using System.Net;
using System.Net.Mail;
using System.Threading.Channels;
using Microsoft.Extensions.Options;

namespace Avw.Api.Community;

/// <summary>One email to the editors, for example "a note is waiting for approval".</summary>
public sealed record Notification(string Subject, string Body);

/// <summary>Tells the editors something. Never blocks the request that caused it, and never fails it.</summary>
public interface INotifier
{
    void Notify(Notification notification);
}

public sealed class SmtpOptions
{
    public const string Section = "Smtp";

    /// <summary>Leave empty to send nothing (notifications are then only written to the log).</summary>
    public string? Host { get; set; }

    public int Port { get; set; } = 587;
    public string? User { get; set; }
    public string? Password { get; set; }
    public bool UseSsl { get; set; } = true;

    /// <summary>The From address, for example <c>no-reply@vietnam-war.au</c>.</summary>
    public string From { get; set; } = "";
}

public sealed class NotificationOptions
{
    public const string Section = "Notifications";

    /// <summary>Who is told about new notes, pictures and casualty reports. The plan reads these from a Keycloak role instead; see the assumptions log.</summary>
    public string[] EditorEmails { get; set; } = [];

    /// <summary>The address links in the email point at.</summary>
    public string? SiteUrl { get; set; }
}

/// <summary>Sends email over SMTP from a queue, on a background thread, so a slow mail server never slows a visitor down.</summary>
public sealed class EmailNotifier(IOptions<SmtpOptions> smtp, IOptions<NotificationOptions> recipients, ILogger<EmailNotifier> logger)
    : BackgroundService, INotifier
{
    // A backlog beyond this means the mail server has been down a long time; dropping the oldest is better than growing without limit.
    private readonly Channel<Notification> _queue = Channel.CreateBounded<Notification>(
        new BoundedChannelOptions(200) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });

    public void Notify(Notification notification) => _queue.Writer.TryWrite(notification);

    /// <summary>Whether mail can be sent at all: a server, a From address and someone to send to.</summary>
    public bool CanSend => !string.IsNullOrWhiteSpace(smtp.Value.Host) && !string.IsNullOrWhiteSpace(smtp.Value.From) && recipients.Value.EditorEmails.Length > 0;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Email is optional. Without it nothing is lost: editors see what is waiting on the Studio's Moderation page.
        if (CanSend)
        {
            logger.LogInformation("Email notifications are on: {Count} editor address(es) will be told when something is waiting", recipients.Value.EditorEmails.Length);
        }
        else
        {
            logger.LogInformation("Email notifications are off (Smtp:Host, Smtp:From and Notifications:EditorEmails are not all set). Editors see what is waiting on the Studio's Moderation page");
        }

        await foreach (var n in _queue.Reader.ReadAllAsync(stoppingToken))
        {
            if (!CanSend)
            {
                logger.LogInformation("Notification not emailed (SMTP or recipients not configured): {Subject}", n.Subject);
                continue;
            }

            try
            {
                await SendAsync(n, stoppingToken);
            }
            catch (Exception ex) when (ex is SmtpException or InvalidOperationException or IOException)
            {
                logger.LogWarning(ex, "Could not email: {Subject}", n.Subject);
            }
        }
    }

    /// <summary>The message text, with <c>{site}</c> replaced by the public address so its links can be followed from an inbox.</summary>
    internal string Render(Notification n) => n.Body.Replace("{site}", (recipients.Value.SiteUrl ?? "").TrimEnd('/'));

    private async Task SendAsync(Notification n, CancellationToken ct)
    {
        var o = smtp.Value;
        using var client = new SmtpClient(o.Host, o.Port) { EnableSsl = o.UseSsl, Timeout = 20_000 };
        if (!string.IsNullOrWhiteSpace(o.User))
        {
            client.Credentials = new NetworkCredential(o.User, o.Password);
        }

        using var message = new MailMessage { From = new MailAddress(o.From), Subject = n.Subject, Body = Render(n) };
        foreach (var to in recipients.Value.EditorEmails)
        {
            message.Bcc.Add(to);                              // Blind copies: editors do not need to see each other's addresses.
        }

        await client.SendMailAsync(message, ct);
    }
}
