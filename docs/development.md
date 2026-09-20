# Running a dev instance

Everything here was run to write it, on Windows with Git Bash. PowerShell forms are given where the syntax differs.

## What you need

- **Docker** with Compose v2 (for MySQL and Keycloak)
- **.NET SDK 10** (`server/global.json` asks for 10.0.100 or a later feature band)
- **Node 24** with npm 11 (what `web/Dockerfile` and `packageManager` use)
- **Access to Elasticsearch**: see step 4. It is the one part that is not local.

Ports used: MySQL **3307**, Keycloak **8080**, API **5186**, web **4300**.

## 1. Start MySQL and Keycloak

```
docker compose -f deploy/dev/compose.yaml up -d
```

- MySQL 8.4: database `avw`, user `avw`, password `avw` (root password `root`).
- Keycloak 26 in dev mode with the same realm the cluster uses (`deploy/keycloak/avw-realm.json`). Admin console at
  http://localhost:8080, login `admin` / `admin`. It takes about a minute to be ready.

## 2. Create the dev users

```
bash deploy/dev/seed-users.sh
```

Makes `member@avw.test`, `author@avw.test`, `editor@avw.test` and `admin@avw.test`, all with password `DevPassw0rd!`. It can be re-run.

**Authors, editors and admins must set up an authenticator on their first sign-in** (the realm requires MFA from `author` up). Use any
authenticator app, or on the setup page choose "Unable to scan?", copy the key, and generate codes on the computer
(for example `oathtool --totp -b <key>`). Keycloak will not accept the same code twice, so wait for the next 30-second code when signing in again.
To start over for a user: Keycloak admin console, realm `avw`, Users, the user, Credentials, delete the one-time-password credential.

## 3. Create the database tables

The API does not create its own tables. Run the migrator once, and again after pulling new migrations:

```
# Git Bash
ConnectionStrings__Default="Server=127.0.0.1;Port=3307;Database=avw;User=avw;Password=avw" dotnet run --project server/src/Avw.Migrator
```
```
# PowerShell
$env:ConnectionStrings__Default = "Server=127.0.0.1;Port=3307;Database=avw;User=avw;Password=avw"
dotnet run --project server/src/Avw.Migrator
```

It prints how many migrations are applied. `--dry-run` lists what is pending without applying it.

## 4. Point the API at Elasticsearch

The contacts on the map, the honour roll and the charts are read from Elasticsearch (`avw_contacts` and `avw_nomroll`). **There is no
Elasticsearch in the dev stack**, so use the shared cluster with a **read-only** key (the project only ever reads from it). Set these in
the shell that runs the API:

```
# Git Bash
export Elasticsearch__Url="https://prod-es-data-http.elastic.svc.prod:9200"
export Elasticsearch__ApiKey="<the read-only key>"
export Elasticsearch__CaCertificatePath="<full path to the cluster's CA certificate>"
```
```
# PowerShell
$env:Elasticsearch__Url = "https://prod-es-data-http.elastic.svc.prod:9200"
$env:Elasticsearch__ApiKey = "<the read-only key>"
$env:Elasticsearch__CaCertificatePath = "<full path to the cluster's CA certificate>"
```

In this workspace the key and the CA certificate are kept in `.ai/` (git-ignored). Never commit them or paste the key into a log.

Without this the API still starts, and sign-in, the Studio, stories, notes and pictures work, but the map, honour roll and charts show errors.

## 5. Run the API

```
dotnet run --project server/src/Avw.Api
```

It listens on http://localhost:5186 in the Development environment (`appsettings.Development.json` already points at the dev MySQL and
Keycloak, and lists the basemaps). Check it: http://localhost:5186/api/health/ready should say `Healthy`.
Uploaded pictures go to `server/src/Avw.Api/data/` (git-ignored).

## 6. Run the web app

```
cd web
npm ci
npm start
```

Open **http://localhost:4300**. The dev server sends `/api` calls to the API on 5186 (`web/proxy.conf.json`). It reloads when you change a file.

Use **4300**, not another port: the dev Keycloak realm only accepts sign-in returns to `http://localhost:4300`.

## 7. Sign in

Use the "Sign in" link (for example under an incident's Notes tab) and one of the users above. Editors and admins see the Studio at
`/studio` and the Moderation page. Email to editors is off in dev (see `runbook.md`), so the API just logs each item that is waiting.

## Optional: real content

The dev database starts empty. To load the old site's content, follow `runbook.md` section 4, using the same commands from the repo root:
`import-poi` (fire support bases, for the map's bases layer) and `import-community` (notes, poppies, pictures). They need the legacy dump
loaded in a scratch MySQL (`ConnectionStrings__Legacy`; add `;SslMode=Disabled` for an old 5.x server) and, for pictures,
`--media-root <the incident-media folder>` with `Media__RootPath` set to somewhere outside the repository. Both are safe to repeat. To empty
the imported content again, delete rows with a `LegacyId` from `incident_notes`, `tributes`, `casualty_submissions` and `incident_media`
(and everything in `casualty_links`).

## Tests

No database, Keycloak or Elasticsearch is needed for almost all of them. Four tests run MySQL's full-text search for real and are skipped unless you point them at a
MySQL that lets them create a database (they make one, run the migrations into it, and drop it):

```
AVW_TEST_MYSQL="Server=127.0.0.1;Port=3307;User=root;Password=root;CharSet=utf8mb4" dotnet test server/Avw.slnx --filter FullyQualifiedName~MySqlFullText
```

The rest:

```
dotnet test server/Avw.slnx
cd web && npx ng test --watch=false
```

## Run it the way production does

This is the server-rendered build with the content security policy on, which is what the browser checks use:

```
cd web && npm run build
# Git Bash (the API from step 5 must be running)
PORT=4010 NG_ALLOWED_HOSTS=localhost API_INTERNAL_URL=http://localhost:5186 CSP_MODE=enforce \
  CSP_EXTRA_ORIGINS="https://tiles.hosting.gradata.com.au" node dist/web/server/server.mjs
node deploy/smoke/smoke.mjs http://localhost:4010 http://localhost:5186
```

Sign-in does not work on port 4010 (the realm only accepts 4300); everything else does. `deploy/smoke/browser-checks.mjs` (accessibility,
policy violations, map drawing in Chrome) is described at the top of that file.

## Stop and reset

```
docker compose -f deploy/dev/compose.yaml down        # stop; keeps the database and Keycloak users
docker compose -f deploy/dev/compose.yaml down -v     # stop and wipe both (run steps 1 to 3 again afterwards)
```

## When something is wrong

| Symptom | Likely cause |
|---|---|
| Map says "could not be loaded" | Elasticsearch settings (step 4) missing or wrong; the API log names the failing request |
| `ConnectionStrings__Default is not set` from the migrator | set the variable in the same shell (step 3) |
| API returns 500 on pages that use the database | migrations not applied (step 3) |
| Sign-in ends on a Keycloak error page | you are not on http://localhost:4300, or Keycloak has not finished starting |
| Editor or admin is stuck on "Mobile Authenticator Setup" | expected the first time; enrol as in step 2 |
| `port is already allocated` | something else uses 3307 or 8080; stop it, or change the port in `deploy/dev/compose.yaml` (and `appsettings.Development.json`) |
| Basemap is blank | the tile server in `appsettings.Development.json` is unreachable from your network |
