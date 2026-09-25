import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import { operationSpans } from './analytics/timeline';
import { Contact } from './contacts';

/**
 * The colours operations are told apart by, on the incident markers and on the bars of the Operations list alike. Chosen to
 * read on both the light and the dark basemaps and to stand apart from one another; none is the markers' usual red.
 */
export const OPERATION_COLOURS = [
  '#e3b92e',
  '#3f7fbf',
  '#d9822b',
  '#4f9a4a',
  '#9b59b6',
  '#1fa39a',
  '#c2185b',
  '#8d6e4a',
  '#5c6bc0',
  '#8bc34a',
  '#f08a6c',
  '#00acc1',
] as const;

/** A contact that belongs to no operation. */
export const NO_OPERATION_COLOUR = '#8c8778';

/**
 * Each operation's colour, by its 1-based number. They are handed out in the order the operations started (the order of the
 * Operations list), so operations that ran at the same time, which sit next to each other there, are never the same colour
 * unless more than a round of the colours apart. Worked out from every contact, not the filtered ones, so an operation keeps
 * its colour as the filters change.
 */
export function operationColours(all: readonly Contact[], operations: readonly { name: string }[]): ReadonlyMap<number, string> {
  return new Map(operationSpans(all, operations).map((s, i) => [s.op, OPERATION_COLOURS[i % OPERATION_COLOURS.length]]));
}

/** The map's colour for a marker, from its operation; a contact in no operation, or one not in `colours`, is grey. */
export function operationColourExpression(colours: ReadonlyMap<number, string>): ExpressionSpecification | string {
  if (colours.size === 0) {
    return NO_OPERATION_COLOUR;
  }
  const pairs = [...colours].flatMap(([op, colour]) => [op, colour]);
  return ['match', ['get', 'op'], ...pairs, NO_OPERATION_COLOUR] as unknown as ExpressionSpecification;
}
