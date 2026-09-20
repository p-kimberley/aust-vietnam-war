# Australia's Vietnam War

A standalone rebuild of the site: an Angular (server-rendered) front end, a .NET API, MySQL, Keycloak and Elasticsearch.
The old WordPress site (`src/`, `wp-content/`, the root `Dockerfile`, `web.config`, `api`) stays here as reference until cutover.

| Where | What |
|---|---|
| `web/` | Angular app (`npm start` for development) |
| `server/` | .NET API, worker, migrator and tests |
| `deploy/` | Helm charts, the dev stack (`deploy/dev`), the Keycloak realm, smoke and browser checks |
| `docs/development.md` | **Start here to run it locally** |
| `docs/runbook.md` | Installing, releasing, migrating content and cutover |
| `docs/rebuild-plan.md` | Why it is built this way |
| `docs/assumptions-and-open-questions.md` | Every decision made without asking, phase by phase |
