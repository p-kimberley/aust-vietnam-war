using System.Globalization;
using System.Text.Json.Nodes;
using Avw.Data.Entities;
using Avw.Data.Indexing;

namespace Avw.Indexing;

/// <summary>
/// Builds the documents. Their fields and names are the ones the live indexes already have (<c>avw_incident_notes</c>,
/// <c>avw_incident_media</c>), so whatever reads those indexes keeps working. Content migrated from the old site (recognised by
/// its old id) already has a document with fields this site cannot rebuild, such as the old author id, so for it only the fields
/// this site owns are sent, and the rest are left alone.
/// </summary>
public static class IndexDocuments
{
    /// <summary>The old site's approval values: 1 approved, 0 rejected, -1 waiting for a moderator.</summary>
    public static int ApprovalValue(ModerationStatus status) => status switch { ModerationStatus.Approved => 1, ModerationStatus.Rejected => 0, _ => -1 };

    public static int ApprovalValue(MediaStatus status) => status switch { MediaStatus.Approved => 1, MediaStatus.Rejected => 0, _ => -1 };

    /// <summary>ISO 8601 in UTC, which the indexes' date fields read.</summary>
    public static string Time(DateTime utc) => DateTime.SpecifyKind(utc, DateTimeKind.Utc).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);

    /// <summary>
    /// A note as the public sees it: its approved text if it has ever been approved (an edit waiting for a moderator does not show, here
    /// or on the site), otherwise its newest text with the status it is waiting in. <paramref name="location"/> is where the incident
    /// is, when known.
    /// </summary>
    public static JsonObject Note(IncidentNote note, (double Lat, double Lon)? location)
    {
        var shown = note.Versions.FirstOrDefault(v => v.VersionNo == (note.ApprovedVersionNo ?? note.LatestVersionNo))
                    ?? note.Versions.OrderByDescending(v => v.VersionNo).First();
        var approval = note.ApprovedVersionNo is not null ? 1 : ApprovalValue(note.Status);

        var doc = new JsonObject
        {
            ["IncidentId"] = note.ContactId,
            ["Title"] = shown.Title,
            ["Body"] = shown.Body,
            ["Created"] = Time(note.CreatedUtc),
            ["Modified"] = Time(note.UpdatedUtc),
            ["ApprovalStatus"] = approval,
        };

        if (note.LegacyId is null)
        {
            if (note.AuthorId is not null)
            {
                doc["Author"] = new JsonObject { ["Id"] = note.AuthorId, ["Name"] = note.AuthorName };
            }

            if (shown.EditedById is not null)
            {
                doc["Editor"] = shown.EditedById;
            }

            if (location is { } at)
            {
                doc["Location"] = new JsonObject { ["lat"] = at.Lat, ["lon"] = at.Lon };
            }
        }

        return doc;
    }

    /// <summary>
    /// A picture attached to an incident or a place, or null when it is not to be in the index: only approved pictures are, because the
    /// pictures index carries no approval field for a reader to filter on.
    /// </summary>
    public static JsonObject? Media(IncidentMedia link, MediaAsset asset, string? uploaderName, DateTime now)
    {
        if (asset.Status != MediaStatus.Approved)
        {
            return null;
        }

        var doc = new JsonObject
        {
            ["Description"] = asset.Caption,
            ["Attribution"] = asset.Credit,
            ["Modified"] = Time(now),
        };

        if (link.ContactId is not null)
        {
            doc["FeatureId"] = link.ContactId;
        }

        if (link.Lat is not null && link.Lon is not null)
        {
            doc["Location"] = new JsonObject { ["lat"] = link.Lat, ["lon"] = link.Lon };
        }

        if (link.DateTaken is { } taken)
        {
            doc["DateTaken"] = taken.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        if (link.LegacyId is null)
        {
            // The file itself, which for the old site's pictures is already described (under the old site's paths).
            doc["FileName"] = asset.Sha256 + ".jpg";
            doc["FileExtension"] = "jpg";
            doc["MimeType"] = asset.ContentType;
            doc["Path"] = $"/media/{asset.Sha256[..2]}/{asset.Sha256}.jpg";
            doc["Size"] = asset.ByteSize;
            doc["Created"] = Time(link.CreatedUtc);
            doc["Author"] = new JsonObject { ["Id"] = asset.UploadedById, ["Name"] = link.AuthorName ?? uploaderName };
        }

        return doc;
    }
}
