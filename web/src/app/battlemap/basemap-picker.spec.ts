import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { BasemapPicker } from './basemap-picker';

const OPTIONS = [
  { id: 'vintage', name: 'Vintage' },
  { id: 'terrain', name: 'Terrain' },
  { id: 'bright', name: 'Bright' },
  { id: 'positron', name: 'Light' },
  { id: 'dark-matter', name: 'Dark' },
];

async function render(value: string | null = 'terrain', options = OPTIONS) {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(BasemapPicker);
  fixture.componentRef.setInput('options', options);
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('labelledBy', 'label-1');
  const picked = vi.fn();
  fixture.componentInstance.picked.subscribe(picked);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const button = el.querySelector<HTMLButtonElement>('[role=combobox]')!;
  const list = () => el.querySelector('[role=listbox]');
  const optionEls = () => [...el.querySelectorAll<HTMLElement>('[role=option]')];
  const press = async (key: string) => {
    button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { fixture, el, button, list, optionEls, press, settle, picked };
}

const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim();

describe('BasemapPicker', () => {
  it('shows the basemap in use, with a picture of it, and keeps the list closed', async () => {
    const { button, list } = await render('terrain');

    expect(text(button)).toBe('Terrain');
    expect(button.querySelector('app-basemap-icon svg')).not.toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-haspopup')).toBe('listbox');
    expect(button.getAttribute('aria-labelledby')).toBe('label-1');
    expect(list()).toBeNull();
  });

  it('opens a list with every basemap and its own picture, marking the one in use', async () => {
    const { button, list, optionEls, settle } = await render('terrain');

    button.click();
    await settle();

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(list()!.getAttribute('aria-labelledby')).toBe('label-1');
    expect(button.getAttribute('aria-controls')).toBe(list()!.id);
    expect(optionEls().map(text)).toEqual(['Vintage', 'Terrain', 'Bright', 'Light', 'Dark']);
    expect(optionEls().every((o) => o.querySelector('svg') !== null)).toBe(true);
    expect(optionEls().map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false', 'false']);
    // The pictures differ, so each basemap can be told apart by its look.
    const lands = optionEls().map((o) => o.querySelector('rect')!.getAttribute('fill'));
    expect(new Set(lands).size).toBe(OPTIONS.length);
  });

  it('chooses a basemap when it is clicked, and closes', async () => {
    const { button, list, optionEls, settle, picked } = await render('terrain');
    button.click();
    await settle();

    optionEls()[4].click();
    await settle();

    expect(picked).toHaveBeenCalledExactlyOnceWith('dark-matter');
    expect(list()).toBeNull();
  });

  it('closes on a click elsewhere, choosing nothing', async () => {
    const { button, list, settle, picked } = await render('terrain');
    button.click();
    await settle();

    document.body.click();
    await settle();

    expect(list()).toBeNull();
    expect(picked).not.toHaveBeenCalled();
  });

  it('works from the keyboard: arrows move, Enter chooses, Escape closes, Home and End jump', async () => {
    const { button, list, optionEls, press, picked } = await render('terrain');

    await press('ArrowDown');                                    // opens on the one in use
    expect(list()).not.toBeNull();
    expect(button.getAttribute('aria-activedescendant')).toBe(optionEls()[1].id);

    await press('ArrowDown');
    expect(button.getAttribute('aria-activedescendant')).toBe(optionEls()[2].id);
    await press('End');
    expect(button.getAttribute('aria-activedescendant')).toBe(optionEls()[4].id);
    await press('ArrowDown');                                    // stays at the end
    expect(button.getAttribute('aria-activedescendant')).toBe(optionEls()[4].id);
    await press('Home');
    await press('ArrowUp');                                      // stays at the start
    expect(button.getAttribute('aria-activedescendant')).toBe(optionEls()[0].id);

    await press('Escape');
    expect(list()).toBeNull();
    expect(picked).not.toHaveBeenCalled();

    await press('ArrowUp');                                      // reopens on the one in use
    await press('ArrowDown');
    await press('Enter');
    expect(picked).toHaveBeenCalledExactlyOnceWith('bright');
    expect(list()).toBeNull();
  });

  it('opens with Space or Enter, and takes the first letter of a name to go to that basemap', async () => {
    const { list, press, optionEls, button } = await render('vintage');

    await press(' ');
    expect(list()).not.toBeNull();

    await press('d');
    expect(button.getAttribute('aria-activedescendant')).toBe(optionEls()[4].id);
    await press('b');
    expect(button.getAttribute('aria-activedescendant')).toBe(optionEls()[2].id);
    await press('z');                                            // nothing starts with z
    expect(button.getAttribute('aria-activedescendant')).toBe(optionEls()[2].id);
  });

  it('shows the first basemap when none is in use, and gives one it has no picture for a plain one', async () => {
    const { button, el, settle } = await render(null, [{ id: 'made-up', name: 'Made up' }, ...OPTIONS]);

    expect(text(button)).toBe('Made up');
    button.click();
    await settle();
    expect(el.querySelectorAll('[role=option] svg')).toHaveLength(6);
  });
});
