# War Timeline: plan

A Features page that tells, in order, **what** Australian forces did in Phuoc Tuy and beyond, 1965–1971, and **why**: a vertical
timeline a reader can take in at a glance and then open up, from the war's phases down to single incidents.

## What the reader sees

A vertical timeline, earliest at the top, with three levels of zoom and a way down from each to the next:

| Level | What a row is | What it says |
|---|---|---|
| **Strategic** | A phase of the war (8 to 10 of them: 1 RAR with the 173rd Airborne; establishing Nui Dat; securing the province; Tet; into the wider war; pacification; the withdrawal) | Why Australia was doing what it was, in a paragraph or two, with the phase's figures and its turning points |
| **Operational** | An operation, or a month of the Task Force's routine where no operation stands out | What was done, by whom, and why, with its units, the mix of tasks and the figures |
| **Tactical** | A unit's notable contacts in that operation or month | The plain-English incident summaries, each opening the incident on the Battle Map |

Controls: zoom (the three levels, and the reader's own scroll), drilldown (open a phase to its operations, an operation to its
contacts), filters by unit and task, and a year rail to jump along. Every row links into the Battle Map: an incident, or the
operation's or unit's filter over its dates.

## Where the words come from

Every narrative is written in plain English (as the incident summaries are) and says where each claim comes from:

- **From the data**: counts, dates, units, tasks, casualties and the incident summaries, worked out by the builder (below).
  Figures are never typed by hand.
- **From cited sources**: context from outside the data (why an operation was mounted, what the enemy was doing, national policy),
  each with its source: the Australian War Memorial, the Anzac Portal (Department of Veterans' Affairs), the official history
  (McNeill and Ekins), and others of that standing. Nothing is asserted without one.

The narratives are written by an AI model (Claude) and reviewed here, as the unit histories' summaries are; the page says so.

## How it is built (as the unit histories are: `content/features/war-timeline/`, committed like code)

1. **Facts** (`Avw.Features war-timeline facts`, from the live data, read-only): `facts.json`, with each month's and each
   operation's figures, units (the unit histories' units, using their table, corrections and nesting), tasks and notable contacts
   (with their incident summaries). Continuing activities recorded as operations (LRRP, TAOR patrols, U/K) are shown as the
   month's routine, not as operations.
2. **Narratives** (`phases.json`, `operations.json`, `months.json`): written from the facts and the sources, each with the
   figures' fingerprint, so a narrative written from facts that have since changed is reported for review.
3. **The page** (`/features/war-timeline`): the facts and narratives bundled with the site, as the histories are.

## Phases of work

1. Facts builder and `facts.json`.
2. The strategic phases, from the facts and cited sources.
3. The operations (the 60-odd with 20 or more contacts; the rest folded into their months) and the months.
4. The page: the timeline, its zoom and drilldown, and the links into the Battle Map.
