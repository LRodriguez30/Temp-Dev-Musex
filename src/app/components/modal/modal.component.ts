import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output
} from '@angular/core';

/**
 * Modal reutilizable para diálogos y ventanas secundarias
 * dentro de Musex.
 *
 * El componente controla únicamente su presentación y cierre.
 * La gestión del estado global se conectará posteriormente
 * mediante ModalService.
 */
@Component({
  selector: 'app-modal',
  standalone: true,
  templateUrl: './modal.component.html',
  styleUrl: './modal.component.css'
})
export class ModalComponent {

  /**
   * Controla si el modal permanece visible.
   */
  @Input() open = false;

  /**
   * Título principal del modal.
   */
  @Input() title = '';

  /**
   * Texto secundario opcional.
   */
  @Input() subtitle = '';

  /**
   * Permite cerrar el modal haciendo clic sobre el fondo.
   */
  @Input() closeOnBackdrop = true;

  /**
   * Notifica al componente padre que el modal debe cerrarse.
   */
  @Output() closed = new EventEmitter<void>();

  constructor(private readonly elementRef: ElementRef<HTMLElement>) {}

  /**
   * Cierra el modal cuando el usuario pulsa Escape.
   */
  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (!this.open) {
      return;
    }

    this.close();
  }

  /**
   * Cierra el modal cuando el usuario pulsa sobre el fondo.
   */
  handleBackdropClick(event: MouseEvent): void {
    if (!this.closeOnBackdrop) {
      return;
    }

    if (event.target === this.elementRef.nativeElement.querySelector('.modal-backdrop')) {
      this.close();
    }
  }

  /**
   * Solicita el cierre del modal.
   */
  close(): void {
    this.closed.emit();
  }
}