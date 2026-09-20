import { Injectable, signal } from '@angular/core';

/**
 * Estado compartido del panel "Más" en móvil.
 *
 * Vive en un servicio propio porque el botón que lo abre
 * ahora está en TopBarComponent, pero el panel en sí sigue
 * siendo responsabilidad visual de SidebarComponent.
 */
@Injectable({
  providedIn: 'root'
})
export class MobileMenuService {

  private readonly open = signal(false);

  readonly isOpen = this.open.asReadonly();

  toggle(): void {
    this.open.update(value => !value);
  }

  close(): void {
    this.open.set(false);
  }

  /**
   * Cierra el panel si la pantalla deja de ser móvil.
   *
   * Se llama desde un HostListener de resize: si el usuario
   * está probando la responsividad y agranda la ventana más
   * allá del breakpoint móvil, el panel no debe quedar
   * "atascado" abierto en memoria (aunque esté oculto por
   * CSS, seguiría bloqueando el toggle al volver a achicar).
   */
  closeIfNotMobile(): void {
    if (window.innerWidth > 620 && this.open()) {
      this.open.set(false);
    }
  }
}