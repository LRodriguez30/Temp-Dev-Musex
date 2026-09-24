import {
  Component,
  computed,
  inject
} from '@angular/core';

import { FormsModule } from '@angular/forms';

import { LibraryService } from '../../core/services/library.service';
import { PlayerService } from '../../core/services/player.service';
import { QueueService } from '../../core/services/queue.service';
import { MusicTableComponent } from '../../components/music-table/music-table.component';
import { Track } from '../../core/models/track.model';
import { ModalService } from '../../core/services/modal.service';

/**
 * Página de canciones favoritas.
 *
 * Consume directamente el estado de LibraryService para mostrar
 * las canciones marcadas como favoritas.
 */
@Component({
  selector: 'app-favorites',
  standalone: true,
  imports: [
    FormsModule,
    MusicTableComponent
  ],
  templateUrl: './favorites.component.html',
  styleUrl: './favorites.component.css'
})
export class FavoritesComponent {

  // =========================================================
  // SERVICES
  // =========================================================

  /**
   * Servicio central de la biblioteca musical.
   */
  private readonly libraryService =
    inject(LibraryService);

  /**
   * Servicio central de reproducción.
   */
  private readonly playerService =
    inject(PlayerService);

  /**
   * Servicio central de la cola de reproducción.
   */
  private readonly queueService =
    inject(QueueService);


  // =========================================================
  // FILTER
  // =========================================================

  /**
   * Criterio actual de ordenamiento.
   *
   * title  → Título
   * artist → Artista
   * recent → Recientes
   */
  sortBy: 'title' | 'artist' | 'recent' = 'title';

  sortMenuOpen = false;

  // =========================================================
  // FAVORITES
  // =========================================================

  /**
   * Canciones favoritas.
   *
   * Se recalcula automáticamente cuando cambia
   * el estado de la biblioteca.
   */
  readonly favorites = computed(() =>
    this.libraryService.getFavorites()
  );


  /**
   * Cantidad actual de canciones favoritas.
   */
  readonly favoriteCount = computed(() =>
    this.libraryService.getFavoriteCount()
  );


  private readonly modalService = 
    inject(ModalService);

  openMore(track: Track): void {
    this.modalService.openTrackMenu(track.id);
  }

  openAddToPlaylist(track: Track): void {
    this.modalService.openAddToPlaylist(track.id);
  }

  /**
   * Canciones favoritas ordenadas según el filtro seleccionado.
   *
   * Esta es la colección que se muestra en la tabla
   * y también determina el orden de reproducción.
   */
  get tracks() {
    const tracks = [...this.favorites()];

    switch (this.sortBy) {

      case 'artist':
        return tracks.sort((a, b) =>
          a.artist.localeCompare(
            b.artist,
            undefined,
            {
              sensitivity: 'base'
            }
          )
        );

      case 'recent':
        return tracks.reverse();

      case 'title':
      default:
        return tracks.sort((a, b) =>
          a.title.localeCompare(
            b.title,
            undefined,
            {
              sensitivity: 'base'
            }
          )
        );
    }
  }


  // =========================================================
  // FAVORITE ACTIONS
  // =========================================================

  /**
   * Alterna el estado de favorito de una canción.
   */
  toggleFavorite(trackId: string): void {
    this.libraryService.toggleFavorite(trackId);
  }


  /**
   * Reproduce todos los favoritos desde el primero.
   *
   * El comportamiento es:
   *
   * 1. Obtiene los favoritos según el orden actual.
   * 2. Reemplaza la cola actual con esos favoritos.
   * 3. Reproduce inmediatamente la primera canción.
   *
   * Ejemplo:
   *
   *   Favorito A
   *   Favorito B
   *   Favorito C
   *
   * Resultado:
   *
   *   Ahora → Favorito A
   *   Siguiente → Favorito B
   *   Siguiente → Favorito C
   */
  playFavorites(): void {
    const tracks = this.tracks;

    if (tracks.length === 0) {
      return;
    }

    /**
     * Obtiene únicamente los IDs de las canciones
     * respetando el orden visual actual.
     */
    const trackIds = tracks.map(track =>
      track.id
    );

    /**
     * Reemplaza completamente la cola actual.
     *
     * Esto evita que canciones anteriores permanezcan
     * mezcladas con los favoritos.
     */
    this.queueService.setQueue(trackIds);

    /**
     * Reproduce inmediatamente la primera canción.
     */
    const firstTrack = tracks[0];

    void this.playerService.playTrack(
      firstTrack.id
    );
  }

  /**
   * Reproduce una canción seleccionada desde la biblioteca.
   */
  playTrack(track: Track): void {
    void this.playerService.playTrack(track.id);
  }
}