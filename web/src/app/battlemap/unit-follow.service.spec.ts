import { describe, expect, it } from 'vitest';
import { MAX_SEPARATE_TRACKS } from './track';
import { UnitFollowService } from './unit-follow.service';

describe('UnitFollowService', () => {
  it('starts with nobody followed', () => {
    const service = new UnitFollowService();

    expect(service.followed()).toEqual(new Set());
    expect(service.full()).toBe(false);
  });

  it('follows a unit, and stops following it again', () => {
    const service = new UnitFollowService();

    service.toggle(3);
    expect(service.followed()).toEqual(new Set([3]));

    service.toggle(5);
    expect(service.followed()).toEqual(new Set([3, 5]));

    service.toggle(3);
    expect(service.followed()).toEqual(new Set([5]));
  });

  it('stops following everyone at once', () => {
    const service = new UnitFollowService();
    service.toggle(1);
    service.toggle(2);

    service.stop();

    expect(service.followed()).toEqual(new Set());
  });

  it('follows no more than the limit, but can still stop following one that is somehow over it', () => {
    const service = new UnitFollowService();
    for (let unit = 1; unit <= MAX_SEPARATE_TRACKS; unit++) {
      service.toggle(unit);
    }
    expect(service.full()).toBe(true);

    service.toggle(99);

    expect(service.followed().size).toBe(MAX_SEPARATE_TRACKS);
    expect(service.followed().has(99)).toBe(false);

    service.toggle(1);          // taking one off still works
    expect(service.followed().has(1)).toBe(false);
    expect(service.full()).toBe(false);
  });
});
