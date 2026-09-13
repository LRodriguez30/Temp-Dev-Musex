// =============================================================
// MUSEX - DOWNLOAD SERVICE
// =============================================================
//
// Gestiona el estado de las descargas dentro de Musex.
//
// Angular mantiene únicamente el estado necesario para
// representar las descargas en la interfaz.
//
// La ejecución física de las descargas corresponde a Rust/Tauri.
//
// La comunicación se realiza mediante eventos:
//
// Rust
//   ↓
// Downloader
//   ↓
// Tauri Events
//   ├── download-progress
//   ├── download-completed
//   └── download-error
//   ↓
// DownloadService
//   ↓
// Angular Signals
//
// El comando `download_audio` solamente inicia el proceso.
// La interfaz no permanece esperando a que termine la descarga.
//
// =============================================================

import {
  Injectable,
  OnDestroy,
  signal
} from '@angular/core';

import {
  invoke
} from '@tauri-apps/api/core';

import {
  listen,
  UnlistenFn
} from '@tauri-apps/api/event';

import {
  Download,
  DownloadProvider,
  DownloadStage,
  DownloadStatus
} from '../models/download.model';

// =============================================================
// DOWNLOAD PROGRESS EVENT
// =============================================================

/**
 * Información enviada por Rust durante una descarga.
 *
 * `status` representa el estado general de la descarga.
 *
 * `stage` representa únicamente la etapa interna del proceso.
 */
interface DownloadProgressEvent {

  /**
   * Identificador de la descarga.
   */
  id: string;

  /**
   * Estado general de la descarga.
   */
  status: DownloadStatus;

  /**
   * Porcentaje actual de progreso.
   */
  progress: number;

  /**
   * Etapa actual de la operación.
   */
  stage: DownloadStage;

  /**
   * Mensaje descriptivo de la operación.
   */
  message: string;

  /**
   * Cantidad real de bytes descargados o procesados.
   */
  downloaded_bytes: number;

  /**
   * Tamaño total del archivo en bytes.
   */
  total_bytes?: number;
}

// =============================================================
// DOWNLOAD COMPLETED EVENT
// =============================================================

interface DownloadCompletedEvent {

  /**
   * Identificador de la descarga.
   */
  id: string;

  /**
   * Ruta final del archivo generado.
   */
  file_path: string;

  /**
   * Título real del contenido descargado.
   *
   * Rust lo extrae del nombre del archivo generado
   * (yt-dlp / Newgrounds) al completar la descarga.
   */
  title: string;
}

// =============================================================
// DOWNLOAD ERROR EVENT
// =============================================================

interface DownloadErrorEvent {

  /**
   * Identificador de la descarga.
   */
  id: string;

  /**
   * Descripción del error.
   */
  message: string;
}

// =============================================================
// DOWNLOAD SERVICE
// =============================================================

@Injectable({
  providedIn: 'root'
})
export class DownloadService
  implements OnDestroy {

  // ===========================================================
  // STATE
  // ===========================================================

  /**
   * Descargas actualmente activas.
   */
  private readonly downloads =
    signal<Download[]>([]);

  /**
   * Descargas que finalizaron correctamente.
   */
  private readonly completedDownloads =
    signal<Download[]>([]);

  /**
   * Cola de descargas activas.
   */
  readonly queue =
    this.downloads.asReadonly();

  /**
   * Descargas completadas.
   */
  readonly completed =
    this.completedDownloads.asReadonly();

  // ===========================================================
  // EVENT LISTENERS
  // ===========================================================

  private progressUnlisten?: UnlistenFn;

  private completedUnlisten?: UnlistenFn;

  private errorUnlisten?: UnlistenFn;

  // ===========================================================
  // INITIALIZATION
  // ===========================================================

  /**
   * Promesa que representa la inicialización de todos
   * los listeners de Tauri.
   */
  private readonly listenersReady: Promise<void>;

  constructor() {

    this.listenersReady =
      this.initializeEventListeners();
  }

  /**
   * Inicializa todos los listeners utilizados por el
   * sistema de descargas.
   */
  private async initializeEventListeners(): Promise<void> {

    await Promise.all([
      this.initializeProgressListener(),
      this.initializeCompletedListener(),
      this.initializeErrorListener()
    ]);
  }

  // ===========================================================
  // PROGRESS LISTENER
  // ===========================================================

  private async initializeProgressListener(): Promise<void> {

    try {

      this.progressUnlisten =
        await listen<DownloadProgressEvent>(
          'download-progress',
          event => {

            this.handleProgressEvent(
              event.payload
            );
          }
        );

    } catch (error) {

      console.error(
        'No se pudo inicializar el listener de progreso:',
        error
      );

      throw error;
    }
  }

  // ===========================================================
  // COMPLETED LISTENER
  // ===========================================================

  private async initializeCompletedListener(): Promise<void> {

    try {

      this.completedUnlisten =
        await listen<DownloadCompletedEvent>(
          'download-completed',
          event => {

            this.handleCompletedEvent(
              event.payload
            );
          }
        );

    } catch (error) {

      console.error(
        'No se pudo inicializar el listener de finalización:',
        error
      );

      throw error;
    }
  }

  // ===========================================================
  // ERROR LISTENER
  // ===========================================================

  private async initializeErrorListener(): Promise<void> {

    try {

      this.errorUnlisten =
        await listen<DownloadErrorEvent>(
          'download-error',
          event => {

            this.handleErrorEvent(
              event.payload
            );
          }
        );

    } catch (error) {

      console.error(
        'No se pudo inicializar el listener de errores:',
        error
      );

      throw error;
    }
  }

  // ===========================================================
  // CONSULTAS
  // ===========================================================

  getDownloads(): Download[] {

    return this.downloads();
  }

  getCompletedDownloads(): Download[] {

    return this.completedDownloads();
  }

  // ===========================================================
  // PROVIDERS
  // ===========================================================

  detectProvider(
    url: string
  ): DownloadProvider {

    try {

      const parsedUrl =
        new URL(url);

      const hostname =
        parsedUrl.hostname.toLowerCase();

      // -------------------------------------------------------
      // YouTube
      // -------------------------------------------------------

      if (
        hostname === 'youtube.com' ||
        hostname.endsWith('.youtube.com') ||
        hostname === 'youtu.be'
      ) {
        return 'youtube';
      }

      // -------------------------------------------------------
      // Newgrounds
      // -------------------------------------------------------

      if (
        hostname === 'newgrounds.com' ||
        hostname.endsWith('.newgrounds.com')
      ) {
        return 'newgrounds';
      }

      return 'unknown';

    } catch {

      return 'unknown';
    }
  }

  validDownloadUrl(
    url: string
  ): boolean {

    try {

      const parsedUrl =
        new URL(url);

      if (
        parsedUrl.protocol !== 'http:' &&
        parsedUrl.protocol !== 'https:'
      ) {
        return false;
      }

      return (
        this.detectProvider(url) !==
        'unknown'
      );

    } catch {

      return false;
    }
  }

  // ===========================================================
  // CREACIÓN DE DESCARGAS
  // ===========================================================

  addDownload(
    url: string,
    title = 'Descarga pendiente'
  ): Download | null {

    const normalizedUrl =
      url.trim();

    if (
      !this.validDownloadUrl(
        normalizedUrl
      )
    ) {
      return null;
    }

    const provider =
      this.detectProvider(
        normalizedUrl
      );

    const download: Download = {

      id:
        this.generateId(),

      url:
        normalizedUrl,

      title,

      provider,

      status:
        'pending',

      stage:
        'preparing',

      progress:
        0,

      downloadedBytes:
        0,

      totalBytes:
        undefined,

      message:
        'Descarga pendiente.',

      createdAt:
        new Date().toISOString()
    };

    this.downloads.update(
      downloads => [
        ...downloads,
        download
      ]
    );

    return download;
  }

  // ===========================================================
  // EJECUCIÓN
  // ===========================================================

  async startDownload(
    downloadId: string
  ): Promise<void> {

    const download =
      this.findDownload(
        downloadId
      );

    if (!download) {
      return;
    }

    // ---------------------------------------------------------
    // Evitar iniciar estados incompatibles
    // ---------------------------------------------------------

    if (
      download.status === 'completed' ||
      download.status === 'cancelled' ||
      download.status === 'downloading'
    ) {
      return;
    }

    // ---------------------------------------------------------
    // Preparar estado visual
    // ---------------------------------------------------------

    this.updateDownload(
      downloadId,
      {
        status:
          'downloading',

        stage:
          'preparing',

        progress:
          0,

        downloadedBytes:
          0,

        totalBytes:
          undefined,

        message:
          'Preparando descarga...',

        errorMessage:
          undefined
      }
    );

    try {

      // -------------------------------------------------------
      // Esperar listeners
      // -------------------------------------------------------

      await this.listenersReady;

      // -------------------------------------------------------
      // Iniciar worker de Rust
      // -------------------------------------------------------

      await invoke<void>(
        'download_audio',
        {
          id:
            download.id,

          url:
            download.url
        }
      );

    } catch (error) {

      this.failDownload(
        downloadId,
        this.getErrorMessage(
          error
        )
      );
    }
  }

  // ===========================================================
  // PROGRESS EVENTS
  // ===========================================================

  /**
   * Procesa un evento de progreso recibido desde Rust.
   *
   * `status` y `stage` se reciben ahora como propiedades
   * independientes.
   */
  private handleProgressEvent(
    event: DownloadProgressEvent
  ): void {

    const download =
      this.findDownload(
        event.id
      );

    if (!download) {
      return;
    }

    const progress =
      Math.max(
        0,
        Math.min(
          event.progress,
          100
        )
      );

    const downloadedBytes =
      Math.max(
        0,
        event.downloaded_bytes
      );

    const totalBytes =
      event.total_bytes !== undefined &&
        event.total_bytes > 0
        ? event.total_bytes
        : undefined;

    this.updateDownload(
      event.id,
      {
        status:
          event.status,

        stage:
          event.stage,

        progress,

        downloadedBytes,

        totalBytes,

        message:
          event.message
      }
    );
  }

  // ===========================================================
  // COMPLETED EVENT
  // ===========================================================

  private handleCompletedEvent(
    event: DownloadCompletedEvent
  ): void {

    console.log(
      '[DOWNLOAD] Descarga completada:',
      event
    );

    this.completeDownload(
      event.id,
      event.file_path,
      event.title
    );
  }

  // ===========================================================
  // ERROR EVENT
  // ===========================================================

  private handleErrorEvent(
    event: DownloadErrorEvent
  ): void {

    console.error(
      '[DOWNLOAD] Error recibido desde Rust:',
      event
    );

    this.failDownload(
      event.id,
      event.message
    );
  }

  // ===========================================================
  // LIBRARY
  // ===========================================================

  async moveToLibrary(
    downloadId: string
  ): Promise<string | null> {

    const download =
      this.findCompletedDownload(
        downloadId
      );

    if (!download) {
      return null;
    }

    if (!download.filePath) {
      return null;
    }

    try {

      const newFilePath =
        await invoke<string>(
          'move_download_to_library',
          {
            filePath:
              download.filePath
          }
        );

      const updatedDownload:
        Download = {

        ...download,

        filePath:
          newFilePath
      };

      this.completedDownloads.update(
        downloads =>
          downloads.map(
            item =>
              item.id === downloadId
                ? updatedDownload
                : item
          )
      );

      return newFilePath;

    } catch (error) {

      throw new Error(
        this.getErrorMessage(
          error
        )
      );
    }
  }

  // ===========================================================
  // OPEN LOCATION
  // ===========================================================

  /**
   * Abre el Explorador de Windows y selecciona el archivo
   * descargado.
   *
   * La ruta física es proporcionada por Rust mediante el
   * evento `download-completed`.
   */
  async openLocation(
    downloadId: string
  ): Promise<void> {

    const download =
      this.findCompletedDownload(
        downloadId
      );

    if (!download) {
      throw new Error(
        'No se encontró la descarga completada.'
      );
    }

    if (!download.filePath) {
      throw new Error(
        'Este archivo no tiene una ubicación disponible.'
      );
    }

    try {

      await invoke<void>(
        'open_download_location',
        {
          filePath:
            download.filePath
        }
      );

    } catch (error) {

      throw new Error(
        this.getErrorMessage(
          error
        )
      );
    }
  }

  // ===========================================================
  // DOWNLOAD CONTROLS
  // ===========================================================

  /**
   * Pausa una descarga.
   *
   * La pausa real todavía no está implementada.
   */
  pause(
    downloadId: string
  ): void {

    const download =
      this.findDownload(
        downloadId
      );

    if (
      !download ||
      download.status !==
      'downloading'
    ) {
      return;
    }
  }

  /**
   * Reanuda una descarga pausada.
   *
   * La reanudación real todavía no está implementada.
   */
  resume(
    downloadId: string
  ): void {

    const download =
      this.findDownload(
        downloadId
      );

    if (
      !download ||
      download.status !==
      'paused'
    ) {
      return;
    }
  }

  /**
   * Cancela una descarga pendiente.
   */
  cancel(
    downloadId: string
  ): void {

    const download =
      this.findDownload(
        downloadId
      );

    if (!download) {
      return;
    }

    if (
      download.status ===
      'pending'
    ) {

      this.updateStatus(
        downloadId,
        'cancelled'
      );

      this.remove(
        downloadId
      );
    }
  }

  // ===========================================================
  // GESTIÓN DE COLA
  // ===========================================================

  remove(
    downloadId: string
  ): void {

    this.downloads.update(
      downloads =>
        downloads.filter(
          download =>
            download.id !==
            downloadId
        )
    );
  }

  clear(): void {

    this.downloads.set([]);
  }

  // ===========================================================
  // DESCARGAS COMPLETADAS
  // ===========================================================

  removeCompleted(
    downloadId: string
  ): void {

    this.completedDownloads.update(
      downloads =>
        downloads.filter(
          download =>
            download.id !==
            downloadId
        )
    );
  }

  clearCompleted(): void {

    this.completedDownloads.set([]);
  }

  // ===========================================================
  // INTERNAL STATE
  // ===========================================================

  private findDownload(
    downloadId: string
  ): Download | undefined {

    return this.downloads().find(
      download =>
        download.id ===
        downloadId
    );
  }

  private findCompletedDownload(
    downloadId: string
  ): Download | undefined {

    return this.completedDownloads().find(
      download =>
        download.id ===
        downloadId
    );
  }

  private updateDownload(
    downloadId: string,
    changes: Partial<Download>
  ): void {

    this.downloads.update(
      downloads =>
        downloads.map(
          download =>
            download.id ===
              downloadId
              ? {
                ...download,
                ...changes
              }
              : download
        )
    );
  }

  private updateProgress(
    downloadId: string,
    progress: number
  ): void {

    this.updateDownload(
      downloadId,
      {
        progress:
          Math.max(
            0,
            Math.min(
              progress,
              100
            )
          )
      }
    );
  }

  private updateStatus(
    downloadId: string,
    status: DownloadStatus
  ): void {

    this.updateDownload(
      downloadId,
      {
        status
      }
    );
  }

  // ===========================================================
  // COMPLETION
  // ===========================================================

  private completeDownload(
    downloadId: string,
    filePath: string,
    title: string
  ): void {

    const download =
      this.findDownload(
        downloadId
      );

    if (!download) {

      console.warn(
        '[DOWNLOAD] Se recibió una finalización para una descarga que ya no está en la cola:',
        downloadId
      );

      return;
    }

    const completedDownload:
      Download = {

      ...download,

      title,

      status:
        'completed',

      stage:
        'completed',

      progress:
        100,

      message:
        'Descarga completada.',

      filePath,

      errorMessage:
        undefined,

      completedAt:
        new Date().toISOString()
    };

    // ---------------------------------------------------------
    // Quitar de la cola activa
    // ---------------------------------------------------------

    this.downloads.update(
      downloads =>
        downloads.filter(
          item =>
            item.id !==
            downloadId
        )
    );

    // ---------------------------------------------------------
    // Agregar a completadas
    // ---------------------------------------------------------

    this.completedDownloads.update(
      downloads => [
        ...downloads,
        completedDownload
      ]
    );

    console.log(
      '[DOWNLOAD] Descarga movida a completadas:',
      completedDownload
    );
  }

  // ===========================================================
  // ERRORS
  // ===========================================================

  private failDownload(
    downloadId: string,
    errorMessage: string
  ): void {

    this.updateDownload(
      downloadId,
      {
        status:
          'error',

        stage:
          'error',

        errorMessage,

        message:
          errorMessage
      }
    );
  }

  private getErrorMessage(
    error: unknown
  ): string {

    if (
      typeof error ===
      'string'
    ) {
      return error;
    }

    if (
      error &&
      typeof error ===
      'object' &&
      'message' in error
    ) {

      const message =
        (
          error as {
            message?: unknown
          }
        ).message;

      if (
        typeof message ===
        'string'
      ) {
        return message;
      }
    }

    return (
      'No se pudo completar la descarga.'
    );
  }

  // ===========================================================
  // IDENTIFIERS
  // ===========================================================

  private generateId(): string {

    return `download-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  // ===========================================================
  // RESTAURACIÓN DESDE HISTORIAL
  // ===========================================================

  /**
   * Restaura las descargas completadas a partir del historial
   * persistido por Rust.
   *
   * Se utiliza al iniciar Musex para que "Descargas completadas"
   * no aparezca vacío después de cerrar y volver a abrir la app.
   */
  restoreFromHistory(
    entries: {
      id: string;
      title: string;
      url: string;
      source: string;
      filePath: string;
      completedAt: string;
    }[]
  ): void {

    const restoredDownloads: Download[] = entries.map(
      entry => ({
        id: entry.id,
        url: entry.url,
        title: entry.title,
        provider: this.detectProvider(entry.url),
        status: 'completed',
        stage: 'completed',
        progress: 100,
        downloadedBytes: 0,
        totalBytes: undefined,
        message: 'Descarga completada.',
        filePath: entry.filePath,
        errorMessage: undefined,
        createdAt: entry.completedAt,
        completedAt: entry.completedAt
      })
    );

    this.completedDownloads.set(
      restoredDownloads
    );
  }

  // ===========================================================
  // CLEANUP
  // ===========================================================

  ngOnDestroy(): void {

    this.progressUnlisten?.();

    this.completedUnlisten?.();

    this.errorUnlisten?.();
  }
}