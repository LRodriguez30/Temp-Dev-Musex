import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Download } from '../../core/models/download.model';
import { DownloadService } from '../../core/services/download.service';
import { ModalService } from '../../core/services/modal.service';
import { NotificationService } from '../../core/services/notification.service';

import { DropZoneComponent } from '../../components/drop-zone/drop-zone.component';
import { DownloadItemComponent } from '../../components/download-item/download-item.component';
import { CompletedDownloadComponent } from '../../components/completed-download/completed-download.component';

import { PlayerService } from '../../core/services/player.service';
import { DownloadHistoryService } from '../../core/services/download-history.service';

/**
 * Vista principal para la gestión de descargas de Musex.
 *
 * El componente coordina la interacción entre la interfaz
 * y DownloadService.
 *
 * Las operaciones relacionadas con proveedores, archivos
 * y sistema operativo permanecen delegadas a la capa
 * de servicios y Tauri/Rust.
 */
@Component({
  selector: 'app-downloads',
  standalone: true,
  imports: [
    FormsModule,
    DropZoneComponent,
    DownloadItemComponent,
    CompletedDownloadComponent,
  ],
  templateUrl: './downloads.component.html',
  styleUrl: './downloads.component.css'
})
export class DownloadsComponent implements OnInit {

  private readonly playerService = inject(PlayerService);

  /**
   * Servicio principal de descargas.
   */
  readonly downloadService =
    inject(DownloadService);

  private readonly downloadHistoryService =
    inject(DownloadHistoryService);

  /**
   * Servicio encargado de gestionar los modales.
   */
  private readonly modalService =
    inject(ModalService);

  /**
   * Servicio encargado de mostrar feedback visual.
   */
  private readonly notificationService =
    inject(NotificationService);

  /**
   * Cola de descargas activas.
   */
  readonly downloads =
    this.downloadService.queue;

  /**
   * Descargas completadas.
   */
  readonly completedDownloads =
    this.downloadService.completed;

  /**
   * URL introducida actualmente por el usuario.
   */
  downloadUrl = '';

  /**
   * Comprueba si una URL pertenece a un proveedor compatible.
   */
  isValidDownloadUrl(url: string): boolean {
    return this.downloadService.validDownloadUrl(url);
  }

  /**
   * Agrega una URL a la cola e inicia inmediatamente
   * el worker de descarga mediante Tauri.
   *
   * La función no espera a que termine la descarga.
   * El progreso, la finalización y los errores son gestionados
   * posteriormente mediante los eventos recibidos por
   * DownloadService.
   */
  async addDownload(): Promise<void> {
    const url =
      this.downloadUrl.trim();

    if (!url) {
      this.notificationService.warning(
        'Introduce una URL para iniciar la descarga.'
      );
      return;
    }

    if (!this.isValidDownloadUrl(url)) {
      this.notificationService.error(
        'La URL no pertenece a una fuente compatible.'
      );
      return;
    }

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

    this.downloadUrl = '';

    this.notificationService.success(
      'La descarga se agregó a la cola.'
    );

    // =========================================================
    // INICIAR WORKER
    // =========================================================

    try {
      await this.downloadService.startDownload(
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

  /**
   * Selecciona una fuente predeterminada para facilitar
   * la introducción de una URL.
   */
  selectPreset(
    provider: 'youtube' | 'newgrounds'
  ): void {
    this.downloadUrl =
      provider === 'youtube'
        ? 'https://www.youtube.com/'
        : 'https://www.newgrounds.com/';

    this.notificationService.info(
      `URL de ${provider === 'youtube'
        ? 'YouTube'
        : 'Newgrounds'
      } preparada.`
    );
  }

  /**
   * Recibe los archivos seleccionados desde DropZoneComponent.
   *
   * La incorporación definitiva de archivos locales
   * se realizará mediante Tauri/Rust.
   */
  importFiles(files: File[]): void {
    if (files.length === 0) {
      return;
    }

    this.notificationService.success(
      `${files.length} archivo${files.length === 1 ? '' : 's'
      } de audio seleccionado${files.length === 1 ? '' : 's'
      }.`
    );
  }

  /**
   * Alterna entre pausa y reanudación de una descarga.
   *
   * La pausa real todavía no está disponible en el motor
   * de descargas actual.
   */
  togglePause(download: Download): void {
    if (download.status === 'paused') {
      this.downloadService.resume(
        download.id
      );
      return;
    }

    if (download.status === 'downloading') {
      this.downloadService.pause(
        download.id
      );
    }
  }

  /**
   * Cancela una descarga pendiente.
   *
   * Las descargas que ya están siendo procesadas por Rust
   * todavía no pueden detenerse desde Angular.
   */
  cancelDownload(download: Download): void {
    if (download.status !== 'pending') {
      this.notificationService.info(
        'La descarga ya está siendo procesada y todavía no puede cancelarse.'
      );
      return;
    }

    this.downloadService.cancel(
      download.id
    );

    this.notificationService.info(
      `Descarga cancelada: "${download.title}".`
    );
  }

  /**
   * Pausa todas las descargas que se encuentran
   * actualmente en ejecución.
   *
   * El método queda preparado para cuando el motor Rust
   * permita controlar individualmente los procesos.
   */
  pauseAll(): void {
    const activeDownloads =
      this.downloads().filter(
        download =>
          download.status === 'downloading'
      );

    if (activeDownloads.length === 0) {
      this.notificationService.info(
        'No hay descargas activas para pausar.'
      );
      return;
    }

    this.notificationService.info(
      'La pausa de descargas todavía no está disponible.'
    );
  }

  /**
   * Limpia la cola de descargas activas.
   */
  clearDownloads(): void {
    if (this.downloads().length === 0) {
      this.notificationService.info(
        'No hay descargas activas para limpiar.'
      );
      return;
    }

    this.downloadService.clear();

    this.notificationService.success(
      'La cola de descargas fue limpiada.'
    );
  }

  /**
   * Reproduce un archivo descargado.
   *
   * La reproducción real se conectará posteriormente
   * con PlayerService y Tauri.
   */
  async playCompleted(download: Download): Promise<void> {
    if (!download.filePath) {
      this.notificationService.warning(
        'Este archivo todavía no tiene una ubicación disponible.'
      );
      return;
    }

    try {
      await this.playerService.playFromPath(download.filePath, download.title);
    } catch (error) {
      this.notificationService.error(
        error instanceof Error
          ? error.message
          : 'No se pudo reproducir el archivo.'
      );
    }
  }

  /**
   * Abre la ubicación del archivo descargado
   * mediante Tauri/Rust.
   */
  async openCompletedLocation(
    download: Download
  ): Promise<void> {

    if (!download.filePath) {
      this.notificationService.warning(
        'Este archivo todavía no tiene una ubicación disponible.'
      );
      return;
    }

    try {
      await this.downloadService.openLocation(
        download.id
      );
    } catch (error) {
      this.notificationService.error(
        error instanceof Error
          ? error.message
          : 'No se pudo abrir la ubicación del archivo.'
      );
    }
  }

  /**
   * Elimina una descarga completada del historial.
   */
  removeCompleted(download: Download): void {
    this.downloadService.removeCompleted(
      download.id
    );

    // También lo quita del historial persistido en Rust,
    // para que no reaparezca al reiniciar Musex.
    this.downloadHistoryService
      .removeEntry(download.id)
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
   * Abre la configuración específica de descargas.
   */
  openDownloadSettings(): void {
    this.modalService.openDownloadSettings();
  }

  /**
   * Agrega una descarga completada a la biblioteca.
   */
  async addToLibrary(
    download: Download
  ): Promise<void> {
    try {
      const newFilePath =
        await this.downloadService.moveToLibrary(
          download.id
        );

      if (!newFilePath) {
        this.notificationService.warning(
          'No se pudo agregar el archivo a tu música.'
        );
        return;
      }

      this.notificationService.success(
        `"${download.title}" fue agregada a tu música.`
      );

    } catch (error) {
      this.notificationService.error(
        error instanceof Error
          ? error.message
          : 'No se pudo agregar el archivo a tu música.'
      );
    }
  }

  /**
   * Devuelve el resumen de la cola actual.
   */
  get downloadSummary(): string {
    const count =
      this.downloads().length;

    if (count === 0) {
      return 'Sin descargas activas';
    }

    return `${count} descarga${count === 1 ? '' : 's'
      } en cola`;
  }

  async ngOnInit(): Promise<void> {
    await this.downloadHistoryService.load();

    this.downloadService.restoreFromHistory(
      this.downloadHistoryService.entries()
    );
  }

  readonly showBrowser = signal(false);

  toggleBrowser(): void {
    this.showBrowser.update(value => !value);
  }

  useBrowserUrl(url: string): void {
    this.downloadUrl = url;

    this.notificationService.info(
      'URL preparada para descargar.'
    );
  }
}