# Runbook

How to install, release, check and (if needed) undo the site. For why it is built this way, see `rebuild-plan.md`; for choices
made without asking, see `assumptions-and-open-questions.md`.

## 1. What runs where

| Piece | What it is | Where |
|---|---|---|
| `avw-web` | Angular server-rendered site (Node, port 4000) | Helm chart `deploy/helm/avw-web`, 2 replicas |
| `avw-api` | .NET API (port 8080): map data, articles, community, sign-in | `deploy/helm/avw-api`, 2 replicas |
| `avw-api-worker` | Scheduled publishing and clearing stale upload files | same chart, **exactly one** replica |
| `avw-api-migrate` | Applies database migrations before every install and upgrade | same chart, a Helm hook Job |
| MySQL 8.4 | Articles, notes, pictures (metadata), tributes, sign-in keys | external (InnoDB Cluster is fine: every table has a primary key) |
| Elasticsearch 9 | Contacts and the nominal roll. **Read only.** Not written by this project | external |
| Keycloak 26 | Sign-in, roles, MFA | external, run by the Keycloak Operator |
| Tile server / GeoServer | Map base layers | external |

One host serves everything. The ingress sends `/api` and `/media` to the API and everything else to the web pods. The web pods
call the API inside the cluster (`apiInternalUrl`) when they render a page.

Pictures live on a shared ReadWriteMany volume (`media`, mounted in the API and the worker). Each API pod also has its own
scratch volume for uploads in progress.

## 2. Before the first install

1. **Keycloak.** Import `deploy/keycloak/avw-realm.json` through the operator. It defines the realm, the confidential `avw-api` client
   (the API hosts the sign-in for the site, so there is no separate web client), the roles `member`, `author`, `editor` and `admin`
   (each includes the one before) and the MFA requirement for `author` and above. Set the `avw-api` client secret and put the
   same value in the API secret (below). Add the site's public host to the client's redirect URIs.
2. **MySQL.** Create a database `avw` and a user with full rights on it (the migrations create the tables).
3. **Elasticsearch.** Create an API key with `read` and `view_index_metadata` on `avw_contacts` and `avw_nomroll`. If the cluster's
   certificate comes from a private CA, put the CA in a Secret (key `ca.crt`) and name it in `elasticsearch.caSecret`.
4. **Key-protection certificate.** Session cookies are signed with keys stored in MySQL and encrypted with a certificate:

   ```
   openssl req -x509 -newkey rsa:3072 -nodes -keyout k.pem -out c.pem -days 3650 -subj "/CN=avw-key-protection"
   openssl pkcs12 -export -inkey k.pem -in c.pem -out key-protection.pfx -passout pass:<password>
   kubectl create secret generic avw-key-protection --from-file=key-protection.pfx
   ```

   Keep the password. Losing the certificate signs everyone out and makes the stored keys unreadable (they are then replaced).
5. **The API secret** (`secrets.existingSecret`, default `avw-api`), created out of band:

   | Key | Value |
   |---|---|
   | `ConnectionStrings__Default` | `Server=<router>;Port=6446;Database=avw;User=avw;Password=...` |
   | `Auth__ClientSecret` | the `avw-api` client secret from Keycloak |
   | `DataProtection__CertificatePassword` | the `.pfx` password |
   | `Elasticsearch__ApiKey` | the base64 key from step 3 |
   | `Smtp__Password` | optional: only when email is turned on and `smtp.user` is set |
   | `ConnectionStrings__Legacy` | only for the one-off import (section 4) |

6. **Values.** Copy the defaults and set at least: `host`, `auth.authority`, `elasticsearch.url`, `map.basemaps` (and `overlays`,
   `terrain` if used), `media.storage` (the RWX class or NFS export), `ingress.className` and TLS, and for `avw-web` the same `host`.
   Email to editors is **optional** and can wait (section 7); nothing needs setting for the site to run.
7. **Images.** `docker build -t <registry>/avw-server:<tag> server/` and `docker build -t <registry>/avw-web:<tag> web/`.
   The server image is about 370 MB and holds the API, worker and migrator. Both run as non-root with a read-only root filesystem.

## 3. Install and upgrade

```
helm upgrade --install avw-api deploy/helm/avw-api -f values-api.yaml --set image.tag=<tag>
helm upgrade --install avw-web deploy/helm/avw-web -f values-web.yaml --set image.tag=<tag>
node deploy/smoke/smoke.mjs https://<host>
```

The migration Job runs first and must succeed, or the release stops before any new pod starts. Keep migrations additive (new
tables, new nullable columns) so the previous release still works against the new schema; a release that has to remove
something is done in two releases.

**Roll back** with `helm rollback avw-api <revision>` (and `avw-web`). That is safe when the migrations since then were additive,
as above; read them before rolling back. If a migration itself was wrong, restore the database from backup rather than editing it by hand.

**Checking a release.** `deploy/smoke/smoke.mjs` (22 checks, read-only) confirms the site, API, Elasticsearch, database and media
storage are all reachable and the security headers are on. `deploy/smoke/browser-checks.mjs` opens the main pages in Chrome and
looks for accessibility problems, content-security-policy violations and script errors (see its header for how to run it).

## 4. Bringing the old content across

Only the Battle Map's community content is migrated (WordPress posts, pages, comments and users are not). The old database is a
MySQL 5.6 dump that contains personal data: keep it off shared machines and never print rows.

1. Load a **current** dump into a **scratch** MySQL (not the new database). It only needs to be readable by the import. The June 2017 dump is
   missing what was added since: at least 140 pictures from 2018 (assumptions 6.17).
2. Give the API secret a `ConnectionStrings__Legacy` with read-only access to that scratch database. If it is an old MySQL
   (5.x) and the connection fails with "Cannot determine the frame size", add `;SslMode=Disabled` (the scratch server is inside the cluster).
3. Points of interest: `import-poi`. Community content: `import-community`. Run each **as a dry run first** (the default in the chart):

   ```
   helm upgrade avw-api deploy/helm/avw-api --reuse-values --set import.enabled=true --set import.command=import-community
   kubectl logs job/avw-api-api-import-<revision>
   ```

   Expected counts from the June 2017 dump: 230 notes, 46 comments, 267 poppies (247 of them laid with no message, kept as
   poppies with no words), 8 casualty reports and 213 person-to-incident links.
   3a. The **nominal roll** (the people who died in service) is copied from the legacy Elasticsearch index into MySQL with `import-roll`. It reads
   Elasticsearch, not the legacy MySQL, so it needs no `ConnectionStrings__Legacy`, but the job is given the chart's `elasticsearch.*` values
   and the API key from the secret (a read-only key is enough). Expected: 522 added. Run it before the site goes live, and again if the old index is
   corrected; it never removes anybody, so the table can be added to or corrected once Elasticsearch is retired.
4. Run for real with `--set import.dryRun=false`. A second run must report **0 added** (everything "unchanged").
5. Pictures: copy the old `incident-media/` folder onto a volume, name it in `import.legacyFiles`, and run again. Files that are
   missing are skipped and reported, so it can be repeated as more arrive. The dump lists 353 pictures. Each is checked, straightened,
   resized to fit 1920x1080, stored as a JPEG under its content hash in `uploads/<first two hex>/` on the media volume, with a 480 px thumbnail. The job runs as UID 1654, so that user must be able to read the legacy folder (on a Synology NFS share, squash all users to an account that can, or give Everyone read). Expected from the 2017 dump: 350 added (one is the same
   picture twice on an incident, and 2 were rejected by a moderator and are left out), 337 distinct files, about 42 MB. Most (329) have no incident and appear only on the map's
   picture layer, once that is built.
6. Portraits for the honour roll are separate: put `<service number>.jpg` files in `portraits/` inside the media volume.
7. Authors are matched by a hash of their email. Nothing else about them is kept. When they sign in with the same **verified** email
   they see their old notes, comments, tributes and pictures as their own.

After the real import the Studio's Moderation page shows what is waiting (one note was waiting in the old site; 9 notes were rejected and stay visible only to their authors and editors).

## 5. Security

- **Headers.** The API sends `nosniff`, `X-Frame-Options: DENY`, a strict `Content-Security-Policy` for its own responses, a
  `Referrer-Policy` and a `Permissions-Policy`, and HSTS when the request came in over HTTPS. The web server sends the same
  set and the page policy below.
- **Content security policy for pages.** It starts as `report-only` (`csp.mode` in the web chart). Browsers post anything that
  would have been blocked to `/api/csp-report`, and the API logs one warning line for each (`CSP script-src-elem blocked ...`).
  Watch the API logs through a normal week, including Studio use and a few embedded videos. If they stay quiet set `csp.mode: enforce`.
  Add hosts the map needs to `csp.extraOrigins` (the tile server, satellite imagery, GeoServer and elevation hosts are set by default; raster tiles need it too). It was checked
  in Chrome with the policy **enforced**: the home page, stories, feedback form, Battle Map with the incident panel and the charts
  raised no violations. Not checked: the Studio, and articles that embed something other than YouTube or Vimeo.
- **Fonts.** The three type families are the site's own files (`web/src/fonts.css`), so readers' browsers contact nothing but the
  site for them, and the policy allows no font host.
- **Scripts.** Inline scripts are allowed only by hash, measured from each page as it is rendered. There is no `unsafe-eval`
  and no inline event handlers except the one Angular uses to load its stylesheet.
- **Rate limits** (per signed-in person, else per address): tributes 10 an hour, other community writes 30 a minute, feedback,
  policy reports 30 a minute.
- **Anti-forgery.** Every state-changing request must carry `X-Requested-With: avw` (the browser app does); the only exception is
  the policy-report endpoint, which changes nothing.
- **Secrets** are only in Kubernetes Secrets. To rotate the `avw-api` client secret, change it in Keycloak and the secret, then
  restart the API. The key-protection certificate can be replaced the same way; sessions signed with old keys keep working until
  the keys expire.
- **Uploads** are identified from their own bytes, decoded with only that format, stripped of metadata, re-encoded and stored under a
  hash. Non-pictures and oversize files are refused, and the API answers 503 rather than fill the scratch volume.

## 6. Backups

| What | How | Notes |
|---|---|---|
| MySQL | nightly `mysqldump --single-transaction` or the cluster's own backup, plus binary logs | The only irreplaceable data besides pictures |
| Media volume | snapshot the RWX volume, or `rsync` it | Files are named by hash and never change; the chart keeps the PVC when the release is deleted |
| Keycloak | the operator's realm export | Users live in Keycloak |
| Secrets | your secret store | Especially the key-protection certificate and password |
| Elasticsearch | none needed from here | This project only reads it |

Restore test: restore MySQL and the media volume into a scratch namespace, run `smoke.mjs` against it, and open a note and a picture.

## 7. Operating it

- **Health.** `/api/health/live` (process is up), `/api/health/ready` (database and media storage are usable), `/healthz` on the web pods.
  Readiness fails if the media volume is read-only or the API cannot write to it.
- **Search of notes and pictures** is MySQL full-text (indexes made by the migration `AddCommunitySearch`; creating them rebuilds two small tables, which takes
  well under a second at today's size). It relies on MySQL's default full-text settings (`innodb_ft_min_token_size` 3 and the built-in stop word list). If a
  search for a word that is plainly in a note finds nothing, check those two settings first. Adding a word to the search box needs no configuration.
- **Worker.** Publishes scheduled articles every 30 seconds and, every 10 minutes, deletes files in `media/.incoming/` older than 6 hours
  (uploads that a dying pod left behind) and health markers older than 2 days (one per API pod name). Settings: `Media__IncomingMaxAgeMinutes`,
  `Media__HealthMarkerMaxAgeDays`. Never run two workers.
- **Scaling.** The API and web pods are stateless; raise `api.replicas` and `replicas`. A pod disruption budget keeps one up
  during maintenance. Contacts are cached in each API pod for a short time, which is what makes the map list cheap.
- **Logs to know.** `CSP ... blocked ...` (policy would block something), `Published N scheduled article(s)`, `Swept N stale file(s)`.
- **Email is optional and off until you set it up.** With `smtp.host`, `smtp.from` and `notifications.editorEmails` not all set, the API says
  so once at start-up ("Email notifications are off ...") and logs one line for each item waiting; nothing fails. Editors see everything
  on the Studio's Moderation page. To turn it on later, set those three (and `smtp.user` with `Smtp__Password` in the secret if the server needs a
  login), plus `notifications.siteUrl` so the links in the email work, then upgrade the chart; the start-up line then reads "Email notifications are on".

Common problems:

| Symptom | Likely cause |
|---|---|
| Web pod restarts, log says the host is not allowed | `host` in the web values differs from the ingress host |
| Sign-in loops | the ingress host is missing from the Keycloak client's redirect URIs, or the API does not receive the forwarded headers |
| API not ready | MySQL unreachable, or the media volume is read-only or root-squashed (check `fsGroup` and the export options). "The media volume is not writable" with the mount owned by root usually means the storage ignores `fsGroup` (inline NFS, or a CSI driver with `fsGroupPolicy: None`): `chown 1654:1654` the share once, or set `media.fixPermissions.enabled=true` (a root init container; not allowed under the "restricted" Pod Security level, and no use on a root-squashed export) |
| Map loads but shows no contacts | the Elasticsearch key or CA is wrong; the API log names the request |
| Basemap does not draw | the style URL is not reachable from browsers, or its host is missing from `csp.extraOrigins` when enforcing |
| Upload answers 503 | too many uploads at once for the scratch volume; raise `scratch.maxConcurrentUploads` and the volume size together |

## 8. Measured on a laptop (single process, for scale only)

| Request | Result |
|---|---|
| API health check, 32 connections | about 32,000 requests per second |
| Map catalogue, 32 connections | about 31,000 per second |
| Contact list (800 KB of JSON, compressed, cached), 8 connections | about 420 per second, 19 ms median |
| Stories list from MySQL, 16 connections | about 3,000 per second, 5 ms median |
| Pictures in a box from MySQL, 16 connections | about 5,500 per second, 2 ms median |
| Home page rendered on the server, 16 connections | about 160 per second, 94 ms median, no errors |

Requests that reach Elasticsearch, tested against production read-only in steps up to 8 connections (one API process, laptop):

| Request | At 8 connections |
|---|---|
| One incident's details (a document fetch, unique ids) | about 3,800 per second, 2 ms median |
| Contact text search (a search on every call) | about 600 per second, 12 ms median, 29 ms at the 99th percentile; scales in step with connections |
| Honour roll search | about 4,000 per second, 2 ms median |
| Charts | about 900 per second, 2 ms median (they use cached data; the first is slower) |

Nothing failed or slowed as connections rose. That is a small load; it says the code is not the bottleneck, not what the cluster can take.
Search is limited to 60 a minute per client address (`elasticsearch.searchPermitsPerMinute`), so anything above that gets 429, which is the
API protecting Elasticsearch. Count response statuses in any test you run.

## 9. Cutover

1. Run the full checks (`smoke.mjs`, `browser-checks.mjs`) against the new site while the old one is still live, using a
   test host name. Do the manual checks below.
2. Freeze the old Battle Map's community writes, take a fresh dump, load it into the scratch MySQL, and run the community
   import again. Being repeatable, it only adds what is new.
3. Lower the DNS time-to-live a day ahead, then point the host at the new ingress. Keep the old servers up but idle for a week.
4. Watch the API logs and the Moderation queue for the first day; set `csp.mode: enforce` when the logs are quiet.
5. Old links are **not** redirected (a decision made earlier: "no need to preserve the legacy link format"). If that changes, add a
   redirect map to the web server or the ingress.
6. After the week, remove the legacy folders from the repository (`src/`, `wp-content/`, the root `Dockerfile`, `web.config`, `api`).

**Manual checks** (the tools above cannot do these):

- Sign in as a member, an author, an editor and an admin; confirm MFA is asked of authors and above.
- As a member: write a note, add a picture, lay a poppy, report a casualty; as an editor: approve each from the Moderation page.
- In the Studio: write an article with an image and a video embed, schedule it, and see it appear.
- Keyboard only: reach the map controls, the incident panel tabs and the charts panel. Use a screen reader on the incident panel and
  the honour roll. Test on a phone-sized screen.
- Compare a handful of incidents, and the 13 charts, with the old site.
