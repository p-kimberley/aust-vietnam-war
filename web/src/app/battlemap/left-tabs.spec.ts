import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { LeftTab, LeftTabs } from './left-tabs';

const TABS: LeftTab[] = [
  { id: 'charts', label: 'Charts' },
  { id: 'roll', label: 'Nominal roll' },
  { id: 'later', label: 'Something else' },
];

function setup(active: string | null = null) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const f = TestBed.createComponent(LeftTabs);
  f.componentRef.setInput('tabs', TABS);
  f.componentRef.setInput('active', active);
  const changes = vi.fn();
  f.componentInstance.active.subscribe(changes);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const tabs = () => [...el.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  const press = (i: number, key: string) => {
    tabs()[i].dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    f.detectChanges();
  };
  return { f, el, tabs, changes, press };
}

describe('LeftTabs', () => {
  it('is a vertical list of tabs, one for each tool, with the label running down the tab', () => {
    const { el, tabs } = setup();
    const list = el.querySelector('[role=tablist]')!;

    expect(list.getAttribute('aria-orientation')).toBe('vertical');
    expect(list.getAttribute('aria-label')).toBe('Map tools');
    expect(tabs().map((t) => t.textContent!.trim())).toEqual(['Charts', 'Nominal roll', 'Something else']);
    expect(tabs().every((t) => t.querySelector('.tab__text') !== null)).toBe(true);
    expect(tabs().every((t) => t.type === 'button')).toBe(true);
  });

  it('marks the open tab, and points every tab at the panel it opens', () => {
    const { tabs } = setup('roll');

    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(tabs().map((t) => t.classList.contains('is-on'))).toEqual([false, true, false]);
    expect(tabs().every((t) => t.getAttribute('aria-controls') === 'left-flyout')).toBe(true);
    expect(tabs().map((t) => t.id)).toEqual(['left-tab-charts', 'left-tab-roll', 'left-tab-later']);
  });

  it('opens a tab that is pressed, and shuts the tab that is open when it is pressed again', () => {
    const { f, tabs, changes } = setup();

    tabs()[1].click();
    f.detectChanges();
    expect(changes).toHaveBeenLastCalledWith('roll');
    expect(f.componentInstance.active()).toBe('roll');

    tabs()[1].click();
    f.detectChanges();
    expect(changes).toHaveBeenLastCalledWith(null);
    expect(f.componentInstance.active()).toBeNull();
  });

  it('opens another tool in place of the open one when its tab is pressed', () => {
    const { f, tabs, changes } = setup('charts');

    tabs()[2].click();
    f.detectChanges();

    expect(changes).toHaveBeenLastCalledWith('later');
  });

  it('puts one tab in the tab order: the open one, or the first', () => {
    expect(setup().tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(setup('roll').tabs().map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('moves between tabs with the up and down arrows, Home and End, and stops at the ends', () => {
    const { f, tabs, press } = setup();
    document.body.append(f.nativeElement);                    // focus only moves within the page
    try {
      press(0, 'ArrowDown');
      expect(document.activeElement).toBe(tabs()[1]);
      press(1, 'ArrowDown');
      expect(document.activeElement).toBe(tabs()[2]);
      press(2, 'ArrowDown');
      expect(document.activeElement).toBe(tabs()[2]);
      press(2, 'Home');
      expect(document.activeElement).toBe(tabs()[0]);
      press(0, 'ArrowUp');
      expect(document.activeElement).toBe(tabs()[0]);
      press(0, 'End');
      expect(document.activeElement).toBe(tabs()[2]);
    } finally {
      f.nativeElement.remove();
    }
  });

  it('leaves other keys alone, so Enter and Space press the tab as they do any button', () => {
    const { tabs } = setup();
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

    tabs()[0].dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('can be given a different id for the panel', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const f = TestBed.createComponent(LeftTabs);
    f.componentRef.setInput('tabs', TABS);
    f.componentRef.setInput('panelId', 'other-panel');
    f.detectChanges();

    expect(f.nativeElement.querySelector('[role=tab]').getAttribute('aria-controls')).toBe('other-panel');
  });
});
