// =============================================================
// MUSEX - LIBRARY SERVICE
// =============================================================
//
// Responsable de administrar la biblioteca musical local.
//
// Este servicio:
//
// - Mantiene el estado reactivo de las canciones.
// - Solicita a Rust el escaneo de la biblioteca.
// - Importa archivos externos hacia la biblioteca de Musex.
// - Administra favoritos.
// - Persiste los favoritos entre sesiones.
// - Mantiene sincronizada la cola con la biblioteca.
//
// Angular administra el estado de la interfaz.
// Rust administra los archivos físicos.
// =============================================================

import { inject, Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

import { DEMO_TRACKS } from '../data/demo-tracks';
import { Track } from '../models/track.model';
import { QueueService } from './queue.service';

// =============================================================
// CONSTANTES
// =============================================================

/**
 * Clave utilizada para almacenar los IDs de las canciones
 * favoritas en el almacenamiento local de Musex.
 *
 * Solamente se guardan los IDs, no las canciones completas.
 */
const FAVORITES_STORAGE_KEY = 'musex_favorite_tracks';

// =============================================================
// MODELOS RECIBIDOS DESDE RUST
// =============================================================

interface RustTrack {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  path: string;
  duration: number | null;
}

// =============================================================
// SERVICE
// =============================================================

@Injectable({
  providedIn: 'root'
})
export class LibraryService {

  /**
   * Estado principal de la biblioteca.
   *
   * Se inicializa con las canciones de demostración para
   * mantener disponible la interfaz mientras no exista
   * una biblioteca local escaneada.
   */
  readonly tracks = signal<Track[]>([...DEMO_TRACKS]);

  /**
   * Exposición de solo lectura para los componentes.
   */
  readonly library = this.tracks.asReadonly();

  /**
   * Servicio encargado de mantener sincronizada la cola
   * con las canciones disponibles en la biblioteca.
   */
  private readonly queueService = inject(QueueService);

  /**
   * IDs de las canciones marcadas como favoritas.
   *
   * El Set permite consultar rápidamente si una canción
   * está marcada y evita IDs duplicados.
   */
  private readonly favoriteIds = new Set<string>();

  constructor() {
    /**
     * Restauramos los favoritos guardados anteriormente.
     */
    this.loadFavorites();

    /**
     * Aplicamos el estado restaurado a las canciones
     * actualmente cargadas en la biblioteca.
     */
    this.restoreFavoriteState();
  }

  // ===========================================================
  // CONSULTAS
  // ===========================================================

  /**
   * Devuelve una copia de las canciones actuales.
   */
  getTracks(): Track[] {
    return [...this.tracks()];
  }

  /**
   * Busca una canción concreta mediante su identificador.
   */
  getTrack(trackId: string): Track | undefined {
    return this.tracks().find(
      track => track.id === trackId
    );
  }

  /**
   * Devuelve todas las canciones favoritas.
   */
  getFavorites(): Track[] {
    return this.tracks().filter(
      track => track.favorite
    );
  }

  /**
   * Comprueba si una canción está marcada como favorita.
   */
  isFavorite(trackId: string): boolean {
    return this.favoriteIds.has(trackId);
  }

  /**
   * Cantidad total de canciones.
   */
  getLibraryCount(): number {
    return this.tracks().length;
  }

  /**
   * Cantidad total de favoritos.
   */
  getFavoriteCount(): number {
    return this.getFavorites().length;
  }

  // ===========================================================
  // ESCANEO
  // ===========================================================

  /**
   * Escanea la carpeta musical administrada por Musex.
   *
   * Rust localiza los archivos y obtiene sus metadatos.
   * Angular solamente transforma el resultado al modelo Track.
   */
  async scanLibrary(): Promise<Track[]> {
    try {

      const scannedTracks =
        await invoke<RustTrack[]>('scan_library');

      const tracks: Track[] =
        scannedTracks.map(track => ({
          id: track.id,
          title: track.title,
          artist: track.artist ?? 'Artista desconocido',
          album: track.album ?? 'Álbum desconocido',
          genre: track.genre ?? undefined,
          duration: track.duration ?? 0,
          path: track.path,
          image: 'assets/images/default-cover.jpg',
          source: null,

          /**
           * El estado favorito se obtiene desde la persistencia.
           */
          favorite: this.favoriteIds.has(track.id)
        }));

      this.tracks.set(tracks);

      this.restoreCovers();

      /**
       * La cola solamente puede contener canciones que
       * todavía existen dentro de la biblioteca.
       */
      this.queueService.syncWithLibrary(
        tracks.map(track => track.id)
      );

      return this.tracks();

    } catch (error) {
      console.error(
        'Error al escanear la biblioteca de Musex:',
        error
      );

      throw error;
    }
  }

  // ===========================================================
  // IMPORTACIÓN
  // ===========================================================

  /**
   * Importa archivos externos hacia la biblioteca de Musex.
   *
   * Las rutas recibidas son rutas físicas obtenidas mediante
   * el diálogo nativo de Tauri.
   *
   * Rust se encarga de copiar los archivos hacia:
   *
   * Desktop/Musex/music/
   *
   * Después de la copia se vuelve a escanear la biblioteca
   * para obtener los Track completos con sus metadatos.
   */
  async importTracks(paths: string[]): Promise<Track[]> {
    if (paths.length === 0) {
      return this.tracks();
    }

    try {

      /**
       * Rust devuelve las rutas finales de los archivos
       * que fueron copiados correctamente.
       */
      await invoke<string[]>(
        'import_tracks',
        { paths }
      );

      /**
       * El scanner vuelve a construir la biblioteca desde
       * los archivos físicos que ahora existen en music/.
       */
      return await this.scanLibrary();

    } catch (error) {
      console.error(
        'Error al importar archivos a la biblioteca de Musex:',
        error
      );

      throw error;
    }
  }

  // ===========================================================
  // FAVORITOS
  // ===========================================================

  /**
   * Alterna el estado de favorito de una canción.
   */
  toggleFavorite(trackId: string): void {

    if (this.isFavorite(trackId)) {
      this.removeFavorite(trackId);
      return;
    }

    this.addFavorite(trackId);
  }

  /**
   * Marca una canción como favorita.
   */
  addFavorite(trackId: string): void {

    const track = this.getTrack(trackId);

    if (!track) {
      return;
    }

    /**
     * Guardamos el ID en memoria.
     */
    this.favoriteIds.add(trackId);

    /**
     * Actualizamos el estado reactivo de la biblioteca.
     */
    this.tracks.update(tracks =>
      tracks.map(track =>
        track.id === trackId
          ? {
            ...track,
            favorite: true
          }
          : track
      )
    );

    /**
     * Persistimos los favoritos.
     */
    this.saveFavorites();
  }

  /**
   * Elimina una canción de favoritos.
   */
  removeFavorite(trackId: string): void {

    /**
     * Eliminamos el ID de la colección persistente.
     */
    this.favoriteIds.delete(trackId);

    /**
     * Actualizamos el estado reactivo.
     */
    this.tracks.update(tracks =>
      tracks.map(track =>
        track.id === trackId
          ? {
            ...track,
            favorite: false
          }
          : track
      )
    );

    /**
     * Persistimos nuevamente la colección.
     */
    this.saveFavorites();
  }

  /**
   * Carga los favoritos almacenados localmente.
   */
  private loadFavorites(): void {
    try {

      const stored =
        localStorage.getItem(FAVORITES_STORAGE_KEY);

      if (!stored) {
        return;
      }

      const parsed: unknown =
        JSON.parse(stored);

      /**
       * Validamos que realmente sea un arreglo.
       */
      if (!Array.isArray(parsed)) {
        return;
      }

      /**
       * Solamente aceptamos IDs de tipo string.
       */
      parsed
        .filter(
          (id): id is string =>
            typeof id === 'string'
        )
        .forEach(id =>
          this.favoriteIds.add(id)
        );

    } catch (error) {

      console.error(
        'No se pudieron cargar los favoritos de Musex:',
        error
      );

    }
  }

  /**
   * Guarda los IDs de favoritos en localStorage.
   */
  private saveFavorites(): void {
    try {

      localStorage.setItem(
        FAVORITES_STORAGE_KEY,
        JSON.stringify([
          ...this.favoriteIds
        ])
      );

    } catch (error) {

      console.error(
        'No se pudieron guardar los favoritos de Musex:',
        error
      );

    }
  }

  /**
   * Aplica los favoritos persistidos a las canciones
   * actualmente presentes en la biblioteca.
   */
  private restoreFavoriteState(): void {

    this.tracks.update(tracks =>
      tracks.map(track => ({
        ...track,
        favorite: this.favoriteIds.has(track.id)
      }))
    );
  }

  // ===========================================================
  // ADMINISTRACIÓN
  // ===========================================================

  /**
   * Agrega canciones directamente al estado de la biblioteca.
   *
   * Se conserva para operaciones internas que ya dependan
   * de este método.
   */
  addTracks(newTracks: Track[]): void {
    if (newTracks.length === 0) {
      return;
    }

    this.tracks.update(tracks => [
      ...tracks,
      ...newTracks.map(track => ({
        ...track,
        favorite: this.favoriteIds.has(track.id)
      }))
    ]);
  }

  /**
   * Elimina una canción del estado actual.
   *
   * También elimina su favorito persistido, ya que la canción
   * deja de formar parte de la biblioteca.
   */
  removeTrack(trackId: string): void {

    this.tracks.update(tracks =>
      tracks.filter(track => track.id !== trackId)
    );

    /**
     * Eliminamos también su estado persistido.
     */
    this.favoriteIds.delete(trackId);

    this.saveFavorites();
  }

  /**
   * Vacía completamente el estado de la biblioteca.
   *
   * Los favoritos persistidos se mantienen porque pertenecen
   * al estado de Musex y pueden volver a aplicarse cuando
   * la biblioteca sea escaneada nuevamente.
   */
  clearLibrary(): void {
    this.tracks.set([]);
  }

  /**
   * Actualiza la portada de una canción.
   *
   * Al ser 'icon', `image` se limpia para evitar mostrar
   * una portada vieja por error en algún binding que no
   * revise coverType.
   */
  updateCover(
    trackId: string,
    cover: {
      coverType: 'icon' | 'image';
      coverIcon?: string;
      coverColor?: string;
      image?: string;
    }
  ): void {

    this.tracks.update(tracks =>
      tracks.map(track =>
        track.id === trackId
          ? {
            ...track,
            coverType: cover.coverType,
            coverIcon: cover.coverType === 'icon' ? cover.coverIcon : undefined,
            coverColor: cover.coverType === 'icon' ? cover.coverColor : undefined,
            image: cover.coverType === 'image' ? (cover.image ?? track.image) : track.image
          }
          : track
      )
    );

    this.saveCovers();
  }

  /**
   * Persiste las portadas personalizadas en localStorage.
   *
   * Solo se guardan overrides por trackId, no la biblioteca
   * completa, para no duplicar datos que ya vienen de Rust.
   */
  private saveCovers(): void {
    const overrides: Record<string, unknown> = {};

    for (const track of this.tracks()) {
      if (track.coverType) {
        overrides[track.id] = {
          coverType: track.coverType,
          coverIcon: track.coverIcon,
          coverColor: track.coverColor,
          image: track.coverType === 'image' ? track.image : undefined
        };
      }
    }

    localStorage.setItem('musex_track_covers', JSON.stringify(overrides));
  }

  /**
   * Restaura las portadas personalizadas guardadas.
   *
   * Se llama después de scanLibrary() para volver a aplicar
   * los overrides sobre los tracks recién escaneados.
   */
  private restoreCovers(): void {
    const saved = localStorage.getItem('musex_track_covers');

    if (!saved) {
      return;
    }

    try {
      const overrides = JSON.parse(saved) as Record<string, any>;

      this.tracks.update(tracks =>
        tracks.map(track => {
          const override = overrides[track.id];

          if (!override) {
            return track;
          }

          return {
            ...track,
            coverType: override.coverType,
            coverIcon: override.coverIcon,
            coverColor: override.coverColor,
            image: override.coverType === 'image' ? (override.image ?? track.image) : track.image
          };
        })
      );

    } catch (error) {
      console.error('No se pudieron restaurar las portadas.', error);
    }
  }

  searchTracks(query: string): Track[] {
    const normalizedQuery = query
      .trim()
      .toLowerCase();

    if (!normalizedQuery) {
      return [];
    }

    return this.tracks().filter(track =>
      track.title.toLowerCase().includes(normalizedQuery) ||
      track.artist.toLowerCase().includes(normalizedQuery) ||
      track.album.toLowerCase().includes(normalizedQuery) ||
      track.genre?.toLowerCase().includes(normalizedQuery)
    );
  }
}