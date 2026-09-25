import { describe, expect, it } from 'vitest';
import { POINT_LAYER } from './contact-layers';
import { Contact } from './contacts';
import { contacts, render } from './battlemap-testing';

const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim();
const lines = (e: HTMLElement | null | undefined) => [...(e?.querySelectorAll('p') ?? [])].map(text);

// In the shared catalogue, operation 2 is "Hardihood, Phase 2" and unit task 1 is "Ambush".
const IN_OPERATION = { ...contacts[0], op: 2, task: 1 } as Contact;
const NOTHING_KNOWN = { ...contacts[1], op: 0, task: 0 } as Contact;

describe('the tooltip over an incident marker', () => {
  it('says when it happened, what kind of incident it was and its operation, or that the kind is not recorded', async () => {
    const r = await render({ contacts: [IN_OPERATION, NOTHING_KNOWN, contacts[2]] });
    const tip = r.basemaps.tips.get(POINT_LAYER)!;

    expect(lines(tip({ id: IN_OPERATION.id }))).toEqual(['3 Mar 1966 19:50', 'Type: Ambush', 'Operation: Hardihood, Phase 2']);
    expect(lines(tip({ id: NOTHING_KNOWN.id }))).toEqual(['5 Mar 1966 08:10', 'Type: Not recorded']);
    expect(tip({ id: 12345 })).toBeNull();
  });

  it('shows names from the data as text, never as markup', async () => {
    const r = await render({
      contacts: [IN_OPERATION],
      catalogue: { ...(await import('./filter-fixtures')).CATALOGUE, tasks: [{ name: '<b>Ambush</b>', count: 1 }] },
    });

    const tip = r.basemaps.tips.get(POINT_LAYER)!({ id: IN_OPERATION.id })!;
    expect(tip.querySelector('b')).toBeNull();
    expect(text(tip)).toContain('<b>Ambush</b>');
  });
});
