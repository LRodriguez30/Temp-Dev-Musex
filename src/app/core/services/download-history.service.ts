import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

import { DownloadHistoryEntry } from '../models/download-history-entry.model';

/**
 * Interfaz cruda recibida desde Rust.
 *
 * Rust serializa la entrada en snake_case; este servicio
 * la transforma al modelo camelCase utilizado por Angular.
 */
interface RustDownloadHistoryEntry {
  id: string;
  title: string;
  url: string;
  source: string;
  file_path: string;
  completed_at: string;
}

@Injectable({
  providedIn: 'root'
})
export class DownloadHistoryService {

  /**
   * Historial de descargas persistido en Rust.
   */
  private readonly history = signal<DownloadHistoryEntry[]>([]);

  /**
   * Exposición de solo lectura del historial.
   */
  readonly entries = this.history.asReadonly();

  /**
   * Indica si el historial todavía se está cargando.
   */
  readonly loading = signal<boolean>(false);

  /**
   * Carga el historial desde Rust.
   */
  async load(): Promise<void> {
    try {
      this.loading.set(true);

      const entries = await invoke<RustDownloadHistoryEntry[]>(
        'get_download_history'
      );

      this.history.set(
        entries.map(entry => this.mapEntry(entry))
      );

    } catch (error) {
      console.error(
        'No se pudo cargar el historial de descargas.',
        error
      );

    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Elimina una entrada del historial.
   */
  async removeEntry(id: string): Promise<void> {
    try {
      await invoke<void>(
        'remove_download_history_entry',
        { id }
      );

      this.history.update(entries =>
        entries.filter(entry => entry.id !== id)
      );

    } catch (error) {
      console.error(
        'No se pudo eliminar la entrada del historial.',
        error
      );

      throw error;
    }
  }

  /**
   * Vacía completamente el historial.
   */
  async clear(): Promise<void> {
    try {
      await invoke<void>('clear_download_history');

      this.history.set([]);

    } catch (error) {
      console.error(
        'No se pudo vaciar el historial de descargas.',
        error
      );

      throw error;
    }
  }

  /**
   * Transforma una entrada recibida de Rust al modelo Angular.
   */
  private mapEntry(
    entry: RustDownloadHistoryEntry
  ): DownloadHistoryEntry {
    return {
      id: entry.id,
      title: entry.title,
      url: entry.url,
      source: entry.source,
      filePath: entry.file_path,
      completedAt: entry.completed_at
    };
  }
}