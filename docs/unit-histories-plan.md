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
read, reviewed and refined in later iterations like any other source: nothing is generated when someone visits. Once published,
editors can go on editing them in the Studio.

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

Each history has **a section for each of its sub-units** with enough to say (companies, squadrons, batteries, troops), and those
sections can be reached directly: the list at the left shows them under their unit, and each has its own address.

## 3. What a reader sees

**Route:** `/units`, `/units/<unit>` for a unit's history, and `/units/<unit>/<sub-unit>` for a sub-unit's section of it (for
example `/units/5-rar`, `/units/5-rar/b-company`), server-rendered like the stories, so a history can be shared, searched and read
without the map. The header's nav gains **Units**.

**Layout:** a list at the left (the 16 units, each with its sub-units indented beneath it; a filter box; each with its contact
count), the history at the right. Choosing a sub-unit opens its unit's history at that sub-unit's section. On a phone the list
becomes a unit picker at the top.

**The history's head:** name, the parent it belongs to, its dates in Vietnam, and a strip of figures (contacts, operations,
friendly and enemy casualties), with **View on the Battle Map**: the map filtered to the unit (`/battlemap?units=<id>`).

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
  (4.3), and nothing else to write from. It writes to the fixed structure in 3, and marks each incident it links with the
  contact's id; the build checks every id is one of the unit's contacts and turns it into a Battle Map link. It links **only
  significant or illustrative contacts** (a handful per section), not every incident it draws on.
- Quotations from the reports must be word for word (checked by the build), and every statement taken from an external source
  carries its citation (checked: a citation must name one of the unit's reference sources).
- The drafts are reviewed and refined in the repository (by you, or with further passes), then published; published accounts
  are editable by editors in the Studio (4.4).
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

### 4.4 In the repository, and in the site

**The repository holds the histories**, under `content/unit-histories/`:

```
content/unit-histories/
  war-events.md                 the curated events of Australia's war, each with its source
  unit-names.csv                the rolls' unit names mapped to the tree's, and any re-parenting (1 ATF Artillery, Mortars)
  5-rar/
    history.md                  the written account: front matter (unit id, title, dates, status) and Markdown, with
                                sub-unit sections (## B Company {#b-company}), contact links ([…](contact:1234)),
                                portraits and pictures by reference (portrait:216900, picture:512), citations ([^3])
    timeline.md                 the timeline's entries (date, kind, words, contact or person or picture), one per line
    sources.md                  the reference file (4.3)
    facts.json                  the fact sheet the draft was made from (rebuilt by `unit-histories facts`)
    images/                     official photographs used, with their credit (never copies of portraits or site pictures)
```

`contact:`, `portrait:` and `picture:` references are resolved when the history is shown, so portraits and community pictures
are always the deployed ones.

**The site holds the published copy**, so editors can edit it:

- `unit-histories import` loads a unit's files into a `unit_histories` table (account as Markdown, rendered and sanitised for readers, as articles are;
  timeline and sources as JSON; revisions as articles have them), as a new revision; it will not overwrite an editor's change
  without being told to.
- In the Studio, **Unit histories** lists the units; editors edit a published account with the article editor, and its
  timeline entries, and publish.
- `unit-histories export` writes the published copies back to `content/unit-histories/`, so editors' changes are committed and
  the next iteration starts from them.
- `GET /api/units` (the list for the left-hand side) and `GET /api/units/{slug}` (one history, with its references resolved).

### 4.5 Keeping it current

The histories are a snapshot. When contacts, the roll or the pictures change a lot, `unit-histories facts` is run again; the
Studio shows which units' facts have changed since their account was reviewed, and those are redrafted or edited by hand.

## 5. Phases and estimates

| Phase | What | Days |
|---|---|---|
| 1. Fact sheets | The unit names table, the fact-sheet command (contacts, sub-units, the nominal roll's tours, portraits, pictures) and its tests; `facts.json` for the 16 units committed; a review of a few with you | 3–4 |
| 2. Page and API | The Markdown format and its references, `import` and the `unit_histories` table, the API, `/units` with the list and a history drawn from the fact sheet alone (figures, activity mix, sub-unit sections, roll of honour, photographs) | 4–5 |
| 3. Timeline | The vertical timeline, `war-events.md` with its sources, the switch between views | 3 |
| 4. Accounts | Official reference files for the units, the drafting command with checked links, quotations and citations, the 16 drafts committed | 4–6 |
| 5. Editing | Studio editing of published histories, `export` back to the repository | 2–3 |
| 6. Review | Your review of the drafts, refinements, publishing | review time |

Phases 1–3 give a working page without any model; phase 4 adds the prose.

## 6. Decisions (2026-09-26)

1. **Australian units only.** New Zealand and US units get no history or section of their own.
2. **Top-level units** (16), each with **navigable sections for its sub-units**. "1 ATF Artillery" and "1 ATF Mortars" are
   nested under 1 ATF as sub-units.
3. **Drafted with a language model**, and the drafted content **committed to the repository** (Markdown, and static images)
   so it can be referenced and refined in later iterations.
4. **Official sources only**, cited wherever external material is used.
5. **Published accounts are editable by editors** (in the Studio, exported back to the repository).
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
- **Two copies**: the repository and the site can drift apart. `import` refuses to overwrite editors' changes, and `export`
  brings them back to the repository; the Studio shows which histories have changed since they were last exported.
- **Sensitivity**: this is about people who died and their families. The tone is set in the drafting instructions (plain,
  factual, respectful), and the review is the safeguard.
