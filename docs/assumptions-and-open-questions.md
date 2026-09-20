# Assumptions and open questions

Kept while working unattended, so they can be resolved together afterwards. Newest first within each phase. Each item says
what was assumed, why, and what to change if the assumption is wrong. Nothing here blocks the work; each is a default
that is easy to flip.

## Working method

- Work is on **stacked feature branches**, one per phase, each started from the previous one, with regular commits:
  `feature/phase-2-map-finish` → `feature/phase-3-cms` → `feature/phase-4-analytics` → `feature/phase-5-community` →
  `feature/phase-6-migration` → `feature/phase-7-deploy`. Nothing has been merged into `develop`, and nothing has been
  pushed. Merge in that order (each branch contains the ones before it).
- The live Elasticsearch cluster was used **read-only** (the API key cannot write). Nothing was written to any shared
  system. MySQL work uses a local scratch container only.

## Phase 2: map

| # | Assumption / gap | Default taken | Change it by |
|---|---|---|---|
| 2.1 | Vintage is the **default** basemap (the brief asks for a vintage motif). | `vintage` has `default: true` in `appsettings.Development.json` and Helm `map.basemaps`. | Move `default: true` to another basemap. |
| 2.2 | **GeoServer overlays** (1ATF topo, bases and towns): no GeoServer URL or layer names were provided. | `map.overlays` is empty; an example is in `values.yaml`. The Layers tab already lists overlays from config. | Give me the WMTS/WMS URL and layer names, or fill `map.overlays`. |
| 2.3 | **Elevation for 3D terrain**: the tile server has no DEM tileset. | Development uses public Terrarium tiles (AWS Open Data); Helm `map.terrain` is `null`, so the 3D switch is hidden in a deployed cluster. | Host a DEM (or accept AWS Terrarium for production) and set `map.terrain`. |
| 2.3b | The **vintage font package** (`deploy/map-styles/fonts`) has been generated but is installed on your tile server only when you copy it there. Until then labels in the deployed style fall back to whatever the server has. | The style's font stacks end in Noto Sans, which is already installed. | Copy `fonts/glyphs/*` (or `ttf/*`) into the server's fonts directory. |
| 2.4 | Courier Prime and Stardos Stencil (the site's own typewriter and stencil faces) **cannot label the map**: they lack about 80% of Vietnamese diacritics. | Noto Serif, IBM Plex Mono and Saira Stencil One (all OFL, full Vietnamese) are used instead. | Say if you want different fonts. |
| 2.5 | Contacts without a `Location` (79 of 6,236) are **not on the map** and their incident detail returns 404. | Excluded, as the legacy map did. | Tell me if they should be reachable some other way (for example from search). |
| 2.6 | `Source_Hyperlink` and `Hidden` **do not exist** in the live index. | The AWM link field is read if present, so it appears once reindexed. | Reindex with the field, or drop the link. |
| 2.7 | Legacy `?contact-filter=` links are **not** honoured (you said they need not be). | New readable parameters. | n/a |
| 2.8 | Unit tree labels (for example `D Coy`) come from `Title` + `ShortTypeName`; 34 parent units are synthetic groups named from `Path`. | Built as described in `UnitTreeBuilder`. | n/a |
| 2.9 | **Points of interest**: the legacy map only drew fire support bases (`FSB`, `FSPB`) and hid rows with `Visible = 'N'`. | All `Visible = 'Y'` rows are shown (97 FSB, 14 FSPB and 2 landing zones), on by default, under the contacts. Hidden rows stay in the table but never reach the API. | Change the filter in `PoiEndpoints`, or the default in `showPois`. |
| 2.10 | POI history text was HTML with external images (Google proxy URLs). | Reduced to plain text on import; images dropped. | Say if the images should be brought over. |
| 2.11 | 7 legacy POI rows have no name (all hidden fire support bases). | Skipped by the importer and counted in its report. | n/a |
| 2.12 | **Search**: incidents are found by every word in the report (top 8 by relevance, with the total), bases by name locally. Units and places are not searchable yet. | As described; shares the per-client rate limit (60 a minute) with the filter's report search. | Tell me which other things should be searchable (units, honour roll names, media). |
| 2.13 | A **scratch MySQL 5.7** container (`avw-scratch-mysql`, port 3308) holds the full legacy dump, which contains personal data. The dev MySQL 8.4 (`avw-dev-mysql-1`, port 3307) holds the schema plus the imported POIs. | Both run locally in Docker; nothing is exposed beyond localhost. | `docker rm -f avw-scratch-mysql` when the migration work is done. |

## Phase 3: content, Studio and media

| # | Assumption / gap | Default taken | Change it by |
|---|---|---|---|
| 3.1 | **Who can do what.** The plan says "authors submit; editors publish". | An author writes and edits **their own drafts** only. Once submitted for review they cannot edit (they can withdraw it back to draft). Editors and admins edit anything, publish, schedule, archive, create pages, choose web addresses and feature items on the home page. Only a draft or archived item can be deleted. | `ArticleService.Transitions` and `CanEdit`. |
| 3.2 | **Bylines are public.** The author's display name (from Keycloak `name`) is shown on articles and in the feed. | Yes. | Drop `AuthorName` from `ArticleCard`/`ArticleView` or let authors set a byline. |
| 3.3 | **Navigation** comes from the published page tree (top-level pages after "Stories"), not from a separate menu editor or a settings file. | Order is the page's "order among siblings", then title. Pages nest up to 5 deep; a page's address is its parent chain, and page slugs are unique across all pages. | Add a menu editor later if you want links that are not pages. |
| 3.4 | **Reserved first path segments** so a page cannot shadow the application: `api, studio, battlemap, articles, media, forbidden, feedback, feed, sitemap, login, logout, vendor, assets`. | A page with one of these names gets `-page` added, or is refused if typed. | `Slugs.Reserved` (API) and `RESERVED` in `cms-page.ts` (web); keep both in step. |
| 3.5 | **Revisions** are folded together: saves by the same person within 10 minutes share one revision, otherwise autosave would create one every few seconds. Restoring always makes a new revision. Nothing is ever pruned. | 10 minutes. | `ArticleService.RevisionWindow`; add pruning if history grows large. |
| 3.6 | **Preview** is inside the editor and shows the text after the server has cleaned it. Shareable draft preview links (in the plan) are **not** built. | In-editor only. | Needs a signed-token route; say if you want it. |
| 3.7 | **Public caching** is a short shared TTL (60 s, plus 5 min stale-while-revalidate), not the plan's tag-based invalidation. | A publish shows within a minute. | Add an invalidation hook when there is a cache in front. |
| 3.8 | **Media served by the API** at `/media` (ingress route added), immutable one-year caching. A picture's address is its content hash, so a *pending* picture is reachable by anyone who has the address, though nothing links to it. Only an **approved** picture can be an article's main picture; pending ones may be inserted in the body. | As described. | Serve only approved files (needs a lookup per request), or require approval before body use. |
| 3.9 | **Accepted pictures**: JPEG, PNG and WebP up to 25 MB and 100 megapixels, identified from their own bytes. GIF, HEIC and SVG are refused. Output is a progressive JPEG (quality 80, at most 1920×1080, never enlarged, EXIF and colour profiles stripped, transparency becomes white) plus a 480 px thumbnail. **Originals are not kept** (`keepOriginals` in Helm is not implemented). No `srcset` variants beyond the thumbnail. | As described. | `MediaOptions`, `MediaProcessor`. |
| 3.10 | **Stale temporary files**: the worker does not yet sweep `media/.incoming/` (a crashed upload can leave a file there). | Left for Phase 7. | n/a |
| 3.11 | **Image alt text** comes from the picture's caption when inserted; there is no per-image alt prompt, no `figure` with visible caption in the editor, and no Battle Map contact-card embed (a stretch item in the plan). | As described. | Extend `RichText`. |
| 3.12 | **Site name and description** ("Australia's Vietnam War", one description sentence) are set in code/config (`Site:Name`); structured data is `Article` only (no `Organization` or `BreadcrumbList`). | As described. | `Seo` service and `CmsEndpoints`. |
| 3.13 | **`PUBLIC_URL`** must be set on the web deployment (Helm `publicUrl`, default `https://<host>`) or canonical links, Open Graph URLs, `robots.txt` and the sitemap use the wrong address. | Helm derives it from `host`. | Set `publicUrl`. |
| 3.14 | **Search** covers published *articles* only (title, summary, text; simple substring match, newest first), not pages, and is not ranked. | As described. | Use Elasticsearch later if wanted. |
| 3.15 | **Feedback form**: messages are stored and shown to editors in the Studio (Feedback tab). **No email is sent** because no SMTP details were given. The optional email address is kept in plain text so an editor can reply, with no retention limit. Limit is 5 messages per visitor per 10 minutes; a hidden decoy field catches simple bots. | As described. | Provide SMTP settings for notifications; decide a retention period. |
| 3.16 | **WordPress content** (posts, pages, comments, feedback) is **not migrated**, as the plan says. Pages are written fresh in the Studio. | n/a | n/a |
| 3.17 | **Keycloak chart removed** at your instruction; the realm definition moved to `deploy/keycloak/avw-realm.json` (the local dev stack still imports it). Its placeholders are `${AVW_PUBLIC_URL}` and `${AVW_CLIENT_SECRET}`. | You apply it through your operator. | n/a |
| 3.18 | **Timestamps** now read back as UTC (`Z`), which the database does not record. All stored times are UTC. | Convention only, no schema change. | n/a |
| 3.19 | Sample rows were added to the **local dev MySQL** for checking (user 900, category 900, articles 9000-9004). They are not in any migration. | Left in the dev database. | `DELETE FROM articles WHERE Id BETWEEN 9000 AND 9010; DELETE FROM categories WHERE Id=900; DELETE FROM users WHERE Id=900;` |
| 3.20 | The Studio was checked in a real browser (Chrome) against a **mocked API** because signing in needs Keycloak. The API is covered by tests that fake the signed-in user. | As described. | Try it once with real logins. |

## Later phases

Added as the work proceeds.
