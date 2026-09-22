import { Injectable, computed, signal } from '@angular/core';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { setSelectedContact } from './contact-layers';
import { setSelectedPhoto } from './photo-layers';
import { setSelectedPoi } from './poi-layers';

/** The tab an incident opens on. Search sends a note's reader straight to the notes; anything else starts on the details. */
export type IncidentTab = 'details' | 'notes';

/**
 * Which one thing is open at the right of the map — an incident, a point of interest, a community picture, or a person on the
 * honour roll — never more than one at a time. Picking one closes whatever else was open, both in the panel and, where the map
 * marks a selection (a contact, a base or a photo), on the map itself.
 *
 * Provided per map component, like `BasemapService`: one instance per map. Call `attach` once the map exists (selecting before
 * then just holds the state; there is nothing yet to highlight).
 */
@Injectable()
export class MapSelectionService {
  private map?: MapLibreMap;

  readonly selectedId = signal<number | null>(null);
  readonly selectedPoiId = signal<number | null>(null);
  readonly selectedPictureId = signal<number | null>(null);
  /** The service number of the person on the honour roll whose panel is open. */
  readonly selectedPerson = signal<string | null>(null);
  readonly incidentTab = signal<IncidentTab>('details');

  /** Something is open at the right, so what else sits there moves aside. */
  readonly anyOpen = computed(
    () => this.selectedId() !== null || this.selectedPoiId() !== null || this.selectedPictureId() !== null || this.selectedPerson() !== null,
  );

  attach(map: MapLibreMap): void {
    this.map = map;
  }

  /** Opens the incident panel for a contact (or closes it), ringing the marker. */
  select(id: number | null): void {
    this.incidentTab.set('details');
    this.selectedId.set(id);
    if (id !== null) {
      this.selectedPoiId.set(null);
      this.selectedPerson.set(null);
      this.selectedPictureId.set(null);
    }
    if (this.map) {
      setSelectedContact(this.map, id);
      if (id !== null) {
        setSelectedPoi(this.map, null);
        setSelectedPhoto(this.map, null);
      }
    }
  }

  /** Opens the panel for a point of interest (or closes it), closing whatever else was open. */
  selectPoi(id: number | null): void {
    this.selectedPoiId.set(id);
    if (id !== null) {
      this.selectedId.set(null);
      this.selectedPerson.set(null);
      this.selectedPictureId.set(null);
    }
    if (this.map) {
      setSelectedPoi(this.map, id);
      if (id !== null) {
        setSelectedContact(this.map, null);
        setSelectedPhoto(this.map, null);
      }
    }
  }

  /** Opens the panel for a community picture (or closes it), closing whatever else was open. */
  selectPicture(id: number | null): void {
    this.selectedPictureId.set(id);
    if (id !== null) {
      this.selectedId.set(null);
      this.selectedPoiId.set(null);
      this.selectedPerson.set(null);
    }
    if (this.map) {
      setSelectedPhoto(this.map, id);
      if (id !== null) {
        setSelectedContact(this.map, null);
        setSelectedPoi(this.map, null);
      }
    }
  }

  /** Opens a person's page on the honour roll (or closes it), closing whatever else was open. */
  openPerson(serviceNumber: string | null): void {
    this.selectedPerson.set(serviceNumber);
    if (serviceNumber !== null) {
      this.selectedId.set(null);
      this.selectedPoiId.set(null);
      this.selectedPictureId.set(null);
      if (this.map) {
        setSelectedContact(this.map, null);
        setSelectedPoi(this.map, null);
        setSelectedPhoto(this.map, null);
      }
    }
  }

  /** Closes whatever is open, wherever it was opened from: a click on empty map does this. */
  clear(): void {
    if (this.selectedId() !== null) {
      this.select(null);
    }
    if (this.selectedPoiId() !== null) {
      this.selectPoi(null);
    }
    if (this.selectedPictureId() !== null) {
      this.selectPicture(null);
    }
  }
}
