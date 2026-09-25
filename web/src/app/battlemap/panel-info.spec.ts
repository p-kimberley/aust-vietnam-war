import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { render, settle } from './battlemap-testing';
import { PanelInfo } from './panel-info';

@Component({
  imports: [PanelInfo],
  template: `<h2>Charts</h2><app-panel-info subject="the charts" text="What the charts are for." /><button id="elsewhere">x</button>`,
})
class Host {}

function mount() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(Host);
  fixture.autoDetectChanges();
  document.body.append(fixture.nativeElement);
  const el = fixture.nativeElement as HTMLElement;
  const button = el.querySelector<HTMLButtonElement>('.info')!;
  const note = () => el.querySelector('.info__text');
  return { fixture, el, button, note };
}

describe('the info button beside a panel heading', () => {
  it('shows what the panel is for when pressed, and puts it away when pressed again', async () => {
    const { fixture, button, note } = mount();
    expect(button.getAttribute('aria-label')).toBe('About the charts');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(note()).toBeNull();

    button.click();
    await fixture.whenStable();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(note()?.textContent).toBe('What the charts are for.');
    expect(button.getAttribute('aria-controls')).toBe(note()!.id);

    button.click();
    await fixture.whenStable();
    expect(note()).toBeNull();
  });

  it('puts it away on Escape, back on the button, and on a click anywhere else', async () => {
    const { fixture, el, button, note } = mount();
    button.click();
    await fixture.whenStable();
    note()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(note()).toBeNull();
    expect(document.activeElement).toBe(button);

    button.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('#elsewhere')!.click();
    await fixture.whenStable();
    expect(note()).toBeNull();
  });
});

describe('the Battle Map panels', () => {
  it('put an info button after each heading, Layers and Filters with their own words', async () => {
    const r = await render({ queryParams: { charts: '1' } });
    const about = () => [...r.el.querySelectorAll('.info')].map((b) => b.getAttribute('aria-label'));
    expect(about()).toContain('About the layers');

    r.el.querySelector<HTMLButtonElement>('#right-tab-filters')!.click();
    await settle(r.fixture);
    expect(about()).toContain('About the filters');
    expect(about()).not.toContain('About the layers');
  });
});
