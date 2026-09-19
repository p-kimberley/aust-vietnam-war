import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Contact } from './contacts';

@Injectable({ providedIn: 'root' })
export class ContactsService {
  private readonly http = inject(HttpClient);
  private inflight?: Promise<Contact[]>;

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
}
