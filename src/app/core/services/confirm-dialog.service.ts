
import { Injectable, signal } from '@angular/core';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  warning?: string;
  itemList?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class ConfirmDialogService {

  readonly current = signal<ConfirmDialogOptions | null>(null);

  private resolveRequest: ((confirmed: boolean) => void) | null = null;

  request(options: ConfirmDialogOptions): Promise<boolean> {
    // Evita dejar una solicitud anterior pendiente.
    this.finish(false);

    this.current.set(options);

    return new Promise<boolean>(resolve => {
      this.resolveRequest = resolve;
    });
  }

  confirm(): void {
    this.finish(true);
  }

  cancel(): void {
    this.finish(false);
  }

  private finish(confirmed: boolean): void {
    const resolve = this.resolveRequest;

    this.resolveRequest = null;
    this.current.set(null);

    resolve?.(confirmed);
  }
}
