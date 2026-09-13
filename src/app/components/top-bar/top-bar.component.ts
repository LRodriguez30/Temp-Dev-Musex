import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  inject,
  signal
} from '@angular/core';

import { LibraryService } from '../../core/services/library.service';
import { Track } from '../../core/models/track.model';
import { PlayerService } from '../../core/services/player.service';

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  type: 'track';
  track: Track;
}

@Component({
  selector: 'app-top-bar',
  standalone: true,
  imports: [],
  templateUrl: './top-bar.component.html',
  styleUrl: './top-bar.component.css'
})
export class TopBarComponent {

  @ViewChild('searchInput')
  private searchInput?: ElementRef<HTMLInputElement>;

  @ViewChild('searchResultsList')
  private searchResultsList?: ElementRef<HTMLDivElement>;

  // =========================================================
  // SERVICIOS
  // =========================================================

  private readonly libraryService =
    inject(LibraryService);

  private readonly playerService = 
    inject(PlayerService);


  // =========================================================
  // ESTADO
  // =========================================================

  readonly searchOpen = signal(false);

  readonly userMenuOpen = signal(false);

  readonly searchQuery = signal('');

  readonly selectedSearchIndex = signal(-1);


  // =========================================================
  // RESULTADOS
  // =========================================================

  readonly filteredSearchResults =
    signal<SearchResult[]>([]);


  // =========================================================
  // BÚSQUEDA
  // =========================================================

  openSearch(): void {

    this.userMenuOpen.set(false);

    this.searchOpen.set(true);

    this.searchQuery.set('');

    this.filteredSearchResults.set([]);

    this.selectedSearchIndex.set(-1);


    /*
     * Esperamos al siguiente ciclo para que Angular
     * haya creado el input antes de darle el foco.
     */

    setTimeout(() => {

      this.searchInput?.nativeElement.focus();

    });

  }


  closeSearch(): void {

    this.searchOpen.set(false);

    this.searchQuery.set('');

    this.filteredSearchResults.set([]);

    this.selectedSearchIndex.set(-1);

  }


  updateSearch(query: string): void {

    this.searchQuery.set(query);

    const normalizedQuery = query
      .trim()
      .toLowerCase();


    /*
     * Si no hay búsqueda, no mostramos resultados.
     */

    if (!normalizedQuery) {

      this.filteredSearchResults.set([]);

      this.selectedSearchIndex.set(-1);

      return;

    }


    /*
     * Buscamos directamente sobre la biblioteca
     * real administrada por LibraryService.
     */

    const tracks =
      this.libraryService.searchTracks(query);


    /*
     * Transformamos Track[] al modelo que utiliza
     * actualmente el modal de búsqueda.
     */

    const results: SearchResult[] =
      tracks.map(track => ({

        id: track.id,

        title: track.title,

        subtitle:
          `${track.artist} · ${track.album}`,

        type: 'track',

        track

      }));


    this.filteredSearchResults.set(results);

    this.selectedSearchIndex.set(
      results.length > 0
        ? 0
        : -1
    );

    setTimeout(() => {

      this.searchResultsList
        ?.nativeElement
        .scrollTo({
          top: 0,
          behavior: 'smooth'
        });

    });
  }


  private scrollToSelectedResult(): void {

    const index =
      this.selectedSearchIndex();

    if (index < 0) {
      return;
    }

    const element =
      document.getElementById(
        `search-result-${index}`
      );

    if (!element) {
      return;
    }

    element.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });

  }

  // =========================================================
  // NAVEGACIÓN DE BÚSQUEDA
  // =========================================================

  handleSearchKeydown(event: KeyboardEvent): void {

    const results =
      this.filteredSearchResults();


    // =========================================================
    // ABAJO
    // =========================================================

    if (event.key === 'ArrowDown') {

      event.preventDefault();

      if (results.length === 0) {
        return;
      }

      const currentIndex =
        this.selectedSearchIndex();

      const nextIndex =
        currentIndex < results.length - 1
          ? currentIndex + 1
          : 0;

      this.selectedSearchIndex.set(
        nextIndex
      );

      setTimeout(() => {
        this.scrollToSelectedResult();
      });

      return;
    }


    // =========================================================
    // ARRIBA
    // =========================================================

    if (event.key === 'ArrowUp') {

      event.preventDefault();

      if (results.length === 0) {
        return;
      }

      const currentIndex =
        this.selectedSearchIndex();

      const previousIndex =
        currentIndex > 0
          ? currentIndex - 1
          : results.length - 1;

      this.selectedSearchIndex.set(
        previousIndex
      );

      setTimeout(() => {
        this.scrollToSelectedResult();
      });

      return;
    }


    // =========================================================
    // ENTER
    // =========================================================

    if (event.key === 'Enter') {

      event.preventDefault();

      this.confirmSearch();

      return;
    }


    // =========================================================
    // ESC
    // =========================================================

    if (event.key === 'Escape') {

      event.preventDefault();

      this.closeSearch();

    }

  }


  selectSearchResult(index: number): void {

    this.selectedSearchIndex.set(index);

  }


  // =========================================================
  // SELECCIÓN
  // =========================================================

  confirmSearch(): void {

    const index =
      this.selectedSearchIndex();

    const results =
      this.filteredSearchResults();


    if (
      index < 0 ||
      index >= results.length
    ) {
      return;
    }


    const result =
      results[index];


    /*
     * Ya tenemos el Track real de la biblioteca.
     *
     * Aquí conectaremos posteriormente:
     *
     * - PlayerService → reproducir ahora
     * - QueueService  → añadir a cola
     *
     * El Track conserva su `path`, por lo que la
     * reproducción seguirá utilizando la arquitectura
     * actual de Musex/Tauri.
     */

    console.log(
      'Musex search selected:',
      result.track
    );

    void this.playerService.playTrack(result.track.id);

    this.closeSearch();

  }


  // =========================================================
  // LIMPIAR BÚSQUEDA
  // =========================================================

  clearRecentSearches(): void {

    this.filteredSearchResults.set([]);

    this.selectedSearchIndex.set(-1);

  }


  // =========================================================
  // MENÚ DE PERFIL
  // =========================================================

  toggleUserMenu(): void {

    this.searchOpen.set(false);

    this.userMenuOpen.update(
      open => !open
    );

  }


  // =========================================================
  // ATAJOS GLOBALES
  // =========================================================

  @HostListener(
    'document:keydown',
    ['$event']
  )
  handleKeyboard(event: KeyboardEvent): void {

    /*
     * Ctrl + K
     *
     * Windows / Linux:
     * Ctrl + K
     *
     * macOS:
     * Cmd + K
     */

    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'k'
    ) {

      event.preventDefault();

      this.openSearch();

      return;

    }


    /*
     * Escape cierra primero la búsqueda
     * y después el menú de perfil.
     */

    if (event.key === 'Escape') {

      if (this.searchOpen()) {

        this.closeSearch();

        return;

      }


      if (this.userMenuOpen()) {

        this.userMenuOpen.set(false);

      }

    }

  }

}