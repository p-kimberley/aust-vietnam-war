import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ContactDetail } from './contacts';
import { ContactsService } from './contacts.service';
import { IncidentPanel } from './incident-panel';

const detail: ContactDetail = {
  id: 2, dtg: '1966-03-03T19:50:00', lat: 10.55, lon: 107.16, gridRef: 'YS374671', operation: 'Hardihood', unitTask: 'Patrol',
  units: [
    { id: 3, shortName: '1 Pl, A Coy, 5 RAR', longName: '1 Platoon, A Company, 5 Battalion, Royal Australian Regiment' },
    { id: 4, shortName: '2 Pl, A Coy, 5 RAR', longName: '2 Platoon' },
  ],
  frForce: 25, enForce: 5, frKia: 1, frWia: 2, enKia: 3, enWia: 4,
  description: 'AT LOC STATED, 1/A/5 RAR CONTACTED 5 EN.', archivalSource: 'Intel V-dat Base', sourceUrl: 'https://www.awm.gov.au/collection/R1',
};

function setup() {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
  });
  return { ctl: TestBed.inject(HttpTestingController), service: TestBed.inject(ContactsService) };
}

async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

/** Runs change detection and lets the resource loader issue its request (it does not run synchronously). */
async function tick(fixture: { detectChanges(): void }) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  fixture.detectChanges();
}

describe('ContactsService.detail', () => {
  it('asks the API once per contact and remembers the answer', async () => {
    const { ctl, service } = setup();

    const first = service.detail(2);
    const again = service.detail(2);
    ctl.expectOne('/api/contacts/2').flush(detail);

    expect(await first).toEqual(detail);
    expect(await again).toEqual(detail);
    ctl.verify();
  });

  it('answers null for a contact that does not exist, and remembers that too', async () => {
    const { ctl, service } = setup();

    const missing = service.detail(999);
    ctl.expectOne('/api/contacts/999').flush(null, { status: 404, statusText: 'Not Found' });
    expect(await missing).toBeNull();

    expect(await service.detail(999)).toBeNull();
    ctl.verify();
  });

  it('does not remember a failure, so the next open retries', async () => {
    const { ctl, service } = setup();

    const failed = service.detail(2);
    ctl.expectOne('/api/contacts/2').flush('boom', { status: 500, statusText: 'Server Error' });
    await expect(failed).rejects.toBeInstanceOf(HttpErrorResponse);

    const retry = service.detail(2);
    ctl.expectOne('/api/contacts/2').flush(detail);
    expect(await retry).toEqual(detail);
  });
});

describe('IncidentPanel', () => {
  function render(id = 2) {
    const { ctl } = setup();
    const fixture = TestBed.createComponent(IncidentPanel);
    fixture.componentRef.setInput('contactId', id);
    return { fixture, ctl, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the incident record', async () => {
    const { fixture, ctl, el } = render();
    await tick(fixture);
    expect(el.textContent).toContain('Loading');

    ctl.expectOne('/api/contacts/2').flush(detail);
    await settle(fixture);

    expect(el.querySelector('.incident__when')?.textContent).toContain('3 Mar 1966 19:50');
    expect(el.textContent).toContain('Hardihood');
    expect(el.textContent).toContain('Patrol');
    expect(el.textContent).toContain('YS374671');
    expect([...el.querySelectorAll('.incident__units li')].map((li) => li.textContent)).toEqual([
      '1 Pl, A Coy, 5 RAR',
      '2 Pl, A Coy, 5 RAR',
    ]);
    expect(el.querySelector('.incident__report')?.textContent).toContain('CONTACTED 5 EN');
  });

  it('lays the figures out as a table with friendly and enemy columns', async () => {
    const { fixture, ctl, el } = render();
    await tick(fixture);
    ctl.expectOne('/api/contacts/2').flush(detail);
    await settle(fixture);

    const rows = [...el.querySelectorAll('.incident__stats tbody tr')].map((r) =>
      [...r.children].map((c) => c.textContent?.trim()),
    );
    expect(rows).toEqual([
      ['Present', '25', '5'],
      ['Killed', '1', '3'],
      ['Wounded', '2', '4'],
    ]);
  });

  it('links the external source safely, and only when there is one', async () => {
    const { fixture, ctl, el } = render();
    await tick(fixture);
    ctl.expectOne('/api/contacts/2').flush(detail);
    await settle(fixture);

    const link = el.querySelector<HTMLAnchorElement>('a')!;
    expect(link.href).toBe('https://www.awm.gov.au/collection/R1');
    expect(link.rel).toContain('noopener');
    expect(link.target).toBe('_blank');
  });

  it('omits sections the record has nothing for', async () => {
    const { fixture, ctl, el } = render();
    await tick(fixture);
    ctl.expectOne('/api/contacts/2').flush({
      ...detail, operation: null, unitTask: null, gridRef: null, units: [], description: null, archivalSource: null, sourceUrl: null,
    });
    await settle(fixture);

    expect(el.textContent).not.toContain('Operation');
    expect(el.textContent).not.toContain('Grid reference');
    expect(el.textContent).not.toContain('Archival source');
    expect(el.querySelector('a')).toBeNull();
    expect(el.querySelector('.incident__none')?.textContent).toBe('Unknown');
    expect(el.querySelector('.incident__report')?.textContent).toContain('No report is recorded');
  });

  it('says so when the incident does not exist', async () => {
    const { fixture, ctl, el } = render(999);
    await tick(fixture);
    ctl.expectOne('/api/contacts/999').flush(null, { status: 404, statusText: 'Not Found' });
    await settle(fixture);

    expect(el.textContent).toContain('not found');
  });

  it('offers a retry when loading fails', async () => {
    const { fixture, ctl, el } = render();
    await tick(fixture);
    ctl.expectOne('/api/contacts/2').flush('boom', { status: 500, statusText: 'Server Error' });
    await settle(fixture);
    expect(el.querySelector('[role=alert]')?.textContent).toContain('could not be loaded');

    el.querySelector<HTMLButtonElement>('.incident__retry')!.click();
    await tick(fixture);
    ctl.expectOne('/api/contacts/2').flush(detail);
    await settle(fixture);

    expect(el.textContent).toContain('Hardihood');
  });

  it('tells the parent when it is closed', async () => {
    const { fixture, ctl, el } = render();
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    await tick(fixture);
    ctl.expectOne('/api/contacts/2').flush(detail);
    await settle(fixture);

    el.querySelector<HTMLButtonElement>('.incident__close')!.click();

    expect(closed).toBe(1);
  });
});
