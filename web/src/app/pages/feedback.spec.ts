import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Feedback } from './feedback';

const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(Feedback);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const ctl = TestBed.inject(HttpTestingController);
  const fill = (selector: string, value: string) => (el.querySelector<HTMLInputElement>(selector)!.value = value);
  const submit = async () => {
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await wait();
  };
  return { fixture, el, ctl, fill, submit };
}

describe('Feedback', () => {
  it('sends the message and thanks the visitor', async () => {
    const { fixture, el, ctl, fill, submit } = setup();
    fill('input[type=text]', 'Pat');
    fill('textarea', 'The date on the Long Tan page is wrong.');

    await submit();
    const req = ctl.expectOne('/api/feedback');
    expect(req.request.body).toEqual({ name: 'Pat', email: '', message: 'The date on the Long Tan page is wrong.', website: '' });
    req.flush(null, { status: 202, statusText: 'Accepted' });
    await wait();
    fixture.detectChanges();

    expect(el.querySelector('[role=status]')?.textContent).toContain('Thank you');
    expect(el.querySelector('form')).toBeNull();
  });

  it('keeps the form and shows the problem next to the field the server named', async () => {
    const { fixture, el, ctl, submit, fill } = setup();
    fill('textarea', 'short');

    await submit();
    ctl.expectOne('/api/feedback').flush({ errors: { message: ['Write between 10 and 2000 characters.'] } }, { status: 400, statusText: 'Bad Request' });
    await wait();
    fixture.detectChanges();

    expect(el.querySelector('#message-error')?.textContent).toContain('Write between 10 and 2000');
    expect(el.querySelector('textarea')?.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('textarea')?.getAttribute('aria-describedby')).toBe('message-error');
    expect(el.querySelector('form')).not.toBeNull();
  });

  it('explains when the visitor has sent too many, and when the server fails', async () => {
    const { fixture, el, ctl, submit, fill } = setup();
    fill('textarea', 'A long enough message for the editors.');

    await submit();
    ctl.expectOne('/api/feedback').flush('', { status: 429, statusText: 'Too Many Requests' });
    await wait();
    fixture.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('several messages already');

    await submit();
    ctl.expectOne('/api/feedback').flush('', { status: 500, statusText: 'Server Error' });
    await wait();
    fixture.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('could not be sent');
  });

  it('has a decoy field that is hidden from people and from screen readers', () => {
    const { el } = setup();

    const decoy = el.querySelector('.decoy')!;
    expect(decoy.getAttribute('aria-hidden')).toBe('true');
    expect(decoy.querySelector('input')?.getAttribute('tabindex')).toBe('-1');
  });
});
