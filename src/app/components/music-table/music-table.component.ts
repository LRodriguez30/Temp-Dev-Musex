import {
  Component,
  EventEmitter,
  inject,
  Input,
  Output
} from '@angular/core';

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
   * Servicio principal del reproductor.
   */
  readonly playerService = inject(PlayerService);

  /**
   * Servicio encargado de gestionar favoritos.
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
    { id: 'music', path: 'M9 18V5l12-2v13 M9 9l12-2' },
    { id: 'heart', path: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z' },
    { id: 'zap', path: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z' }
  ];

  readonly coverColors: string[] = [
    'var(--musex-accent)', '#a45cff', '#ff9d00', '#7276ff', '#ff3ab7', '#44e000'
  ];

  showCoverPicker = false;

  getCoverIconPath(id: string | undefined): string {
    return this.coverIcons.find(icon => icon.id === id)?.path
      ?? this.coverIcons[0].path;
  }

  openCoverPicker(): void {
    this.showCoverPicker = true;
  }

  closeCoverPicker(): void {
    this.showCoverPicker = false;
  }

  chooseIconCover(iconId: string, color: string): void {
    if (!this.editingTrack) return;

    this.editingTrack.coverType = 'icon';
    this.editingTrack.coverIcon = iconId;
    this.editingTrack.coverColor = color;

    this.closeCoverPicker();
  }

  removeCover(): void {
    if (!this.editingTrack) return;

    this.editingTrack = {
      ...this.editingTrack,
      coverType: undefined,
      coverIcon: undefined,
      coverColor: undefined,
      image: ''
    };
  }

  onCoverImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file || !this.editingTrack) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      return;
    }

    const imageUrl = URL.createObjectURL(file);

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

    const playlist = this.playlistService.getPlaylist(playlistId);

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

    return this.libraryService.isFavorite(track.id);
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

    document.body.classList.add('modal-open');

    this.more.emit(track);
  }

  /**
   * Cierra el panel de información.
   *
   * También restaura el desplazamiento normal de la aplicación.
   */
  closeMore(): void {
    this.selectedTrack = null;
    this.editingTrack = null;
    this.showCoverPicker = false;

    document.body.classList.remove('modal-open');
  }

  /**
   * Guarda los cambios realizados sobre los datos visibles.
   *
   * Por ahora solamente actualiza la copia local. La persistencia
   * real se conectará posteriormente con LibraryService y Rust.
   */
  saveMetadata(): void {
    if (!this.selectedTrack || !this.editingTrack) {
      return;
    }

    Object.assign(
      this.selectedTrack,
      this.editingTrack
    );

    this.libraryService.updateCover(this.selectedTrack.id, {
      coverType: this.editingTrack.coverType ?? 'image',
      coverIcon: this.editingTrack.coverIcon,
      coverColor: this.editingTrack.coverColor,
      image: this.editingTrack.image
    });

    this.closeMore();
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