# War Timeline: how the narratives are written

The narratives explain, in order, **what** Australian forces did in Vietnam from 1965 to 1971 and **why**. There are three kinds,
each in its own file under `narratives/`, keyed as the facts are (`facts.json`):

| File | Key | Length | What it answers |
|---|---|---|---|
| `phases.json` | the phase's slug | 3 to 5 short paragraphs | Why the phase began and ended; what the Task Force (or 1 RAR) was trying to do; how it went about it; what changed |
| `operations.json` | the operation's slug | 1 to 3 paragraphs | Why it was mounted; where; who took part; what was done and what came of it |
| `months.json` | `yyyy-MM` | 1 short paragraph (2 to 4 sentences) | What the month's work was: the operations under way, the routine, anything that stood out |

## An entry

```json
"coburg": {
  "fingerprint": "3f9a0c21b7de",
  "summary": "Two battalions sent north-west into Bien Hoa province to block the approaches to Long Binh as the Tet offensive came.",
  "text": "In late January 1968 …[1]\n\nOver the next five weeks …",
  "sources": [
    { "title": "Operation Coburg", "publisher": "Anzac Portal (Department of Veterans' Affairs)", "url": "https://anzacportal.dva.gov.au/…" }
  ]
}
```

- `fingerprint`: the entry's `fingerprint` in `facts.json` when it was written. Copy it exactly.
- `summary`: one sentence (at most 30 words) for the timeline's collapsed row.
- `text`: plain text in paragraphs separated by a blank line (`\n\n`). No Markdown, no headings, no bullet points.
- `sources`: the outside sources the text cites, in order; `[1]` in the text is the first. None for an entry drawn only from the data.

## Rules

- **Plain English.** Write for a reader who knows nothing of the army: spell out abbreviations (1 ATF is "the 1st Australian Task
  Force", or "the Task Force" once named; RAR "Royal Australian Regiment"; APC "armoured personnel carrier"; VC "Viet Cong"; NVA
  "North Vietnamese Army"). Battalions may be written as "5 RAR" after the first full mention in an entry. Australian spelling.
- **What, then why.** Every entry says what was done, and why, as far as the sources let it: the purpose of an operation, the
  enemy's intent, the policy behind a phase. Where the why is not known, say what was done and leave it there.
- **Two kinds of claim, kept apart.**
  - *From the data* (the facts file: dates, units, tasks, counts, casualties, and the notable contacts' summaries). No marker. Use
    the facts' figures exactly, and say "recorded" for enemy figures ("245 enemy were recorded killed"): they are the
    Australians' own counts. Never add up figures yourself beyond what the facts give; never round them in a way that changes them.
    The record's friendly figures (`frKia`, `frWia`) count everyone on the allied side: mostly Australians, with New Zealanders
    and at times Americans and South Vietnamese. So give an entry's totals as "killed on the Task Force's side" (or "on the allied
    side" before the Task Force, in 1 RAR's year with the Americans), not as "Australians killed". Call particular soldiers
    Australians only where the source or the incident's summary says they were.
  - *From a source* (anything the data does not show: purposes, orders, the enemy's units and aims, national policy, names of
    places the data does not give, results beyond the data). Every such sentence ends with its source's marker `[n]`.
- **Sources.** Only sources of standing: the Australian War Memorial (awm.gov.au), the Anzac Portal (anzacportal.dva.gov.au),
  the Australian Army and its Research Centre (army.gov.au, researchcentre.army.gov.au), the Department of Veterans' Affairs, the
  National Archives, the official history (Ian McNeill and Ashley Ekins, *The Australian Army and the Vietnam War 1962–1975*,
  as cited by those sites), and unit associations' histories where nothing better exists. No Wikipedia, no forums, no blogs.
  Cite the page you read, not a search result. Nothing is asserted that the source does not say.
- **Faithful.** Add nothing the data or sources do not say. Keep uncertainty ("possibly", "thought to be"). Where the data and a
  source disagree (a date, a number), say so briefly or keep to the data and leave the source's figure out.
- **No names of the Australian fallen or wounded**, as in the incident summaries. Names of units, commanders named by the sources
  in their command roles, operations, places and enemy units are fine.
- **Respectful and neutral.** No glorifying, no editorialising, no judgement of the enemy or of Australian conduct beyond what
  the sources say. Civilian deaths and friendly fire are stated plainly where the data or sources record them.
- **Routine matters.** Most of the war was patrolling, ambushing and securing the province, not battles. Months without a big
  operation should say what that routine was (the facts' task mix, the continuing activities counted as `routine`) rather than
  apologise for it.
