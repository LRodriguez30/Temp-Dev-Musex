import { Injectable, signal } from '@angular/core';

/**
 * Tipos de notificación disponibles dentro de Musex.
 */
export type NotificationType =
  | 'success'
  | 'info'
  | 'warning'
  | 'error';

/**
 * Representa una notificación temporal mostrada al usuario.
 */
export interface Notification {
  /**
   * Identificador único de la notificación.
   */
  id: string;

  /**
   * Tipo visual y semántico de la notificación.
   */
  type: NotificationType;

  /**
   * Título principal del mensaje.
   */
  title: string;

  /**
   * Descripción opcional.
   */
  message?: string;

  /**
   * Tiempo que permanecerá visible en milisegundos.
   */
  duration: number;
}

/**
 * Gestiona las notificaciones temporales de Musex.
 *
 * El servicio mantiene únicamente el estado de los mensajes.
 * ToastContainerComponent será responsable de representarlos
 * visualmente.
 */
@Injectable({
  providedIn: 'root'
})
export class NotificationService {

  /**
   * Lista interna de notificaciones activas.
   */
  private readonly notifications = signal<Notification[]>([]);

  /**
   * Exposición de solo lectura de las notificaciones.
   */
  readonly items = this.notifications.asReadonly();

  /**
   * Muestra una nueva notificación.
   *
   * @param type Tipo de notificación.
   * @param title Título principal.
   * @param message Descripción opcional.
   * @param duration Tiempo visible en milisegundos.
   */
  show(
    type: NotificationType,
    title: string,
    message = '',
    duration = 3500
  ): void {
    const notification: Notification = {
      id: this.generateId(),
      type,
      title,
      message,
      duration
    };

    this.notifications.update(items => [
      ...items,
      notification
    ]);

    if (duration > 0) {
      window.setTimeout(() => {
        this.remove(notification.id);
      }, duration);
    }
  }

  /**
   * Muestra una notificación de éxito.
   */
  success(
    title: string,
    message = '',
    duration = 3500
  ): void {
    this.show(
      'success',
      title,
      message,
      duration
    );
  }

  /**
   * Muestra una notificación informativa.
   */
  info(
    title: string,
    message = '',
    duration = 3500
  ): void {
    this.show(
      'info',
      title,
      message,
      duration
    );
  }

  /**
   * Muestra una advertencia.
   */
  warning(
    title: string,
    message = '',
    duration = 3500
  ): void {
    this.show(
      'warning',
      title,
      message,
      duration
    );
  }

  /**
   * Muestra una notificación de error.
   */
  error(
    title: string,
    message = '',
    duration = 4500
  ): void {
    this.show(
      'error',
      title,
      message,
      duration
    );
  }

  /**
   * Elimina una notificación específica.
   */
  remove(notificationId: string): void {
    this.notifications.update(items =>
      items.filter(
        notification => notification.id !== notificationId
      )
    );
  }

  /**
   * Elimina todas las notificaciones activas.
   */
  clear(): void {
    this.notifications.set([]);
  }

  /**
   * Genera un identificador único para una notificación.
   */
  private generateId(): string {
    return `notification-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }
}