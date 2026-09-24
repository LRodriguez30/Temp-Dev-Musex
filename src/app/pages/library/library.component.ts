// =============================================================
// MUSEX - LIBRARY COMPONENT
// =============================================================
//
// Página principal de la biblioteca musical.
//
// LibraryService mantiene la colección musical y obtiene
// las canciones reales mediante el scanner de Rust.
//
// PlayerService se encarga exclusivamente de la reproducción.
//
// La página no mantiene una copia independiente de la biblioteca;
// consulta directamente el estado administrado por los servicios.
//
// Los favoritos son administrados y persistidos por LibraryService.
// =============================================================

import {
  Component,
  OnInit,
  inject
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { open } from '@tauri-apps/plugin-dialog';

import { LibraryService } from '../../core/services/library.service';
import { PlaylistService } from '../../core/services/playlist.service';
import { DownloadService } from '../../core/services/download.service';
import { PlayerService } from '../../core/services/player.service';
import { DownloadHistoryService } from '../../core/services/download-history.service';

import { MusicTableComponent } from '../../components/music-table/music-table.component';
import { DropZoneComponent } from '../../components/drop-zone/drop-zone.component';

import { Track } from '../../core/models/track.model';
import { ModalService } from '../../core/services/modal.service';

/**
 * Página principal de la biblioteca de Musex.
 */
@Component({
  selector: 'app-library',
  standalone: true,
  imports: [
    FormsModule,
    MusicTableComponent,
    DropZoneComponent
  ],
  templateUrl: './library.component.html',
  styleUrl: './library.component.css'
})
export class LibraryComponent implements OnInit {

  // ===========================================================
  // SERVICIOS
  // ===========================================================

  /**
   * Servicio encargado de administrar la biblioteca musical
   * y el estado persistente de favoritos.
   */
  readonly libraryService =
    inject(LibraryService);

  /**
   * Servicio encargado de administrar las playlists.
   */
  readonly playlistService =
    inject(PlaylistService);

  /**
   * Servicio encargado de administrar las descargas.
   */
  readonly downloadService =
    inject(DownloadService);

  /**
   * Servicio encargado de administrar el historial
   * de descargas.
   */
  private readonly downloadHistoryService =
    inject(DownloadHistoryService);

  /**
   * Servicio encargado de controlar la reproducción.
   */
  readonly playerService =
    inject(PlayerService);

  /**
   * Servicio encargado de controlar los modales
   * relacionados con las canciones.
   */
  private readonly modalService =
    inject(ModalService);


  // ===========================================================
  // MODALES
  // ===========================================================

  /**
   * Abre el menú de opciones de una canción.
   */
  openMore(track: Track): void {
    this.modalService.openTrackMenu(track.id);
  }

  /**
   * Abre el selector para agregar una canción
   * a una playlist.
   */
  openAddToPlaylist(track: Track): void {
    this.modalService.openAddToPlaylist(track.id);
  }


  // ===========================================================
  // ESTADO DE LA VISTA
  // ===========================================================

  /**
   * Orden actual aplicado a la biblioteca.
   */
  sortBy: 'title' | 'artist' | 'recent' = 'title';

  /**
   * Controla la visibilidad del menú personalizado
   * de ordenamiento.
   */
  sortMenuOpen = false;

  /**
   * Estado utilizado para evitar múltiples escaneos
   * simultáneos desde la interfaz.
   */
  scanning = false;

  /**
   * Estado utilizado durante la importación de archivos.
   */
  importing = false;

  /**
   * Error producido durante el último escaneo.
   */
  scanError: string | null = null;

  /**
   * Error producido durante la última importación.
   */
  importError: string | null = null;


  // ===========================================================
  // INICIALIZACIÓN
  // ===========================================================

  /**
   * Carga la biblioteca real al inicializar la página.
   */
  async ngOnInit(): Promise<void> {

    await this.scanLibrary();

    await this.downloadHistoryService.load();

    this.downloadService.restoreFromHistory(
      this.downloadHistoryService.entries()
    );
  }


  // ===========================================================
  // ORDENAMIENTO
  // ===========================================================

  /**
   * Alterna la visibilidad del menú de ordenamiento.
   */
  toggleSortMenu(): void {
    this.sortMenuOpen = !this.sortMenuOpen;
  }

  /**
   * Cambia el criterio de ordenamiento y cierra
   * inmediatamente el menú.
   */
  setSort(
    sort: 'title' | 'artist' | 'recent'
  ): void {

    this.sortBy = sort;
    this.sortMenuOpen = false;
  }


  // ===========================================================
  // BIBLIOTECA
  // ===========================================================

  /**
   * Canciones disponibles actualmente en la biblioteca.
   *
   * Se crea una copia para poder ordenar los resultados
   * sin modificar el estado interno de LibraryService.
   */
  get tracks(): Track[] {

    const tracks = [
      ...this.libraryService.library()
    ];

    switch (this.sortBy) {

      case 'artist':

        return tracks.sort(
          (a, b) =>
            a.artist.localeCompare(b.artist)
        );

      case 'recent':

        return tracks.reverse();

      case 'title':

      default:

        return tracks.sort(
          (a, b) =>
            a.title.localeCompare(b.title)
        );
    }
  }

  /**
   * Cantidad total de canciones disponibles.
   */
  get libraryCount(): number {
    return this.libraryService.getLibraryCount();
  }

  /**
   * Cantidad total de canciones marcadas como favoritas.
   */
  get favoriteCount(): number {
    return this.libraryService.getFavoriteCount();
  }

  /**
   * Cantidad de playlists disponibles.
   */
  get playlistCount(): number {
    return this.playlistService.getPlaylists().length;
  }

  /**
   * Cantidad de descargas completadas.
   */
  get downloadCount(): number {
    return this.downloadService.completed().length;
  }


  // ===========================================================
  // FAVORITOS
  // ===========================================================

  /**
   * Comprueba si una canción está marcada como favorita.
   *
   * La consulta se delega completamente a LibraryService.
   */
  isFavorite(trackId: string): boolean {
    return this.libraryService.isFavorite(trackId);
  }

  /**
   * Alterna el estado de favorito de una canción.
   *
   * LibraryService actualiza el estado reactivo y además
   * persiste el cambio para conservarlo al cerrar Musex.
   */
  toggleFavorite(trackId: string): void {
    this.libraryService.toggleFavorite(trackId);
  }


  // ===========================================================
  // ESCANEO
  // ===========================================================

  /**
   * Escanea nuevamente la biblioteca musical.
   */
  async scanLibrary(): Promise<void> {

    if (this.scanning) {
      return;
    }

    this.scanning = true;
    this.scanError = null;

    try {

      await this.libraryService.scanLibrary();

      console.log(
        'Biblioteca de Musex actualizada correctamente.'
      );

    } catch (error) {

      console.error(
        'No se pudo actualizar la biblioteca de Musex:',
        error
      );

      this.scanError =
        'No se pudo cargar la biblioteca musical.';

    } finally {

      this.scanning = false;
    }
  }


  // ===========================================================
  // REPRODUCCIÓN
  // ===========================================================

  /**
   * Reproduce una canción seleccionada desde la biblioteca.
   */
  playTrack(track: Track): void {
    void this.playerService.playTrack(track.id);
  }


  // ===========================================================
  // IMPORTACIÓN
  // ===========================================================

  /**
   * Abre el selector nativo de archivos de Tauri.
   *
   * El diálogo devuelve las rutas físicas de los archivos
   * seleccionados, que posteriormente serán enviadas a Rust.
   */
  async selectMusicFiles(): Promise<void> {

    console.log(
      '1. Entró a selectMusicFiles()'
    );

    if (this.importing) {

      console.log(
        '2. Importación bloqueada'
      );

      return;
    }

    try {

      console.log(
        '3. Antes de abrir diálogo'
      );

      const selected = await open({
        multiple: true,
        directory: false,

        filters: [
          {
            name: 'Audio',

            extensions: [
              'mp3',
              'wav',
              'flac',
              'ogg',
              'm4a',
              'aac',
              'opus'
            ]
          }
        ]
      });

      console.log(
        '4. Resultado del diálogo:',
        selected
      );

      if (!selected) {
        return;
      }

      const paths = Array.isArray(selected)
        ? selected
        : [selected];

      console.log(
        '5. Rutas seleccionadas:',
        paths
      );

      await this.importTracks(paths);

    } catch (error) {

      console.error(
        'ERROR AL ABRIR/USAR EL DIÁLOGO:',
        error
      );

      this.importError =
        'No se pudieron seleccionar los archivos de música.';
    }
  }

  /**
   * Envía las rutas físicas seleccionadas hacia Rust.
   *
   * LibraryService se encarga de invocar el comando Tauri
   * y actualizar posteriormente la biblioteca.
   */
  async importTracks(paths: string[]): Promise<void> {

    if (
      paths.length === 0 ||
      this.importing
    ) {
      return;
    }

    this.importing = true;
    this.importError = null;

    try {

      await this.libraryService.importTracks(paths);

      console.log(
        `${paths.length} archivo(s) importado(s) correctamente.`
      );

    } catch (error) {

      console.error(
        'No se pudieron importar los archivos:',
        error
      );

      this.importError =
        'No se pudieron importar los archivos seleccionados.';

    } finally {

      this.importing = false;
    }
  }


  // ===========================================================
  // DROP ZONE
  // ===========================================================

  /**
   * Mantiene temporalmente compatibilidad con el DropZone actual.
   *
   * La implementación definitiva del arrastre deberá entregar
   * rutas físicas de Tauri en lugar de objetos File del navegador.
   */
  importFiles(files: File[]): void {

    if (files.length === 0) {
      return;
    }

    console.info(
      'Archivos seleccionados para importación:',
      files
    );
  }

  /**
   * Mantiene compatibilidad con el input de archivos actual.
   *
   * El selector principal de Musex utiliza ahora el diálogo
   * nativo de Tauri mediante selectMusicFiles().
   */
  handleFileSelection(
    files: FileList | null
  ): void {

    if (!files || files.length === 0) {
      return;
    }

    this.importFiles(
      Array.from(files)
    );
  }
}