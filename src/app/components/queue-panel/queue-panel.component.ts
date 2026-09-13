import {
  Component,
  inject
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

  close(): void {
    this.queuePanelService.close();
  }

  handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }
}