import {
  Component,
  DestroyRef,
  effect,
  inject,
  OnInit,
  computed,
  signal
} from '@angular/core';

import { QueueComponent } from '../queue/queue.component';
import { QueuePanelService } from '../../core/services/queue-panel.service';
import { LibraryService } from '../../core/services/library.service';
import { NotificationService } from '../../core/services/notification.service';
import { PlayerService } from '../../core/services/player.service';
import { QueueService } from '../../core/services/queue.service';
import { IS_ANDROID } from '@tauri-apps/api/core';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

/**
 * Contenedor responsive para la cola de reproducción.
 *
 * QueuePanelComponent controla únicamente la presentación
 * del panel y las interacciones relacionadas con su cierre.
 *
 * El estado de visibilidad pertenece a QueuePanelService,
 * permitiendo que otros componentes puedan controlar la cola
 * sin acoplarse directamente a este componente.
 */
@Component({
  selector: 'app-queue-panel',
  standalone: true,
  imports: [
    QueueComponent
  ],
  templateUrl: './queue-panel.component.html',
  styleUrl: './queue-panel.component.css'
})
export class QueuePanelComponent implements OnInit {

  readonly isAndroid = IS_ANDROID;

  readonly queuePanelService = inject(QueuePanelService);

  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private readonly player = inject(PlayerService);
  private readonly queueService = inject(QueueService);
  private readonly library = inject(LibraryService);
  private readonly notifications = inject(NotificationService);

  /**
   * Indica si el usuario está manipulando la posición.
   */
  readonly seeking = signal(false);

  /**
   * Posición seleccionada durante la búsqueda.
   */
  readonly seekPosition = signal(0);

  /**
   * Comienza la búsqueda temporal.
   */
  startSeek(): void {
      this.seeking.set(true);

      this.seekPosition.set(
          this.playerState().currentTime
      );
  }

  /**
   * Actualiza la posición visual sin modificar
   * todavía la reproducción real.
   */
  updateSeekPosition(position: number): void {
      const track = this.currentTrack();

      if (!track) {
          return;
      }

      this.seekPosition.set(
          Math.max(
              0,
              Math.min(position, track.duration)
          )
      );
  }

  /**
   * Aplica la posición seleccionada al reproductor.
   */
  async finishSeek(): Promise<void> {
      if (!this.seeking()) {
          return;
      }

      const position = this.seekPosition();

      try {
          await this.player.seek(position);
      } finally {
          this.seeking.set(false);
      }
  }
  
  // ===========================================================
  // DATOS PARA EL ENCABEZADO Y LA TARJETA "REPRODUCIENDO"
  // ===========================================================

  readonly playerState = this.player.state;

  readonly currentTrack = computed(() => {

    const id = this.playerState().currentTrackId;

    return id ? this.library.getTrack(id) : undefined;
  });

  readonly queueCount = computed(() => this.queueService.items().length);

  /** Duración total de las canciones en cola (segundos). */
  readonly queueSeconds = computed(() =>
    this.queueService.items().reduce(
      (sum, id) => sum + (this.library.getTrack(id)?.duration ?? 0),
      0
    )
  );

  readonly progress = computed(() => {

    const duration = this.currentTrack()?.duration ?? 0;

    return duration > 0
      ? Math.min(100, (this.playerState().currentTime / duration) * 100)
      : 0;
  });

  togglePlay(): void {
    void this.player.togglePlay();
  }

  next(): void {
    this.player.nextTrack();
  }

  previous(): void {
    this.player.previousTrack();
  }

  /** Salta a la posición donde se hizo clic en la barra de progreso. */
  seekFromBar(event: MouseEvent): void {

    const track = this.currentTrack();

    if (!track || track.duration <= 0) {
      return;
    }

    const bar = event.currentTarget as HTMLElement;

    const rect = bar.getBoundingClientRect();

    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));

    void this.player.seek(ratio * track.duration);
  }

  clearQueue(): void {

    if (this.queueService.items().length === 0) {
      return;
    }

    this.queueService.clear();

    this.player.syncQueue();

    this.notifications.info(
      'Cola vaciada',
      'Se eliminaron todas las canciones de la cola.'
    );
  }

  formatTime(seconds: number): string {

    if (!Number.isFinite(seconds) || seconds < 0) {
      return '0:00';
    }

    const total = Math.floor(seconds);

    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  /** "2 h 15 min" / "48 min" */
  formatTotal(seconds: number): string {

    const minutes = Math.round(seconds / 60);

    if (minutes < 60) {
      return `${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);

    return minutes % 60 === 0
      ? `${hours} h`
      : `${hours} h ${minutes % 60} min`;
  }

  // El resto de tus propiedades y métodos permanece igual.

  ngOnInit(): void {
    this.router.events
      .pipe(
        filter(event => event instanceof NavigationStart),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        if (this.isAndroid && this.queuePanelService.open()) {
          this.close();
        }
      });
  }

  /**
   * Mantiene el panel montado durante la animación de salida.
   */
  readonly queuePanelMounted = signal(false);

  /**
   * Indica que el panel está ejecutando su animación de salida.
   */
  readonly queuePanelExiting = signal(false);

  private queuePanelExitTimeout: ReturnType<typeof setTimeout> | null = null;

  // ===========================================================
  // GESTO MÓVIL — deslizar hacia abajo desde el encabezado
  // ===========================================================

  private swipeStartY = 0;

  onSwipeStart(event: TouchEvent): void {
    this.swipeStartY = event.touches[0].clientY;
  }

  onSwipeEnd(event: TouchEvent): void {
    const deltaY =
      event.changedTouches[0].clientY - this.swipeStartY;

    if (deltaY > 70) {
      this.close();
    }
  }

  constructor() {

    effect(() => {

      const open = this.queuePanelService.open();

      if (open) {

        if (this.queuePanelExitTimeout) {
          clearTimeout(this.queuePanelExitTimeout);
          this.queuePanelExitTimeout = null;
        }

        this.queuePanelMounted.set(true);
        this.queuePanelExiting.set(false);

        return;
      }


      if (!this.queuePanelMounted()) {
        return;
      }


      this.queuePanelExiting.set(true);


      this.queuePanelExitTimeout = setTimeout(() => {

        this.queuePanelMounted.set(false);
        this.queuePanelExiting.set(false);
        this.queuePanelExitTimeout = null;

      }, 220);

    });


    this.destroyRef.onDestroy(() => {

      if (this.queuePanelExitTimeout) {
        clearTimeout(this.queuePanelExitTimeout);
      }

    });

  }


  close(): void {
    this.queuePanelService.close();
  }


  handleBackdropClick(event: MouseEvent): void {

    if (event.target === event.currentTarget) {
      this.close();
    }

  }

}