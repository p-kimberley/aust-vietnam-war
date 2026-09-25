import { Injectable, OnDestroy, signal } from '@angular/core';
import type { Map, Marker } from 'maplibre-gl';

export interface Place {
  lat: number;
  lon: number;
}

// Colours match the style guide tokens in styles.scss; the pin lives in the map's own DOM, outside any component's styles.
const INK = '#22251a';
const PAPER = '#efe7cc';
const SMOKE_YELLOW = '#e3b92e';

/**
 * Where a picture being uploaded is to go on the map, and the pin that shows it. The pin is dropped onto the map from the pictures
 * panel (or put in the middle of the view), then can be dragged about until the picture is sent. It shows the picture itself once one
 * is chosen, so it is clear what is being placed.
 *
 * Provided per map component, like `BasemapService`; call `attach` once the map exists.
 */
@Injectable()
export class PicturePlacementService implements OnDestroy {
  private map?: Map;
  private marker?: Marker;
  private preview: string | null = null;

  /** Where the pin is, or `null` before it has been put on the map. */
  readonly place = signal<Place | null>(null);

  attach(map: Map): void {
    this.map = map;
  }

  /** Whether there is a map to put a pin on. */
  get ready(): boolean {
    return !!this.map;
  }

  /**
   * Drops the pin where the pointer was let go, if that was over the map itself (not over a panel lying on it). Returns whether it
   * was. The point is on the screen; the pin's tip goes there.
   */
  dropAt(clientX: number, clientY: number): boolean {
    const map = this.map;
    if (!map) {
      return false;
    }
    const canvas = map.getCanvasContainer();
    const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(clientX, clientY) : null;
    if (!hit || !canvas.contains(hit)) {
      return false;
    }
    const rect = canvas.getBoundingClientRect();
    const at = map.unproject([clientX - rect.left, clientY - rect.top]);
    void this.put({ lat: at.lat, lon: at.lng });
    return true;
  }

  /** Puts the pin in the middle of what the map shows: for the keyboard, and anyone who would rather not drag. */
  placeAtCentre(): void {
    const c = this.map?.getCenter();
    if (c) {
      void this.put({ lat: c.lat, lon: c.lng });
    }
  }

  /** The picture the pin shows (an object URL for the chosen file), or `null` for a plain pin. */
  setPreview(url: string | null): void {
    this.preview = url;
    if (this.marker) {
      this.drawPin(this.marker.getElement(), url);
    }
  }

  /** Takes the pin off the map and forgets the place. */
  clear(): void {
    this.marker?.remove();
    this.marker = undefined;
    this.place.set(null);
  }

  ngOnDestroy(): void {
    this.clear();
  }

  private async put(place: Place): Promise<void> {
    this.place.set(place);
    const map = this.map;
    if (!map) {
      return;
    }
    if (!this.marker) {
      const { Marker } = await import('maplibre-gl');
      const element = document.createElement('div');
      this.drawPin(element, this.preview);
      // A click on the pin is not a click on the empty map (which would close whatever is open).
      element.addEventListener('click', (e) => e.stopPropagation());
      this.marker = new Marker({ element, anchor: 'bottom', draggable: true }).setLngLat([place.lon, place.lat]).addTo(map);
      this.marker.on('dragend', () => {
        const at = this.marker!.getLngLat();
        this.place.set({ lat: at.lat, lon: at.lng });
      });
    } else {
      this.marker.setLngLat([place.lon, place.lat]);
    }
    // Keep the pin in view: a drop at the very edge would leave it half off the map.
    if (!map.getBounds().contains([place.lon, place.lat])) {
      map.easeTo({ center: [place.lon, place.lat], duration: 400 });
    }
  }

  /** A framed picture (or an empty frame) on a stalk, with its tip at the place. */
  private drawPin(element: HTMLElement, url: string | null): void {
    element.className = 'avw-place-pin';
    element.setAttribute('aria-label', 'Where the picture goes. Drag to move it.');
    element.title = 'Drag to move';
    Object.assign(element.style, { width: '56px', height: '72px', cursor: 'grab', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.5))' });
    const frame = styled('div', { boxSizing: 'border-box', width: '56px', height: '56px', padding: '3px', background: PAPER, border: `2px solid ${INK}`, borderRadius: '4px', overflow: 'hidden' });
    if (url) {
      const img = styled('img', { display: 'block', width: '100%', height: '100%', objectFit: 'cover' });
      img.alt = '';
      img.draggable = false;
      img.src = url;
      frame.append(img);
    } else {
      frame.append(styled('div', { width: '100%', height: '100%', background: SMOKE_YELLOW, opacity: '0.5' }));
    }
    const tip = styled('div', { width: '0', height: '0', margin: '-1px auto 0', borderLeft: '9px solid transparent', borderRight: '9px solid transparent', borderTop: `15px solid ${INK}` });
    element.replaceChildren(frame, tip);
  }
}

function styled<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration>): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  Object.assign(element.style, style);
  return element;
}
