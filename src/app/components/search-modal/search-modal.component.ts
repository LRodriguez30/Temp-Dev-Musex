import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  inject,
  signal
} from '@angular/core';

import { LibraryService } from '../../core/services/library.service';
import { PlayerService } from '../../core/services/player.service';
import { ModalService } from '../../core/services/modal.service';
import { Track } from '../../core/models/track.model';


interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  type: 'track';
  track: Track;
}


@Component({
  selector: 'app-search-modal',
  standalone: true,
  imports: [],
  templateUrl: './search-modal.component.html',
  styleUrl: './search-modal.component.css'
})
export class SearchModalComponent {

  // =========================================================
  // REFERENCIAS DEL DOM
  // =========================================================

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


  private readonly modalService =
    inject(ModalService);


  // =========================================================
  // ESTADO
  // =========================================================

  readonly searchQuery =
    signal('');


  readonly selectedSearchIndex =
    signal(-1);


  // =========================================================
  // RESULTADOS
  // =========================================================

  readonly filteredSearchResults =
    signal<SearchResult[]>([]);


  // =========================================================
  // INICIALIZACIÓN
  // =========================================================

  ngAfterViewInit(): void {

    /*
     * Cuando el componente aparece dentro del modal,
     * esperamos un ciclo para asegurarnos de que el input
     * exista y posteriormente le damos el foco.
     */

    setTimeout(() => {

      this.searchInput?.nativeElement.focus();

    });

  }


  // =========================================================
  // BÚSQUEDA
  // =========================================================

  updateSearch(query: string): void {

    this.searchQuery.set(query);


    const normalizedQuery =
      query
        .trim()
        .toLowerCase();


    /*
     * Si el usuario no ha escrito nada,
     * limpiamos los resultados.
     */

    if (!normalizedQuery) {

      this.filteredSearchResults.set([]);

      this.selectedSearchIndex.set(-1);

      return;

    }


    /*
     * Buscamos directamente en la biblioteca
     * administrada por LibraryService.
     */

    const tracks =
      this.libraryService.searchTracks(query);


    /*
     * Transformamos Track[] al modelo utilizado
     * por la interfaz del buscador.
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


    /*
     * Volvemos al principio de la lista
     * cuando cambia la búsqueda.
     */

    setTimeout(() => {

      this.searchResultsList
        ?.nativeElement
        .scrollTo({
          top: 0,
          behavior: 'smooth'
        });

    });

  }


  // =========================================================
  // NAVEGACIÓN
  // =========================================================

  handleSearchKeydown(
    event: KeyboardEvent
  ): void {

    const results =
      this.filteredSearchResults();


    // =======================================================
    // ABAJO
    // =======================================================

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


    // =======================================================
    // ARRIBA
    // =======================================================

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


    // =======================================================
    // ENTER
    // =======================================================

    if (event.key === 'Enter') {

      event.preventDefault();

      this.confirmSearch();

      return;

    }


    // =======================================================
    // ESC
    // =======================================================

    if (event.key === 'Escape') {

      event.preventDefault();

      this.close();

    }

  }


  // =========================================================
  // SELECCIÓN
  // =========================================================

  selectSearchResult(
    index: number
  ): void {

    this.selectedSearchIndex.set(index);

  }


  // =========================================================
  // SCROLL
  // =========================================================

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
  // CONFIRMAR BÚSQUEDA
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
     * El Track conserva su `path`, por lo que PlayerService
     * continúa utilizando la arquitectura actual de Musex.
     */

    console.log(
      'Musex search selected:',
      result.track
    );


    void this.playerService.playTrack(
      result.track.id
    );


    this.close();

  }


  // =========================================================
  // LIMPIAR
  // =========================================================

  clearRecentSearches(): void {

    this.filteredSearchResults.set([]);

    this.selectedSearchIndex.set(-1);

  }


  // =========================================================
  // CERRAR
  // =========================================================

  close(): void {

    this.modalService.close();

  }


  // =========================================================
  // ATAJOS
  // =========================================================

  @HostListener(
    'document:keydown',
    ['$event']
  )
  handleGlobalKeyboard(
    event: KeyboardEvent
  ): void {

    /*
     * El ModalComponent global ya controla Escape.
     *
     * No necesitamos volver a manejarlo aquí.
     *
     * Esta escucha queda únicamente para evitar que
     * eventos de teclado externos interfieran con el
     * buscador si posteriormente agregamos más atajos.
     */

  }

}