// =============================================================
// MUSEX - DOWNLOAD ITEM COMPONENT
// =============================================================
//
// Representa visualmente una descarga activa dentro de Musex.
//
// Este componente únicamente presenta el estado recibido desde
// DownloadService y comunica las acciones solicitadas por el
// usuario.
//
// La ejecución, progreso y control real de la descarga pertenecen
// a DownloadService y a la capa Rust/Tauri.
// =============================================================

import {
  Component,
  EventEmitter,
  Input,
  Output
} from '@angular/core';

import {
  DecimalPipe,
  TitleCasePipe
} from '@angular/common';

import {
  Download,
  DownloadStage,
  DownloadStatus
} from '../../core/models/download.model';

// =============================================================
// COMPONENT
// =============================================================

/**
 * Representa una descarga activa dentro de Musex.
 *
 * El componente recibe el estado de la descarga mediante `@Input`
 * y emite las acciones del usuario mediante `@Output`.
 *
 * El progreso mostrado corresponde directamente a los valores
 * enviados por la capa Rust mediante los eventos de Tauri.
 */
@Component({
  selector: 'app-download-item',
  standalone: true,
  imports: [
    TitleCasePipe,
    DecimalPipe
  ],
  templateUrl: './download-item.component.html',
  styleUrl: './download-item.component.css'
})
export class DownloadItemComponent {

  // ===========================================================
  // INPUT
  // ===========================================================

  /**
   * Descarga que será representada.
   */
  @Input({ required: true })
  download!: Download;

  // ===========================================================
  // OUTPUTS
  // ===========================================================

  /**
   * Evento emitido para pausar o reanudar una descarga.
   */
  @Output()
  pause =
    new EventEmitter<Download>();

  /**
   * Evento emitido para cancelar una descarga.
   */
  @Output()
  cancel =
    new EventEmitter<Download>();

  // ===========================================================
  // STATUS
  // ===========================================================

  /**
   * Devuelve el texto correspondiente al estado general
   * de la descarga.
   */
  get statusLabel(): string {

    const labels:
      Record<DownloadStatus, string> = {

      pending:
        'Pendiente',

      downloading:
        'Descargando',

      paused:
        'Pausada',

      completed:
        'Completada',

      error:
        'Error',

      cancelled:
        'Cancelada'
    };

    return labels[
      this.download.status
    ];
  }

  // ===========================================================
  // STAGE
  // ===========================================================

  /**
   * Devuelve el mensaje correspondiente a la etapa actual.
   *
   * El mensaje enviado por Rust tiene prioridad para que la
   * interfaz pueda representar exactamente qué está ocurriendo.
   */
  get stageLabel(): string {

    if (this.download.message) {
      return this.download.message;
    }

    const labels:
      Record<DownloadStage, string> = {

      preparing:
        'Preparando descarga...',

      fetching:
        'Obteniendo información...',

      downloading:
        'Descargando audio...',

      converting:
        'Convirtiendo archivo...',

      saving:
        'Guardando archivo...',

      completed:
        'Descarga completada.',

      error:
        'No se pudo completar la descarga.'
    };

    return labels[
      this.download.stage
    ];
  }

  // ===========================================================
  // DOWNLOAD SIZE
  // ===========================================================

  /**
   * Indica si la descarga dispone de un tamaño total válido.
   *
   * Cuando el tamaño total no está disponible, la interfaz
   * debe mostrar únicamente los bytes recibidos y utilizar
   * una representación de progreso indeterminado.
   */
  get hasTotalBytes(): boolean {

    return (
      this.download.totalBytes !== undefined &&
      this.download.totalBytes > 0
    );
  }

  /**
   * Devuelve la cantidad de bytes descargados en un formato
   * legible para la interfaz.
   *
   * Ejemplos:
   *
   * - 1024      → 1.00 KB
   * - 1048576   → 1.00 MB
   * - 1572864   → 1.50 MB
   */
  formatBytes(bytes: number): string {

    if (
      !Number.isFinite(bytes) ||
      bytes <= 0
    ) {
      return '0 B';
    }

    const units = [
      'B',
      'KB',
      'MB',
      'GB',
      'TB'
    ];

    const exponent =
      Math.min(
        Math.floor(
          Math.log(bytes) /
          Math.log(1024)
        ),
        units.length - 1
      );

    const value =
      bytes /
      Math.pow(
        1024,
        exponent
      );

    return (
      `${value.toFixed(
        exponent === 0
          ? 0
          : 2
      )} ${units[exponent]}`
    );
  }

  /**
   * Devuelve la cantidad descargada en un formato adecuado
   * para mostrar junto al tamaño total.
   */
  get downloadedSizeLabel(): string {

    return this.formatBytes(
      this.download.downloadedBytes
    );
  }

  /**
   * Devuelve el tamaño total de la descarga cuando está
   * disponible.
   */
  get totalSizeLabel(): string {

    if (!this.hasTotalBytes) {
      return '';
    }

    return this.formatBytes(
      this.download.totalBytes!
    );
  }

  // ===========================================================
  // CONTROLS
  // ===========================================================

  /**
   * Indica si la descarga puede pausarse o reanudarse.
   *
   * El control queda preparado para la futura implementación
   * de pausa real en Rust.
   */
  get canPause(): boolean {

    return (
      this.download.status ===
        'downloading' ||

      this.download.status ===
        'paused'
    );
  }

  /**
   * Texto de la acción disponible sobre la descarga.
   */
  get pauseLabel(): string {

    return (
      this.download.status ===
        'paused'
        ? 'Reanudar descarga'
        : 'Pausar descarga'
    );
  }

  /**
   * Solicita pausar o reanudar la descarga.
   *
   * El componente no modifica directamente el estado.
   * La solicitud se envía al componente padre.
   */
  togglePause(): void {

    if (!this.canPause) {
      return;
    }

    this.pause.emit(
      this.download
    );
  }

  /**
   * Solicita cancelar la descarga.
   *
   * La decisión de si la operación puede cancelarse
   * corresponde a DownloadService.
   */
  cancelDownload(): void {

    this.cancel.emit(
      this.download
    );
  }
}