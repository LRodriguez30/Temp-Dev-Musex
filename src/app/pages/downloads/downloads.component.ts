import {
  Component,
  computed,
  inject,
  OnInit,
  signal
} from '@angular/core';

import { FormsModule } from '@angular/forms';

import { Download } from '../../core/models/download.model';

import { DownloadService } from '../../core/services/download.service';
import { NotificationService } from '../../core/services/notification.service';
import { PlayerService } from '../../core/services/player.service';
import { DownloadHistoryService } from '../../core/services/download-history.service';
import { LibraryService } from '../../core/services/library.service';

import { DropZoneComponent } from '../../components/drop-zone/drop-zone.component';
import { DownloadItemComponent } from '../../components/download-item/download-item.component';
import { CompletedDownloadComponent } from '../../components/completed-download/completed-download.component';


/**
 * Vista principal para la gestión de descargas de Musex.
 *
 * DownloadService mantiene el estado de las descargas.
 * Rust/Tauri ejecuta físicamente las descargas.
 *
 * Esta vista únicamente coordina:
 *
 * - formulario de descarga
 * - estados de la cola
 * - errores
 * - reintentos
 * - eliminación
 * - reproducción
 * - historial
 * - incorporación a biblioteca
 * - detección de archivos duplicados
 */
@Component({
  selector: 'app-downloads',

  standalone: true,

  imports: [
    FormsModule,
    DropZoneComponent,
    DownloadItemComponent,
    CompletedDownloadComponent
  ],

  templateUrl: './downloads.component.html',

  styleUrl: './downloads.component.css'
})
export class DownloadsComponent
  implements OnInit {


  // ===========================================================
  // SERVICES
  // ===========================================================

  /**
   * Reproductor principal de Musex.
   */
  private readonly playerService =
    inject(PlayerService);


  /**
   * Servicio principal de descargas.
   */
  readonly downloadService =
    inject(DownloadService);


  /**
   * Biblioteca musical de Musex.
   *
   * Se utiliza para comprobar si un archivo descargado
   * ya existe dentro de la biblioteca.
   */
  private readonly libraryService =
    inject(LibraryService);


  /**
   * Historial persistido de descargas.
   */
  private readonly downloadHistoryService =
    inject(DownloadHistoryService);


  /**
   * Sistema de notificaciones.
   */
  private readonly notificationService =
    inject(NotificationService);


  // ===========================================================
  // STATE
  // ===========================================================

  /**
   * Descargas que todavía pertenecen a la cola activa.
   *
   * Aquí pueden existir:
   *
   * - pending
   * - downloading
   * - paused
   * - error
   */
  readonly downloads =
    this.downloadService.queue;


  /**
   * IDs de descargas que están siendo reintentadas.
   *
   * Se utiliza como Set para permitir varios reintentos
   * independientes sin bloquear toda la interfaz.
   */
  readonly retryingDownloads =
    signal<Set<string>>(new Set());


  /**
   * Controla el navegador integrado.
   */
  readonly showBrowser =
    signal(false);


  /**
   * Descargas que fueron añadidas a la biblioteca
   * durante la sesión actual.
   *
   * Se conserva como respaldo para ocultarlas inmediatamente
   * aunque LibraryService todavía no haya actualizado
   * completamente su estado.
   */
  private readonly addedToLibrary =
    signal<Set<string>>(new Set());


  /**
   * Descargas completadas que todavía deben mostrarse.
   *
   * Una descarga deja de aparecer cuando:
   *
   * 1. Ya fue añadida a la biblioteca durante esta sesión.
   *
   * 2. La biblioteca ya contiene el mismo archivo.
   *
   * La comparación se realiza mediante:
   *
   * - ruta completa
   * - nombre del archivo
   *
   * Esto permite detectar el mismo archivo aunque haya sido
   * movido desde la carpeta de descargas hacia la biblioteca.
   *
   * El historial de descargas NO se modifica.
   */
  readonly completedDownloads =
    computed(() => {

      const completed =
        this.downloadService.completed();


      const library =
        this.libraryService.library();


      const added =
        this.addedToLibrary();


      return completed.filter(
        download => {

          // ---------------------------------------------------
          // YA AÑADIDA A LA BIBLIOTECA EN ESTA SESIÓN
          // ---------------------------------------------------

          if (
            added.has(
              download.id
            )
          ) {

            return false;
          }


          // ---------------------------------------------------
          // COMPROBAR CONTRA LA BIBLIOTECA
          // ---------------------------------------------------

          const existsInLibrary =
            library.some(
              track =>
                this.matchesLibraryTrack(
                  download,
                  track
                )
            );


          return !existsInLibrary;
        }
      );
    });


  /**
   * URL introducida en el formulario.
   */
  downloadUrl = '';


  // ===========================================================
  // DUPLICATE FILE COMPARISON
  // ===========================================================

  /**
   * Comprueba si una descarga ya representa un archivo
   * existente dentro de la biblioteca.
   *
   * La comparación se realiza en este orden:
   *
   * 1. Ruta física completa.
   * 2. Nombre físico del archivo.
   *
   * No se utilizan título, artista, álbum, género ni duración
   * para determinar si el archivo ya existe.
   *
   * Esto evita falsos positivos entre canciones diferentes
   * que puedan compartir el mismo título o metadatos.
   */
  private matchesLibraryTrack(
    download: Download,
    track: {
      id: string;
      title: string;
      artist: string;
      album: string;
      genre?: string;
      duration: number;
      path: string;
    }
  ): boolean {

    // ---------------------------------------------------------
    // COMPROBAR RUTA COMPLETA
    // ---------------------------------------------------------

    if (
      download.filePath &&
      track.path &&
      this.normalizePath(
        download.filePath
      ) ===
      this.normalizePath(
        track.path
      )
    ) {

      return true;
    }


    // ---------------------------------------------------------
    // COMPROBAR NOMBRE DEL ARCHIVO
    // ---------------------------------------------------------

    if (
      download.filePath &&
      track.path &&
      this.normalizeFileName(
        download.filePath
      ) ===
      this.normalizeFileName(
        track.path
      )
    ) {

      return true;
    }


    return false;
  }


  /**
   * Normaliza una ruta para evitar diferencias de formato
   * entre Windows y el valor almacenado.
   *
   * Ejemplo:
   *
   * C:\Users\LART\Musex\downloads\song.mp3
   *
   * se convierte en:
   *
   * c:/users/lart/musex/downloads/song.mp3
   */
  private normalizePath(
    path: string
  ): string {

    return path
      .trim()
      .replace(/\\/g, '/')
      .toLocaleLowerCase();
  }


  /**
   * Obtiene y normaliza únicamente el nombre del archivo.
   *
   * Esto permite reconocer el mismo archivo aunque se encuentre
   * en directorios diferentes.
   *
   * Ejemplo:
   *
   * Musex/downloads/song.mp3
   *
   * Music/song.mp3
   *
   * ambos producen:
   *
   * song.mp3
   */
  private normalizeFileName(
    path: string
  ): string {

    const fileName =
      path
        .trim()
        .replace(/\\/g, '/')
        .split('/')
        .pop() ?? '';


    return fileName
      .trim()
      .toLocaleLowerCase();
  }


  // ===========================================================
  // URL VALIDATION
  // ===========================================================

  /**
   * Comprueba si la URL pertenece a un proveedor compatible
   * con el sistema de descargas de Musex.
   */
  isValidDownloadUrl(
    url: string
  ): boolean {

    return this.downloadService
      .validDownloadUrl(
        url
      );
  }


  // ===========================================================
  // ADD DOWNLOAD
  // ===========================================================

  /**
   * Agrega una nueva descarga a la cola
   * y comienza inmediatamente su ejecución.
   */
  async addDownload(): Promise<void> {

    const url =
      this.downloadUrl.trim();


    // ---------------------------------------------------------
    // URL VACÍA
    // ---------------------------------------------------------

    if (!url) {

      this.notificationService.warning(
        'Introduce una URL para iniciar la descarga.'
      );

      return;
    }


    // ---------------------------------------------------------
    // URL NO COMPATIBLE
    // ---------------------------------------------------------

    if (
      !this.isValidDownloadUrl(
        url
      )
    ) {

      this.notificationService.error(
        'La URL no pertenece a una fuente compatible.'
      );

      return;
    }


    // ---------------------------------------------------------
    // CREAR DESCARGA
    // ---------------------------------------------------------

    const download =
      this.downloadService.addDownload(
        url
      );


    if (!download) {

      this.notificationService.error(
        'No se pudo agregar la descarga.'
      );

      return;
    }


    // ---------------------------------------------------------
    // LIMPIAR FORMULARIO
    // ---------------------------------------------------------

    this.downloadUrl = '';


    this.notificationService.success(
      'La descarga se agregó a la cola.'
    );


    // ---------------------------------------------------------
    // INICIAR DESCARGA
    // ---------------------------------------------------------

    try {

      await this.downloadService
        .startDownload(
          download.id
        );

    } catch (error) {

      this.notificationService.error(
        error instanceof Error
          ? error.message
          : 'No se pudo iniciar la descarga.'
      );
    }
  }


  // ===========================================================
  // PROVIDER PRESETS
  // ===========================================================

  /**
   * Coloca una URL base de un proveedor
   * dentro del formulario.
   */
  selectPreset(
    provider:
      | 'youtube'
      | 'newgrounds'
  ): void {

    this.downloadUrl =
      provider === 'youtube'
        ? 'https://www.youtube.com/'
        : 'https://www.newgrounds.com/';


    this.notificationService.info(
      `URL de ${
        provider === 'youtube'
          ? 'YouTube'
          : 'Newgrounds'
      } preparada.`
    );
  }


  // ===========================================================
  // LOCAL FILES
  // ===========================================================

  /**
   * Recibe archivos desde DropZoneComponent.
   */
  importFiles(
    files: File[]
  ): void {

    if (
      files.length === 0
    ) {

      return;
    }


    this.notificationService.success(
      `${files.length} archivo${
        files.length === 1
          ? ''
          : 's'
      } de audio seleccionado${
        files.length === 1
          ? ''
          : 's'
      }.`
    );
  }


  // ===========================================================
  // DOWNLOAD CONTROLS
  // ===========================================================

  /**
   * La pausa todavía no está implementada realmente.
   */
  togglePause(
    download: Download
  ): void {

    if (
      download.status !==
      'downloading'
    ) {

      return;
    }


    this.notificationService.info(
      'La pausa de descargas todavía no está disponible.'
    );
  }


  /**
   * Cancela una descarga que todavía está pendiente.
   */
  cancelDownload(
    download: Download
  ): void {

    if (
      download.status !==
      'pending'
    ) {

      this.notificationService.info(
        'Esta descarga ya está siendo procesada y no puede cancelarse todavía.'
      );

      return;
    }


    this.downloadService.cancel(
      download.id
    );


    this.notificationService.info(
      `"${download.title}" fue cancelada.`
    );
  }


  /**
   * Elimina una descarga de la cola.
   */
  removeDownload(
    download: Download
  ): void {

    this.downloadService.remove(
      download.id
    );


    this.notificationService.info(
      `"${download.title}" fue eliminada de la cola.`
    );
  }


  /**
   * Reintenta una descarga que terminó con error.
   */
  async retryDownload(
    download: Download
  ): Promise<void> {

    if (
      download.status !==
      'error'
    ) {

      return;
    }


    this.retryingDownloads.update(
      current => {

        const next =
          new Set(current);

        next.add(
          download.id
        );

        return next;
      }
    );


    try {

      await this.downloadService
        .startDownload(
          download.id
        );

    } finally {

      this.retryingDownloads.update(
        current => {

          const next =
            new Set(current);

          next.delete(
            download.id
          );

          return next;
        }
      );
    }
  }


  /**
   * Indica si una descarga está siendo reintentada.
   */
  isRetrying(
    downloadId: string
  ): boolean {

    return this.retryingDownloads()
      .has(
        downloadId
      );
  }


  // ===========================================================
  // QUEUE CLEANUP
  // ===========================================================

  /**
   * Elimina únicamente las descargas que terminaron
   * con error.
   */
  clearDownloads(): void {

    const errorDownloads =
      this.downloads()
        .filter(
          download =>
            download.status ===
            'error'
        );


    if (
      errorDownloads.length === 0
    ) {

      this.notificationService.info(
        'No hay descargas con error para limpiar.'
      );

      return;
    }


    for (
      const download
      of errorDownloads
    ) {

      this.downloadService.remove(
        download.id
      );
    }


    this.notificationService.success(
      `${errorDownloads.length} descarga${
        errorDownloads.length === 1
          ? ''
          : 's'
      } con error ${
        errorDownloads.length === 1
          ? 'fue eliminada'
          : 'fueron eliminadas'
      }.`
    );
  }


  // ===========================================================
  // COMPLETED DOWNLOADS
  // ===========================================================

  /**
   * Reproduce directamente el archivo descargado.
   *
   * Se utiliza el título real almacenado en Download,
   * no el nombre físico del archivo.
   */
  async playCompleted(
    download: Download
  ): Promise<void> {

    if (
      !download.filePath
    ) {

      this.notificationService.warning(
        'Este archivo todavía no tiene una ubicación disponible.'
      );

      return;
    }


    try {

      await this.playerService
        .playFromPath(
          download.filePath,
          download.title
        );

    } catch (error) {

      console.error(
        'No se pudo reproducir la descarga:',
        error
      );


      this.notificationService.error(
        error instanceof Error
          ? error.message
          : 'No se pudo reproducir el archivo.'
      );
    }
  }


  /**
   * Abre la ubicación física del archivo descargado.
   */
  async openCompletedLocation(
    download: Download
  ): Promise<void> {

    if (
      !download.filePath
    ) {

      this.notificationService.warning(
        'Este archivo todavía no tiene una ubicación disponible.'
      );

      return;
    }


    try {

      await this.downloadService
        .openLocation(
          download.id
        );

    } catch (error) {

      console.error(
        'No se pudo abrir la ubicación del archivo:',
        error
      );


      this.notificationService.error(
        error instanceof Error
          ? error.message
          : 'No se pudo abrir la ubicación del archivo.'
      );
    }
  }


  /**
   * Elimina una descarga completada de:
   *
   * - estado reactivo
   * - historial persistido
   *
   * No elimina físicamente el archivo de disco.
   */
  removeCompleted(
    download: Download
  ): void {

    this.downloadService
      .removeCompleted(
        download.id
      );


    this.downloadHistoryService
      .removeEntry(
        download.id
      )
      .catch(error => {

        console.error(
          'No se pudo eliminar del historial persistido:',
          error
        );
      });


    this.notificationService.info(
      `"${download.title}" fue eliminada del historial de descargas.`
    );
  }


  /**
   * Mueve una descarga completada a la biblioteca
   * permanente de Musex.
   *
   * La descarga permanece en el historial.
   *
   * Al completar correctamente, se marca inmediatamente
   * para que desaparezca de "Descargas completadas".
   */
  async addToLibrary(
    download: Download
  ): Promise<void> {

    try {

      const newFilePath =
        await this.downloadService
          .moveToLibrary(
            download.id
          );


      if (!newFilePath) {

        this.notificationService.warning(
          'No se pudo agregar el archivo a tu música.'
        );

        return;
      }


      /**
       * Ocultamos inmediatamente esta descarga.
       *
       * No eliminamos el registro del historial.
       */
      this.addedToLibrary.update(
        current => {

          const next =
            new Set(current);

          next.add(
            download.id
          );

          return next;
        }
      );


      this.notificationService.success(
        `"${download.title}" fue agregada a tu música.`
      );

    } catch (error) {

      console.error(
        'No se pudo agregar la descarga a la biblioteca:',
        error
      );


      this.notificationService.error(
        error instanceof Error
          ? error.message
          : 'No se pudo agregar el archivo a tu música.'
      );
    }
  }


  // ===========================================================
  // QUEUE SUMMARY
  // ===========================================================

  /**
   * Resumen contextual de la cola.
   */
  get downloadSummary(): string {

    const downloads =
      this.downloads();


    if (
      downloads.length === 0
    ) {

      return 'Sin descargas activas';
    }


    const downloading =
      downloads.filter(
        download =>
          download.status ===
          'downloading'
      ).length;


    const pending =
      downloads.filter(
        download =>
          download.status ===
          'pending'
      ).length;


    const paused =
      downloads.filter(
        download =>
          download.status ===
          'paused'
      ).length;


    const errors =
      downloads.filter(
        download =>
          download.status ===
          'error'
      ).length;


    const parts: string[] = [];


    if (
      downloading > 0
    ) {

      parts.push(
        `${downloading} descargando`
      );
    }


    if (
      pending > 0
    ) {

      parts.push(
        `${pending} pendiente${
          pending === 1
            ? ''
            : 's'
        }`
      );
    }


    if (
      paused > 0
    ) {

      parts.push(
        `${paused} pausada${
          paused === 1
            ? ''
            : 's'
        }`
      );
    }


    if (
      errors > 0
    ) {

      parts.push(
        `${errors} con error`
      );
    }


    return parts.length > 0
      ? parts.join(' · ')
      : 'Sin descargas activas';
  }


  /**
   * Número de descargas que terminaron con error.
   */
  get errorCount(): number {

    return this.downloads()
      .filter(
        download =>
          download.status ===
          'error'
      )
      .length;
  }


  /**
   * Número de descargas que todavía pueden eliminarse
   * de forma segura desde la cola.
   */
  get removableDownloadCount(): number {

    return this.downloads()
      .filter(
        download =>
          download.status === 'pending' ||
          download.status === 'paused' ||
          download.status === 'error'
      )
      .length;
  }


  /**
   * Indica si existe al menos una descarga actualmente
   * en ejecución.
   */
  get hasDownloading(): boolean {

    return this.downloads()
      .some(
        download =>
          download.status ===
          'downloading'
      );
  }


  // ===========================================================
  // INITIALIZATION
  // ===========================================================

  /**
   * Carga el historial persistido y reconstruye
   * las descargas completadas.
   */
  async ngOnInit(): Promise<void> {

    await this.downloadHistoryService
      .load();


    this.downloadService
      .restoreFromHistory(
        this.downloadHistoryService
          .entries()
      );
  }


  // ===========================================================
  // BROWSER
  // ===========================================================

  /**
   * Muestra u oculta el navegador integrado.
   */
  toggleBrowser(): void {

    this.showBrowser.update(
      value => !value
    );
  }


  /**
   * Utiliza una URL obtenida desde el navegador
   * como URL del formulario de descarga.
   */
  useBrowserUrl(
    url: string
  ): void {

    const normalizedUrl =
      url.trim();


    if (
      !normalizedUrl
    ) {

      return;
    }


    this.downloadUrl =
      normalizedUrl;


    this.showBrowser.set(
      false
    );


    this.notificationService.info(
      'URL preparada para descargar.'
    );
  }
}