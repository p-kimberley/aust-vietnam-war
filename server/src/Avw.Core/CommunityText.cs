using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Avw.Api.Community;

/// <summary>Limits and names shared by the API (for what members write) and the importers (for what came from the old site).</summary>
public static class CommunityLimits
{
    public const int MaxTitle = 200;
    public const int MaxBody = 5000;
    public const int MaxComment = 1000;

    /// <summary>The name shown for someone whose name is not known.</summary>
    public const string DefaultAuthorName = "Member";

    public static readonly string[] CasualtyTypes = ["Killed in action", "Died of wounds", "Wounded in action", "Missing", "Other"];
}

/// <summary>How an email address is remembered: only as a hash, so old content can be matched to a verified sign-in without keeping the address.</summary>
public static class EmailHash
{
    public static string Of(string email) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(email.Trim().ToLowerInvariant())));
}

/// <summary>Cleans text typed by a member into safe plain text. Nothing here is ever markup.</summary>
public static partial class PlainText
{
    [GeneratedRegex(@"[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]")]
    private static partial Regex Unwanted();

    [GeneratedRegex(@"\n{3,}")]
    private static partial Regex Blanks();

    [GeneratedRegex(@"[ \t]+\n")]
    private static partial Regex TrailingSpaces();

    /// <summary>Normalises line breaks, removes control and direction-changing characters, and tidies blank lines. Returns "" for null.</summary>
    public static string Clean(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return "";
        }

        var s = Unwanted().Replace(text.Replace("\r\n", "\n").Replace('\r', '\n'), "");
        return Blanks().Replace(TrailingSpaces().Replace(s, "\n"), "\n\n").Trim();
    }
}
