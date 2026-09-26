# Unit Histories — plan

Status: agreed in outline, 2026-09-26 (decisions in section 6). Estimates are rough person-days for one developer who knows this codebase.

## 1. Goal

A **Unit Histories** page that tells, for each major Australian unit, what kinds of combat actions it carried out in the war,
and how its war unfolded. A reader picks a unit from a list at the left (sub-units nested under their parent) and reads its
history at the right, as either:

- a **written account**: an illustrated narrative, with the unit's dead (and their portraits), photographs, and links into
  the Battle Map for the contacts it describes; or
- a **vertical timeline** of the unit's major incidents, alongside the major events of Australia's war.

The histories are **built once, offline, and committed to the repository** as Markdown with their own images, so they can be
read, reviewed and refined in later iterations like any other source: nothing is generated when someone visits. **The
repository is the only copy**: a change is made there and goes out with the next deploy. They are not in the database and not
edited in the Studio.

Unit Histories is the first of the site's **Features**, a new item in the header's navigation beside the Battle Map.
**Operation Histories** is planned next, built the same way (section 8).

## 2. What the data gives us (checked against the live data, 2026-09-26)

| Source | What it has | Use |
|---|---|---|
| Contacts (Elasticsearch, 6,157 plotted) | Date/time, place, units involved, operation, unit task (Ambush, Patrol, …), data source, friendly and enemy force, KIA and WIA, mine flag, **report text** (typically from the AWM95 commanders' diaries, cited in the text) | The spine of every history: counts, spans, activity mix, places, notable incidents, report excerpts |
| Unit tree (filter catalogue, 590 units) | Units and sub-units, with parents recovered from their paths | The list, and what counts as a unit's own contacts (its sub-units' included) |
| Honour roll (MySQL, 522 people) | Name, rank, corps, dates, and **tours of duty naming the unit** (battalion level, e.g. "5th Battalion, The Royal Australian Regiment") | The unit's dead, by tour; the date they died places them on the timeline |
| Casualty links (MySQL, 213) | Person ↔ contact | Ties a death to the contact it happened in, so the account and timeline can say where and how |
| Portraits (deployed in the `media/portraits` volume, `<service number>.jpg`) | 521 files. Checked against the nominal roll index (`avw_nomroll`, 60,799 people): 520 match exactly one record, each with a death date, each on the honour roll, surnames agreeing. Two of the roll have no portrait (Kirkwood, A113169; McGrath, O44851). One file, `2786017.jpg` ("Dal Edward Abbot" in its original name), matches no one in the index or the roll | Beside each name in the roll of honour, referenced where they are deployed (`/media/portraits/<service number>.jpg`), never copied |
| Nominal roll index (Elasticsearch, 60,799 people) | Everyone who served: service number, name, rank, branch, birth, death, **tours with their unit and dates** | Tours place the dead (and the unit's arrival and departure) in time; a check on the honour roll |
| Community pictures (MySQL, 350; 325 placed on the map, 71 dated, 23 linked to a contact) | Picture, caption, credit, place, date | Illustrations: linked to a unit's contact, or placed near its contacts (and in its time, where dated) |
| Operations (catalogue) | Names; spans come from their contacts | Timeline entries and the account's structure |
| Public sources | Arrival and departure dates, tours, commanding officers, battles and their context: the Australian War Memorial's unit pages, DVA's Anzac Portal, the official history (McNeill and Ekins), and battalion histories | Context the contacts do not hold; used as references, never copied (see 4.3) |

### Which units

**Top-level Australian units with 50 or more contacts, counting their sub-units'**: 16.

| | Units |
|---|---|
| Infantry | 1, 2, 3, 4, 5, 6, 7, 8 and 9 RAR |
| Armour and cavalry | 3 Cavalry Regiment, 1 Armoured Regiment |
| Special forces | Special Air Service Regiment |
| Formation | 1 Australian Task Force (with 1 ATF Artillery and 1 ATF Mortars as its sub-units) |
| Artillery | 4 Field Regiment, 1 Field Regiment |
| Engineers | 1 Field Squadron |

The US units are left out, and so are the New Zealand sub-units within these (V and W Companies of the ANZAC battalions, and
161 Field Battery, RNZA): their contacts still count towards their parent's figures where the parent took part, but they get no
section of their own. "1 ATF Artillery" and "1 ATF Mortars" are top-level groupings in the data; here they are **nested under
1 ATF** as two of its sub-units (their contacts count towards 1 ATF's figures, and each has its own section). The unit
names table (4.4) records that re-parenting, so the Battle Map's own unit tree is left as it is.

Each history has **a section for each of its sub-units** with enough to say, down to company level (companies, squadrons, batteries; platoons and troops count towards them), and those
sections can be reached directly: the list at the left shows them under their unit, and each has its own address.

## 3. What a reader sees

**Navigation:** the header gains **Features**, beside **Battle Map**, leading to `/features`: a short page introducing each
feature (Unit Histories now, Operation Histories later), each opening its own page.

**Routes:** `/features/unit-histories` (the list, and an introduction), `/features/unit-histories/<unit>` for a unit's history,
and `/features/unit-histories/<unit>/<sub-unit>` for a sub-unit's section of it (for example
`/features/unit-histories/5-rar/b-company`). They are **prerendered at build time** into plain HTML from the committed Markdown,
so they load at once, are found by search engines, can be shared, and read without the map.

**Layout:** a list at the left (the 16 units, each with its sub-units indented beneath it; a filter box; each with its contact
count), the history at the right. Choosing a sub-unit opens its unit's history at that sub-unit's section. On a phone the list
becomes a unit picker at the top.

**The history's head:** name, its dates in Vietnam, and a strip of figures (contacts, operations, friendly and enemy casualties),
with **View on the Battle Map**: the map filtered to the unit (`/battlemap?units=<id>`).

**Written account** (the default):

1. *In brief*: two or three sentences on the unit's war.
2. *What it did*: the activity mix (from unit tasks: patrols, ambushes, cordon and search, convoy escort, fire support …),
   with a small bar of the proportions, and what that meant on the ground.
3. *Its war, in order*: tours and operations as sections, each describing what the unit did, with photographs where there
   are any, and short quotations from the reports where they say it best. **Only the contacts that matter are linked**
   (**Open on the Battle Map** → `/battlemap?incident=<id>`): the unit's significant actions, and a few chosen because they show
   what its work was typically like. Most of what it did is told in summary, not incident by incident.
4. *Its sub-units*: a section for each company, squadron or battery, with its own figures, activity mix and notable actions
   (reachable directly, 3 above).
5. *Roll of honour*: the unit's dead, with portraits, rank, date, and the contact they died in (linked) where it is known;
   each opens their honour roll entry.
6. *Sources*: the archival sources the reports cite, and every external source used, cited where it is used and listed here.

**Timeline:** vertical, oldest at the top, with a spine down the middle:

- the unit's own entries: arrival and departure, each operation (a bar for its span), notable contacts (sized by their
  casualties; each links to the Battle Map), deaths (with portraits), and photographs;
- the war's major events for Australia, shown differently (ruled across the spine, not in the unit's colour), and hideable:
  for example AATTV's arrival (1962), 1 RAR's deployment (1965), 1 ATF at Nui Dat (1966), Long Tan (1966), Tet and
  Coral–Balmoral (1968), Binh Ba (1969), the moratoriums (1970), 1 ATF's withdrawal (1971), and the last Australians leaving
  (1972–73). This list is curated once, with a source for each.

**Switching** between the two keeps the unit and the place in its war (`?view=timeline` in the link).

## 4. How it is built

### 4.1 The fact sheet (deterministic)

A new migrator command, `dotnet run --project server/src/Avw.Migrator -- unit-histories facts`, works out for every unit in
scope a **fact sheet**, stored as JSON:

- contacts (the unit's and its sub-units'), their span, and per-year counts;
- the activity mix from unit tasks, and the data sources;
- operations, with spans and the unit's contacts in each;
- casualties, friendly and enemy, and the contacts with the most;
- **notable contacts**: the largest by casualties or force, the first and last, and those in named battles, each with its
  report text;
- places: the areas it worked in (a few clusters, named from the nearest bases on the map);
- the dead: people whose tour (from the nominal roll index, confirmed against the honour roll) was with the unit at the time
  they died (a mapping from the rolls' unit names, "5th Battalion, The Royal Australian Regiment", to the tree's,
  "5 Battalion, Royal Australian Regiment", kept in a small checked-in table), with their casualty links, and their portrait's
  deployed address (`/media/portraits/<service number>.jpg`) where there is one;
- photographs: those linked to its contacts, then those within a short distance of its contacts (and within its dates, where
  a photograph has a date), best-placed first;
- the public references for the unit (4.3).

This part is plain code, tested like the rest, and can be rebuilt at any time.

### 4.2 The account (drafted once, then reviewed)

The written account and the timeline's descriptions are **drafted by a language model (Claude, through the Anthropic API) from
the fact sheet**, once, by a second command (`unit-histories draft`), and **written to the repository** (4.4).

- The model is given the fact sheet, the reports of the unit's notable contacts, and the reference notes from official sources
  (4.3), and nothing else to write from. It writes to the fixed structure in 3, and links each incident it names to the
  Battle Map (`/battlemap?incident=<id>`); the build checks every linked id is one of the unit's contacts. It links **only
  significant or illustrative contacts** (a handful per section), not every incident it draws on.
- Quotations from the reports must be word for word (checked by the build), and every statement taken from an external source
  carries its citation (checked: a citation must name one of the unit's reference sources).
- The drafts are reviewed and refined in the repository (by you, or with further passes), and published by committing them;
  later corrections are made the same way (4.4).
- The cost is one run over 16 units, not per visit; the model is chosen, and its cost confirmed, when phase 4 starts.

### 4.3 Official sources

Only **official sources**: the Australian War Memorial (its unit pages, the AWM95 commanders' diaries the reports come from, and
its collection), DVA's Anzac Portal, and the Official History of Australia's Involvement in Southeast Asian Conflicts
1948–1975 (McNeill and Ekins). For each unit a short **reference file** is gathered once, with the facts it gives (tour dates,
commanding officers, the battles it fought and their outcome) and where each comes from. Their wording is not copied, and any
statement drawn from them is **cited where it is used** in the account (as a numbered note pointing to *Sources*).

Official photographs from the Memorial's collection may be used where its catalogue marks them as out of copyright, credited
and with their accession number; they are committed with the history (4.4). Otherwise photographs come from the site's own
collection, referenced where they are deployed.

### 4.4 In the repository, and how the site shows it

**The repository holds the histories**, under `content/features/unit-histories/`:

```
content/features/
  features.md                   the Features page: a short introduction to each feature
  war-events.md                 the curated events of Australia's war, each with its source (shared with Operation Histories)
  unit-histories/
    index.md                    the Unit Histories introduction; the list of units and sub-units, with their counts (front matter)
    unit-names.csv              the rolls' unit names mapped to the tree's, and any re-parenting (1 ATF Artillery, Mortars)
    5-rar/
      history.md                the written account: front matter (unit id, title, dates, figures) and Markdown, with sub-unit
                                sections (## B Company {#b-company}), citations ([^3]), and links and pictures written as their
                                site addresses (below)
      timeline.md               the timeline's entries (date, kind, words, link, picture), one per line
      sources.md                the reference file (4.3)
      facts.json                the fact sheet the draft was made from (rebuilt by `unit-histories facts`, kept for review)
      images/                   official photographs used, with their credit (never copies of portraits or site pictures)
```

**Every reference is a plain site address**, written in when the history is drafted, so showing a history needs no database or
API call: a contact is `/battlemap?incident=<id>`, the unit on the map is `/battlemap?units=<id>`, a portrait is
`/media/portraits/<service number>.jpg`, and a community picture is its deployed `/media/…` address. The drafting command checks
each exists (the contact is the unit's, the portrait and the picture are deployed).

**The web build** copies `content/features/` into the site's assets (an `angular.json` asset entry) and **prerenders** each
page from it: the Markdown is rendered (with `marked`, already in the app) when the site is built, and Angular sanitises the
result as it does any HTML it is given. Nothing is added to the API or the database. A change to a history is a change to its
Markdown, reviewed and committed like code, and live with the next deploy.

### 4.5 Keeping it current

The histories are a snapshot. When contacts, the roll or the pictures change a lot, `unit-histories facts` is run again; its
report says which units' facts have changed since their account was drafted (the new `facts.json` shows the difference in the
commit), and those are redrafted or edited by hand. The commands are tools run from a developer's machine (they read the live
Elasticsearch and the database read-only, and write files); they are never part of the site.

## 5. Phases and estimates

| Phase | What | Days |
|---|---|---|
| 1. Fact sheets | The unit names table, the fact-sheet command (contacts, sub-units, the nominal roll's tours, portraits, pictures) and its tests; `facts.json` for the 16 units committed; a review of a few with you | 3–4 |
| 2. Features and the page | **Features** in the header and `/features`; `/features/unit-histories` with the list and a history drawn from the fact sheet alone (figures, activity mix, sub-unit sections, roll of honour, photographs), prerendered from the committed files | 3–4 |
| 3. Timeline | The vertical timeline, `war-events.md` with its sources, the switch between views | 3 |
| 4. Accounts | Official reference files for the units, the drafting command with checked links, quotations and citations, the 16 drafts committed | 4–6 |
| 5. Review | Your review of the drafts, refinements in the repository | review time |

Phases 1–3 give a working page without any model; phase 4 adds the prose.

## 6. Decisions (2026-09-26)

1. **Australian units only.** New Zealand and US units get no history or section of their own.
2. **Top-level units** (16), each with **navigable sections for its sub-units**. "1 ATF Artillery" and "1 ATF Mortars" are
   nested under 1 ATF as sub-units.
3. **Drafted with a language model**, and the drafted content **committed to the repository** (Markdown, and static images)
   so it can be referenced and refined in later iterations.
4. **Official sources only**, cited wherever external material is used.
5. **The repository is the only copy** (changed 2026-09-26): histories are committed Markdown, changed in the repository and
   live with the next deploy; not in the database, and not edited in the Studio. Feature pages stay out of the database unless
   one needs it.
8. **Features**: a new header item beside Battle Map, leading to `/features`; Unit Histories is its first page, Operation
   Histories the next (section 8).
6. **Portraits are the deployed ones** (`media/portraits/<service number>.jpg`, 520 of the roll's 522, mapped and checked
   against the nominal roll index); histories reference them and never copy them.
7. **Only significant or illustrative contacts are linked** to the Battle Map, not every incident.

Still open: the one portrait that matches no one (`2786017.jpg`), which may be a service number typed wrongly.

## 7. Risks

- **Accuracy**: a drafted account can state things the sources do not support. Mitigated by giving the model only the fact
  sheet and reports, checking every citation and quotation, and publishing nothing unreviewed.
- **Names**: units are named differently in the contacts, the roll and the public sources; the mapping is by hand and needs
  checking.
- **Thin units**: some companies have few reports with any detail; their accounts will be short, which is better than padded.
- **Copyright**: facts from official sources, not their words, and cited; photographs from the site's own collection, or official
  photographs the Memorial marks as out of copyright, each credited.
- **Changes need a deploy**: a correction to a history waits for the next release. That is the trade for keeping it in the
  repository, reviewed like code; a hotfix deploy is the answer if one is urgent.
- **Sensitivity**: this is about people who died and their families. The tone is set in the drafting instructions (plain,
  factual, respectful), and the review is the safeguard.

## 8. Operation Histories (next)

The same pattern, for the major operations: a list at the left (by year), each operation's account (why it was mounted, the units
in it, what happened, what it cost) and its timeline, from a fact sheet of its contacts, units, dead and pictures, drafted from
official sources and committed under `content/features/operation-histories/`. Most of phase 1 to 3 is shared (the fact-sheet
machinery, the Markdown and its references, the page, the timeline and `war-events.md`); what the operations add is their own
selection (which operations are major), their fact sheet and their drafting instructions. Unit and operation histories link to
each other where a unit took part in an operation. Planned in detail once Unit Histories is built.
