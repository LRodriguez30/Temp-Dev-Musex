
import {
  Component,
  computed,
  inject
} from '@angular/core';

import { MusicTableComponent } from '../../components/music-table/music-table.component';

import { LibraryService } from '../../core/services/library.service';
import { PlayerService } from '../../core/services/player.service';
import { QueueService } from '../../core/services/queue.service';
import { ModalService } from '../../core/services/modal.service';

import { Track } from '../../core/models/track.model';

@Component({
  selector: 'app-favorites-mobile',
  standalone: true,
  imports: [MusicTableComponent],
  templateUrl: './favorites-mobile.component.html',
  styleUrl: './favorites-mobile.component.css'
})
export class FavoritesMobileComponent {

  // =========================================================
  // SERVICES
  // =========================================================

  private readonly libraryService = inject(LibraryService);
  private readonly playerService = inject(PlayerService);
  private readonly queueService = inject(QueueService);
  private readonly modalService = inject(ModalService);

  // =========================================================
  // SORTING
  // =========================================================

  sortBy: 'title' | 'artist' | 'recent' = 'title';

  sortMenuOpen = false;

  // =========================================================
  // FAVORITES
  // =========================================================

  readonly localFavorites = computed(() =>
    this.sorted(this.libraryService.getLocalFavorites())
  );

  readonly remoteFavorites = computed(() =>
    this.sorted(this.libraryService.getRemoteFavorites())
  );

  readonly localFavoriteCount = computed(() =>
    this.localFavorites().length
  );

  readonly remoteFavoriteCount = computed(() =>
    this.remoteFavorites().length
  );

  readonly favoriteCount = computed(() =>
    this.localFavoriteCount() + this.remoteFavoriteCount()
  );

  /**
   * Ordena una colección según el criterio seleccionado.
   */
  private sorted(tracks: Track[]): Track[] {

    const result = [...tracks];

    switch (this.sortBy) {

      case 'artist':
        return result.sort((a, b) =>
          a.artist.localeCompare(
            b.artist,
            undefined,
            { sensitivity: 'base' }
          )
        );

      case 'recent':
        return result.sort((a, b) =>
          b.addedAt.localeCompare(a.addedAt)
        );

      case 'title':
      default:
        return result.sort((a, b) =>
          a.title.localeCompare(
            b.title,
            undefined,
            { sensitivity: 'base' }
          )
        );
    }
  }

  // =========================================================
  // PLAYBACK
  // =========================================================

  /**
   * Reproduce una colección desde su primera canción,
   * reemplazando la cola de reproducción actual.
   */
  playFavorites(collection: 'local' | 'remote' = 'local'): void {

    const tracks = collection === 'local'
      ? this.localFavorites()
      : this.remoteFavorites();

    if (tracks.length === 0) {
      return;
    }

    const trackIds = tracks.map(track => track.id);

    this.queueService.setQueue(trackIds);

    void this.playerService.playTrack(tracks[0].id);
  }

  /**
   * Reproduce, pausa o reanuda una canción seleccionada.
   */
  async playTrack(
    event: {
      track: Track;
      action: 'play' | 'pause';
    }
  ): Promise<void> {

    if (event.action === 'pause') {
      await this.playerService.togglePlay();
      return;
    }

    const state = this.playerService.state();

    if (
      state.currentTrackId === event.track.id &&
      !state.playing
    ) {
      await this.playerService.togglePlay();
      return;
    }

    await this.playerService.playTrack(event.track.id);
  }

  // =========================================================
  // TRACK ACTIONS
  // =========================================================

  openMore(track: Track): void {
    this.modalService.openTrackMenu(track.id);
  }

  openAddToPlaylist(track: Track): void {
    this.modalService.openAddToPlaylist(track.id);
  }
}