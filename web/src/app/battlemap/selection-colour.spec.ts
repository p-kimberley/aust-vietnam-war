import { describe, expect, it } from 'vitest';
import { SELECTION_YELLOW, parseColour, selectionColour } from './selection-colour';

/** A style whose bottom layer is a background of `colour`, as the vector basemaps' are. */
const background = (colour: string) => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': colour } }] }) as never;

describe('selectionColour', () => {
  it.each([
    ['vintage', '#e9dfbc'],
    ['terrain', 'hsl(47, 26%, 88%)'],
  ])('rings in a deep blue, opposite the warm beige of %s', (_name, colour) => {
    expect(selectionColour(background(colour))).toMatch(/^hsl\(22\d, 85%, 34%\)$/);
  });

  it.each([
    ['positron', 'rgb(242,243,240)'],
    ['plain white', '#fff'],
  ])('rings in cobalt on a light grey basemap (%s), which has no hue to stand against', (_name, colour) => {
    expect(selectionColour(background(colour))).toBe('hsl(215, 85%, 34%)');
  });

  it('keeps the yellow on a dark basemap', () => {
    expect(selectionColour(background('rgb(12,12,12)'))).toBe(SELECTION_YELLOW);
  });

  it('keeps the yellow on imagery, and where the style says nothing it can read', () => {
    expect(selectionColour({ version: 8, sources: {}, layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }] } as never)).toBe(SELECTION_YELLOW);
    expect(selectionColour(undefined)).toBe(SELECTION_YELLOW);
    expect(selectionColour(background('not a colour'))).toBe(SELECTION_YELLOW);
    expect(selectionColour({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': ['get', 'x'] } }] } as never)).toBe(
      SELECTION_YELLOW,
    );
  });
});

describe('parseColour', () => {
  it.each([
    ['#e9dfbc', [233, 223, 188]],
    ['#fff', [255, 255, 255]],
    ['rgb(12,12,12)', [12, 12, 12]],
    ['rgba(10, 20, 30, 0.5)', [10, 20, 30]],
    ['hsl(0, 100%, 50%)', [255, 0, 0]],
  ])('reads %s', (text, rgb) => {
    expect(parseColour(text)!.map(Math.round)).toEqual(rgb);
  });

  it('reads nothing from what is not a colour', () => {
    expect(parseColour('red')).toBeNull();
    expect(parseColour('rgb(1,2)')).toBeNull();
  });
});
