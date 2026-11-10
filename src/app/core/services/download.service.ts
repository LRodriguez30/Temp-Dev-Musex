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
        new URL(this.normalizeUrl(url));

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

  // ===========================================================
  // COLA CON LÍMITE DE DESCARGAS SIMULTÁNEAS
  // ===========================================================
  //
  // Cada descarga lanza yt-dlp y ffmpeg. Con una lista larga no
  // pueden arrancar todas a la vez: se procesan de a pocas.

  /** Cuántas descargas corren a la vez (una por una). */
  private static readonly MAX_PARALLEL = 1;

  private readonly slotHolders = new Set<string>();

  private readonly slotWaiters: { id: string; resolve: () => void }[] = [];

  /**
   * Inicia una descarga respetando el límite de simultáneas: si ya
   * hay varias en curso, espera su turno (queda como "pendiente").
   */
  async queueDownload(
    downloadId: string
  ): Promise<void> {

    await this.acquireSlot(downloadId);

    // Pudo cancelarse o eliminarse mientras esperaba.
    const download = this.findDownload(downloadId);

    if (!download || download.status === 'cancelled') {
      this.releaseSlot(downloadId);
      return;
    }

    try {

      await this.startDownload(downloadId);

    } catch (error) {

      this.releaseSlot(downloadId);

      throw error;
    }

    // Si startDownload ya la dejó en un estado final, libera el turno.
    const after = this.findDownload(downloadId);

    if (
      !after ||
      (after.status !== 'downloading' && after.status !== 'pending')
    ) {
      this.releaseSlot(downloadId);
    }
  }

  private acquireSlot(
    downloadId: string
  ): Promise<void> {

    if (this.slotHolders.size < DownloadService.MAX_PARALLEL) {

      this.slotHolders.add(downloadId);

      return Promise.resolve();
    }

    return new Promise<void>(resolve => {
      this.slotWaiters.push({ id: downloadId, resolve });
    });
  }

  private releaseSlot(
    downloadId: string
  ): void {

    // Si estaba esperando turno, simplemente se quita de la fila.
    const waiting = this.slotWaiters.findIndex(
      waiter => waiter.id === downloadId
    );

    if (waiting >= 0) {
      this.slotWaiters.splice(waiting, 1);
      return;
    }

    if (!this.slotHolders.delete(downloadId)) {
      return;
    }

    while (
      this.slotHolders.size < DownloadService.MAX_PARALLEL &&
      this.slotWaiters.length > 0
    ) {

      const next = this.slotWaiters.shift()!;

      this.slotHolders.add(next.id);

      next.resolve();
    }
  }

  // ===========================================================
  // VARIOS ENLACES Y LISTAS DE YOUTUBE
  // ===========================================================

  /**
   * Extrae todos los enlaces compatibles de un texto (uno por línea,
   * o separados por espacios o comas). Sin duplicados.
   */
  extractUrls(
    text: string
  ): { valid: string[]; invalid: string[] } {

    const valid: string[] = [];
    const invalid: string[] = [];

    const seen = new Set<string>();

    for (const token of (text ?? '').split(/[\s,;]+/)) {

      const url = this.normalizeUrl(token);

      if (!url) {
        continue;
      }

      if (seen.has(url)) {
        continue;
      }

      seen.add(url);

      (this.validDownloadUrl(url) ? valid : invalid).push(url);
    }

    return { valid, invalid };
  }

  /**
   * Si la URL pertenece a una lista de YouTube devuelve su
   * identificador (`list=`); si no, null.
   */
  playlistIdOf(
    url: string
  ): string | null {

    try {

      const parsed = new URL(this.normalizeUrl(url));

      const host = parsed.hostname.toLowerCase();

      if (
        host !== 'youtube.com' &&
        !host.endsWith('.youtube.com')
      ) {
        return null;
      }

      const id = parsed.searchParams.get('list');

      return id && /^[A-Za-z0-9_-]{2,64}$/.test(id)
        ? id
        : null;

    } catch {

      return null;
    }
  }

  /** true si es una página de lista (no un video dentro de una lista). */
  isPlaylistPage(
    url: string
  ): boolean {

    try {

      return (
        this.playlistIdOf(url) !== null &&
        new URL(this.normalizeUrl(url)).pathname === '/playlist'
      );

    } catch {

      return false;
    }
  }

  /** Lee el contenido de una lista de YouTube (sin descargar). */
  async listYouTubePlaylist(
    url: string
  ): Promise<{
    title: string;
    entries: { id: string; title: string; duration?: number }[];
    truncated: boolean;
  }> {

    return invoke(
      'list_youtube_playlist',
      { url }
    );
  }

  /**
   * Limpia el texto pegado y devuelve la URL contenida:
   * ignora texto alrededor ("Mira esto https://..."), signos
   * de puntuación o <> alrededor, y añade https:// si falta.
   */
  normalizeUrl(
    input: string
  ): string {

    const text =
      (input ?? '').trim();

    if (!text) {
      return '';
    }

    const candidates =
      text
        .split(/\s+/)
        .map(token =>
          token
            .replace(/^[<("'\[]+/, '')
            .replace(/[>)"'\],;.]+$/, '')
        )
        .filter(token => token.length > 0);

    const withScheme =
      candidates.find(
        token => /^https?:\/\//i.test(token)
      );

    if (withScheme) {
      return withScheme;
    }

    const bare =
      candidates.find(
        token =>
          /^(?:[a-z0-9-]+\.)*(?:youtube\.com|youtu\.be|newgrounds\.com)(?:[/?#:]|$)/i
            .test(token)
      );

    if (bare) {
      return `https://${bare.replace(/^\/+/, '')}`;
    }

    return candidates[0] ?? '';
  }

  validDownloadUrl(
    url: string
  ): boolean {

    try {

      const parsedUrl =
        new URL(this.normalizeUrl(url));

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
      this.normalizeUrl(url);

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

    // Eventos que llegan después de cancelar no deben reactivarla.
    if (download.status === 'cancelled') {
      return;
    }

    if (event.status === 'cancelled') {

      this.updateDownload(
        event.id,
        {
          status:
            'cancelled',

          message:
            'Descarga cancelada.'
        }
      );

      setTimeout(
        () => this.remove(event.id),
        1200
      );

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
  async cancel(
    downloadId: string
  ): Promise<void> {

    const download =
      this.findDownload(
        downloadId
      );

    if (!download) {
      return;
    }

    // Pendiente: aún no llegó a Rust, basta con descartarla.
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

      return;
    }

    // En curso: se pide a Rust detener el proceso.
    if (
      download.status ===
      'downloading'
    ) {

      this.updateDownload(
        downloadId,
        {
          message:
            'Cancelando...'
        }
      );

      try {

        await invoke<boolean>(
          'cancel_download',
          {
            id:
              downloadId
          }
        );

      } catch (error) {

        this.updateDownload(
          downloadId,
          {
            message:
              `No se pudo cancelar: ${this.getErrorMessage(error)}`
          }
        );
      }
    }
  }

  // ===========================================================
  // GESTIÓN DE COLA
  // ===========================================================

  remove(
    downloadId: string
  ): void {

    this.releaseSlot(downloadId);

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

    // Al terminar (bien, mal o cancelada) se libera el turno para que
    // arranque la siguiente descarga en espera.
    if (
      changes.status === 'completed' ||
      changes.status === 'error' ||
      changes.status === 'cancelled'
    ) {
      this.releaseSlot(downloadId);
    }

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