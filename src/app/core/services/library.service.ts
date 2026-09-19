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
// - Guarda las portadas físicamente mediante Rust.
// - Recupera las portadas físicas almacenadas por Rust.
//
// Angular administra el estado de la interfaz.
// Rust administra los archivos físicos.
// =============================================================

import {
  inject,
  Injectable,
  signal
} from '@angular/core';

import {
  convertFileSrc,
  invoke
} from '@tauri-apps/api/core';

import { DEMO_TRACKS } from '../data/demo-tracks';
import { Track } from '../models/track.model';
import { QueueService } from './queue.service';

const FAVORITES_STORAGE_KEY =
  'musex_favorite_tracks';

const COVERS_STORAGE_KEY =
  'musex_track_covers';

// =============================================================
// RESPUESTA DE RUST
// =============================================================

interface RustTrack {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  path: string;
  duration: number | null;

  /**
   * Ruta física de la portada almacenada por Rust.
   *
   * Ejemplo:
   *
   * C:\Users\LART\Desktop\Musex\covers\abc123.jpg
   */
  coverPath: string | null;
}

// =============================================================
// CONFIGURACIÓN DE PORTADA
// =============================================================

interface CoverOverride {
  coverType?: 'icon' | 'image';
  coverIcon?: string;
  coverColor?: string;
}

// =============================================================
// SERVICE
// =============================================================

@Injectable({
  providedIn: 'root'
})
export class LibraryService {

  readonly tracks =
    signal<Track[]>([...DEMO_TRACKS]);

  readonly library =
    this.tracks.asReadonly();

  private readonly queueService =
    inject(QueueService);

  private readonly favoriteIds =
    new Set<string>();

  // ===========================================================
  // CONSTRUCTOR
  // ===========================================================

  constructor() {
    this.loadFavorites();
    this.restoreFavoriteState();
  }

  // ===========================================================
  // GETTERS
  // ===========================================================

  getTracks(): Track[] {
    return [...this.tracks()];
  }

  getTrack(
    trackId: string
  ): Track | undefined {
    return this.tracks().find(
      track => track.id === trackId
    );
  }

  getFavorites(): Track[] {
    return this.tracks().filter(
      track => track.favorite
    );
  }

  isFavorite(
    trackId: string
  ): boolean {
    return this.favoriteIds.has(trackId);
  }

  getLibraryCount(): number {
    return this.tracks().length;
  }

  getFavoriteCount(): number {
    return this.getFavorites().length;
  }

  // ===========================================================
  // SCAN LIBRARY
  // ===========================================================

  async scanLibrary(): Promise<Track[]> {

    try {

      const scannedTracks =
        await invoke<RustTrack[]>(
          'scan_library'
        );

      const tracks: Track[] =
        scannedTracks.map(track => {

          const coverOverrides =
            this.getCoverOverride(track.id);

          return {
            id: track.id,

            title:
              track.title,

            artist:
              track.artist ??
              'Artista desconocido',

            album:
              track.album ??
              'Álbum desconocido',

            genre:
              track.genre ??
              undefined,

            duration:
              track.duration ??
              0,

            path:
              track.path,

            image:
              this.resolveCoverPath(
                track.coverPath
              ),

            source:
              null,

            favorite:
              this.favoriteIds.has(
                track.id
              ),

            coverType:
              coverOverrides?.coverType ??
              (track.coverPath
                ? 'image'
                : undefined),

            coverIcon:
              coverOverrides?.coverIcon,

            coverColor:
              coverOverrides?.coverColor
          };
        });

      this.tracks.set(tracks);

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
  // RESOLVER PORTADA
  // ===========================================================

  /**
   * Convierte una ruta física devuelta por Rust
   * en una URL que el WebView de Tauri puede mostrar.
   *
   * Si no existe una portada física, utiliza la
   * portada predeterminada de Musex.
   */
  private resolveCoverPath(
    coverPath: string | null
  ): string {

    if (!coverPath) {
      return 'assets/images/default-cover.jpg';
    }

    try {

      return convertFileSrc(
        coverPath
      );

    } catch (error) {

      console.error(
        'No se pudo convertir la ruta de la portada:',
        error
      );

      return 'assets/images/default-cover.jpg';
    }
  }

  // ===========================================================
  // GUARDAR PORTADA FÍSICA
  // ===========================================================

  /**
   * Guarda físicamente una portada dentro de:
   *
   * Musex/covers/
   *
   * Rust recibe los bytes del archivo y devuelve
   * la ruta física donde fue almacenado.
   */
  async saveCover(
    trackId: string,
    file: File
  ): Promise<string> {

    if (!trackId.trim()) {
      throw new Error(
        'El ID de la canción no puede estar vacío.'
      );
    }

    if (!file) {
      throw new Error(
        'No se recibió ninguna portada.'
      );
    }

    if (!file.type.startsWith('image/')) {
      throw new Error(
        'El archivo seleccionado no es una imagen.'
      );
    }

    const extension =
      this.getImageExtension(file);

    const buffer =
      await file.arrayBuffer();

    const data =
      Array.from(
        new Uint8Array(buffer)
      );

    try {

      const coverPath =
        await invoke<string>(
          'save_cover',
          {
            trackId,
            extension,
            data
          }
        );

      return coverPath;

    } catch (error) {

      console.error(
        'No se pudo guardar físicamente la portada:',
        error
      );

      throw error;
    }
  }

  // ===========================================================
  // EXTENSIÓN DE IMAGEN
  // ===========================================================

  private getImageExtension(
    file: File
  ): string {

    switch (file.type) {

      case 'image/png':
        return 'png';

      case 'image/jpeg':
        return 'jpg';

      case 'image/webp':
        return 'webp';

      default: {

        const fileName =
          file.name.toLowerCase();

        if (fileName.endsWith('.png')) {
          return 'png';
        }

        if (
          fileName.endsWith('.jpg') ||
          fileName.endsWith('.jpeg')
        ) {
          return 'jpg';
        }

        if (fileName.endsWith('.webp')) {
          return 'webp';
        }

        throw new Error(
          'Formato de imagen no compatible.'
        );
      }
    }
  }

  // ===========================================================
  // IMPORTAR TRACKS
  // ===========================================================

  async importTracks(
    paths: string[]
  ): Promise<Track[]> {

    if (paths.length === 0) {
      return this.tracks();
    }

    try {

      await invoke<string[]>(
        'import_tracks',
        { paths }
      );

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

  toggleFavorite(
    trackId: string
  ): void {

    if (this.isFavorite(trackId)) {
      this.removeFavorite(trackId);
      return;
    }

    this.addFavorite(trackId);
  }

  addFavorite(
    trackId: string
  ): void {

    const track =
      this.getTrack(trackId);

    if (!track) return;

    this.favoriteIds.add(
      trackId
    );

    this.tracks.update(
      tracks =>
        tracks.map(track =>
          track.id === trackId
            ? {
              ...track,
              favorite: true
            }
            : track
        )
    );

    this.saveFavorites();
  }

  removeFavorite(
    trackId: string
  ): void {

    this.favoriteIds.delete(
      trackId
    );

    this.tracks.update(
      tracks =>
        tracks.map(track =>
          track.id === trackId
            ? {
              ...track,
              favorite: false
            }
            : track
        )
    );

    this.saveFavorites();
  }

  // ===========================================================
  // FAVORITES STORAGE
  // ===========================================================

  private loadFavorites(): void {

    try {

      const stored =
        localStorage.getItem(
          FAVORITES_STORAGE_KEY
        );

      if (!stored) return;

      const parsed: unknown =
        JSON.parse(stored);

      if (!Array.isArray(parsed)) {
        return;
      }

      parsed
        .filter(
          (id): id is string =>
            typeof id === 'string'
        )
        .forEach(
          id =>
            this.favoriteIds.add(id)
        );

    } catch (error) {

      console.error(
        'No se pudieron cargar los favoritos de Musex:',
        error
      );
    }
  }

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

  private restoreFavoriteState(): void {

    this.tracks.update(
      tracks =>
        tracks.map(track => ({
          ...track,
          favorite:
            this.favoriteIds.has(
              track.id
            )
        }))
    );
  }

  // ===========================================================
  // TRACKS
  // ===========================================================

  addTracks(
    newTracks: Track[]
  ): void {

    if (newTracks.length === 0) {
      return;
    }

    this.tracks.update(
      tracks => [
        ...tracks,

        ...newTracks.map(track => ({
          ...track,
          favorite:
            this.favoriteIds.has(
              track.id
            )
        }))
      ]
    );
  }

  removeTrack(
    trackId: string
  ): void {

    this.tracks.update(
      tracks =>
        tracks.filter(
          track =>
            track.id !== trackId
        )
    );

    this.favoriteIds.delete(
      trackId
    );

    this.saveFavorites();
  }

  clearLibrary(): void {
    this.tracks.set([]);
  }

  // ===========================================================
  // COVER
  // ===========================================================

  updateCover(
    trackId: string,
    cover: {
      coverType?: 'image' | 'icon';
      coverIcon?: string;
      coverColor?: string;

      /**
       * URL de Tauri generada a partir de la ruta
       * física de la portada.
       */
      image?: string;
    }
  ): void {

    this.tracks.update(
      tracks =>
        tracks.map(track => {

          if (track.id !== trackId) {
            return track;
          }

          return {
            ...track,

            coverType:
              cover.coverType,

            coverIcon:
              cover.coverType === 'icon'
                ? cover.coverIcon
                : undefined,

            coverColor:
              cover.coverType === 'icon'
                ? cover.coverColor
                : undefined,

            image:
              cover.coverType === 'image'
                ? (
                  cover.image ??
                  track.image
                )
                : track.image
          };
        })
    );

    this.saveCovers();
  }

  // ===========================================================
  // COVER STORAGE
  // ===========================================================

  /**
   * Guarda solamente la configuración visual de la portada.
   *
   * La imagen física NO se guarda en localStorage.
   */
  private saveCovers(): void {

    const overrides:
      Record<string, CoverOverride> = {};

    for (const track of this.tracks()) {

      if (!track.coverType) {
        continue;
      }

      overrides[track.id] = {

        coverType:
          track.coverType,

        coverIcon:
          track.coverIcon,

        coverColor:
          track.coverColor
      };
    }

    try {

      localStorage.setItem(
        COVERS_STORAGE_KEY,
        JSON.stringify(
          overrides
        )
      );

    } catch (error) {

      console.error(
        'No se pudo guardar la configuración de las portadas:',
        error
      );
    }
  }

  // ===========================================================
  // RECUPERAR CONFIGURACIÓN DE PORTADA
  // ===========================================================

  private getCoverOverride(
    trackId: string
  ): CoverOverride | undefined {

    try {

      const stored =
        localStorage.getItem(
          COVERS_STORAGE_KEY
        );

      if (!stored) {
        return undefined;
      }

      const overrides =
        JSON.parse(
          stored
        ) as Record<
          string,
          CoverOverride
        >;

      return overrides[trackId];

    } catch (error) {

      console.error(
        'No se pudo recuperar la configuración de la portada:',
        error
      );

      return undefined;
    }
  }

  // ===========================================================
  // SEARCH
  // ===========================================================

  searchTracks(
    query: string
  ): Track[] {

    const normalizedQuery =
      query
        .trim()
        .toLowerCase();

    if (!normalizedQuery) {
      return [];
    }

    return this.tracks().filter(
      track =>
        track.title
          .toLowerCase()
          .includes(normalizedQuery) ||

        track.artist
          .toLowerCase()
          .includes(normalizedQuery) ||

        track.album
          .toLowerCase()
          .includes(normalizedQuery) ||

        track.genre
          ?.toLowerCase()
          .includes(normalizedQuery)
    );
  }
}