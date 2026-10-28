import { 
  Component, 
  OnInit, 
  computed, 
  inject, 
  signal 
} from '@angular/core'; 
 
import { Track } from '../../core/models/track.model'; 
import { LibraryService } from '../../core/services/library.service'; 
import { PlayerService } from '../../core/services/player.service'; 
import { ModalService } from '../../core/services/modal.service'; 
 
import { 
  EqualizerService, 
  EqTrack 
} from '../../core/services/equalizer.service'; 
 
import { SenseService } from '../../core/services/sense.service'; 
 
 
@Component({ 
  selector: 'app-equalizer', 
  standalone: true, 
  imports: [], 
  templateUrl: './equalizer.component.html', 
  styleUrl: './equalizer.component.css', 
}) 
export class EqualizerComponent implements OnInit { 
 
 
  // ========================================================= 
  // SERVICIOS 
  // ========================================================= 
 
  private readonly libraryService = 
    inject(LibraryService); 
 
  readonly playerService = 
    inject(PlayerService); 
 
  private readonly modalService = 
    inject(ModalService); 
 
  readonly eqService = 
    inject(EqualizerService); 
 
  private readonly sense = 
    inject(SenseService); 
 
 
  // ========================================================= 
  // UI STATE 
  // ========================================================= 
 
  readonly isRefreshing = 
    signal(false); 
 
  /** 
   * Texto utilizado para buscar canciones. 
   */ 
  readonly searchQuery = 
    signal(''); 
 
  /** 
   * Filtro aplicado a la biblioteca. 
   * 
   * all: 
   *   Todas las canciones. 
   * 
   * enabled: 
   *   Solo canciones habilitadas para EQ. 
   * 
   * disabled: 
   *   Solo canciones no habilitadas para EQ. 
   */ 
  readonly libraryFilter = 
    signal<'all' | 'enabled' | 'disabled'>('all'); 
 
  /** 
   * Orden aplicado a las canciones. 
   */ 
  readonly sortBy = 
    signal<'title' | 'artist' | 'recent'>('title'); 
 
  /** 
   * Estado del menú desplegable de ordenamiento. 
   */ 
  readonly sortMenuOpen = 
    signal(false); 
 
 
  // ========================================================= 
  // SENSE 
  // ========================================================= 
 
  /** 
   * Estado persistido de Sense. 
   * 
   * SenseService es la única fuente de verdad. 
   */ 
  readonly senseSettings = 
    this.sense.settings; 
 
  /** 
   * Indica si Sense global está disponible. 
   * 
   * Cuando Sense está deshabilitado no se puede 
   * activar ni desactivar el asistente de EQ desde 
   * esta pantalla. 
   */ 
  readonly senseGlobalEnabled = 
    computed(() => 
      this.senseSettings().enabled 
    ); 
 
  /** 
   * Estado visible del asistente de ecualización 
   * de Sense. 
   * 
   * El asistente solamente se considera activo cuando 
   * Sense global también está habilitado. 
   */ 
  readonly senseEnabled = 
    computed(() => 
      this.senseGlobalEnabled() && 
      this.senseSettings().capabilities.eqAssistant 
    ); 
 
  /** 
   * Indica si el botón del asistente de EQ 
   * puede ser modificado desde esta pantalla. 
   */ 
  readonly canToggleSense = 
    computed(() => 
      this.senseGlobalEnabled() 
    ); 
 
 
  // ========================================================= 
  // LIBRARY 
  // ========================================================= 
 
  /** 
   * Biblioteca real de Musex. 
   */ 
  readonly libraryTracks = 
    computed<Track[]>(() => 
      this.libraryService.tracks() 
    ); 
 
 
  /** 
   * Biblioteca filtrada y ordenada. 
   */ 
  readonly filteredLibraryTracks = 
    computed<Track[]>(() => { 
 
      const query = 
        this.searchQuery() 
          .trim() 
          .toLocaleLowerCase(); 
 
      const filter = 
        this.libraryFilter(); 
 
      const tracks = 
        this.libraryTracks() 
          .filter(track => { 
 
            if (filter === 'enabled') { 
 
              return this.isEnabled( 
                track 
              ); 
            } 
 
            if (filter === 'disabled') { 
 
              return !this.isEnabled( 
                track 
              ); 
            } 
 
            return true; 
          }) 
          .filter(track => { 
 
            if (!query) { 
              return true; 
            } 
 
            return [ 
              track.title, 
              track.artist, 
              track.album, 
              track.genre 
            ] 
              .filter(Boolean) 
              .some(value => 
                value! 
                  .toLocaleLowerCase() 
                  .includes(query) 
              ); 
          }); 
 
      return this.sortTracks( 
        tracks 
      ); 
    }); 
 
 
  // ========================================================= 
  // EQUALIZER TRACKS 
  // ========================================================= 
 
  /** 
   * Canciones actualmente habilitadas 
   * para ecualización. 
   */ 
  readonly eqTracks = 
    this.eqService.eqTracks; 
 
  readonly hasEnabledTracks = 
    this.eqService.hasEnabledTracks; 
 
 
  /** 
   * Canciones habilitadas para EQ 
   * filtradas mediante la búsqueda. 
   */ 
  readonly filteredEqTracks = 
    computed<EqTrack[]>(() => { 
 
      const query = 
        this.searchQuery() 
          .trim() 
          .toLocaleLowerCase(); 
 
      const tracks = 
        this.eqTracks() 
          .filter(track => { 
 
            if (!query) { 
              return true; 
            } 
 
            return [ 
              track.title, 
              track.artist, 
              track.album, 
              track.genre 
            ] 
              .filter(Boolean) 
              .some(value => 
                value! 
                  .toLocaleLowerCase() 
                  .includes(query) 
              ); 
          }); 
 
      return this.sortTracks( 
        tracks 
      ); 
    }); 
 
 
  /** 
   * Indica si existen canciones EQ 
   * después de aplicar la búsqueda. 
   */ 
  readonly hasFilteredEqTracks = 
    computed(() => 
      this.filteredEqTracks().length > 0 
    ); 
 
 
  // ========================================================= 
  // INITIALIZATION 
  // ========================================================= 
 
  async ngOnInit(): Promise<void> { 
 
    try { 
 
      /* 
       * Cargamos el estado persistido de Sense. 
       * 
       * Esto garantiza que senseEnabled() 
       * represente el estado real guardado. 
       */ 
      await this.sense.ensureLoaded(); 
 
 
      /* 
       * Primero cargamos la biblioteca real. 
       */ 
      await this.libraryService.scanLibrary(); 
 
 
      /* 
       * Después sincronizamos los archivos temporales 
       * con la biblioteca. 
       */ 
      await this.syncEqualizerTracks(); 
 
    } catch (error) { 
 
      console.error( 
        'No se pudo inicializar el ecualizador:', 
        error 
      ); 
 
    } 
 
  } 
 
 
  // ========================================================= 
  // SEARCH / FILTER / SORT 
  // ========================================================= 
 
  /** 
   * Actualiza el texto de búsqueda. 
   */ 
  setSearchQuery( 
    value: string 
  ): void { 
 
    this.searchQuery.set( 
      value 
    ); 
  } 
 
 
  /** 
   * Cambia el filtro de la biblioteca. 
   */ 
  setLibraryFilter( 
    filter: 'all' | 'enabled' | 'disabled' 
  ): void { 
 
    this.libraryFilter.set( 
      filter 
    ); 
  } 
 
 
  /** 
   * Cambia el orden de las canciones. 
   */ 
  setSort( 
    sort: 'title' | 'artist' | 'recent' 
  ): void { 
 
    this.sortBy.set( 
      sort 
    ); 
 
    this.sortMenuOpen.set( 
      false 
    ); 
 
  } 
 
 
  /** 
   * Limpia la búsqueda. 
   */ 
  clearSearch(): void { 
 
    this.searchQuery.set(''); 
  } 
 
 
  /** 
   * Ordena una colección de canciones. 
   */ 
  private sortTracks<T extends Track>( 
    tracks: T[] 
  ): T[] { 
 
    const sorted = 
      [...tracks]; 
 
    switch (this.sortBy()) { 
 
      case 'artist': 
 
        return sorted.sort( 
          (a, b) => 
            (a.artist || '') 
              .localeCompare( 
                b.artist || '' 
              ) 
        ); 
 
      case 'recent': 
 
        return sorted.sort( 
          (a, b) => 
            (b.addedAt || '') 
              .localeCompare( 
                a.addedAt || '' 
              ) 
        ); 
 
      case 'title': 
 
      default: 
 
        return sorted.sort( 
          (a, b) => 
            (a.title || '') 
              .localeCompare( 
                b.title || '' 
              ) 
        ); 
 
    } 
  } 
 
 
  // ========================================================= 
  // SENSE 
  // ========================================================= 
 
  /** 
   * Activa o desactiva el asistente de ecualización 
   * de Sense. 
   * 
   * Esta acción solamente está disponible cuando 
   * Sense global está habilitado. 
   */ 
  async toggleSense(): Promise<void> { 
 
    if (!this.canToggleSense()) { 
      return; 
    } 
 
    try { 
 
      await this.sense.toggleCapability( 
        'eq_assistant' 
      ); 
 
    } catch (error) { 
 
      console.error( 
        'No se pudo cambiar el estado del asistente de ecualización de Sense:', 
        error 
      ); 
 
    } 
 
  } 
 
 
  // ========================================================= 
  // TEMP + EQUALIZER 
  // ========================================================= 
 
  /** 
   * Sincroniza los archivos temporales de EQ 
   * con la biblioteca real. 
   */ 
  private async syncEqualizerTracks(): Promise<void> { 
 
    await this.libraryService.scanTemp(); 
 
    const tracks = 
      this.libraryService.getTracks(); 
 
    await this.eqService.refreshFromDisk( 
      tracks 
    ); 
 
  } 
 
 
  // ========================================================= 
  // REFRESH 
  // ========================================================= 
 
  async refreshTracks(): Promise<void> { 
 
    if (this.isRefreshing()) { 
      return; 
    } 
 
    this.isRefreshing.set( 
      true 
    ); 
 
    const startedAt = 
      performance.now(); 
 
    const minimumLoadingTime = 
      280; 
 
    try { 
 
      await this.libraryService.scanLibrary(); 
 
      await this.syncEqualizerTracks(); 
 
    } catch (error) { 
 
      console.error( 
        'No se pudo sincronizar el estado del ecualizador:', 
        error 
      ); 
 
    } finally { 
 
      const elapsed = 
        performance.now() - 
        startedAt; 
 
      const remaining = 
        Math.max( 
          0, 
          minimumLoadingTime - 
          elapsed 
        ); 
 
      if (remaining > 0) { 
 
        await new Promise<void>( 
          resolve => 
            setTimeout( 
              resolve, 
              remaining 
            ) 
        ); 
 
      } 
 
      this.isRefreshing.set( 
        false 
      ); 
 
    } 
 
  } 
 
 
  // ========================================================= 
  // NORMAL PLAYBACK 
  // ========================================================= 
 
  async playTrack( 
    track: Track 
  ): Promise<void> { 
 
    try { 
 
      await this.eqService.playTrack( 
        track 
      ); 
 
    } catch (error) { 
 
      console.error( 
        'No se pudo reproducir la pista:', 
        error 
      ); 
 
    } 
 
  } 
 
 
  isTrackPlaying( 
    track: Track 
  ): boolean { 
 
    const state = 
      this.playerService.state(); 
 
    return ( 
      state.playing && 
      state.currentTrackId === track.id 
    ); 
 
  } 
 
 
  // ========================================================= 
  // ENABLE / DISABLE EQ 
  // ========================================================= 
 
  async enableForEq( 
    track: Track 
  ): Promise<void> { 
 
    try { 
 
      await this.eqService.enableForEq( 
        track 
      ); 
 
      await this.syncEqualizerTracks(); 
 
    } catch (error) { 
 
      console.error( 
        'No se pudo habilitar la canción para ecualización:', 
        error 
      ); 
 
    } 
 
  } 
 
 
  async disableFromEq( 
    track: EqTrack 
  ): Promise<void> { 
 
    try { 
 
      await this.eqService.disableFromEq( 
        track 
      ); 
 
      await this.syncEqualizerTracks(); 
 
    } catch (error) { 
 
      console.error( 
        'No se pudo quitar la canción de ecualización:', 
        error 
      ); 
 
    } 
 
  } 
 
 
  // ========================================================= 
  // EQ EDITOR 
  // ========================================================= 
 
  async openEditor( 
    track: EqTrack 
  ): Promise<void> { 
 
    try { 
 
      this.modalService.openEqualizerEditor( 
        track.id 
      ); 
 
      await this.eqService.openEditor( 
        track 
      ); 
 
    } catch (error) { 
 
      console.error( 
        'No se pudo abrir el editor de ecualización:', 
        error 
      ); 
 
    } 
 
  } 
 
 
  // ========================================================= 
  // ENABLED STATE 
  // ========================================================= 
 
  isEnabled( 
    track: Track 
  ): boolean { 
 
    return this.eqService.isEnabled( 
      track 
    ); 
 
  } 
 
 
  // ========================================================= 
  // FORMATTERS 
  // ========================================================= 
 
  formatDuration( 
    duration: number | undefined | null 
  ): string { 
 
    if ( 
      duration === undefined || 
      duration === null || 
      !Number.isFinite(duration) 
    ) { 
 
      return '--:--'; 
 
    } 
 
    const totalSeconds = 
      Math.max( 
        0, 
        Math.floor(duration) 
      ); 
 
    const minutes = 
      Math.floor( 
        totalSeconds / 60 
      ); 
 
    const seconds = 
      totalSeconds % 
      60; 
 
    return ( 
      `${minutes}:${seconds 
        .toString() 
        .padStart(2, '0')}` 
    ); 
 
  } 
 
} 