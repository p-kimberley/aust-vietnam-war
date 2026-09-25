import { Contact, formatDtg } from './contacts';

/** The names a contact's numbered fields point into (the filter catalogue's), or `null` before the catalogue has come. */
export type TipNames = { operations: readonly { name: string }[]; tasks: readonly { name: string }[] } | null;

/**
 * What the tooltip over an incident marker says: when it happened, what kind of incident it was (its unit task), and the
 * operation it belongs to when it belongs to one. Built from text nodes, never markup, since the names come from the data.
 */
export function markerTip(contact: Contact, names: TipNames): HTMLElement {
  const task = contact.task > 0 ? names?.tasks[contact.task - 1]?.name : undefined;
  const operation = contact.op > 0 ? names?.operations[contact.op - 1]?.name : undefined;

  const tip = document.createElement('div');
  tip.className = 'marker-tip';
  const when = document.createElement('p');
  when.className = 'marker-tip__when';
  when.textContent = formatDtg(contact.dtg);
  tip.append(when);
  const line = (label: string, value: string) => {
    const p = document.createElement('p');
    const b = document.createElement('span');
    b.className = 'marker-tip__label';
    b.textContent = `${label}: `;
    p.append(b, value);
    tip.append(p);
  };
  line('Type', task ?? 'Not recorded');
  if (operation) {
    line('Operation', operation);
  }
  return tip;
}
