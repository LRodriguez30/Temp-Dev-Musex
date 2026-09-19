import {
  Component,
  EventEmitter,
  inject,
  Input,
  Output
} from '@angular/core';

import { convertFileSrc } from '@tauri-apps/api/core';

import { Track } from '../../core/models/track.model';
import { PlayerService } from '../../core/services/player.service';
import { LibraryService } from '../../core/services/library.service';
import { PlaylistService } from '../../core/services/playlist.service';
import { NotificationService } from '../../core/services/notification.service';

/**
 * Tabla reutilizable para mostrar colecciones de canciones.
 *
 * El componente presenta las canciones y comunica las acciones
 * realizadas por el usuario.
 *
 * La reproducción y la gestión de los datos permanecen fuera
 * del componente para mantenerlo reutilizable.
 */
@Component({
  selector: 'app-music-table',
  standalone: true,
  templateUrl: './music-table.component.html',
  styleUrl: './music-table.component.css'
})
export class MusicTableComponent {

  /**
   * Canciones que serán mostradas en la tabla.
   */
  @Input()
  tracks: Track[] = [];

  /**
   * Evento emitido cuando el usuario solicita reproducir
   * una canción.
   */
  @Output()
  play = new EventEmitter<Track>();

  /**
   * Evento emitido cuando el usuario abre las opciones
   * de una canción.
   */
  @Output()
  more = new EventEmitter<Track>();

  /**
   * Canción actualmente seleccionada para mostrar sus datos.
   */
  selectedTrack: Track | null = null;

  /**
   * Canción temporal utilizada para editar los datos.
   *
   * Se mantiene separada de la canción original para evitar
   * modificar la biblioteca antes de confirmar los cambios.
   */
  editingTrack: Track | null = null;

  /**
   * Archivo de portada seleccionado actualmente.
   *
   * Este archivo todavía no se guarda físicamente hasta que
   * el usuario confirma los cambios.
   */
  private pendingCoverFile: File | null = null;

  /**
   * URL temporal utilizada únicamente para mostrar la
   * previsualización de una portada recién seleccionada.
   */
  private pendingCoverPreviewUrl: string | null = null;

  /**
   * Servicio principal del reproductor.
   */
  readonly playerService = inject(PlayerService);

  /**
   * Servicio encargado de gestionar favoritos y biblioteca.
   */
  private readonly libraryService = inject(LibraryService);

  private readonly playlistService = inject(PlaylistService);
  private readonly notificationService = inject(NotificationService);

  readonly playlists = this.playlistService.allPlaylists;

  /**
   * Canción para la cual se está eligiendo una playlist.
   */
  trackForPlaylist: Track | null = null;

  readonly coverIcons: { id: string; path: string }[] = [
    {
      id: 'music',
      path: 'M9 18V5l12-2v13 M9 9l12-2'
    },
    {
      id: 'heart',
      path: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z'
    },
    {
      id: 'zap',
      path: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z'
    }
  ];

  readonly coverColors: string[] = [
    'var(--musex-accent)',
    '#a45cff',
    '#ff9d00',
    '#7276ff',
    '#ff3ab7',
    '#44e000'
  ];

  showCoverPicker = false;

  getCoverIconPath(id: string | undefined): string {
    return this.coverIcons.find(
      icon => icon.id === id
    )?.path ?? this.coverIcons[0].path;
  }

  openCoverPicker(): void {
    this.showCoverPicker = true;
  }

  closeCoverPicker(): void {
    this.showCoverPicker = false;
  }

  /**
   * Selecciona una portada basada en icono.
   *
   * Si anteriormente se había seleccionado una imagen,
   * esa imagen queda descartada y no será guardada.
   */
  chooseIconCover(
    iconId: string,
    color: string
  ): void {
    if (!this.editingTrack) {
      return;
    }

    this.clearPendingCover();

    this.editingTrack = {
      ...this.editingTrack,
      coverType: 'icon',
      coverIcon: iconId,
      coverColor: color
    };

    this.closeCoverPicker();
  }

  /**
   * Elimina la portada visual de la edición actual.
   *
   * La eliminación física de una portada previamente guardada
   * se manejará posteriormente mediante un comando específico
   * de Rust.
   */
  removeCover(): void {
    if (!this.editingTrack) {
      return;
    }

    this.clearPendingCover();

    this.editingTrack = {
      ...this.editingTrack,
      coverType: undefined,
      coverIcon: undefined,
      coverColor: undefined,
      image: ''
    };
  }

  /**
   * Selecciona una imagen desde el sistema.
   *
   * La imagen se mantiene como File mientras el usuario no
   * confirme los cambios.
   *
   * URL.createObjectURL() solamente se utiliza para la
   * previsualización temporal.
   */
  onCoverImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file || !this.editingTrack) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      input.value = '';
      return;
    }

    this.clearPendingCover();

    const imageUrl = URL.createObjectURL(file);

    this.pendingCoverFile = file;
    this.pendingCoverPreviewUrl = imageUrl;

    this.editingTrack = {
      ...this.editingTrack,
      coverType: 'image',
      coverIcon: undefined,
      coverColor: undefined,
      image: imageUrl
    };

    input.value = '';
  }

  /**
   * Libera los recursos temporales utilizados para
   * previsualizar una portada.
   */
  private clearPendingCover(): void {
    if (this.pendingCoverPreviewUrl) {
      URL.revokeObjectURL(
        this.pendingCoverPreviewUrl
      );
    }

    this.pendingCoverPreviewUrl = null;
    this.pendingCoverFile = null;
  }

  /**
   * Abre el selector de playlists para una canción.
   */
  openAddToPlaylist(track: Track): void {
    this.trackForPlaylist = track;
  }

  closeAddToPlaylist(): void {
    this.trackForPlaylist = null;
  }

  addToPlaylist(playlistId: string): void {
    if (!this.trackForPlaylist) {
      return;
    }

    this.playlistService.addTrack(
      playlistId,
      this.trackForPlaylist.id
    );

    const playlist =
      this.playlistService.getPlaylist(playlistId);

    this.notificationService.success(
      `Agregada a "${playlist?.name ?? 'la playlist'}".`
    );

    this.closeAddToPlaylist();
  }

  /**
   * Canción actualmente seleccionada.
   */
  get currentTrack() {
    return this.playerService.getCurrentTrack();
  }

  /**
   * Indica si la canción actual está marcada como favorita.
   */
  get currentTrackIsFavorite(): boolean {
    const track = this.currentTrack;

    if (!track) {
      return false;
    }

    return this.libraryService.isFavorite(
      track.id
    );
  }

  /**
   * Solicita la reproducción de una canción.
   */
  playTrack(track: Track): void {
    this.play.emit(track);
  }

  /**
   * Abre el panel de información de una canción.
   *
   * También bloquea temporalmente el desplazamiento de la
   * aplicación mientras el panel permanece abierto.
   */
  openMore(track: Track): void {
    this.selectedTrack = track;

    this.editingTrack = {
      ...track
    };

    this.clearPendingCover();

    document.body.classList.add('modal-open');

    this.more.emit(track);
  }

  /**
   * Cierra el panel de información.
   *
   * También libera cualquier previsualización temporal que
   * todavía no haya sido guardada.
   */
  closeMore(): void {
    this.clearPendingCover();

    this.selectedTrack = null;
    this.editingTrack = null;
    this.showCoverPicker = false;

    document.body.classList.remove('modal-open');
  }

  /**
   * Guarda los cambios realizados sobre los datos visibles.
   *
   * Si existe una nueva portada seleccionada, primero se envía
   * el archivo a Rust mediante LibraryService para almacenarlo
   * físicamente dentro de:
   *
   *     Musex/covers/
   *
   * Después se convierte la ruta física en una URL compatible
   * con Tauri para que Angular pueda mostrarla.
   */
  async saveMetadata(): Promise<void> {
    if (
      !this.selectedTrack ||
      !this.editingTrack
    ) {
      return;
    }

    try {
      let imagePath = this.editingTrack.image;

      // ---------------------------------------------------------
      // GUARDAR NUEVA PORTADA
      // ---------------------------------------------------------

      if (
        this.pendingCoverFile &&
        this.editingTrack.coverType === 'image'
      ) {
        const coverPath =
          await this.libraryService.saveCover(
            this.selectedTrack.id,
            this.pendingCoverFile
          );

        imagePath = convertFileSrc(
          coverPath
        );
      }

      // ---------------------------------------------------------
      // ACTUALIZAR TRACK
      // ---------------------------------------------------------

      Object.assign(
        this.selectedTrack,
        this.editingTrack,
        {
          image: imagePath
        }
      );

      // ---------------------------------------------------------
      // GUARDAR CONFIGURACIÓN DE PORTADA
      // ---------------------------------------------------------

      this.libraryService.updateCover(
        this.selectedTrack.id,
        {
          coverType:
            this.editingTrack.coverType,
          coverIcon:
            this.editingTrack.coverIcon,
          coverColor:
            this.editingTrack.coverColor,
          image: imagePath
        }
      );

      this.closeMore();

    } catch (error) {
      console.error(
        'No se pudo guardar la portada:',
        error
      );

      this.notificationService.error(
        'No se pudo guardar la portada.'
      );
    }
  }

  /**
   * Formatea la duración almacenada en segundos.
   */
  formatDuration(seconds: number): string {
    const totalSeconds = Math.max(
      0,
      Math.floor(seconds)
    );

    const minutes = Math.floor(
      totalSeconds / 60
    );

    const remainingSeconds =
      totalSeconds % 60;

    return `${minutes}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`;
  }
}