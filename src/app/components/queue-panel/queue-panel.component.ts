import {
  Component,
  DestroyRef,
  effect,
  inject,
  signal
} from '@angular/core';

import { QueueComponent } from '../queue/queue.component';
import { QueuePanelService } from '../../core/services/queue-panel.service';

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
export class QueuePanelComponent {

  readonly queuePanelService = inject(QueuePanelService);

  private readonly destroyRef = inject(DestroyRef);

  /**
   * Mantiene el panel montado durante la animación de salida.
   */
  readonly queuePanelMounted = signal(false);

  /**
   * Indica que el panel está ejecutando su animación de salida.
   */
  readonly queuePanelExiting = signal(false);

  private queuePanelExitTimeout: ReturnType<typeof setTimeout> | null = null;

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