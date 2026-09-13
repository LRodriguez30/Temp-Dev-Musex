import {
  Component,
  EventEmitter,
  Input,
  Output
} from '@angular/core';

import { Download } from '../../core/models/download.model';
import { TitleCasePipe } from '@angular/common';

/**
 * Representa una descarga que ya fue completada.
 *
 * Este componente se encarga únicamente de presentar las
 * acciones disponibles para el archivo. La lógica de negocio
 * permanece en DownloadsComponent y DownloadService.
 */
@Component({
  selector: 'app-completed-download',
  standalone: true,
  imports: [TitleCasePipe],
  templateUrl: './completed-download.component.html',
  styleUrl: './completed-download.component.css'
})
export class CompletedDownloadComponent {

  // ===========================================================
  // INPUTS
  // ===========================================================

  /**
   * Descarga completada que será mostrada en la interfaz.
   */
  @Input({ required: true })
  download!: Download;

  // ===========================================================
  // OUTPUTS
  // ===========================================================

  /**
   * Solicita reproducir el archivo descargado.
   */
  @Output()
  readonly play =
    new EventEmitter<Download>();

  /**
   * Solicita mover el archivo desde `downloads`
   * hacia la biblioteca permanente de Musex.
   */
  @Output()
  readonly addToLibrary =
    new EventEmitter<Download>();

  /**
   * Solicita abrir la ubicación del archivo.
   */
  @Output()
  readonly openLocation =
    new EventEmitter<Download>();

  /**
   * Solicita eliminar el registro de la descarga.
   */
  @Output()
  readonly remove =
    new EventEmitter<Download>();

  // ===========================================================
  // ACTIONS
  // ===========================================================

  /**
   * Emite la descarga actual para reproducirla.
   */
  onPlay(): void {
    this.play.emit(this.download);
  }

  /**
   * Emite la descarga actual para agregarla
   * a la biblioteca permanente.
   */
  onAddToLibrary(): void {
    this.addToLibrary.emit(this.download);
  }

  /**
   * Emite la descarga actual para abrir su ubicación.
   */
  onOpenLocation(): void {
    this.openLocation.emit(this.download);
  }

  /**
   * Emite la descarga actual para eliminarla
   * del historial de descargas.
   */
  onRemove(): void {
    this.remove.emit(this.download);
  }
}