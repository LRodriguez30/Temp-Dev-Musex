import { Component, inject } from '@angular/core';

import { PlayerService } from '../../core/services/player.service';
import { QueueService } from '../../core/services/queue.service';
import { Track } from '../../core/models/track.model';
import { NotificationService } from '../../core/services/notification.service';

/**
 * Representa la cola de reproducción de Musex.
 *
 * QueueComponent se encarga únicamente de presentar y manipular
 * la cola. El estado pertenece a QueueService y la reproducción
 * pertenece a PlayerService.
 */
@Component({
  selector: 'app-queue',
  standalone: true,
  imports: [],
  templateUrl: './queue.component.html',
  styleUrl: './queue.component.css'
})
export class QueueComponent {

  /**
   * Servicio que mantiene la cola de reproducción.
   */
  private readonly queueService = inject(QueueService);

  /**
   * Servicio encargado de reproducir las canciones.
   */
  private readonly playerService = inject(PlayerService);

  private readonly notificationService = inject(NotificationService);

  /**
   * Cola reactiva de canciones.
   */
  readonly queue = this.queueService.items;

  /**
   * Devuelve la canción actualmente reproducida.
   */
  get currentTrackId(): string | null {
    return this.playerService.state().currentTrackId;
  }

  /**
   * Devuelve una canción a partir de su identificador.
   */
  getTrack(trackId: string): Track | undefined {
    return this.playerService.getTrack(trackId);
  }

  /**
   * Reproduce una canción seleccionada de la cola.
   */
  play(trackId: string): void {
    this.playerService.playTrack(trackId);
  }

  /**
   * Elimina una canción de la cola.
   */
  remove(trackId: string): void {
    const track = this.getTrack(trackId);
    this.queueService.remove(trackId);

    /**
     * Mantiene sincronizada la representación de la cola
     * dentro del estado del reproductor.
     */
    this.playerService.syncQueue();

    if (track) {
      this.notificationService.info(
        'Canción eliminada de la cola',
        `${track.title} se quitó de la cola de reproducción.`
      );
    }
  }

  /**
   * Elimina una canción utilizando su posición dentro de la cola.
   */
  removeAt(index: number): void {
    const trackId = this.queue()[index];
    const track = trackId
      ? this.getTrack(trackId)
      : undefined;

    this.queueService.removeAt(index);
    this.playerService.syncQueue();

    if (track) {
      this.notificationService.info(
        'Canción eliminada de la cola',
        `${track.title} se quitó de la cola de reproducción.`
      );
    }
  }

  /**
   * Vacía completamente la cola.
   */
  clear(): void {
    if (this.queue().length === 0) {
      return;
    }

    this.queueService.clear();
    this.playerService.syncQueue();

    this.notificationService.info(
      'Cola vaciada',
      'Se eliminaron todas las canciones de la cola.'
    );
  }

  /**
   * Mueve una canción dentro de la cola.
   */
  move(fromIndex: number, toIndex: number): void {
    this.queueService.move(
      fromIndex,
      toIndex
    );

    this.playerService.syncQueue();
  }

  /**
   * Indica si una canción es la que se está reproduciendo.
   */
  isPlaying(trackId: string): boolean {
    return this.currentTrackId === trackId;
  }

  formatTime(seconds: number): string {
    const totalSeconds =
      Math.max(0, Math.floor(seconds));

    const hours =
      Math.floor(totalSeconds / 3600);

    const minutes =
      Math.floor(
        (totalSeconds % 3600) / 60
      );

    const remainingSeconds =
      totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes
        .toString()
        .padStart(2, '0')}:${remainingSeconds
          .toString()
          .padStart(2, '0')}`;
    }

    return `${minutes}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`;
  }

  getCoverIconPath(id: string | undefined): string {
    const icons: Record<string, string> = {
      music: 'M9 18V5l12-2v13 M9 9l12-2',

      heart:
        'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z',

      zap:
        'M13 2 3 14h9l-1 8 10-12h-9l1-8Z'
    };

    return icons[id ?? 'music'] ?? icons['music'];
  }
}