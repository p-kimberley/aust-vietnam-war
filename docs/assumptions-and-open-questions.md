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

## Later phases

Added as the work proceeds.
