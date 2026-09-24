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


/**
 * Tabla reutilizable para mostrar colecciones de canciones.
 *
 * El componente presenta las canciones y comunica las acciones
 * realizadas por el usuario.
 *
 * La reproducción y la gestión de los datos permanecen fuera
 * del componente para mantenerlo reutilizable.
 *
 * Los modales de metadata y playlists no pertenecen a este
 * componente. Las acciones correspondientes se emiten mediante
 * eventos para que MainLayout pueda controlar los overlays
 * globales.
 */
@Component({
  selector: 'app-music-table',
  standalone: true,
  templateUrl: './music-table.component.html',
  styleUrl: './music-table.component.css'
})
export class MusicTableComponent {


  /* =============================================================
     INPUTS
     ============================================================= */

  /**
   * Canciones que serán mostradas en la tabla.
   */
  @Input()
  tracks: Track[] = [];


  /* =============================================================
     OUTPUTS
     ============================================================= */

  /**
   * Evento emitido cuando el usuario solicita reproducir
   * una canción.
   */
  @Output()
  play = new EventEmitter<Track>();


  /**
   * Evento emitido cuando el usuario abre las opciones
   * de una canción.
   *
   * MainLayout utiliza este evento para abrir el modal
   * global de metadata.
   */
  @Output()
  more = new EventEmitter<Track>();


  /**
   * Evento emitido cuando el usuario solicita agregar
   * una canción a una playlist.
   *
   * MainLayout utiliza este evento para abrir el modal
   * global de playlists.
   */
  @Output()
  addToPlaylist = new EventEmitter<Track>();


  /* =============================================================
     SERVICES
     ============================================================= */

  /**
   * Servicio principal del reproductor.
   */
  readonly playerService = inject(PlayerService);


  /**
   * Servicio encargado de gestionar la biblioteca y favoritos.
   */
  private readonly libraryService = inject(LibraryService);


  /* =============================================================
     TRACK ACTUAL
     ============================================================= */

  /**
   * Canción actualmente seleccionada por el reproductor.
   *
   * Se obtiene directamente desde PlayerService para que la
   * tabla pueda identificar el estado de reproducción actual.
   */
  get currentTrack(): Track | null {
    return this.playerService.getCurrentTrack() ?? null;
  }


  /**
   * Indica si la canción actualmente reproducida está marcada
   * como favorita.
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


  /* =============================================================
     REPRODUCCIÓN
     ============================================================= */

  /**
   * Solicita la reproducción de una canción.
   *
   * La tabla no controla directamente la reproducción.
   * Solamente comunica la acción al componente padre.
   */
  playTrack(track: Track): void {

    this.play.emit(track);
  }

  isTrackPlaying(track: Track): boolean {
    const state = this.playerService.state();

    return (
        state.playing &&
        state.currentTrackId === track.id
    );
  }


  /* =============================================================
     MODAL — METADATA
     ============================================================= */

  /**
   * Solicita abrir el modal de información y edición
   * de una canción.
   *
   * La implementación visual del modal pertenece a MainLayout.
   */
  openMore(track: Track): void {

    this.more.emit(track);
  }


  /* =============================================================
     MODAL — PLAYLIST
     ============================================================= */

  /**
   * Solicita abrir el selector de playlists para una canción.
   *
   * MainLayout recibe el evento y controla el modal global.
   */
  openAddToPlaylist(track: Track): void {

    this.addToPlaylist.emit(track);
  }

  formatDuration(duration: number | undefined | null): string {
    if (
      duration === undefined ||
      duration === null ||
      !Number.isFinite(duration)
    ) {
      return '--:--';
    }

    const totalSeconds = Math.max(
      0,
      Math.floor(duration)
    );

    const minutes = Math.floor(
      totalSeconds / 60
    );

    const seconds = totalSeconds % 60;

    return `${minutes}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }
}