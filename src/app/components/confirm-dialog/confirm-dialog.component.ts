
import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output
} from '@angular/core';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.css'
})
export class ConfirmDialogComponent {

  @Input() title = '¿Continuar?';
  @Input() message = '';
  @Input() confirmLabel = 'Continuar';
  @Input() danger = false;
  @Input() warning = '';

  @Input() set itemList(value: string[]) {
    this.items = value.slice(0, 5);
    this.extraCount = Math.max(0, value.length - 5);
  }

  items: string[] = [];
  extraCount = 0;

  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  rendered = true;
  closing = false;

  private closeTimeoutId: ReturnType<typeof setTimeout> | null = null;

  private static readonly ANIMATION_DURATION = 200;

  constructor(
    private readonly elementRef: ElementRef<HTMLElement>
  ) {}

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (this.closing || !this.rendered) {
      return;
    }

    this.cancel();
  }

  handleBackdropClick(event: MouseEvent): void {
    if (
      this.closing ||
      event.target !== this.elementRef.nativeElement.querySelector(
        '.confirm-dialog-backdrop'
      )
    ) {
      return;
    }

    this.cancel();
  }

  cancel(): void {
    if (this.closing) {
      return;
    }

    this.cancelled.emit();
  }

  confirm(): void {
    if (this.closing) {
      return;
    }

    this.confirmed.emit();
  }

  ngOnDestroy(): void {
    if (this.closeTimeoutId !== null) {
      clearTimeout(this.closeTimeoutId);
    }
  }
}
