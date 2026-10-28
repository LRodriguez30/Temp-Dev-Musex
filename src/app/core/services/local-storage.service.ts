
import {
  Injectable,
  computed,
  inject,
  signal
} from '@angular/core';

import { invoke } from '@tauri-apps/api/core';

import { IS_ANDROID } from '../platform/invoke';

import { LibraryService } from './library.service';
import { NotificationService } from './notification.service';

export interface LocalStorageInfo {
  baseDir: string;
  musicDir: string;
  shared: boolean;
  writable: boolean;
}

export interface PhoneFolder {
  path: string;
  name: string;
  audioCount: number;
  sizeBytes: number;
}

export interface TransferResult {
  transferred: number;
  skipped: number;
  failed: number;
}

export interface BrowserEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  audioCount: number;
  sizeBytes: number;
}

export interface DuplicateCheck {
  path: string;
  status: 'exact' | 'probable' | 'none';
  matchedTitle: string | null;
  matchedArtist: string | null;
}

export interface ImportResult {
  transferred: number;
  skipped: number;
  failed: number;
}

@Injectable({
  providedIn: 'root'
})
export class LocalStorageService {
  private readonly libraryService = inject(LibraryService);
  private readonly notificationService = inject(NotificationService);

  readonly duplicateChecks = signal<Map<string, DuplicateCheck>>(new Map());

  readonly info = signal<LocalStorageInfo | null>(null);
  readonly hasAccess = signal(false);

  readonly phoneFolders = signal<PhoneFolder[]>([]);
  readonly scanningFolders = signal(false);

  readonly working = signal(false);
  readonly lastError = signal('');

  // Explorador de carpetas del teléfono.
  readonly currentDirectory = signal('/storage/emulated/0');
  readonly directoryEntries = signal<BrowserEntry[]>([]);
  readonly browsing = signal(false);
  readonly directoryError = signal('');

  // Selección persistente durante la navegación.
  readonly selectedPaths = signal<Set<string>>(new Set());

  readonly selectedCount = computed(
    () => this.selectedPaths().size
  );

  readonly ready = computed(() => {
    const info = this.info();
    return !!info && info.shared && info.writable;
  });

  readonly needsRestart = computed(
    () => this.hasAccess() && !this.ready()
  );

  async refresh(): Promise<void> {
    if (!IS_ANDROID) return;

    this.hasAccess.set(
      window.MusexAndroid?.hasAllFilesAccess() ?? false
    );

    try {
      this.info.set(
        await invoke<LocalStorageInfo>(
          'get_local_storage_info'
        )
      );

      this.lastError.set('');
    } catch (error) {
      this.lastError.set(this.messageOf(error));
    }
  }

  requestAccess(): void {
    window.MusexAndroid?.requestAllFilesAccess();
  }

  /**
   * Abre una carpeta y carga únicamente su contenido inmediato.
   */
  async browseDirectory(path: string): Promise<void> {
    if (this.browsing()) return;

    this.browsing.set(true);
    this.directoryError.set('');
    this.duplicateChecks.set(new Map());

    try {
      const entries = await invoke<BrowserEntry[]>(
        'browse_phone_directory',
        { path }
      );

      this.currentDirectory.set(path);
      this.directoryEntries.set(entries);
    } catch (error) {
      this.directoryError.set(this.messageOf(error));
      return;
    } finally {
      this.browsing.set(false);
    }

    // El análisis no bloquea la navegación.
    void this.analyzeDirectoryDuplicates(path);
  }

  private async analyzeDirectoryDuplicates(path: string): Promise<void> {
    const audioPaths = this.directoryEntries()
      .filter(entry => !entry.isDirectory)
      .map(entry => entry.path);

    if (audioPaths.length === 0) return;

    try {
      const checks = await invoke<DuplicateCheck[]>(
        'analyze_phone_audio_duplicates',
        { paths: audioPaths }
      );

      // Ignorar resultados si el usuario ya navegó a otra carpeta.
      if (this.currentDirectory() !== path) return;

      this.duplicateChecks.set(
        new Map(checks.map(check => [check.path, check]))
      );
    } catch {
      // El análisis es opcional para navegar e importar.
    }
  }

  getDuplicateCheck(path: string): DuplicateCheck | undefined {
    return this.duplicateChecks().get(path);
  }

  async goToPhoneRoot(): Promise<void> {
    await this.browseDirectory('/storage/emulated/0');
  }

  goUp(): void {
    const current = this.currentDirectory();
    const root = '/storage/emulated/0';

    // No permitir subir por encima de la raíz del teléfono.
    if (current === root) {
      return;
    }

    const normalized = current.replace(/\/+$/, '');
    const separator = normalized.lastIndexOf('/');
    const parent = normalized.slice(0, separator) || '/';

    // Evitar salir de la raíz permitida.
    if (!parent.startsWith(root) && parent !== '/storage/emulated') {
      return;
    }

    void this.browseDirectory(parent);
  }

  toggleFile(path: string): void {
    this.selectedPaths.update(current => {
      const next = new Set(current);

      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }

      return next;
    });
  }

  isSelected(path: string): boolean {
    return this.selectedPaths().has(path);
  }

  clearSelection(): void {
    this.selectedPaths.set(new Set());
  }

  /**
   * Importa los archivos seleccionados.
   * El comando Rust valida nuevamente todas las rutas.
   */
  
  async importSelectedFiles(
    paths: string[],
    mode: 'copy' | 'move' = 'copy'
  ): Promise<ImportResult> {
    if (paths.length === 0) {
      return {
        transferred: 0,
        skipped: 0,
        failed: 0
      };
    }

    this.working.set(true);
    this.lastError.set('');

    const total: ImportResult = {
      transferred: 0,
      skipped: 0,
      failed: 0
    };

    const processed: string[] = [];

    try {
      for (const path of paths) {
        try {
          const result = await invoke<ImportResult>(
            'import_phone_audio_files',
            {
              paths: [path],
              mode
            }
          );

          total.transferred += result.transferred;
          total.skipped += result.skipped;
          total.failed += result.failed;

          processed.push(path);
        } catch (error) {
          total.failed++;
          this.lastError.set(this.messageOf(error));
        }
      }

      this.selectedPaths.update(current => {
        const next = new Set(current);

        for (const path of processed) {
          next.delete(path);
        }

        return next;
      });

      this.notificationService.success(
        `Importadas: ${total.transferred} · ` +
        `Duplicadas: ${total.skipped} · ` +
        `Errores: ${total.failed}`
      );

      void this.libraryService.scanLocal().catch(error => {
        this.lastError.set(this.messageOf(error));
      });

      return total;
    } catch (error) {
      this.lastError.set(this.messageOf(error));

      this.notificationService.error(
        'No se pudieron importar las canciones.'
      );

      throw error;
    } finally {
      this.working.set(false);
    }
  }

  async importSelected(
    mode: 'copy' | 'move' = 'copy'
  ): Promise<void> {
    const paths = [...this.selectedPaths()];

    if (paths.length === 0) return;

    await this.importSelectedFiles(paths, mode);
  }

  /** Escaneo recursivo anterior, conservado por compatibilidad. */
  async scanPhone(): Promise<void> {
    this.scanningFolders.set(true);
    this.lastError.set('');

    try {
      this.phoneFolders.set(
        await invoke<PhoneFolder[]>('scan_phone_audio')
      );
    } catch (error) {
      this.lastError.set(this.messageOf(error));
    } finally {
      this.scanningFolders.set(false);
    }
  }

  /** Transferencia de una carpeta completa, conservada por compatibilidad. */
  async transfer(
    folder: PhoneFolder,
    mode: 'copy' | 'move'
  ): Promise<TransferResult> {
    this.working.set(true);
    this.lastError.set('');

    try {
      const result = await invoke<TransferResult>(
        'transfer_phone_folder',
        { path: folder.path, mode }
      );

      await this.libraryService.scanLocal();
      await this.scanPhone();

      return result;
    } catch (error) {
      this.lastError.set(this.messageOf(error));
      throw error;
    } finally {
      this.working.set(false);
    }
  }

  async deleteFiles(paths: string[]): Promise<number> {
    this.working.set(true);
    this.lastError.set('');

    try {
      const deleted = await invoke<number>(
        'delete_local_files',
        { paths }
      );

      await this.libraryService.scanLocal();

      return deleted;
    } catch (error) {
      this.lastError.set(this.messageOf(error));
      throw error;
    } finally {
      this.working.set(false);
    }
  }

  formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) {
      return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }

    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  private messageOf(error: unknown): string {
    return error instanceof Error
      ? error.message
      : String(error);
  }
}
