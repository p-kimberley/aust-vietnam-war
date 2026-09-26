# Features content

The site's **Features** pages (Unit Histories now, Operation Histories next) are built from the files here, committed like code:
the repository is the only copy. A change is made here, reviewed, and live with the next deploy. The plan is
`docs/unit-histories-plan.md`.

## Unit Histories (`unit-histories/`)

| File | What it is | Made by |
|---|---|---|
| `units.csv` | Which units have a history (`history`), which are shown under another (`nest`: 1 ATF Artillery and Mortars under 1 ATF), which are left out with everything under them (`exclude`: the New Zealand companies and battery); each unit's address, names, **arm**, **Australian War Memorial record** and **official tours** (from that record or the Anzac Portal; empty until checked), and the names the nominal roll uses for it | By hand, from the official records |
| `index.json` | The page's list of units: each with its dates, a few figures and its sub-unit sections | `Avw.Features unit-histories facts` |
| `<unit>/facts.json` | The unit's fact sheet: figures, activity mix, operations, areas, notable contacts with their reports, sub-unit sections, its dead (with their portraits' addresses) and pictures | `Avw.Features unit-histories facts` |
| `summaries.json` | A plain-English summary of each notable contact's report (the reports are full of abbreviations and soldiers' shorthand), written by an AI model (Claude) from the report and reviewed here, with a fingerprint of the report it was written from | By hand or by a model, reviewed |
| `<unit>/history.md` | **What the site shows**: the unit's history in Markdown, with front matter for the page's head, made from its fact sheet and the summaries | `Avw.Features unit-histories render` |

The site bundles `index.json` and the `history.md` files when it is built (`web/src/app/features/`); a new unit also needs its
line in `web/src/app/features/unit-histories/histories.ts` (a test checks the two agree). The page takes its contents from the
history's `##` sections, opens a sub-unit's address at its `###` heading (the heading's words as a slug), shows the lists under
*Roll of honour* and *Photographs* as galleries, and shows the first ten rows of a longer table with a button for the rest.

Every link and picture is a plain site address (`/battlemap?incident=<id>`, `/battlemap?units=<id>`, `/battlemap?person=<service
number>`, `/battlemap?picture=<id>`, `/media/portraits/<service number>.jpg`, a picture's `/media/…`), so the pages need nothing
else to show them.

### Rebuilding the fact sheets

From the repository root, with the same settings the API uses (`docs/development.md` step 4 has the Elasticsearch ones):

```
# Git Bash
export ConnectionStrings__Default="Server=127.0.0.1;Port=3307;Database=avw;User=avw;Password=avw"
export Elasticsearch__Url=... Elasticsearch__ApiKey=... Elasticsearch__CaCertificatePath=...
dotnet run --project server/src/Avw.Features -- unit-histories facts                  # all units
dotnet run --project server/src/Avw.Features -- unit-histories facts --only 5-rar     # one
```

It reads the contacts from Elasticsearch and the honour roll, casualty links, pictures and bases from the database, all
read-only, and the deployed portraits from a folder of `<service number>.jpg` (`--portraits`, by default `.ai/kia-portraits`).
It reports which sheets changed; the difference shows in the commit. A sheet carries no timestamp, so an unchanged sheet is
left untouched. It then renders the histories (below).

### Rendering the histories

```
dotnet run --project server/src/Avw.Features -- unit-histories render                 # all units; needs no Elasticsearch or database
```

It writes each `history.md` from the unit's `facts.json` and `summaries.json`, and lists the notable contacts that have no
summary, or one written from a report that has since changed. Write those summaries (plain English, abbreviations spelt out,
nothing the report does not say, no names of the fallen) into `summaries.json` with the report's fingerprint
(`ReportSummaries.Fingerprint`: the first 12 hex digits of the SHA-256 of the report's text, trimmed, with `\n` line endings),
and render again.

### How the facts are worked out

- **A unit's contacts** are those of the unit and everything under it in the Battle Map's unit tree, with the nesting and
  exclusions in `units.csv` applied.
- **Led or supported.** A contact's report names its units in order, the unit in contact first ("12 pl D coy 5 RAR; 105 Fd Bty");
  the record's list of units is in no such order, so the unit in contact is the one the report's words name first (matched on the
  tree's labels, with "Fd"/"Field" and the like brought together; failing a match, the first listed). A unit **led** the contacts
  where it (or one of its own) was the unit in contact, and **supported** the rest.
- **Activity** is what the unit did in the contacts it led: the report's unit task, in plain words, or where none is recorded
  what the report's other fields show (an artillery engagement, a mine incident). It is never taken from a contact the unit only
  supported: an artillery regiment whose forward observers were with an infantry patrol did not patrol.
- **Support** is what the unit did in other units' contacts, by its arm (from its official record): artillery gave fire support,
  cavalry its armoured personnel carriers, armour its tanks, engineers engineer support; a headquarters' support is read from the
  report (artillery support); infantry and the SAS were in another unit's contact. Each is counted by the unit supported.
- **Filed against the wrong unit**: a contact recorded against a unit outside its official tours, whose report names another
  unit with a history that was in Vietnam then ("9 pl C coy, 2 RAR" filed under 5 RAR after 5 RAR went home), is counted for
  the unit its report names; one whose report names a New Zealand company first ("3 pl W Coy 6 RAR") is left out, like the
  companies themselves. Each such contact is listed on the sheets of the units involved (`corrected`).
- **Outside its tours**: the other contacts recorded against a unit outside its official tours are listed, to be checked (an
  error in the data, a detachment that stayed, or a unit named wrongly) and left out of, or explained in, its history.
- **Sub-unit sections** go down to company level only: the units directly under it (its companies, squadrons or batteries)
  with 20 or more contacts, named without their unit's name ("B Company"). Platoons and troops count towards their company.
- **Notable contacts**: the eight most significant (someone killed or wounded; ranked by casualties, then the forces involved),
  the first and the last, and for each of the four commonest activities one typical contact the unit led, with a report of 120
  characters or more. Each says whether the unit led it or what support it gave, and to whom. The account links only to these.
- **The dead**: a person whose tour when they died is with one of the units in `units.csv` is that unit's. A person whose tour
  does not say (mostly reinforcements) is the unit's whose contact they are linked to, the infantry battalion's if there is one
  among them.
- **Areas**: each contact counted against the nearest base or landing zone within 15 km.
- **Pictures**: those linked to the unit's contacts, then up to twelve taken within 1.5 km of at least three of them (and within
  its dates, where a picture is dated).
