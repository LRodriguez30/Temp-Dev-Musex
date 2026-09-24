import { Component, inject } from '@angular/core';

import { PlayerService } from '../../core/services/player.service';
import { LibraryService } from '../../core/services/library.service';
import { PlaylistService } from '../../core/services/playlist.service';
import { HistoryService } from '../../core/services/history.service';

import { SongCardComponent } from '../../components/song-card/song-card.component';
import { PlaylistCardComponent } from '../../components/playlist-card/playlist-card.component';
import { RecommendationCardComponent } from '../../components/recommendation-card/recommendation-card.component';

import { Track } from '../../core/models/track.model';

/**
 * Página principal de Musex.
 *
 * Presenta las secciones principales de la aplicación:
 * continuación de reproducción, historial reciente,
 * playlists y recomendaciones personalizadas.
 *
 * La vista utiliza los servicios centrales para obtener el estado
 * de la aplicación y delega la representación de elementos
 * reutilizables en componentes independientes.
 */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    SongCardComponent,
    PlaylistCardComponent,
    RecommendationCardComponent
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent {

  /**
   * Servicio principal del reproductor.
   */
  readonly playerService = inject(PlayerService);

  /**
   * Servicio encargado de la biblioteca musical y favoritos.
   */
  readonly libraryService = inject(LibraryService);

  /**
   * Servicio encargado de las playlists.
   */
  readonly playlistService = inject(PlaylistService);

  /**
   * Servicio encargado del historial de reproducción.
   */
  readonly historyService = inject(HistoryService);

  /**
   * Canciones disponibles en la biblioteca.
   */
  readonly tracks = this.libraryService.tracks;

  /**
   * Playlists disponibles en Musex.
   */
  readonly playlists = this.playlistService.allPlaylists;

  /**
   * Historial de reproducción.
   */
  readonly history = this.historyService.entries;

  /**
   * Canción seleccionada para mostrar acciones.
   */
  selectedTrack: Track | null = null;

  /**
   * Canción seleccionada para agregar a una playlist.
   */
  trackForPlaylist: Track | null = null;

  /**
   * Abre el selector de playlists para una canción.
   */
  openAddToPlaylist(track: Track): void {
    this.trackForPlaylist = track;
  }

  /**
   * Cierra el selector de playlists.
   */
  closeAddToPlaylist(): void {
    this.trackForPlaylist = null;
  }

  /**
   * Agrega la canción seleccionada a una playlist.
   */
  addTrackToPlaylist(playlistId: string): void {
    if (!this.trackForPlaylist) {
      return;
    }

    this.playlistService.addTrack(
      playlistId,
      this.trackForPlaylist.id
    );

    this.closeAddToPlaylist();
  }

  /**
   * Canciones reproducidas recientemente.
   *
   * El historial almacena identificadores de canciones,
   * por lo que cada entrada se transforma nuevamente
   * en su Track correspondiente.
   */
  get recentTracks(): Track[] {
    const seen = new Set<string>();

    return this.history()
      .map(entry => this.libraryService.getTrack(entry.trackId))
      .filter((track): track is Track => {
        if (!track || seen.has(track.id)) return false;
        seen.add(track.id);
        return true;
      })
      .slice(0, 5);
  }

  get continueListeningTrack(): Track | undefined {
    const history = this.history();

    if (history.length < 2) {
      return undefined;
    }

    return this.libraryService.getTrack(
      history[1].trackId
    );
  }

  /**
   * Reproduce una canción seleccionada desde Home.
   */
  playTrack(trackId: string): void {
    this.playerService.playTrack(trackId);
  }

  /**
   * Indica si una canción está reproduciéndose actualmente.
   */
  isTrackPlaying(track: Track): boolean {
    const state = this.playerService.state();

    return (
      state.playing &&
      state.currentTrackId === track.id
    );
  }

  /**
   * Alterna el estado de favorito de una canción.
   */
  toggleFavorite(trackId: string): void {
    this.libraryService.toggleFavorite(trackId);
  }

  /**
   * Indica si una canción pertenece a favoritos.
   */
  isFavorite(trackId: string): boolean {
    return this.libraryService.isFavorite(trackId);
  }

  /**
   * Reproduce una canción aleatoria de la biblioteca.
   *
   * Se utiliza para la acción de reproducción aleatoria
   * disponible en el encabezado de Home.
   */
  playMix(): void {
    const tracks = this.tracks();

    if (tracks.length === 0) {
      return;
    }

    const randomIndex = Math.floor(
      Math.random() * tracks.length
    );

    this.playerService.playTrack(
      tracks[randomIndex].id
    );
  }

  /**
   * Obtiene el saludo correspondiente a la hora actual.
   *
   * El saludo se divide en mañana, tarde y noche
   * para adaptar Home al momento del día.
   */
  getGreeting(): string {
    const hour = new Date().getHours();

    if (hour >= 5 && hour < 12) {
      return 'Buenos días';
    }

    if (hour >= 12 && hour < 19) {
      return 'Buenas tardes';
    }

    return 'Buenas noches';
  }
}