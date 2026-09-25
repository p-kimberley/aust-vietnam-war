import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { POINT_LAYER } from './contact-layers';
import { Contact } from './contacts';
import { contacts, render, settle } from './battlemap-testing';
import { NO_OPERATION_COLOUR, OPERATION_COLOURS, operationColourExpression, operationColours } from './operation-colours';

const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const c = (id: number, dtg: string, op: number) => ({ ...contacts[0], id, dtg, op }) as Contact;

// Hardihood (operation 2) starts first, then Coburg (1); the third contact is in no operation.
const WITH_OPS = [c(2, '1966-03-03T19:50:00', 2), c(9, '1966-03-05T08:10:00', 1), c(11, '1966-04-01T00:00:00', 0)];
const NAMES = [{ name: 'Coburg' }, { name: 'Hardihood, Phase 2' }];

describe('operationColours', () => {
  it('hands the colours out in the order the operations started, round again after the last', () => {
    const colours = operationColours(WITH_OPS, NAMES);

    expect([...colours]).toEqual([[2, OPERATION_COLOURS[0]], [1, OPERATION_COLOURS[1]]]);

    const many = Array.from({ length: OPERATION_COLOURS.length + 1 }, (_, i) => c(i + 1, `1967-01-${String(i + 1).padStart(2, '0')}T00:00:00`, i + 1));
    const names = many.map((_, i) => ({ name: `Op ${i + 1}` }));
    expect(operationColours(many, names).get(OPERATION_COLOURS.length + 1)).toBe(OPERATION_COLOURS[0]);
  });

  it('colours a marker by its operation on the map, and grey when it has none', () => {
    expect(operationColourExpression(new Map([[2, '#111111'], [1, '#222222']]))).toEqual(['match', ['get', 'op'], 2, '#111111', 1, '#222222', NO_OPERATION_COLOUR]);
    expect(operationColourExpression(new Map())).toBe(NO_OPERATION_COLOUR);
  });
});

describe('colouring the markers by operation', () => {
  const colourSelect = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLLabelElement>('label')].find((l) => l.textContent?.includes('Marker colour'))!.querySelector('select')!;

  it('colours the markers, the Operations list and the legend alike when chosen, and puts it in the link', async () => {
    const r = await render({ contacts: WITH_OPS });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const bars = () => [...r.el.querySelectorAll<HTMLElement>('.row__bar')].map((b) => b.style.background);
    expect(bars().every((b) => b === '')).toBe(true);

    const select = colourSelect(r.el);
    select.value = 'operation';
    select.dispatchEvent(new Event('change'));
    await settle(r.fixture);
    await wait(450);

    expect(r.basemaps.map.setPaintProperty).toHaveBeenCalledWith(POINT_LAYER, 'circle-color', [
      'match',
      ['get', 'op'],
      2,
      OPERATION_COLOURS[0],
      1,
      OPERATION_COLOURS[1],
      NO_OPERATION_COLOUR,
    ]);
    expect(navigate.mock.calls.at(-1)![1]!.queryParams!['colour']).toBe('operation');

    // The Operations list, earliest first: each bar the colour of its operation's markers.
    const probe = document.createElement('i');
    const css = (hex: string) => ((probe.style.background = hex), probe.style.background);
    expect(bars()).toEqual([css(OPERATION_COLOURS[0]), css(OPERATION_COLOURS[1])]);

    const legend = [...r.el.querySelectorAll('.legend__op-list li')];
    expect(legend.map(text)).toEqual(['Hardihood, Phase 2', 'Coburg', 'No operation']);
    expect(legend.map((li) => li.querySelector('circle')?.getAttribute('fill'))).toEqual([OPERATION_COLOURS[0], OPERATION_COLOURS[1], NO_OPERATION_COLOUR]);
  });

  it('opens a link with the markers coloured by operation', async () => {
    const r = await render({ contacts: WITH_OPS, inputs: { colour: 'operation' } });

    expect(colourSelect(r.el).value).toBe('operation');
    expect(r.el.querySelectorAll('.legend__op-list li')).toHaveLength(3);
  });

  it('keeps every marker red, and the legend plain, by default', async () => {
    const r = await render({ contacts: WITH_OPS });

    expect(colourSelect(r.el).value).toBe('red');
    expect(r.el.querySelector('.legend__op-list')).toBeNull();
    expect(text(r.el.querySelector('.legend__list li'))).toBe('Contact');
  });
});
