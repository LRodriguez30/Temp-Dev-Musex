import {
  Component,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal
} from '@angular/core';

import { QueueComponent } from '../queue/queue.component';
import { QueuePanelService } from '../../core/services/queue-panel.service';
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