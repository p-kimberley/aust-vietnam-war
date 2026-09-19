# Australia's Vietnam War — rebuild plan

Status: draft, consolidated 2026-09-19. Estimates are rough person-weeks for one experienced full-stack developer.

## 1. Goal

Rebuild the legacy site as a **standalone web application on supported technology**, with no WordPress.

- The **Battle Map** is the main feature: about 6,200 contacts (battles) from 1965–1971 on an interactive map, with incident notes, media, an honour roll, analytics and 3D terrain.
- **Article publishing** (blogging, with rich editing) is the one WordPress feature that must be ported, as an own-built CMS.
- Authentication moves to **Keycloak (OAuth2 / OIDC)**. The WordPress/PHP auth glue is removed.
- Deployed to Kubernetes with Helm. Look and feel: modernised and responsive, keeping a **vintage Vietnam War-era motif**.

### What the legacy system is

| Layer | Legacy | Notes |
|---|---|---|
| Web | Hand-coded JS, AngularJS 1, jQuery/jQuery UI, OpenLayers 3, Highstock | About 17.7k lines under `src/js/bm`, no tests. Cesium 3D mode was experimental and is dropped. |
| Server | PHP scripts in `src/php/bm`, MySQL stored procedures, WordPress cookie auth, `wp_mail` | Dual-writes to MySQL and Elasticsearch using Groovy scripts and a hardcoded API key. |
| API | .NET Framework 4.6.1 raw Elasticsearch proxy (`api` submodule) | Anonymous read of any index and query. Replaced, not extended. |
| Search/data | Elasticsearch 2.x | Now Elasticsearch 9, already loaded. |
| Hosting | WordPress theme template `page-battlemap.php` embedding `battle-map.html` | |

Latent bugs found and **not** to be ported: SQL injection in `delete-incident-note.php`, script injection in the approval-status updates, a PHP syntax error in `record-user-media-view.php`, a broken `stripos(...) === true` check, trusting client-supplied upload filenames. Committed secrets (writer API key, two Mapbox tokens) must be rotated regardless.

## 2. Decisions

| Area | Decision |
|---|---|
| Web app | Latest stable Angular (standalone components, signals, Router-driven URL state). **SSR** for public content; **client-only** lazy routes for `/battlemap` and `/studio`. One app so auth, design tokens and code are shared. |
| Map | **MapLibre GL JS** (BSD-licensed, no access token, no vendor calls; switched from Mapbox GL JS v3 on 2026-09-20) behind a thin `BasemapService`. Basemaps, terrain DEM and GeoServer layers come from a runtime-config catalogue (Helm values), so providers can be swapped. Native GL heatmap, clustering and 3D terrain replace the OpenLayers layer classes. |
| Charts | Apache ECharts (Highstock needs a commercial licence). |
| API | .NET 10 LTS Web API plus a separate one-replica **worker** deployment (same image). OpenAPI with a generated TypeScript client. Typed endpoints, no raw Elasticsearch passthrough. |
| Relational store | Dedicated database on the existing **MySQL 8.4 InnoDB Cluster**, via MySQL Router. |
| Search / map data | **Elasticsearch 9**. Also used as a search projection for articles, notes and people. |
| Identity | **Keycloak 26** (operator deployed), dedicated realm for this app, self-registration enabled. |
| Editor | **TipTap (ProseMirror)**, stored as **sanitised HTML**. Server-side allowlist sanitiser on every save. Verify the current licence terms at kickoff. |
| Media storage | Shared RWX volume (CephFS or NFS) for final images, plus a per-pod **RWO** scratch volume. See section 6. |
| Basemap styles | Absolute http(s) style URLs served by a tile server (currently TileServer GL at `tiles.hosting.gradata.com.au`: terrain, bright, light, dark, `ww2`). `mapbox://` styles cannot be loaded and the API refuses to start with one. |

## 3. Scope

### In scope

- **Public site** (Angular SSR): homepage, article list, article page, hierarchical pages (About, Team, Help), search, RSS, sitemap, Open Graph, structured data, a simple Send Feedback form with rate limiting.
- **Studio** (`/studio`): articles and workflow, editor, media library, community moderation, menus and settings.
- **Battle Map** (`/battlemap`): map, layers, filters and unit tree, unit follow track, timeline, analytics (13 charts), incident panel, honour roll and biography, poppy tributes, community notes, media, deep links.
- **Community features**: notes (with versions, comments, moderation), photos, casualty submissions, tributes.
- **Auth**: Keycloak realm, API-hosted login (BFF), roles, MFA for authors and above, a Keycloak theme matching the site.
- **Data migration** (Battle Map data only, see section 5).
- Helm charts and CI.

### Deferred

- **Air sorties and naval gunfire layers** (Phase 2b, about 1 week). They do not block the map MVP. Decide whether they must land before cutover.
- Reader comments on articles, video upload, a menu editor UI, article galleries, newsletter.

### Dropped

- WordPress content: posts, pages, post comments, feedback, users, sliders.
- BuddyPress (activity, members, groups, messages, xprofile), bbPress forums, Usernoise, Cesium 3D mode.
- Raw user-activity log (`user_activity`, about 270k rows with IPs) and IP addresses on tributes.

## 4. Architecture

```
vietnam-war.au (one host, path-based ingress)
 ├─ /                    avw-web   Angular SSR: home, articles, pages, help, search
 │   ├─ /battlemap         client-only lazy route (MapLibre GL, charts)
 │   └─ /studio            client-only lazy route (editor, media, moderation, admin)
 ├─ /api                 avw-api   .NET: map data, CMS, community, media, auth (BFF)
 │                                  ├─ Elasticsearch 9    map data and search projections
 │                                  ├─ MySQL 8.4          articles, community content, media metadata
 │                                  └─ media volume       final images (RWX)
 ├─ /media/*             served by avw-api from the media volume (immutable cache headers)
 ├─ /geoserver           GeoServer (raster tiles / WMTS)
 └─ auth.vietnam-war.au  Keycloak 26
avw-worker (1 replica): scheduled publishing, search sync, orphan sweeps
```

### 4.1 Authentication and roles

- The API hosts the OIDC login (Authorization Code with PKCE, confidential client). The session is an **HttpOnly, Secure, SameSite cookie**; the browser never sees tokens. Angular calls `/api/auth/me`. State-changing requests require a custom header in addition to SameSite.
- Data Protection keys are shared across API replicas (persisted, not per-pod).
- Roles: `member` (self-registered: notes, photos, tributes), `author` (writes and submits articles), `editor` (reviews, publishes, moderates), `admin` (settings). Roles are assigned in Keycloak; nobody is pre-created. **MFA is required for author and above.**
- Registration needs email verification plus a bot check (the old site had a real spam problem).
- The realm, clients and roles are declared in a `KeycloakRealmImport` resource in the Helm chart.
- **Legacy authors:** notes and media keep a stored display name and a hash of the author's email (no plaintext email). When someone registers or logs in with a verified matching email, their old content is linked to them, so they can edit and delete their own notes.
- Notification recipients (new pending notes) come from Keycloak role membership via a cached service-account query. The API sends email directly by SMTP; Keycloak sends its own verification and reset email.

### 4.2 CMS

- Draft → In review → Scheduled → Published → Archived. Authors submit; editors publish.
- Articles and pages share one table: slug, title, excerpt, HTML body, status, author, featured image, category, tags, publish and schedule dates, "feature on homepage" flag, SEO and Open Graph fields, parent and sort order for pages.
- Revisions with restore, autosave, optimistic concurrency, draft preview links.
- Public output: RSS, sitemap, canonical URLs, Open Graph, Article JSON-LD, cached with tag-based invalidation on publish.
- Editor features (MVP): headings, bold/italic/underline, lists, quotes, links, images (alt text prompt, caption, credit), video embeds (allowlist), tables, autosave, revisions, preview. Stretch: an embed node for a Battle Map contact card.
- Security: server-side HTML allowlist, embed allowlist, CSP with nonces, Angular `bypassSecurityTrustHtml` only on server-sanitised HTML.
- Pages are authored fresh in the new editor (no legacy content is migrated). Navigation comes from a settings file at launch.

### 4.3 Battle Map API (replaces `src/php/bm` and the raw proxy)

| Legacy | New |
|---|---|
| `/api/es/search/avw_contacts` (bulk scroll) | `GET /api/contacts` compact map payload with ETag and caching |
| ES aggregations from the browser (13 charts) | Typed endpoints sharing one filter DTO |
| `add-incident-note`, `update-incident-note`, `delete-incident-note`, `add-incident-note-comment`, `delete-incident-note-comment`, `update-incident-note-approval-status` | Notes, comments and moderation endpoints; edit history kept in `note_versions` |
| `upload-incident-media`, `update-media-approval-status`, `record-user-media-like`, `record-user-media-view` | Media endpoints (section 6) |
| `add-tribute`, `record-casualty-information` | Tributes and casualty-submission endpoints |
| `get-current-user`, `get-user-meta`, `get-logout-url`, `user-profile.php` | `/api/auth/*` and a small public author lookup |
| `log-user-activity` | Dropped (aggregate counters only if needed) |

Rules preserved: editors and admins auto-approve their own notes and media; everyone else is pending. Only the author or a privileged user may edit; only privileged users may delete or moderate. Deep-link URL parameters (`?incident=`, `?incident-note=`, `?at=`, `?layers=`, `?contact-filter=`, …) keep working.

### 4.4 Map UI notes

- Layout follows the legacy one (right icon rail, media filmstrip on the left, floating controls, minimap, scale bar, full-width waveform timeline, incident panel with statistics and honour roll) and reskins it. See the mockups.
- Layers: basemaps from the tile-server catalogue (Terrain, Vintage, Bright, Light, Dark), 1ATF topo overlays (Hillshaded, Classic) and Bases-and-towns from GeoServer, combat incident markers or concentrations, community content, and new **3D terrain** (DEM source, exaggeration, pitch, sky). The 1ATF rasters drape over the terrain; verify heatmap and marker behaviour on terrain early.
- The dataset is small enough (about 6,200 contacts) to load whole and filter client-side; analytics use server-side aggregations.

## 5. Data

### 5.1 Findings from the legacy dump (`.samples/mysql`, June 2017, MySQL 5.6)

Aggregates only; the dump contains personal data and is git-ignored.

- Elasticsearch 9 already holds **6,236** contacts, which matches the dump's visible contacts (6,286 total, 50 hidden).
- **Live cluster, checked read-only on 2026-09-20** (Elasticsearch 9.5.3, private CA, API key limited to `read` and `view_index_metadata` on `avw_contacts` and `avw_nomroll`). The live mappings match `.samples/elasticsearch` exactly (100 fields for contacts, 16 for the honour roll). Of the 6,236 contacts, **6,157 have a `Location`** and appear on the map; the other 79 are excluded. 51 plotted contacts list no friendly unit, and 556 distinct unit ids appear. The fields `Source_Hyperlink` and `Hidden` (contact or unit) **do not exist** in the index, so the incident panel's AWM link stays empty until they are reindexed. The cluster also holds `avw_air_operations` (about 8.7 million documents), `avw_sitra` (1.1 million), `avw_conga` (289,000) and `avw_incident_media` (493); the API key cannot read them yet, which Phase 2b (air and naval layers) and Phase 5 will need.
- Reference data lives in MySQL too: `contacts` (1965-05-29 to 1971-11-02), `units` (619), `unit_types`, `poi` (131), `nomroll_personnel` (60,798), `nomroll_tours` (104,565), `nomroll_honours`, `awm_honour_roll` (521), and the `contact_*` detail tables. The `es_*` views define the Elasticsearch document shapes.
- Community content: 230 notes (220 approved) with 378 versions and 46 comments; 353 media items (351 JPEG, 2 PNG, 143 MB); 267 tributes; 8 casualty submissions.
- WordPress: 21 posts, 30 pages, 300 users (5 staff), 147 comments (133 on the feedback form), 127 feedback items, 795 unactivated signups. None of this is migrated.

### 5.2 Migration scope

Migrated (Battle Map data only, through an idempotent, dry-run-capable `Avw.Migrator` console project):

- Reference tables, imported as-is with the charset fixed. The API indexer rebuilds Elasticsearch from the `es_*` view logic, so ES becomes a rebuildable projection.
- Community content: notes, versions, comments, media metadata with tags and likes, tributes (without IPs), casualty submissions.
- Legacy author display names and email hashes for account linking.

Not migrated: WordPress posts, pages, comments, feedback and users; BuddyPress and bbPress data; `user_activity`; `countryinfo_*`.

Files (handled by the project owner): `incident-media/` (353 files), `honour-roll/` portraits (`<ServiceNumber>.jpg`, 522 rows in `nomroll_portraits`). Check whether `nomroll_personnel_media.ImageUrl` (521 rows) points at local files or external links.

### 5.3 Technical notes for the migration

- **Do not restore the dump straight into the cluster.** MySQL 5.6 → 8.4 differs in charset (`utf8` → `utf8mb4`), zero dates and SQL mode. Load into a scratch MySQL first, then run the migrator.
- **InnoDB Cluster (Group Replication) requires a primary key on every table.** Several legacy link tables likely lack one.
- Hidden contacts (`Hidden = 1`) must never reach the API or Elasticsearch.
- The legacy analytics stored procedures and `countryinfo_*` are not needed.
- Verify Elasticsearch 9 mappings against the `es_*` views in Phase 0.

## 6. Media storage and uploads

Two volumes:

- **`media`**: shared **RWX** (CephFS or NFS), mounted in the API and worker pods; final images only, served at `/media/*`.
- **`scratch`**: per-pod **RWO** volume owned by the API pod handling the upload; uploads and processing only.

Flow:

1. Stream the upload into `scratch/incoming/{uploadId}.part` with a hard size cap; detect content type by magic bytes.
2. Process **in the same pod** (Magick.NET): auto-rotate, strip EXIF, resize to 1920×1080, JPEG quality 80 (legacy parity), generate thumbnail and `srcset` variants, compute the content hash.
3. Copy to a temp name in `media/.incoming/`, flush, then **rename** into `media/aa/<sha256>.jpg` (the temp file is on the same filesystem as its destination, so the rename is atomic). Content-hash names make files immutable and re-uploads no-ops.
4. Insert the database row (approved for editors and admins, otherwise pending) and delete the scratch files.

Details:

- Set `TMPDIR` and `MAGICK_TEMPORARY_PATH` to the scratch volume (ASP.NET buffers large multipart bodies to temp files). This also allows a read-only root filesystem.
- `maxConcurrentUploads × maxUploadBytes` (including working copies) must fit in the scratch size; the API answers 503 rather than filling it.
- A crashed pod loses its in-flight uploads; the client retries. The worker sweeps stale `media/.incoming/` files.
- The API writes and reads a marker file on both volumes at startup and fails readiness if either is read-only or root-squashed.
- Images only at launch. Video passthrough (no transcoding) is a config flag, off by default.

Helm values (sketch):

```yaml
media:                                  # shared: final images, served at /media
  mountPath: /var/lib/avw/media
  storage:
    type: pvc                           # pvc | existingClaim | nfs
    existingClaim: ""
    pvc: { storageClassName: "", accessModes: [ReadWriteMany], size: 20Gi }   # CephFS class
    nfs: { server: "", path: "" }
  keepOriginals: false                  # true = also keep the uploaded original (not publicly served)
scratch:                                # per-pod: uploads and processing
  mountPath: /var/lib/avw/scratch
  type: ephemeralPvc                    # ephemeralPvc | emptyDir
  ephemeralPvc:
    storageClassName: ""                # e.g. a Ceph RBD class
    accessModes: [ReadWriteOnce]        # ReadWriteOncePod also works if the CSI supports it
    size: 5Gi
  emptyDir: { sizeLimit: 5Gi }          # local dev
  maxUploadBytes: 26214400
  maxConcurrentUploads: 4
podSecurityContext: { fsGroup: 1654 }   # .NET images run as UID 1654; adjust for CephFS/NFS
```

`ephemeralPvc` gives each API pod its own PVC, created and deleted with the pod, so a plain Deployment works and rolling updates never hit multi-attach errors. Because scratch is RWO, another pod (such as the worker) cannot read it, so processing stays in the receiving pod.

## 7. Deployment

- Two charts: **`avw-api`** (API, worker, EF migration job) and **`avw-web`** (Angular SSR). MySQL, Elasticsearch, Keycloak and GeoServer are external, configured through values and secrets.
- Ingress on one host with path routing (see the diagram); TLS via cert-manager.
- Keycloak: `KeycloakRealmImport` for the realm, clients, roles and MFA policy; a custom theme (Keycloakify or plain CSS) matching the site.
- Observability: OpenTelemetry, health checks, structured logs. API rate limiting; CSP; audit log of Studio admin actions.
- Suggested repo layout: `web/` (Angular workspace), `api/` (solution: `Avw.Api`, `Avw.Worker`, `Avw.Migrator`, tests), `keycloak/` (realm resource, theme), `deploy/helm/{avw-api,avw-web}`, `docs/`. The legacy `src/`, `wp-content/`, `Dockerfile` and `api` submodule stay as reference until cutover, then are removed. Decide whether the new API lives in the existing `aust-vietnam-war-data-api` repository or in-tree.

## 8. Phases and estimates

| Phase | Scope | Est. (weeks) |
|---|---|---|
| 0. Discovery and design | Confirm Elasticsearch 9 mappings against the `es_*` views; feature inventory and baseline screenshots of the legacy map; finalise design system from the mockups | 2–3 |
| 1. Foundations | Repo, CI; API and web skeletons; Keycloak realm and API-hosted login; MySQL schema and migrations; SSR; Helm skeletons | 3–4 |
| 2. Map MVP | Contacts, heatmap, basemap and terrain catalogue, GeoServer layers, 3D toggle, incident panel, search, URL deep-link state, POIs (air and sea excluded) | 3.5–4.5 |
| 3. CMS and public site | Article API, workflow, revisions, scheduling, editor UI, media library and upload pipeline, homepage, pages, search, feeds, feedback form | 11–14 |
| 4. Filters, timeline, analytics | Unit tree, filters, unit track, timeline, 13 charts on a shared filter DTO | 5–6 |
| 5. Community features | Notes (versions, comments, moderation, viewer, notes tab), community media, honour roll, tributes, casualty submissions, email notifications | 4.5–5.5 |
| 6. Battle Map data migration | Reference-data import and indexer, community content, author linking | 2.5–3.5 |
| 7. Deploy and cutover | Helm hardening, end-to-end tests, load and accessibility checks, parallel run | 3 |
| **Total** | | **≈35–44** |
| 2b. Air and naval layers (deferred) | | ~1 |

With two people, the map track (phases 2, 4, 5) and the CMS track (phase 3) are independent after Phase 1, which roughly halves the calendar time.

**CMS MVP cut line.** MVP: draft/publish and roles, rich text with images, categories and tags, featured image, scheduling, basic revisions. Later: contact embeds, galleries, menu editor, reader comments.

## 9. Risks and open items

| Item | Notes |
|---|---|
| EF Core MySQL provider vs .NET 10 | Pomelo has historically lagged new .NET releases. Verify at kickoff; fallback MySqlConnector plus Dapper. |
| Map library (resolved) | Mapbox GL JS v3 renders nothing without an access token and depends on reaching Mapbox even for a self-hosted style, so it was replaced with MapLibre GL JS on 2026-09-20. Its worker and shared chunk are copied to `/vendor` and set explicitly, because the bundler cannot resolve the worker. |
| Vintage styles and tilesets | The vintage styles and tilesets live in two personal Mapbox accounts (`kimberleyp`, `gradata-systems`). MapLibre cannot load `mapbox://` resources, and Mapbox's terms do not allow using its hosted tiles from other libraries, so the vintage look must be re-created as a style on the tile server (the existing `ww2` style is a dark base to start from). Rotate the leaked Mapbox tokens regardless. |
| TipTap licence | Core is MIT; confirm any extension used. CKEditor and TinyMCE need licence keys or commercial terms. |
| InnoDB Cluster | Primary keys required; connect through MySQL Router's read/write port. |
| Storage classes | Need the RWX class (CephFS or NFS) and the RWO class for scratch. |
| 3D terrain | Works in MapLibre with heatmap and markers drawn over it, but the tile server has no elevation tileset. Development uses public Terrarium tiles (AWS Open Data); production needs a DEM source chosen and hosted (`map.terrain` in the Helm values). Check heatmap and marker behaviour on steep terrain. |
| Air and naval layers | Decide whether they must be in before cutover. |
| Legacy files | Owner is copying `incident-media/` and `honour-roll/`; confirm what `nomroll_personnel_media.ImageUrl` references. |
| Old-host redirects | `vietnam.unsw.adfa.edu.au` → new host needs UNSW DNS; outside this project. |

## 10. Reference material

- **UI mockups** (private design canvas, updated in place): https://claude.ai/artifact/Qn7fSjzn8RfJuLHWXZC6io. Battle Map boards (map, 3D and layers, filters, honour roll, charts, community notes flow, mobile, style guide) and site boards (homepage, articles, article, about/team, Studio, sign-in, register, mobile).
- **Legacy screenshots**: `.samples/screenshots/`. Source of truth for existing UX.
- **Legacy dump**: `.samples/mysql/austvietnam2-prod-20170611.sql`. Contains personal data; report aggregates only.
- **Live reference for the homepage**: https://vietnam-war.au/.
