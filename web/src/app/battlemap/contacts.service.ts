import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Contact, ContactDetail } from './contacts';

@Injectable({ providedIn: 'root' })
export class ContactsService {
  private readonly http = inject(HttpClient);
  private inflight?: Promise<Contact[]>;
  private readonly details = new Map<number, Promise<ContactDetail | null>>();

  /**
   * Loads every contact once (about 6,200). The response carries an ETag and short cache lifetime, so the browser
   * revalidates cheaply on later visits. A failed load is not cached.
   */
  load(): Promise<Contact[]> {
    this.inflight ??= firstValueFrom(this.http.get<Contact[]>('/api/contacts')).catch((e) => {
      this.inflight = undefined;
      throw e;
    });
    return this.inflight;
  }

  /**
   * One contact in full, or `null` when it does not exist. Answers are remembered so reopening an incident is
   * instant; a failed request is forgotten so the next open retries.
   */
  detail(id: number): Promise<ContactDetail | null> {
    let pending = this.details.get(id);
    if (!pending) {
      pending = firstValueFrom(this.http.get<ContactDetail>(`/api/contacts/${id}`)).catch((e) => {
        if (e instanceof HttpErrorResponse && e.status === 404) {
          return null;
        }
        this.details.delete(id);
        throw e;
      });
      this.details.set(id, pending);
    }
    return pending;
  }
}
