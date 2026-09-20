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
 * El componente controla:
 *
 * - presentación
 * - animación de entrada
 * - animación de salida
 * - cierre mediante Escape
 * - cierre mediante backdrop
 *
 * La gestión del estado global se realiza mediante ModalService
 * desde MainLayout.
 */
@Component({
  selector: 'app-modal',
  standalone: true,
  templateUrl: './modal.component.html',
  styleUrl: './modal.component.css'
})
export class ModalComponent {

  // =============================================================
  // ESTADO INTERNO
  // =============================================================

  /**
   * Estado real recibido desde el componente padre.
   */
  private _open = false;

  /**
   * Mantiene el DOM montado durante la animación de salida.
   */
  rendered = false;

  /**
   * Indica que el modal está ejecutando su animación de salida.
   */
  closing = false;

  /**
   * Temporizador utilizado para desmontar el modal
   * después de finalizar la animación.
   */
  private closeTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Duración de las animaciones CSS.
   *
   * Debe coincidir con modal.component.css.
   */
  private static readonly ANIMATION_DURATION = 200;


  // =============================================================
  // OPEN
  // =============================================================

  @Input()
  set open(value: boolean) {

    this._open = value;

    // -----------------------------------------------------------
    // APERTURA
    // -----------------------------------------------------------

    if (value) {

      /**
       * Si existía un cierre pendiente, lo cancelamos.
       */
      if (this.closeTimeoutId !== null) {

        clearTimeout(this.closeTimeoutId);

        this.closeTimeoutId = null;
      }

      /**
       * El modal debe permanecer montado.
       */
      this.rendered = true;

      /**
       * Cancelamos cualquier estado de salida.
       */
      this.closing = false;

      return;
    }


    // -----------------------------------------------------------
    // CIERRE
    // -----------------------------------------------------------

    /**
     * Si ya no está montado no hay nada que animar.
     */
    if (!this.rendered) {
      return;
    }

    /**
     * Activamos la animación de salida.
     */
    this.closing = true;

    /**
     * Esperamos a que termine la animación CSS.
     */
    this.closeTimeoutId = setTimeout(() => {

      /**
       * Es posible que el modal haya vuelto a abrirse
       * mientras la animación estaba ejecutándose.
       */
      if (!this._open) {

        this.rendered = false;
        this.closing = false;

        this.animationFinished.emit();
      }

      this.closeTimeoutId = null;

    }, ModalComponent.ANIMATION_DURATION);
  }


  get open(): boolean {
    return this._open;
  }


  // =============================================================
  // INPUTS
  // =============================================================

  /**
   * Título principal del modal.
   */
  @Input() title = '';

  /**
   * Texto secundario opcional.
   */
  @Input() subtitle = '';

  /**
   * Permite cerrar haciendo clic sobre el backdrop.
   */
  @Input() closeOnBackdrop = true;

  /**
   * Permite utilizar únicamente el backdrop,
   * sin generar el panel genérico del componente.
   *
   * Se utiliza para:
   *
   * - editor de metadatos
   * - añadir a playlist
   */
  @Input() bare = false;


  // =============================================================
  // OUTPUTS
  // =============================================================

  /**
   * Solicita al componente padre que cierre el modal.
   */
  @Output() closed = new EventEmitter<void>();

  /**
   * Informa al padre que la animación de salida
   * terminó y el componente ya puede considerarse desmontado.
   */
  @Output() animationFinished = new EventEmitter<void>();


  // =============================================================
  // CONSTRUCTOR
  // =============================================================

  constructor(
    private readonly elementRef: ElementRef<HTMLElement>
  ) {}


  // =============================================================
  // ESCAPE
  // =============================================================

  @HostListener('document:keydown.escape')
  handleEscape(): void {

    if (
      !this.open ||
      this.closing
    ) {
      return;
    }

    this.close();
  }


  // =============================================================
  // BACKDROP
  // =============================================================

  handleBackdropClick(event: MouseEvent): void {

    if (
      !this.closeOnBackdrop ||
      this.closing
    ) {
      return;
    }

    if (
      event.target ===
      this.elementRef.nativeElement.querySelector(
        '.modal-backdrop'
      )
    ) {
      this.close();
    }
  }


  // =============================================================
  // CLOSE
  // =============================================================

  close(): void {

    if (this.closing) {
      return;
    }

    this.closed.emit();
  }
}