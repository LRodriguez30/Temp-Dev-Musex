import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';

import { LibraryService } from '../../core/services/library.service';
import {
  LocalStorageService,
  PhoneFolder
} from '../../core/services/local-storage.service';
import { NotificationService } from '../../core/services/notification.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';

type PendingAction =
  | { kind: 'transfer'; folder: PhoneFolder; mode: 'copy' | 'move' }
  | { kind: 'delete'; paths: string[]; names: string[] };

/**
 * Gestión de la música guardada en el teléfono (carpeta Musex).
 *
 * - Pide el acceso a los archivos.
 * - Busca carpetas del teléfono con música y las copia o mueve a Musex.
 * - Permite borrar música de Musex.
 *
 * Todo lo que mueve o borra archivos pasa por una ventana de
 * confirmación.
 */
@Component({
  selector: 'app-local-storage-manager',
  standalone: true,
  imports: [],
  templateUrl: `./local-storage-manager.component.html`,
  styleUrl: `./local-storage-manager.component.css`
})
export class LocalStorageManagerComponent implements OnInit, OnDestroy {

  readonly storage = inject(LocalStorageService);

  private readonly libraryService = inject(LibraryService);

  private readonly notificationService = inject(NotificationService);

  private readonly confirmDialog = inject(ConfirmDialogService);

  readonly selected = signal<Set<string>>(new Set());

  readonly localTracks = computed(() =>
    this.libraryService
      .tracks()
      .filter(track => track.origin === 'local')
  );

  readonly allSelected = computed(() =>
    this.localTracks().length > 0 &&
    this.selected().size === this.localTracks().length
  );

  readonly visibleTrackLimit = signal(40);

  readonly visibleTracks = computed(() =>
    this.localTracks().slice(0, this.visibleTrackLimit())
  );

  readonly hasMoreTracks = computed(() =>
    this.visibleTrackLimit() < this.localTracks().length
  );

  loadMoreTracks(): void {
    this.visibleTrackLimit.update(limit => limit + 40);
  }

  private readonly onVisible = (): void => {
    if (document.hidden) {
      return;
    }

    void this.refreshStorageAccess();
  };

  private async refreshStorageAccess(): Promise<void> {
    await this.storage.refresh();

    if (this.storage.hasAccess()) {
      await this.storage.goToPhoneRoot();
    }
  }

  async ngOnInit(): Promise<void> {
    await this.storage.refresh();
    await this.libraryService.scanLocal();

    if (this.storage.hasAccess()) {
      await this.storage.goToPhoneRoot();
    }

    document.addEventListener(
      'visibilitychange',
      this.onVisible
    );
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  async reload(): Promise<void> {

    await this.storage.refresh();
    await this.libraryService.scanLocal();
  }

  // ===========================================================
  // SELECCIÓN
  // ===========================================================

  toggle(trackId: string): void {

    this.selected.update(current => {

      const next = new Set(current);

      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }

      return next;
    });
  }

  toggleAll(): void {

    this.selected.set(
      this.allSelected()
        ? new Set()
        : new Set(this.localTracks().map(track => track.id))
    );
  }

  // ===========================================================
  // CONFIRMAR Y EJECUTAR
  // ===========================================================

  async ask(action: PendingAction): Promise<void> {
    let confirmed: boolean;

    if (action.kind === 'transfer') {
      const isMoving = action.mode === 'move';

      confirmed = await this.confirmDialog.request({
        title: isMoving
          ? 'Mover música a Musex'
          : 'Copiar música a Musex',
        message: isMoving
          ? `Se moverán ${action.folder.audioCount} canciones de «${action.folder.name}» a la carpeta Musex.`
          : `Se copiarán ${action.folder.audioCount} canciones de «${action.folder.name}» a la carpeta Musex. Las originales no se tocan.`,
        warning: isMoving
          ? `Las canciones dejarán de estar en «${action.folder.name}», por lo que otras apps ya no las verán allí.`
          : '',
        danger: isMoving,
        confirmLabel: isMoving ? 'Mover' : 'Copiar'
      });
    } else {
      confirmed = await this.confirmDialog.request({
        title: 'Eliminar música',
        message: `Se ${
          action.paths.length === 1 ? 'eliminará' : 'eliminarán'
        } ${action.paths.length} ${
          action.paths.length === 1 ? 'archivo' : 'archivos'
        } de la carpeta Musex.`,
        warning: 'Esta acción no se puede deshacer: los archivos se borran del teléfono.',
        itemList: action.names,
        danger: true,
        confirmLabel: 'Eliminar'
      });
    }

    if (confirmed) {
      await this.run(action);
    }
  }

  async askDelete(): Promise<void> {
    const tracks = this.localTracks().filter(track =>
      this.selected().has(track.id)
    );

    if (tracks.length === 0) {
      return;
    }

    await this.ask({
      kind: 'delete',
      paths: tracks.map(track => track.path),
      names: tracks.map(track => track.title)
    });
  }

  async run(action: PendingAction): Promise<void> {
    try {
      if (action.kind === 'transfer') {
        const result = await this.storage.transfer(
          action.folder,
          action.mode
        );

        this.notificationService.success(
          this.summary(
            result.transferred,
            result.skipped,
            result.failed
          )
        );

        return;
      }

      const deleted = await this.storage.deleteFiles(action.paths);

      this.selected.set(new Set());

      this.notificationService.success(
        deleted === 1
          ? 'Se eliminó 1 archivo.'
          : `Se eliminaron ${deleted} archivos.`
      );
    } catch {
      this.notificationService.error(
        'No se pudo completar la operación.'
      );
    }
  }

  private summary(
    transferred: number,
    skipped: number,
    failed: number
  ): string {

    const parts = [`${transferred} en Musex`];

    if (skipped > 0) {
      parts.push(`${skipped} ya estaban`);
    }

    if (failed > 0) {
      parts.push(`${failed} con error`);
    }

    return parts.join(' · ');
  }
}