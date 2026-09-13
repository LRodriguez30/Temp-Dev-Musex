import {
  Component,
  inject,
  signal
} from '@angular/core';

import { PlayerService } from '../../core/services/player.service';
import { LibraryService } from '../../core/services/library.service';
import { QueuePanelService } from '../../core/services/queue-panel.service';
import { NotificationService } from '../../core/services/notification.service';
import { FullPlayerComponent } from '../full-player/full-player.component';


/**
 * Reproductor inferior persistente de Musex.
 *
 * Este componente representa visualmente el estado actual
 * del reproductor y delega las operaciones de reproducción
 * en los servicios correspondientes.
 *
 * La barra inferior comparte el mismo estado que el panel
 * lateral para mantener ambos controles sincronizados.
 */
@Component({
  selector: 'app-bottom-player',
  standalone: true,
  imports: [FullPlayerComponent],
  templateUrl: './bottom-player.component.html',
  styleUrl: './bottom-player.component.css'
})
export class BottomPlayerComponent {

  /**
   * Indica si el usuario está manipulando manualmente
   * la posición de reproducción.
   *
   * Mientras está activo, el valor del slider utiliza
   * seekPosition() para evitar que el seguimiento automático
   * de Rust sobrescriba la posición seleccionada.
   */
  readonly seeking = signal(false);

  /**
   * Posición temporal seleccionada por el usuario mientras
   * arrastra la barra de progreso.
   *
   * Esta posición no se envía a Rust hasta finalizar
   * la interacción.
   */
  readonly seekPosition = signal(0);

  /**
   * Servicio principal del reproductor.
   */
  readonly playerService = inject(PlayerService);

  /**
   * Servicio encargado de gestionar favoritos.
   */
  private readonly libraryService = inject(LibraryService);

  /**
   * Servicio encargado de gestionar el panel de cola.
   */
  readonly queuePanelService = inject(QueuePanelService);

  /**
   * Estado reactivo compartido del reproductor.
   */
  readonly playerState = this.playerService.state;

  /**
   * Servicio encargado de mostrar notificaciones.
   */
  private readonly notificationService =
    inject(NotificationService);

  /**
 * Barras utilizadas por el visualizador decorativo
 * del reproductor inferior.
 *
 * Los valores son deliberadamente diferentes para
 * crear un movimiento más natural.
 */
  readonly visualizerBars = [
    { height: '28%', delay: '-0.4s', duration: '1.1s' },
    { height: '52%', delay: '-0.8s', duration: '0.9s' },
    { height: '36%', delay: '-0.2s', duration: '1.3s' },
    { height: '68%', delay: '-0.6s', duration: '1.0s' },
    { height: '44%', delay: '-1.1s', duration: '1.4s' },
    { height: '78%', delay: '-0.3s', duration: '0.8s' },
    { height: '55%', delay: '-0.9s', duration: '1.2s' },
    { height: '34%', delay: '-0.5s', duration: '1.0s' },
    { height: '64%', delay: '-1.3s', duration: '1.5s' },
    { height: '42%', delay: '-0.7s', duration: '0.9s' },
    { height: '72%', delay: '-1.0s', duration: '1.2s' },
    { height: '30%', delay: '-0.1s', duration: '1.1s' },
    { height: '58%', delay: '-0.6s', duration: '1.4s' },
    { height: '40%', delay: '-1.2s', duration: '0.8s' },
    { height: '70%', delay: '-0.4s', duration: '1.3s' }
  ];

  /**
   * Indica si el reproductor expandido está visible.
   */
  readonly fullPlayerOpen = signal(false);

  /**
   * Canción actualmente seleccionada.
   */
  get currentTrack() {
    return this.playerService.getCurrentTrack();
  }

  /**
   * Indica si la canción actual está marcada como favorita.
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

    const isFavorite =
      this.libraryService.isFavorite(track.id);

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
    void this.playerService.togglePlay();
  }

  /**
   * Reproduce la canción siguiente.
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
   * Inicia la manipulación manual de la barra de progreso.
   *
   * Se guarda la posición actual como punto de partida
   * para evitar que el seguimiento automático del reproductor
   * interfiera durante el arrastre.
   */
  startSeek(): void {
    this.seeking.set(true);

    this.seekPosition.set(
      this.playerState().currentTime
    );
  }

  /**
   * Actualiza únicamente la posición visual del slider
   * mientras el usuario lo está arrastrando.
   *
   * La reproducción real no cambia todavía.
   */
  updateSeekPosition(time: number): void {
    const track = this.currentTrack;

    if (!track) {
      return;
    }

    const normalizedTime = Math.max(
      0,
      Math.min(time, track.duration)
    );

    this.seekPosition.set(normalizedTime);
  }

  /**
   * Finaliza la manipulación de la barra de progreso
   * y aplica la nueva posición al reproductor real.
   */
  async finishSeek(): Promise<void> {
    if (!this.seeking()) {
      return;
    }

    const position = this.seekPosition();

    try {
      await this.seek(position);
    } finally {
      this.seeking.set(false);
    }
  }

  /**
   * Actualiza la posición real de reproducción.
   */
  async seek(time: number): Promise<void> {
    await this.playerService.seek(time);
  }

  /**
   * Actualiza el volumen del reproductor.
   */
  async setVolume(volume: number): Promise<void> {
    await this.playerService.setVolume(volume);
  }

  /**
   * Activa o desactiva el silencio.
   */
  toggleMute(): void {
    this.playerService.toggleMute();
  }

  /**
   * Activa o desactiva la reproducción aleatoria.
   */
  toggleShuffle(): void {
    this.playerService.toggleShuffle();
  }

  /**
   * Cambia el modo de repetición.
   *
   * Los estados posibles son:
   *
   * off   -> no repetir.
   * track -> repetir la canción actual.
   * queue -> repetir la cola completa.
   *
   * La lógica del cambio de estado pertenece a PlayerService.
   */
  toggleRepeat(): void {
    this.playerService.toggleRepeat();
  }

  /**
   * Muestra u oculta el panel lateral del reproductor.
   */
  toggleRightPanel(): void {
    this.playerService.toggleRightPanel();
  }

  /**
   * Muestra u oculta el panel de cola de reproducción.
   */
  toggleQueue(): void {
    this.queuePanelService.toggle();
  }

  getCoverIconPath(id: string | undefined): string {
    const icons: Record<string, string> = {
      music: 'M9 18V5l12-2v13 M9 9l12-2',
      heart: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z',
      zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z'
    };

    return icons[id ?? 'music'] ?? icons['music'];
  }
  
  /**
   * Formatea una duración expresada en segundos
   * para mostrarla de forma legible en el reproductor.
   *
   * Ejemplos:
   *
   * 0    -> 0:00
   * 65   -> 1:05
   * 245  -> 4:05
   * 3661 -> 1:01:01
   */
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

  /**
   * Muestra u oculta el reproductor expandido.
   */
  toggleFullPlayer(): void {
    this.fullPlayerOpen.update(open => !open);
  }

  /**
   * Cierra el reproductor expandido.
   */
  closeFullPlayer(): void {
    this.fullPlayerOpen.set(false);
  }
}