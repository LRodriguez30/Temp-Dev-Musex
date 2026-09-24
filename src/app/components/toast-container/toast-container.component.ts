import {
  Component,
  inject
} from '@angular/core';

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
 * servicio; este componente se encarga únicamente de presentarlas
 * y gestionar la transición visual de salida.
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
  private readonly notificationService =
    inject(NotificationService);

  /**
   * Lista reactiva de notificaciones actualmente visibles.
   */
  readonly notifications =
    this.notificationService.items;

  /**
   * IDs de notificaciones que están ejecutando
   * la animación de salida.
   */
  private readonly leavingIds =
    new Set<string>();


  /**
   * Comprueba si una notificación está saliendo.
   */
  isLeaving(notificationId: string): boolean {
    return this.leavingIds.has(notificationId);
  }


  /**
   * Inicia la animación de salida y elimina la
   * notificación después de que termine.
   */
  dismiss(notificationId: string): void {

    // Evita iniciar la animación más de una vez.
    if (this.leavingIds.has(notificationId)) {
      return;
    }

    // Marcamos la notificación como saliendo.
    this.leavingIds.add(notificationId);


    /*
     * Debe coincidir con la duración de
     * toast-leave en el CSS.
     */
    setTimeout(() => {

      this.notificationService.remove(
        notificationId
      );

      this.leavingIds.delete(
        notificationId
      );

    }, 220);
  }

}