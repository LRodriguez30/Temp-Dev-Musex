import { Injectable, signal } from '@angular/core';

import { Track } from '../models/track.model';

/**
 * Resultado de una selección automática:
 *
 * - pending: esperando el tiempo de gracia.
 * - auto: sonó al terminar el tiempo de gracia (o sin espera).
 * - now: el usuario la adelantó con "Ahora".
 * - cancelled: el usuario la canceló.
 * - replaced: el usuario reprodujo otra cosa antes de que sonara.
 */
export type AutoPickOutcome =
  | 'pending'
  | 'auto'
  | 'now'
  | 'cancelled'
  | 'replaced';

export interface AutoPickHistoryEntry {
  id: string;
  trackId: string;

  /** Copia de los datos por si la canción se elimina de la biblioteca. */
  title: string;
  artist: string;

  pickedAt: string;
  outcome: AutoPickOutcome;
}

const STORAGE_KEY = 'musex_autopick_history';
const MAX_ENTRIES = 200;

/**
 * Historial de las canciones elegidas por el auto-picker y de
 * lo que ocurrió con cada una.
 */
@Injectable({
  providedIn: 'root'
})
export class AutoPickHistoryService {

  private readonly history = signal<AutoPickHistoryEntry[]>(
    this.loadSaved()
  );

  readonly entries = this.history.asReadonly();

  record(
    track: Track,
    outcome: AutoPickOutcome = 'pending'
  ): AutoPickHistoryEntry {

    const entry: AutoPickHistoryEntry = {
      id: `autopick-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      pickedAt: new Date().toISOString(),
      outcome
    };

    this.history.update(list =>
      [entry, ...list].slice(0, MAX_ENTRIES)
    );

    this.persist();

    return entry;
  }

  /**
   * Fija el resultado de una selección. Solo cambia entradas que
   * siguen pendientes, de modo que el primer resultado prevalece.
   */
  resolve(
    entryId: string | null,
    outcome: Exclude<AutoPickOutcome, 'pending'>
  ): void {

    if (!entryId) {
      return;
    }

    const target = this.history().find(
      entry => entry.id === entryId
    );

    if (!target || target.outcome !== 'pending') {
      return;
    }

    this.history.update(list =>
      list.map(entry =>
        entry.id === entryId
          ? { ...entry, outcome }
          : entry
      )
    );

    this.persist();
  }

  removeEntry(entryId: string): void {

    this.history.update(list =>
      list.filter(entry => entry.id !== entryId)
    );

    this.persist();
  }

  clear(): void {

    this.history.set([]);

    this.persist();
  }

  private loadSaved(): AutoPickHistoryEntry[] {

    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (raw) {
        const parsed: unknown = JSON.parse(raw);

        if (Array.isArray(parsed)) {
          // Una app cerrada con una selección pendiente no puede
          // completarla: se marca como reemplazada.
          return (parsed as AutoPickHistoryEntry[]).map(entry =>
            entry.outcome === 'pending'
              ? { ...entry, outcome: 'replaced' as const }
              : entry
          );
        }
      }
    } catch {
      /* historial ilegible: se empieza vacío */
    }

    return [];
  }

  private persist(): void {

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(this.history())
      );
    } catch {
      /* almacenamiento no disponible */
    }
  }
}
