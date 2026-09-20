import { Injectable, signal } from '@angular/core';

/**
 * Tipos de contenido que pueden mostrarse mediante el sistema
 * de modales de Musex.
 */
export type ModalType =
  | 'notifications'
  | 'profile'
  | 'confirm-exit'
  | 'track-menu'
  | 'track-details'
  | 'playlist'
  | 'add-to-playlist'
  | 'new-playlist'
  | 'settings'
  | 'download-settings'
  | 'search';

/**
 * Estado global del sistema de modales.
 */
export interface ModalState {

  /**
   * Indica si el modal está visualmente abierto.
   */
  open: boolean;

  /**
   * Tipo de contenido que debe representar el modal.
   *
   * Este valor permanece durante la animación de salida
   * para evitar que Angular destruya el contenido antes
   * de que termine la transición.
   */
  type: ModalType | null;

  /**
   * Título principal del modal.
   */
  title: string;

  /**
   * Texto secundario opcional.
   */
  subtitle: string;

  /**
   * Identificador de la canción relacionada con el modal.
   */
  trackId: string | null;

  /**
   * Identificador de la playlist relacionada con el modal.
   */
  playlistId: string | null;
}

/**
 * Gestiona el estado global de las ventanas modales de Musex.
 *
 * El servicio controla únicamente el estado y el contexto.
 * La representación visual y las animaciones pertenecen
 * a ModalComponent.
 */
@Injectable({
  providedIn: 'root'
})
export class ModalService {

  /**
   * Estado interno del sistema de modales.
   */
  private readonly modalState = signal<ModalState>({
    open: false,
    type: null,
    title: '',
    subtitle: '',
    trackId: null,
    playlistId: null
  });

  /**
   * Estado público de solo lectura.
   */
  readonly state = this.modalState.asReadonly();


  // =============================================================
  // OPEN
  // =============================================================

  /**
   * Abre un modal con la configuración indicada.
   */
  open(
    type: ModalType,
    options: {
      title?: string;
      subtitle?: string;
      trackId?: string | null;
      playlistId?: string | null;
    } = {}
  ): void {

    this.modalState.set({
      open: true,
      type,
      title: options.title ?? '',
      subtitle: options.subtitle ?? '',
      trackId: options.trackId ?? null,
      playlistId: options.playlistId ?? null
    });
  }


  // =============================================================
  // CLOSE
  // =============================================================

  /**
   * Inicia el cierre visual del modal.
   *
   * El contexto del modal NO se elimina todavía.
   * Esto permite que ModalComponent reproduzca la animación
   * de salida antes de desmontar el contenido.
   */
  close(): void {

    this.modalState.update(state => ({
      ...state,
      open: false
    }));
  }


  // =============================================================
  // FINISH CLOSE
  // =============================================================

  /**
   * Limpia completamente el estado después de que termina
   * la animación de salida.
   */
  finishClose(): void {

    this.modalState.set({
      open: false,
      type: null,
      title: '',
      subtitle: '',
      trackId: null,
      playlistId: null
    });
  }


  // =============================================================
  // STATE
  // =============================================================

  /**
   * Comprueba si actualmente existe un modal abierto.
   */
  isOpen(): boolean {
    return this.modalState().open;
  }

  /**
   * Comprueba el tipo de modal actualmente representado.
   *
   * IMPORTANTE:
   * Durante la animación de salida `open` ya puede ser false,
   * pero el tipo debe permanecer disponible hasta que
   * ModalComponent termine su animación.
   */
  is(type: ModalType): boolean {

    return this.modalState().type === type;
  }


  // =============================================================
  // MODAL OPENERS
  // =============================================================

  /**
   * Abre el modal de notificaciones.
   */
  openNotifications(): void {

    this.open('notifications', {
      title: 'Notificaciones'
    });
  }

  /**
   * Abre el modal del perfil del usuario.
   */
  openProfile(): void {

    this.open('profile', {
      title: 'Perfil'
    });
  }

  /**
   * Abre el diálogo de confirmación para cerrar Musex.
   */
  openExitConfirmation(): void {

    this.open('confirm-exit', {
      title: 'Cerrar Musex',
      subtitle: '¿Quieres cerrar la aplicación?'
    });
  }

  /**
   * Abre el menú contextual de una canción.
   */
  openTrackMenu(trackId: string): void {

    this.open('track-menu', {
      title: 'Opciones de canción',
      trackId
    });
  }

  /**
   * Abre los detalles de una canción.
   */
  openTrackDetails(trackId: string): void {

    this.open('track-details', {
      title: 'Detalles de la canción',
      trackId
    });
  }

  /**
   * Abre la información de una playlist.
   */
  openPlaylist(playlistId: string): void {

    this.open('playlist', {
      title: 'Playlist',
      playlistId
    });
  }

  /**
   * Abre el modal para añadir una canción a una playlist.
   */
  openAddToPlaylist(trackId: string): void {

    this.open('add-to-playlist', {
      title: 'Añadir a playlist',
      trackId
    });
  }

  /**
   * Abre el formulario para crear una nueva playlist.
   */
  openNewPlaylist(): void {

    this.open('new-playlist', {
      title: 'Nueva playlist',
      subtitle: 'Crea una nueva colección de canciones.'
    });
  }

  /**
   * Abre la configuración general de Musex.
   */
  openSettings(): void {

    this.open('settings', {
      title: 'Configuración'
    });
  }

  /**
   * Abre la configuración relacionada con las descargas.
   */
  openDownloadSettings(): void {

    this.open('download-settings', {
      title: 'Configuración de descargas'
    });
  }

  openSearch(): void {
    this.open('search', {
      title: 'Buscar en Musex'
    });
  }
}