import { Injectable, signal } from '@angular/core';

/**
 * Tipos de contenido que pueden mostrarse mediante el sistema
 * de modales de Musex.
 *
 * Estos valores representan las ventanas contempladas
 * originalmente en el prototipo.
 */
export type ModalType =
  | 'notifications'
  | 'profile'
  | 'confirm-exit'
  | 'track-menu'
  | 'track-details'
  | 'playlist'
  | 'new-playlist'
  | 'settings'
  | 'download-settings';

/**
 * Estado global del sistema de modales.
 */
export interface ModalState {
  /**
   * Indica si existe un modal abierto.
   */
  open: boolean;

  /**
   * Tipo de contenido que debe representar el modal.
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
   *
   * Se utiliza para menús, detalles u otras acciones
   * relacionadas con una pista concreta.
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
 * El servicio no contiene la interfaz del modal. Su responsabilidad
 * es únicamente indicar qué ventana debe mostrarse y con qué contexto.
 *
 * La representación visual continúa perteneciendo a ModalComponent.
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

  /**
   * Cierra el modal actualmente abierto.
   */
  close(): void {
    this.modalState.update(state => ({
      ...state,
      open: false
    }));
  }

  /**
   * Comprueba si actualmente existe un modal abierto.
   */
  isOpen(): boolean {
    return this.modalState().open;
  }

  /**
   * Comprueba si el modal actualmente abierto
   * corresponde a un tipo determinado.
   */
  is(type: ModalType): boolean {
    return (
      this.modalState().open &&
      this.modalState().type === type
    );
  }

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
}