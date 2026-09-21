import { describe, expect, it } from 'vitest';
import { fakeMap } from './battlemap-testing';
import { Contact } from './contacts';
import {
  MAX_SEPARATE_TRACKS,
  neighbour,
  TRACK_CASING,
  TRACK_COLOURS,
  TRACK_LINE,
  TRACK_SOURCE,
  TRACK_STOPS,
  addTrackLayers,
  buildTracks,
  setTrackVisibility,
  setTracks,
  toTrackGeoJson,
} from './track';

const c = (id: number, dtg: string, units: number[], lon = 107 + id / 100, lat = 10 + id / 100): Contact => ({
  id, dtg, lat, lon, fr: 0, frCas: 0, en: 0, enCas: 0, frKia: 0, frWia: 0, enKia: 0, enWia: 0, units, op: 0, task: 0, series: 1, mine: 0,
});

const CONTACTS = [
  c(3, '1966-03-05T08:00:00', [1]),
  c(1, '1966-03-03T19:50:00', [1, 2]),
  c(2, '1966-03-03T19:50:00', [1]),           // the same moment as 1: ordered by id
  c(4, '1966-04-01T00:00:00', [2]),
  c(5, '1966-04-02T00:00:00', []),
];

describe('buildTracks', () => {
  it('draws nothing when no unit is chosen', () => {
    expect(buildTracks(CONTACTS, new Set())).toEqual([]);
  });

  it('makes one track for each chosen unit, in date order, ties broken by id, each in its own colour', () => {
    const tracks = buildTracks(CONTACTS, new Set([2, 1]));

    expect(tracks.map((t) => [t.key, t.colour, t.stops.map((s) => s.id)])).toEqual([
      [1, TRACK_COLOURS[0], [1, 2, 3]],
      [2, TRACK_COLOURS[1], [1, 4]],
    ]);
  });

  it('leaves out a unit that has no contacts among those given', () => {
    expect(buildTracks(CONTACTS, new Set([1, 99])).map((t) => t.key)).toEqual([1]);
  });

  it('follows nothing when there are too many units, since paths of a whole battalion overlap in time', () => {
    const many = new Set(Array.from({ length: MAX_SEPARATE_TRACKS + 1 }, (_, i) => i + 1));

    expect(buildTracks(CONTACTS, many)).toEqual([]);
    expect(buildTracks(CONTACTS, new Set(Array.from({ length: MAX_SEPARATE_TRACKS }, (_, i) => i + 1))).length).toBeGreaterThan(0);
  });

  it('does not change the contacts it is given', () => {
    const before = CONTACTS.map((x) => x.id);

    buildTracks(CONTACTS, new Set([1]));

    expect(CONTACTS.map((x) => x.id)).toEqual(before);
  });
});

describe('neighbour', () => {
  const track = buildTracks(CONTACTS, new Set([1]))[0];           // contacts 1, 2, 3 in that order

  it('steps forward and back along the track, staying at the ends', () => {
    expect(neighbour(track, 2, 1)?.id).toBe(3);
    expect(neighbour(track, 2, -1)?.id).toBe(1);
    expect(neighbour(track, 3, 1)?.id).toBe(3);
    expect(neighbour(track, 1, -1)?.id).toBe(1);
  });

  it('starts at the first when going forward and the last when going back, with nothing selected or something off the track', () => {
    expect(neighbour(track, null, 1)?.id).toBe(1);
    expect(neighbour(track, null, -1)?.id).toBe(3);
    expect(neighbour(track, 99, 1)?.id).toBe(1);
  });

  it('gives nothing for an empty track', () => {
    expect(neighbour({ key: 9, colour: '#fff', stops: [] }, null, 1)).toBeNull();
  });
});

describe('toTrackGeoJson', () => {
  it('draws a line through the places in order and a stop at every contact, marking the first and last', () => {
    const geo = toTrackGeoJson(buildTracks(CONTACTS, new Set([1])));

    const line = geo.features.find((f) => f.geometry.type === 'LineString')!;
    expect((line.geometry as GeoJSON.LineString).coordinates).toEqual([[107.01, 10.01], [107.02, 10.02], [107.03, 10.03]]);
    expect(line.properties).toMatchObject({ key: 1, colour: TRACK_COLOURS[0], count: 3 });
    const stops = geo.features.filter((f) => f.geometry.type === 'Point');
    expect(stops.map((s) => [s.properties.order, s.properties.end])).toEqual([[1, 'first'], [2, 'middle'], [3, 'last']]);
  });

  it('does not repeat a place in the line when contacts sit on the same spot, but still marks each contact', () => {
    const same = [c(1, '1966-03-01T00:00:00', [1], 107, 10), c(2, '1966-03-02T00:00:00', [1], 107, 10), c(3, '1966-03-03T00:00:00', [1], 107.1, 10.1)];

    const geo = toTrackGeoJson(buildTracks(same, new Set([1])));

    expect((geo.features.find((f) => f.geometry.type === 'LineString')!.geometry as GeoJSON.LineString).coordinates).toEqual([[107, 10], [107.1, 10.1]]);
    expect(geo.features.filter((f) => f.geometry.type === 'Point')).toHaveLength(3);
  });

  it('gives a track of one place stops but no line', () => {
    const geo = toTrackGeoJson(buildTracks([c(1, '1966-03-01T00:00:00', [1])], new Set([1])));

    expect(geo.features.map((f) => f.geometry.type)).toEqual(['Point']);
    expect(geo.features[0].properties.end).toBe('first');
  });

  it('is empty for no tracks', () => {
    expect(toTrackGeoJson([]).features).toEqual([]);
  });
});

describe('track layers', () => {
  it('adds the source and layers once, hidden when tracking is off, and puts the lines under the stops', () => {
    const map = fakeMap();

    addTrackLayers(map as never, [], false);
    addTrackLayers(map as never, [], false);

    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect([...map.layers]).toEqual([TRACK_CASING, TRACK_LINE, TRACK_STOPS]);
    expect(map.addLayer.mock.calls.map(([l]) => (l as unknown as { layout: { visibility: string } }).layout.visibility)).toEqual(['none', 'none', 'none']);
  });

  it('adds the layers visible when tracking is on', () => {
    const map = fakeMap();

    addTrackLayers(map as never, [], true);

    expect(map.addLayer.mock.calls.map(([l]) => (l as unknown as { layout: { visibility: string } }).layout.visibility)).toEqual(['visible', 'visible', 'visible']);
  });

  it('replaces the data, and shows or hides every layer', () => {
    const map = fakeMap();
    addTrackLayers(map as never, [], false);

    setTracks(map as never, buildTracks(CONTACTS, new Set([1])));
    setTrackVisibility(map as never, true);

    expect(map.dataFor(TRACK_SOURCE)).toHaveBeenCalledOnce();
    expect(map.setLayoutProperty.mock.calls.map(([id, prop, value]) => [id, prop, value])).toEqual([
      [TRACK_CASING, 'visibility', 'visible'],
      [TRACK_LINE, 'visibility', 'visible'],
      [TRACK_STOPS, 'visibility', 'visible'],
    ]);
  });

  it('does nothing before the layers exist', () => {
    const map = fakeMap();

    setTracks(map as never, []);
    setTrackVisibility(map as never, true);

    expect(map.setLayoutProperty).not.toHaveBeenCalled();
  });
});
