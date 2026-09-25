import { describe, expect, it, vi } from 'vitest';
import { PicturePlacementService } from './picture-placement.service';

/** Every pin put on a map, newest last, with what was done to it. */
const markers: FakeMarker[] = [];

class FakeMarker {
  readonly handlers: Record<string, () => void> = {};
  at: [number, number] = [0, 0];
  map: unknown = null;
  constructor(readonly options: { element: HTMLElement; anchor: string; draggable: boolean }) {
    markers.push(this);
  }
  setLngLat(at: [number, number]) {
    this.at = at;
    return this;
  }
  getLngLat() {
    return { lng: this.at[0], lat: this.at[1] };
  }
  addTo(map: unknown) {
    this.map = map;
    return this;
  }
  on(event: string, handler: () => void) {
    this.handlers[event] = handler;
    return this;
  }
  getElement() {
    return this.options.element;
  }
  remove = vi.fn();
}

vi.mock('maplibre-gl', () => ({ Marker: FakeMarker }));

function setup() {
  markers.length = 0;
  const canvas = document.createElement('div');
  const inside = document.createElement('canvas');
  canvas.append(inside);
  document.body.append(canvas);
  canvas.getBoundingClientRect = () => ({ left: 100, top: 50, right: 1100, bottom: 850, width: 1000, height: 800, x: 100, y: 50, toJSON: () => null });
  const map = {
    getCanvasContainer: () => canvas,
    // 1000 pixels to the degree, from 107 E, 11 N at the top left.
    unproject: ([x, y]: [number, number]) => ({ lng: 107 + x / 1000, lat: 11 - y / 1000 }),
    getCenter: () => ({ lat: 10.55, lng: 107.17 }),
    getBounds: () => ({ contains: () => true }),
    easeTo: vi.fn(),
  };
  const service = new PicturePlacementService();
  service.attach(map as never);
  return { service, map, canvas, inside };
}

const settle = () => new Promise((r) => setTimeout(r));

describe('PicturePlacementService', () => {
  it('drops a draggable pin, tip down, where the pointer was let go over the map', async () => {
    const { service, inside } = setup();
    document.elementFromPoint = vi.fn(() => inside);

    expect(service.dropAt(400, 250)).toBe(true);
    await settle();

    expect(service.place()).toEqual({ lat: 10.8, lon: 107.3 });
    expect(markers).toHaveLength(1);
    expect(markers[0].options).toMatchObject({ anchor: 'bottom', draggable: true });
    expect(markers[0].at).toEqual([107.3, 10.8]);
  });

  it('does not drop the pin on a panel lying over the map', () => {
    const { service } = setup();
    const panel = document.createElement('aside');
    document.body.append(panel);
    document.elementFromPoint = vi.fn(() => panel);

    expect(service.dropAt(400, 250)).toBe(false);
    expect(service.place()).toBeNull();
  });

  it('follows the pin as it is dragged about, moving the one pin rather than adding another', async () => {
    const { service, inside } = setup();
    document.elementFromPoint = vi.fn(() => inside);
    service.dropAt(400, 250);
    await settle();

    markers[0].setLngLat([107.31, 10.81]);
    markers[0].handlers['dragend']();
    expect(service.place()).toEqual({ lat: 10.81, lon: 107.31 });

    service.dropAt(600, 450);
    await settle();
    expect(markers).toHaveLength(1);
    expect(markers[0].at).toEqual([107.5, 10.6]);
  });

  it('can put the pin in the middle of the map instead', async () => {
    const { service } = setup();

    service.placeAtCentre();
    await settle();

    expect(service.place()).toEqual({ lat: 10.55, lon: 107.17 });
    expect(markers[0].at).toEqual([107.17, 10.55]);
  });

  it('shows the chosen picture on the pin, and an empty frame without one', async () => {
    const { service } = setup();
    service.placeAtCentre();
    await settle();
    const element = markers[0].getElement();
    expect(element.querySelector('img')).toBeNull();

    service.setPreview('blob:picture');

    expect(element.querySelector('img')?.getAttribute('src')).toBe('blob:picture');
  });

  it('keeps a click on the pin from reaching the map', async () => {
    const { service, canvas } = setup();
    service.placeAtCentre();
    await settle();
    const onMap = vi.fn();
    canvas.addEventListener('click', onMap);
    canvas.append(markers[0].getElement());

    markers[0].getElement().click();

    expect(onMap).not.toHaveBeenCalled();
  });

  it('takes the pin away and forgets the place when cleared', async () => {
    const { service } = setup();
    service.placeAtCentre();
    await settle();

    service.clear();

    expect(markers[0].remove).toHaveBeenCalled();
    expect(service.place()).toBeNull();
  });
});
