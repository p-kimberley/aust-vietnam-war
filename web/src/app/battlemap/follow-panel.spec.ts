import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { FollowPanel } from './follow-panel';
import { FollowRow } from './track';

const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim();

const ROWS: FollowRow[] = [
  { unit: 1, label: '1 Pl, A Coy', fullName: '1 Platoon, A Company', colour: '#ffd166', at: 2, total: 3 },
  { unit: 2, label: 'D Coy', fullName: 'D Company', colour: '#4cc9f0', at: null, total: 1 },
];

function setup(rows: FollowRow[] = ROWS) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const f = TestBed.createComponent(FollowPanel);
  f.componentRef.setInput('rows', rows);
  const steps: { unit: number; direction: 1 | -1 }[] = [];
  const unfollowed: number[] = [];
  f.componentInstance.step.subscribe((e) => steps.push(e));
  f.componentInstance.unfollow.subscribe((u) => unfollowed.push(u));
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  return {
    f,
    el,
    steps,
    unfollowed,
    toggle: () => el.querySelector<HTMLButtonElement>('.follow__toggle')!,
    frame: () => el.querySelector('.follow__frame')!,
    rows: () => [...el.querySelectorAll('.follow__list li')],
  };
}

describe('FollowPanel', () => {
  it('names how many units are followed, and is open to begin with', () => {
    const { toggle, frame } = setup();

    expect(text(toggle())).toContain('Following 2 units');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe('follow-body');
    expect(frame().classList.contains('is-open')).toBe(true);
  });

  it('says "1 unit", not "1 units"', () => {
    const { toggle } = setup([ROWS[0]]);

    expect(text(toggle())).toContain('Following 1 unit');
  });

  it('shuts and opens again from its own toggle', () => {
    const { f, toggle, frame } = setup();

    toggle().click();
    f.detectChanges();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(frame().classList.contains('is-open')).toBe(false);

    toggle().click();
    f.detectChanges();
    expect(frame().classList.contains('is-open')).toBe(true);
  });

  it('lists each unit with its colour and its position along its own path, x/n, its full name on hover', () => {
    const { rows } = setup();

    expect(rows()).toHaveLength(2);
    expect((rows()[0].querySelector('.follow__swatch') as HTMLElement).style.background).toBe('rgb(255, 209, 102)');
    expect(text(rows()[0].querySelector('.follow__label'))).toBe('1 Pl, A Coy');
    expect(rows()[0].querySelector('.follow__label')!.getAttribute('title')).toBe('1 Platoon, A Company');
    expect(text(rows()[0].querySelector('.follow__pager'))).toContain('2/3');
  });

  it('shows no position for a unit whose own incidents are not open', () => {
    const { rows } = setup();

    expect(text(rows()[1].querySelector('.follow__pager'))).toContain('–/1');
  });

  it('emits which unit and which direction when a pager arrow is pressed', () => {
    const { rows, steps } = setup();

    rows()[0].querySelector<HTMLButtonElement>('[aria-label="Next incident"]')!.click();
    rows()[1].querySelector<HTMLButtonElement>('[aria-label="Previous incident"]')!.click();

    expect(steps).toEqual([
      { unit: 1, direction: 1 },
      { unit: 2, direction: -1 },
    ]);
  });

  it('emits unfollow for just that unit from the cancel button beside its pager', () => {
    const { rows, unfollowed } = setup();

    rows()[1].querySelector<HTMLButtonElement>('.follow__cancel')!.click();

    expect(unfollowed).toEqual([2]);
  });

  it('gives the pager arrows and the cancel button tooltips, not just labels for screen readers', () => {
    const { rows } = setup();
    const row = rows()[0];

    expect(row.querySelector('[aria-label="Previous incident"]')!.getAttribute('title')).toBe('Previous incident');
    expect(row.querySelector('[aria-label="Next incident"]')!.getAttribute('title')).toBe('Next incident');
    expect(row.querySelector('.follow__cancel')!.getAttribute('title')).toBe('Stop following 1 Pl, A Coy');
  });

  it('labels each cancel button by the unit it stops following', () => {
    const { rows } = setup();

    expect(rows()[0].querySelector('.follow__cancel')!.getAttribute('aria-label')).toBe('Stop following 1 Pl, A Coy');
  });
});
