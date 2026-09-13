import { Injectable, signal } from '@angular/core';

// import { DEMO_PLAYLISTS } from '../data/demo-playlists';
import { Playlist } from '../models/playlist.model';

/**
 * Gestiona las playlists disponibles dentro de Musex.
 *
 * El servicio separa la administración de playlists de la interfaz
 * y del reproductor. Durante esta etapa utiliza las playlists demo
 * definidas en core/data.
 *
 * Posteriormente será responsable también de las playlists creadas
 * por el usuario y de su persistencia.
 */
@Injectable({
  providedIn: 'root'
})
export class PlaylistService {

  /**
   * Lista interna de playlists.
   *
   * Se inicializa cargando desde localStorage (o un arreglo vacío si no hay nada guardado).
   */
  private readonly playlists = signal<Playlist[]>(this.loadInitialPlaylists());

  /**
   * Exposición de solo lectura de las playlists.
   */
  readonly allPlaylists = this.playlists.asReadonly();

  /**
   * Carga las playlists guardadas en localStorage.
   */
  private loadInitialPlaylists(): Playlist[] {
    if (typeof window === 'undefined') {
      return [];
    }
    const saved = localStorage.getItem('musex_playlists');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * Guarda el estado actual de las playlists en localStorage.
   */
  private saveToStorage(playlists: Playlist[]): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('musex_playlists', JSON.stringify(playlists));
    }
  }

  /**
   * Devuelve todas las playlists disponibles.
   */
  getPlaylists(): Playlist[] {
    return this.playlists();
  }

  /**
   * Busca una playlist mediante su identificador.
   */
  getPlaylist(playlistId: string): Playlist | undefined {
    return this.playlists().find(
      playlist => playlist.id === playlistId
    );
  }

  /**
   * Devuelve únicamente las playlists creadas por el usuario.
   */
  getCustomPlaylists(): Playlist[] {
    return this.playlists().filter(
      playlist => playlist.custom === true
    );
  }

  /**
   * Crea una nueva playlist.
   *
   * Las playlists nuevas comienzan vacías y posteriormente
   * podrán recibir canciones mediante addTrack().
   */
  createPlaylist(
    name: string,
    cover: {
      coverType: 'icon' | 'image';
      coverIcon?: string;
      coverColor?: string;
      image?: string;
    }
  ): Playlist | null {
    const normalizedName = name.trim();

    if (!normalizedName) {
      return null;
    }

    const playlist: Playlist = {
      id: this.generatePlaylistId(normalizedName),
      name: normalizedName,
      count: 0,
      image: cover.coverType === 'image' ? (cover.image ?? '') : '',
      coverType: cover.coverType,
      coverIcon: cover.coverType === 'icon' ? cover.coverIcon : undefined,
      coverColor: cover.coverType === 'icon' ? cover.coverColor : undefined,
      trackIds: [],
      custom: true
    };

    this.playlists.update(playlists => {
      const updated = [...playlists, playlist];
      this.saveToStorage(updated);
      return updated;
    });

    return playlist;
  }

  /**
   * Elimina una playlist mediante su identificador.
   *
   * Las playlists demo también pueden eliminarse a nivel de estado
   * durante esta etapa de desarrollo. Las restricciones definitivas
   * se definirán cuando implementemos la persistencia.
   */
  removePlaylist(playlistId: string): void {
    this.playlists.update(playlists => {
      const updated = playlists.filter(
        playlist => playlist.id !== playlistId
      );
      this.saveToStorage(updated);
      return updated;
    });
  }

  /**
   * Cambia el nombre de una playlist existente.
   */
  renamePlaylist(
    playlistId: string,
    name: string
  ): void {
    const normalizedName = name.trim();

    if (!normalizedName) {
      return;
    }

    this.playlists.update(playlists => {
      const updated = playlists.map(playlist =>
        playlist.id === playlistId
          ? {
            ...playlist,
            name: normalizedName
          }
          : playlist
      );
      this.saveToStorage(updated);
      return updated;
    });
  }

  /**
   * Agrega una canción a una playlist.
   *
   * Si la canción ya pertenece a la playlist, no se agrega
   * nuevamente.
   */
  addTrack(
    playlistId: string,
    trackId: string
  ): void {
    this.playlists.update(playlists => {
      const updated = playlists.map(playlist => {
        if (playlist.id !== playlistId) {
          return playlist;
        }

        const trackIds = playlist.trackIds ?? [];

        if (trackIds.includes(trackId)) {
          return playlist;
        }

        const updatedTrackIds = [
          ...trackIds,
          trackId
        ];

        return {
          ...playlist,
          trackIds: updatedTrackIds,
          count: updatedTrackIds.length
        };
      });
      this.saveToStorage(updated);
      return updated;
    });
  }

  /**
   * Elimina una canción de una playlist.
   */
  removeTrack(
    playlistId: string,
    trackId: string
  ): void {
    this.playlists.update(playlists => {
      const updated = playlists.map(playlist => {
        if (playlist.id !== playlistId) {
          return playlist;
        }

        const updatedTrackIds = (
          playlist.trackIds ?? []
        ).filter(id => id !== trackId);

        return {
          ...playlist,
          trackIds: updatedTrackIds,
          count: updatedTrackIds.length
        };
      });
      this.saveToStorage(updated);
      return updated;
    });
  }

  /**
   * Obtiene los identificadores de canciones pertenecientes
   * a una playlist.
   */
  getTrackIds(playlistId: string): string[] {
    return this.getPlaylist(playlistId)?.trackIds ?? [];
  }

  /**
   * Genera un identificador sencillo para una nueva playlist.
   *
   * Se añade una marca temporal para reducir la posibilidad
   * de colisiones entre playlists creadas rápidamente.
   */
  private generatePlaylistId(name: string): string {
    const normalizedName = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return `${normalizedName || 'playlist'}-${Date.now()}`;
  }
}