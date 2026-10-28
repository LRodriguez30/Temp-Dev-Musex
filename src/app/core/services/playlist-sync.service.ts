import {
  Injectable,
  effect,
  inject,
  signal
} from '@angular/core';

import { invoke } from '@tauri-apps/api/core';

import {
  IS_ANDROID,
  fetchRemoteFavorites,
  fetchRemotePlaylists,
  getRemote
} from '../platform/invoke';

import { Playlist } from '../models/playlist.model';

import { LibraryService } from './library.service';
import { PlaylistService } from './playlist.service';
import { RemoteDevicesService } from './remote-devices.service';

/** Imágenes en base64 mayores a este tamaño no viajan al móvil. */
const MAX_INLINE_IMAGE = 200_000;

/** Tiempo mínimo entre sincronizaciones automáticas (Android). */
const AUTO_SYNC_INTERVAL_MS = 30_000;

/**
 * Sincroniza playlists y favoritos entre Musex de escritorio y
 * el móvil. El escritorio es la única fuente de verdad.
 *
 * Escritorio:
 *   cada vez que cambian las playlists o los favoritos, los
 *   entrega al servidor de streaming (Rust) para que el móvil
 *   pueda pedirlos.
 *
 * Android:
 *   al abrir la app, al volver a ella y cuando se pide
 *   manualmente, descarga ambos y los guarda localmente.
 */
@Injectable({
  providedIn: 'root'
})
export class PlaylistSyncService {

  private readonly playlistService = inject(PlaylistService);

  private readonly libraryService = inject(LibraryService);

  /** Se crea antes que nada: restaura el equipo activo. */
  private readonly devices = inject(RemoteDevicesService);

  readonly syncing = signal(false);

  readonly lastError = signal('');

  private lastSyncAt = 0;

  constructor() {

    if (IS_ANDROID) {

      void this.pull();

      document.addEventListener('visibilitychange', () => {

        if (
          !document.hidden &&
          Date.now() - this.lastSyncAt > AUTO_SYNC_INTERVAL_MS
        ) {
          void this.pull();
        }
      });

      return;
    }

    // ---------------------------------------------------------
    // ESCRITORIO — playlists
    // ---------------------------------------------------------

    effect(() => {

      const playlists =
        this.playlistService.allPlaylists();

      void this.push(
        'set_stream_playlists',
        playlists.map(playlist =>
          this.toShareable(playlist)
        )
      );
    });

    // ---------------------------------------------------------
    // ESCRITORIO — favoritos
    // ---------------------------------------------------------

    effect(() => {

      const favoriteIds =
        this.libraryService
          .getFavorites()
          .map(track => track.id);

      void this.push(
        'set_stream_favorites',
        favoriteIds
      );
    });
  }

  /**
   * Descarga playlists y favoritos del escritorio (solo Android).
   * Devuelve cuántas playlists recibió.
   */
  async pull(): Promise<number> {

    if (!IS_ANDROID || !this.devices.activeDevice() || !getRemote()) {
      return 0;
    }

    this.syncing.set(true);
    this.lastError.set('');

    try {

      const [playlists, favorites] = await Promise.all([
        fetchRemotePlaylists(),
        fetchRemoteFavorites()
      ]);

      this.playlistService.replaceRemotePlaylists(playlists);

      this.libraryService.replaceRemoteFavorites(favorites);

      this.lastSyncAt = Date.now();

      return playlists.length;

    } catch {

      this.lastError.set(
        'No se pudo conectar con Musex de escritorio.'
      );

      return 0;

    } finally {

      this.syncing.set(false);
    }
  }

  private push(
    command: 'set_stream_playlists' | 'set_stream_favorites',
    data: unknown
  ): Promise<void> {

    return invoke<void>(
      command,
      { json: JSON.stringify(data) }
    ).catch(() => {
      /* Sin backend de Tauri (por ejemplo, ng serve en el navegador). */
    });
  }

  /**
   * Las rutas de imagen del escritorio (asset://) no existen en el
   * teléfono. Solo viajan las imágenes incrustadas (base64) y pequeñas;
   * el resto se reemplaza por un icono.
   */
  private toShareable(playlist: Playlist): Playlist {

    const image = playlist.image ?? '';

    const keepImage =
      playlist.coverType === 'image' &&
      image.startsWith('data:') &&
      image.length <= MAX_INLINE_IMAGE;

    if (playlist.coverType !== 'image' || keepImage) {
      return {
        ...playlist,
        image: keepImage ? image : ''
      };
    }

    return {
      ...playlist,
      image: '',
      coverType: 'icon',
      coverIcon: playlist.coverIcon ?? 'music',
      coverColor: playlist.coverColor
    };
  }
}