import { Injectable, signal } from '@angular/core';

/**
 * Gestiona el estado de visibilidad del panel de cola.
 *
 * El servicio permite que cualquier componente de Musex pueda
 * abrir, cerrar o alternar la cola sin depender directamente
 * de QueuePanelComponent.
 */
@Injectable({
  providedIn: 'root'
})
export class QueuePanelService {
  /**
   * Indica si el panel de cola está visible.
   */
  private readonly panelOpen = signal(false);

  /**
   * Estado de solo lectura disponible para los componentes.
   */
  readonly open = this.panelOpen.asReadonly();

  /**
   * Abre el panel de cola.
   */
  show(): void {
    this.panelOpen.set(true);
  }

  /**
   * Cierra el panel de cola.
   */
  close(): void {
    this.panelOpen.set(false);
  }

  /**
   * Alterna entre el estado abierto y cerrado.
   */
  toggle(): void {
    this.panelOpen.update(open => !open);
  }
}