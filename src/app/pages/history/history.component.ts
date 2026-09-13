import { Component, inject, OnInit } from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';

import { DownloadHistoryService } from '../../core/services/download-history.service';
import { NotificationService } from '../../core/services/notification.service';

/**
 * Página del historial de Musex.
 *
 * Presenta dos secciones independientes:
 *
 * - Descargas: historial persistente proporcionado por Rust.
 * - Reproducción: pendiente de integrar mediante HistoryService.
 */
@Component({
  selector: 'app-history',
  standalone: true,
  imports: [DatePipe, TitleCasePipe],
  templateUrl: './history.component.html',
  styleUrl: './history.component.css'
})
export class HistoryComponent implements OnInit {

  readonly downloadHistoryService =
    inject(DownloadHistoryService);

  private readonly notificationService =
    inject(NotificationService);

  readonly downloadHistory =
    this.downloadHistoryService.entries;

  readonly loading =
    this.downloadHistoryService.loading;

  async ngOnInit(): Promise<void> {
    await this.downloadHistoryService.load();
  }

  async removeEntry(id: string): Promise<void> {
    try {
      await this.downloadHistoryService.removeEntry(id);

      this.notificationService.info(
        'Entrada eliminada del historial.'
      );

    } catch (error) {
      this.notificationService.error(
        'No se pudo eliminar la entrada del historial.'
      );
    }
  }

  async clearHistory(): Promise<void> {
    if (this.downloadHistory().length === 0) {
      return;
    }

    try {
      await this.downloadHistoryService.clear();

      this.notificationService.success(
        'Historial de descargas vaciado.'
      );

    } catch (error) {
      this.notificationService.error(
        'No se pudo vaciar el historial.'
      );
    }
  }
}