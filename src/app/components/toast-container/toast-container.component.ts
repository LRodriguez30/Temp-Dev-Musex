import { Component, inject } from '@angular/core';

import {
  NotificationService
} from '../../core/services/notification.service';

/**
 * Contenedor global de notificaciones de Musex.
 *
 * Escucha las notificaciones emitidas por NotificationService
 * y las expone al template para su representación visual.
 *
 * La lógica de creación, duración y eliminación pertenece al
 * servicio; este componente se encarga únicamente de presentarlas.
 */
@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [],
  templateUrl: './toast-container.component.html',
  styleUrl: './toast-container.component.css'
})
export class ToastContainerComponent {

  /**
   * Servicio encargado de gestionar las notificaciones.
   */
  private readonly notificationService = inject(NotificationService);

  /**
   * Lista reactiva de notificaciones actualmente visibles.
   */
  readonly notifications = this.notificationService.items;

  /**
   * Elimina una notificación concreta.
   *
   * El botón de cierre del toast utiliza este método para
   * permitir al usuario descartarlo manualmente.
   */
  dismiss(notificationId: string): void {
    this.notificationService.remove(notificationId);
  }
}