"""
The War Timeline's narratives: slices of the facts to write from, and a check of what was written.

  python narratives.py slice <from yyyy-MM> <to yyyy-MM> <out.json>
      The months in the range, and the operations whose main run starts in it, with the phases they fall in (and those phases'
      narratives, if written), as one compact file to write the narratives from.

  python narratives.py check <draft.json> [--slice <slice.json>]
      Checks a draft ({"operations": {slug: entry}, "months": {yyyy-MM: entry}}) or a narratives file ({key: entry}) against the
      rules in STYLE.md that can be checked: known keys, fingerprints as in facts.json, a summary of at most 30 words, plain text,
      source markers matching the sources, sources of standing, no number that is not in the entry's facts. Prints each problem;
      exits 1 if there are any.

  python narratives.py merge <draft.json>...
      Adds the drafts' entries to narratives/operations.json and narratives/months.json (after checking them).

Run from anywhere; it finds facts.json beside this folder.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FACTS = json.loads((ROOT / 'facts.json').read_text(encoding='utf-8'))
MONTHS = {m['month']: m for m in FACTS['months']}
OPS = {o['slug']: o for o in FACTS['operations']}
PHASES = {p['slug']: p for p in FACTS['phases']}
UNITS = {u['slug']: u['short'] for u in FACTS['units']}
STANDING = ('awm.gov.au', 'anzacportal.dva.gov.au', 'army.gov.au', 'dva.gov.au', 'naa.gov.au', 'vietnamroll.gov.au', 'gov.au')


def phase_of(day):
    return [s for s, p in PHASES.items() if p['from'] <= day <= p['to']]


def compact_contact(c):
    return {k: c[k] for k in ('id', 'date', 'unitLabel', 'task', 'operation', 'casualties', 'summary') if c.get(k) is not None} | {'unit': UNITS.get(c['unit'])}


def compact(entry, kind):
    e = {k: v for k, v in entry.items() if k not in ('notable', 'units', 'mapUrl')}
    e['units'] = [f"{UNITS[u['slug']]}: {u['contacts']} contacts ({u['led']} as the unit in contact)" for u in entry['units']]
    e['notable'] = [compact_contact(c) for c in entry['notable']]
    return e


def slice_(lo, hi, out):
    narratives = ROOT / 'narratives' / 'phases.json'
    written = json.loads(narratives.read_text(encoding='utf-8')) if narratives.exists() else {}
    months = [compact(m, 'month') for k, m in MONTHS.items() if lo <= k <= hi]
    ops = [compact(o, 'operation') for o in OPS.values() if lo <= o['from'][:7] <= hi]
    phases = sorted({s for m in months for s in phase_of(m['month'] + '-15')} | {s for o in ops for s in phase_of(o['from'])},
                    key=lambda s: PHASES[s]['from'])
    data = {
        'range': [lo, hi],
        'phases': [{'slug': s, 'title': PHASES[s]['title'], 'from': PHASES[s]['from'], 'to': PHASES[s]['to'],
                    'narrative': written.get(s, {}).get('text'), 'sources': written.get(s, {}).get('sources')} for s in phases],
        'operations': ops,
        'months': months,
    }
    Path(out).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'{out}: {len(months)} months, {len(ops)} operations, phases {", ".join(phases)}')


def numbers_in(obj):
    text = json.dumps(obj, ensure_ascii=False)
    return {n.replace(',', '') for n in re.findall(r'\d[\d,]*', text)}


def check_entry(kind, key, e, problems):
    facts = MONTHS.get(key) if kind == 'months' else OPS.get(key) if kind == 'operations' else PHASES.get(key)
    where = f'{kind}/{key}'
    if facts is None:
        problems.append(f'{where}: no such {kind[:-1]} in facts.json')
        return
    for field in ('fingerprint', 'summary', 'text', 'sources'):
        if field not in e:
            problems.append(f'{where}: no {field}')
    if e.get('fingerprint') != facts['fingerprint']:
        problems.append(f"{where}: fingerprint {e.get('fingerprint')} is not the facts' {facts['fingerprint']}")
    summary, text, sources = e.get('summary', ''), e.get('text', ''), e.get('sources', [])
    if len(summary.split()) > 30:
        problems.append(f'{where}: summary has {len(summary.split())} words (at most 30)')
    if re.search(r'(^|\n)\s*[#*\-]|\*\*|__|`', text):
        problems.append(f'{where}: text looks like Markdown (headings, bullets or emphasis)')
    paragraphs = [p for p in text.split('\n\n') if p.strip()]
    limit = {'months': 1, 'operations': 3, 'phases': 5}[kind]
    if len(paragraphs) > limit:
        problems.append(f'{where}: {len(paragraphs)} paragraphs (at most {limit})')
    markers = sorted({int(n) for n in re.findall(r'\[(\d+)\]', text + summary)})
    if markers != list(range(1, len(sources) + 1)):
        problems.append(f'{where}: markers {markers} do not match the {len(sources)} source(s)')
    for s in sources:
        url = s.get('url', '')
        if not all(s.get(k) for k in ('title', 'publisher', 'url')):
            problems.append(f'{where}: a source needs a title, publisher and url: {s}')
        elif not re.match(r'https://[^/]*(' + '|'.join(re.escape(d) for d in STANDING) + r')(/|$)', url):
            problems.append(f'{where}: source not of standing (see STYLE.md): {url}')
    # Every number in the text must be in the entry's facts (a phase's include its months'), or be a year, a day of the month, or
    # a small number; or be in a sentence that cites a source (a sourced figure).
    known = numbers_in(facts) | {str(y) for y in range(1939, 1976)} | {str(n) for n in range(0, 32)}
    if kind == 'phases':
        known |= numbers_in([m for k, m in MONTHS.items() if facts['from'][:7] <= k <= facts['to'][:7]])
    sentences = re.split(r'(?<=[.!?\]])\s+', text + ' ' + summary)
    plain = ' '.join(s for s in sentences if not re.search(r'\[\d+\][.!?]?$', s.strip()))
    plain = re.sub(r'\[\d+\]', '', plain)
    plain = re.sub(r'\b\d+(st|nd|rd|th)\b', '', plain)                   # 173rd, 1st, 33rd
    plain = re.sub(r'\b\d+ (RAR|SASR|Squadron|Regiment|Battalion|Field|Troop|Platoon|Company|Division|Brigade|ATF)\b', '', plain)
    plain = re.sub(r'\b(D|No\.?|Route|Highway|FSB|Hill|Toan Thang|Cung Chung|Capital|Briar Patch|Sydney)\s?\d+\b', '', plain)
    plain = re.sub(r'\b\d{1,2}/\d{2}\b', '', plain)                         # numbered operations, 10/65
    unknown = sorted({n.replace(',', '') for n in re.findall(r'\d[\d,]*', plain)} - known, key=lambda n: int(n))
    if unknown:
        problems.append(f'{where}: numbers not in its facts (check them, or cite a source for them): {", ".join(unknown)}')


def check(path, quiet=False):
    doc = json.loads(Path(path).read_text(encoding='utf-8'))
    problems = []
    if 'operations' in doc or 'months' in doc:
        for kind in ('operations', 'months'):
            for key, e in doc.get(kind, {}).items():
                check_entry(kind, key, e, problems)
    else:
        kind = Path(path).stem
        for key, e in doc.items():
            check_entry(kind, key, e, problems)
    for p in problems:
        print(p)
    if not quiet:
        print(f'{path}: {len(problems)} problem(s)')
    return problems


def merge(paths):
    total = {'operations': 0, 'months': 0}
    for kind in ('operations', 'months'):
        target = ROOT / 'narratives' / f'{kind}.json'
        merged = json.loads(target.read_text(encoding='utf-8')) if target.exists() else {}
        for path in paths:
            doc = json.loads(Path(path).read_text(encoding='utf-8'))
            merged.update(doc.get(kind, {}))
            total[kind] += len(doc.get(kind, {}))
        order = (lambda k: OPS[k]['from'] + k) if kind == 'operations' else (lambda k: k)
        merged = {k: merged[k] for k in sorted(merged, key=order)}
        target.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(f"merged {total['operations']} operations and {total['months']} months")


if __name__ == '__main__':
    args = sys.argv[1:]
    if args[:1] == ['slice'] and len(args) == 4:
        slice_(args[1], args[2], args[3])
    elif args[:1] == ['check'] and len(args) >= 2:
        sys.exit(1 if check(args[1]) else 0)
    elif args[:1] == ['merge'] and len(args) >= 2:
        if any(check(p, quiet=True) for p in args[1:]):
            sys.exit('not merged: fix the problems above first')
        merge(args[1:])
    else:
        sys.exit(__doc__)
