import { Component, inject } from '@angular/core';

import { PlayerService } from '../../core/services/player.service';
import { LibraryService } from '../../core/services/library.service';
import { QueueService } from '../../core/services/queue.service';
import { QueueComponent } from '../queue/queue.component';
import { NotificationService } from '../../core/services/notification.service';

/**
 * Panel lateral del reproductor de Musex.
 *
 * Muestra la información de la canción actual y los controles
 * secundarios del reproductor.
 *
 * La gestión del estado se delega en los servicios correspondientes
 * para mantener separadas la lógica y la presentación.
 */
@Component({
  selector: 'app-now-playing',
  standalone: true,
  imports: [
    QueueComponent
  ],
  templateUrl: './now-playing.component.html',
  styleUrl: './now-playing.component.css'
})
export class NowPlayingComponent {
  readonly playerService = inject(PlayerService);
  private readonly libraryService = inject(LibraryService);
  private readonly queueService = inject(QueueService);
  private readonly notificationService = inject(NotificationService);

  readonly playerState = this.playerService.state;

  activePanel: 'playing' | 'lyrics' = 'playing';
  
  /**
   * Canción actualmente seleccionada en el reproductor.
   */
  get currentTrack() {
    return this.playerService.getCurrentTrack();
  }

  /**
   * Indica si la canción actual pertenece a favoritos.
   */
  get currentTrackIsFavorite(): boolean {
    const track = this.currentTrack;

    if (!track) {
      return false;
    }

    return this.libraryService.isFavorite(track.id);
  }

  /**
   * Agrega o elimina la canción actual de favoritos.
   */
  toggleFavorite(): void {
    const track = this.currentTrack;

    if (!track) {
      return;
    }

    this.libraryService.toggleFavorite(track.id);

    const isFavorite = this.libraryService.isFavorite(track.id);

    if (isFavorite) {
      this.notificationService.success(
        'Canción agregada a favoritos',
        `${track.title} se agregó a tu colección.`
      );
    } else {
      this.notificationService.info(
        'Canción eliminada de favoritos',
        `${track.title} se quitó de tu colección.`
      );
    }
  }

  /**
   * Alterna entre reproducción y pausa.
   */
  togglePlay(): void {
    this.playerService.togglePlay();
  }

  /**
   * Reproduce la siguiente canción.
   */
  nextTrack(): void {
    this.playerService.nextTrack();
  }

  /**
   * Reproduce la canción anterior.
   */
  previousTrack(): void {
    this.playerService.previousTrack();
  }

  /**
   * Actualiza la posición actual de reproducción.
   */
  seek(time: number): void {
    this.playerService.seek(time);
  }

  /**
   * Activa o desactiva la reproducción aleatoria.
   */
  toggleShuffle(): void {
    this.playerService.toggleShuffle();
  }

  /**
   * Activa o desactiva la repetición.
   */
  toggleRepeat(): void {
    this.playerService.toggleRepeat();
  }

  /**
   * Vacía completamente la cola de reproducción.
   */
  clearQueue(): void {
    this.queueService.clear();
    this.playerService.syncQueue();
  }

  formatTime(seconds: number): string {
    const totalSeconds = Math.max(
      0,
      Math.floor(seconds)
    );

    const hours = Math.floor(
      totalSeconds / 3600
    );

    const minutes = Math.floor(
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

  /**
   * Porcentaje actual de progreso de la canción.
   */
  get progressPercentage(): number {
    const duration = this.currentTrack?.duration ?? 0;
    const currentTime = this.playerState().currentTime;

    if (duration <= 0) {
      return 0;
    }

    return Math.min(
      100,
      Math.max(0, (currentTime / duration) * 100)
    );
  }

  getCoverIconPath(id: string | undefined): string {
    const icons: Record<string, string> = {
      music: 'M9 18V5l12-2v13 M9 9l12-2',
      heart: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z',
      zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z'
    };

    return icons[id ?? 'music'] ?? icons['music'];
  }
}