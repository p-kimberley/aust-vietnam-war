import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { LayerRow } from './layer-row';

@Component({
  imports: [LayerRow],
  template: `
    <app-layer-row [label]="label" [expandable]="expandable">
      <label primary><input type="checkbox" />Heatmap</label>
      <p options>The options</p>
    </app-layer-row>
  `,
})
class Host {
  label = 'Heatmap options';
  expandable = true;
}

function setup(expandable = true) {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture: ComponentFixture<Host> = TestBed.createComponent(Host);
  fixture.componentInstance.expandable = expandable;
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    el,
    toggle: () => el.querySelector<HTMLButtonElement>('.toggle'),
    body: () => el.querySelector('.options'),
  };
}

describe('LayerRow', () => {
  it('always shows what was put in the primary slot', () => {
    const { el } = setup();
    expect(el.textContent).toContain('Heatmap');
  });

  it('starts shut, with the options out of the accessibility tree, and opens on the arrow', () => {
    const { fixture, el, toggle, body } = setup();

    expect(toggle()!.getAttribute('aria-expanded')).toBe('false');
    expect(toggle()!.getAttribute('aria-label')).toBe('Heatmap options');
    expect(body()!.classList.contains('is-open')).toBe(false);
    expect(el.textContent).toContain('The options');                    // present, but hidden by the closed grid row, not removed

    toggle()!.click();
    fixture.detectChanges();

    expect(toggle()!.getAttribute('aria-expanded')).toBe('true');
    expect(body()!.classList.contains('is-open')).toBe(true);
  });

  it('shuts again on a second click of the same arrow', () => {
    const { fixture, toggle, body } = setup();

    toggle()!.click();
    fixture.detectChanges();
    toggle()!.click();
    fixture.detectChanges();

    expect(toggle()!.getAttribute('aria-expanded')).toBe('false');
    expect(body()!.classList.contains('is-open')).toBe(false);
  });

  it('links the arrow to the options region for a screen reader', () => {
    const { toggle, body } = setup();

    expect(toggle()!.getAttribute('aria-controls')).toBe(body()!.id);
    expect(body()!.getAttribute('aria-labelledby')).toBe(toggle()!.id);
  });

  it('has no arrow and no options region when there is nothing to configure', () => {
    const { el, toggle, body } = setup(false);

    expect(toggle()).toBeNull();
    expect(body()).toBeNull();
    expect(el.textContent).toContain('Heatmap');                        // the primary slot still shows
  });
});
