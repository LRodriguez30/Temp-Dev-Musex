import { Injectable, signal } from '@angular/core';

import { HistoryEntry } from '../models/history-entry.model';

/**
 * Gestiona el historial de reproducción de Musex.
 *
 * El servicio registra las canciones reproducidas y mantiene
 * la información necesaria para mostrar posteriormente la
 * actividad reciente del usuario.
 *
 * La persistencia definitiva se implementará posteriormente
 * mediante StorageService.
 */
@Injectable({
  providedIn: 'root'
})
export class HistoryService {

  /**
   * Historial interno de reproducción.
   *
   * Las entradas más recientes se mantienen al principio
   * de la colección.
   */
  private readonly history = signal<HistoryEntry[]>(
    this.loadSaved()
  );

  /**
   * Exposición de solo lectura del historial.
   */
  readonly entries = this.history.asReadonly();

  /**
   * Devuelve una copia del historial actual.
   */
  getHistory(): HistoryEntry[] {
    return [...this.history()];
  }

  /**
   * Registra una nueva reproducción.
   *
   * Si la canción ya existe en el historial, se elimina
   * su entrada anterior antes de colocar la nueva entrada
   * al principio.
   *
   * De esta manera, cada canción aparece una sola vez
   * en el historial y la más recientemente reproducida
   * siempre queda al frente.
   */
  addEntry(
    trackId: string,
    playedDuration = 0
  ): HistoryEntry {

    const entry: HistoryEntry = {
      id: this.generateId(),
      trackId,
      playedAt: new Date().toISOString(),
      playedDuration
    };

    this.history.update(history => [
      entry,
      ...history.filter(
        item => item.trackId !== trackId
      )
    ]);

    this.persist();

    return entry;
  }

  /**
   * Elimina una entrada específica del historial.
   */
  removeEntry(entryId: string): void {
    this.history.update(history =>
      history.filter(entry => entry.id !== entryId)
    );

    this.persist();
  }

  /**
   * Elimina todas las entradas del historial.
   */
  clearHistory(): void {
    this.history.set([]);

    this.persist();
  }

  /**
   * Obtiene la cantidad de reproducciones registradas.
   */
  getCount(): number {
    return this.history().length;
  }

  /**
   * Busca una entrada concreta mediante su identificador.
   */
  getEntry(entryId: string): HistoryEntry | undefined {
    return this.history().find(
      entry => entry.id === entryId
    );
  }

  /**
   * Obtiene las reproducciones correspondientes a una canción.
   */
  getEntriesForTrack(trackId: string): HistoryEntry[] {
    return this.history().filter(
      entry => entry.trackId === trackId
    );
  }

  /**
   * Reemplaza el historial actual.
   *
   * Será utilizado posteriormente cuando StorageService
   * restaure el estado persistido de Musex.
   */
  setHistory(entries: HistoryEntry[]): void {
    this.history.set([...entries]);

    this.persist();
  }

  /**
   * Restaura el historial guardado entre sesiones.
   */
  private loadSaved(): HistoryEntry[] {

    try {
      const raw = localStorage.getItem('musex_history');

      if (raw) {
        const parsed: unknown = JSON.parse(raw);

        if (Array.isArray(parsed)) {
          return parsed as HistoryEntry[];
        }
      }
    } catch {
      /* historial ilegible: se empieza vacío */
    }

    return [];
  }

  /** Guarda como máximo las 200 reproducciones más recientes. */
  private persist(): void {

    try {
      localStorage.setItem(
        'musex_history',
        JSON.stringify(this.history().slice(0, 200))
      );
    } catch {
      /* almacenamiento no disponible */
    }
  }

  /**
   * Genera un identificador único para una entrada.
   */
  private generateId(): string {
    return `history-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }
}