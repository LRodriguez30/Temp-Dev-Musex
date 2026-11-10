import { 
  Component, 
  EventEmitter, 
  inject, 
  Input, 
  Output,
  ChangeDetectorRef,
  computed,
  signal
} from '@angular/core'; 
 
import { Track } from '../../core/models/track.model'; 
import { PlayerService } from '../../core/services/player.service'; 
import { LibraryService } from '../../core/services/library.service';
import { NotificationService } from '../../core/services/notification.service';
import { QueueService } from '../../core/services/queue.service';
import { RowProgressComponent } from './row-progress.component'; 
import { IS_ANDROID } from '@tauri-apps/api/core';
 
 
/** 
 * Tabla reutilizable para mostrar colecciones de canciones. 
 * 
 * El componente presenta las canciones y comunica las acciones 
 * realizadas por el usuario. 
 * 
 * La reproducción y la gestión de los datos permanecen fuera 
 * del componente para mantenerlo reutilizable. 
 * 
 * Los modales de metadata y playlists no pertenecen a este 
 * componente. Las acciones correspondientes se emiten mediante 
 * eventos para que MainLayout pueda controlar los overlays 
 * globales. 
 */ 
@Component({ 
  selector: 'app-music-table', 
  standalone: true, 
  imports: [RowProgressComponent],
  templateUrl: './music-table.component.html', 
  styleUrl: './music-table.component.css' 
}) 
export class MusicTableComponent { 
 
  readonly isAndroid = IS_ANDROID;
 
  /* ============================================================= 
     INPUTS 
     ============================================================= */ 
 
  /** 
   * Canciones que serán mostradas en la tabla. 
   */ 
  @Input() 
  tracks: Track[] = []; 
 
 
  /* ============================================================= 
     OUTPUTS 
     ============================================================= */ 
 
  /** 
   * Evento emitido cuando el usuario solicita reproducir 
   * o pausar una canción. 
   */ 
  @Output() 
  play = new EventEmitter<{ 
    track: Track; 
    action: 'play' | 'pause'; 
  }>(); 
 
 
  /** 
   * Evento emitido cuando el usuario abre las opciones 
   * de una canción. 
   * 
   * MainLayout utiliza este evento para abrir el modal 
   * global de metadata. 
   */ 
  @Output() 
  more = new EventEmitter<Track>(); 
 
 
  /** 
   * Evento emitido cuando el usuario solicita agregar 
   * una sola canción a una playlist. 
   * 
   * Se mantiene para conservar el comportamiento actual. 
   */ 
  @Output() 
  addToPlaylist = new EventEmitter<Track>(); 
 
 
  /** 
   * Evento emitido cuando el usuario solicita agregar 
   * varias canciones a una playlist. 
   * 
   * El componente padre recibe todas las canciones 
   * seleccionadas para abrir el selector de playlists. 
   */ 
  @Output() 
  addSelectedToPlaylist = new EventEmitter<Track[]>(); 


  /**
   * Muestra las acciones de "quitar de la playlist"
   * (fila y barra de selección). Solo se activa desde
   * el detalle de una playlist editable.
   */
  @Input()
  removable = false;


  /**
   * Evento emitido al quitar una sola canción
   * de la playlist actual.
   */
  @Output()
  removeTrack = new EventEmitter<Track>();


  /**
   * Evento emitido al quitar varias canciones
   * seleccionadas de la playlist actual.
   */
  @Output()
  removeSelected = new EventEmitter<Track[]>();
 
 
  /* ============================================================= 
     SERVICES 
     ============================================================= */ 
 
  /** 
   * Servicio principal del reproductor. 
   */ 
  readonly playerService = inject(PlayerService); 
 
 
  /** 
   * Servicio encargado de gestionar la biblioteca y favoritos. 
   */ 
  private readonly libraryService = inject(LibraryService); 
 
 
  /* ============================================================= 
     SELECCIÓN 
     ============================================================= */ 
 
  /** 
   * IDs de las canciones seleccionadas. 
   * 
   * Se utilizan IDs para evitar depender de referencias 
   * de objetos Track. 
   */ 
  private selectedTrackIds = new Set<string>(); 
 
 
  /** 
   * Cantidad de canciones seleccionadas. 
   */ 
  get selectedCount(): number { 
    return this.selectedTrackIds.size; 
  } 
 
 
  /** 
   * Indica si existe al menos una canción seleccionada. 
   */ 
  get hasSelection(): boolean { 
    return this.selectedTrackIds.size > 0; 
  } 
 
 
  /** 
   * Indica si todas las canciones visibles están seleccionadas. 
   */ 
  get allTracksSelected(): boolean { 
 
    if (this.tracks.length === 0) { 
      return false; 
    } 
 
    return this.tracks.every(track => 
      this.selectedTrackIds.has(track.id) 
    ); 
  } 
 
 
  /** 
   * Indica si una canción está seleccionada. 
   */ 
  isTrackSelected(track: Track): boolean { 
    return this.selectedTrackIds.has(track.id); 
  } 
 
 
  /** 
   * Alterna la selección de una canción. 
   */ 
  toggleTrackSelection(track: Track): void { 
 
    if (this.selectedTrackIds.has(track.id)) { 
 
      this.selectedTrackIds.delete(track.id); 
 
    } else { 
 
      this.selectedTrackIds.add(track.id); 
 
    } 
  } 
 
 
  /** 
   * Selecciona o deselecciona todas las canciones visibles. 
   */ 
  toggleSelectAll(): void { 
 
    if (this.allTracksSelected) { 
 
      for (const track of this.tracks) { 
        this.selectedTrackIds.delete(track.id); 
      } 
 
      return; 
    } 
 
    for (const track of this.tracks) { 
      this.selectedTrackIds.add(track.id); 
    } 
  } 
 
 
  /** 
   * Limpia toda la selección. 
   */ 
  clearSelection(): void { 
    this.selectedTrackIds.clear(); 
  } 

  /* =============================================================
     MÓVIL (Android)
     -------------------------------------------------------------
     La lista táctil no tiene columna de casillas:
       - pulsación larga  → modo de selección
       - deslizar →       → favorita
       - deslizar ←       → agregar a la cola
     ============================================================= */

  private readonly cdr = inject(ChangeDetectorRef);
  private readonly queueService = inject(QueueService);
  private readonly notifications = inject(NotificationService);

  /** Modo de selección activado desde el botón "Seleccionar". */
  selectionMode = false;

  /** Detallada (todos los datos) o compacta (más canciones por pantalla). */
  readonly density = signal<'detailed' | 'compact'>(
    (localStorage.getItem('musex_list_density') as 'detailed' | 'compact' | null)
    ?? 'detailed'
  );

  /** Pista de gestos: se muestra una vez. */
  readonly hintVisible = signal(
    localStorage.getItem('musex_list_hint') !== 'done'
  );

  private static readonly SWIPE_THRESHOLD = 88;
  private static readonly SWIPE_MAX = 132;

  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressed = false;

  private pressTrack: Track | null = null;
  private startX = 0;
  private startY = 0;
  private swiping = false;
  private armed = false;
  private swipeDx = 0;
  private swipeRow: HTMLElement | null = null;
  private swipeCard: HTMLElement | null = null;
  private justSwiped = false;

  /** true mientras se están eligiendo canciones. */
  get isSelecting(): boolean {
    return this.selectionMode || this.hasSelection;
  }

  /** "Seleccionar" / "Listo". */
  toggleSelectMode(): void {

    if (this.isSelecting) {
      this.exitSelection();
      return;
    }

    this.selectionMode = true;
  }

  exitSelection(): void {

    this.clearSelection();

    this.selectionMode = false;
  }

  toggleDensity(): void {

    const next = this.density() === 'detailed' ? 'compact' : 'detailed';

    this.density.set(next);

    localStorage.setItem('musex_list_density', next);

    navigator.vibrate?.(8);
  }

  dismissHint(): void {

    this.hintVisible.set(false);

    localStorage.setItem('musex_list_hint', 'done');
  }

  isFav(track: Track): boolean {
    return this.libraryService.isFavorite(track.id);
  }

  /** Tono (0–360) estable para cada género: da variedad a las etiquetas. */
  genreHue(genre: string): number {

    let hash = 0;

    for (const char of genre.toLowerCase()) {
      hash = (hash * 31 + char.charCodeAt(0)) % 360;
    }

    return hash;
  }

  // -------------------------------------------------------------
  // GESTOS
  // -------------------------------------------------------------

  onPointerDown(track: Track, event: PointerEvent): void {

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const row = event.currentTarget as HTMLElement;

    // Origen de la onda de toque (ripple).
    const rect = row.getBoundingClientRect();

    row.style.setProperty('--rx', `${event.clientX - rect.left}px`);
    row.style.setProperty('--ry', `${event.clientY - rect.top}px`);

    this.pressTrack = track;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.swiping = false;
    this.armed = false;
    this.swipeDx = 0;
    this.swipeRow = row;
    this.swipeCard = row.querySelector('.mt-m-card');
    this.longPressed = false;
    this.justSwiped = false;

    this.onRelease();

    if (this.isSelecting) {
      return;
    }

    // Pulsación larga: selecciona la canción.
    this.pressTimer = setTimeout(() => {

      this.pressTimer = null;
      this.longPressed = true;

      this.toggleTrackSelection(track);

      navigator.vibrate?.(15);

      // El temporizador corre fuera de un evento de Angular: sin este
      // aviso la vista no se actualizaría (la app no usa zone.js).
      this.cdr.markForCheck();

    }, 450);
  }

  onPointerMove(event: PointerEvent): void {

    const row = this.swipeRow;
    const card = this.swipeCard;

    if (!row || !card || !this.pressTrack) {
      return;
    }

    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;

    if (!this.swiping) {

      // Movimiento vertical: es scroll, no gesto.
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        this.onRelease();
        return;
      }

      const horizontal =
        Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4;

      if (!horizontal || this.isSelecting) {
        return;
      }

      this.swiping = true;

      this.onRelease();

      row.setPointerCapture?.(event.pointerId);

      row.classList.add('is-swiping');
    }

    const max = MusicTableComponent.SWIPE_MAX;
    const threshold = MusicTableComponent.SWIPE_THRESHOLD;

    const x = Math.max(-max, Math.min(max, dx));

    this.swipeDx = x;

    card.style.transform = `translateX(${x}px)`;

    row.dataset['dir'] = x > 0 ? 'right' : 'left';

    row.style.setProperty(
      '--swipe',
      String(Math.min(1, Math.abs(x) / threshold))
    );

    const armed = Math.abs(x) >= threshold;

    if (armed !== this.armed) {

      this.armed = armed;

      row.classList.toggle('is-armed', armed);

      if (armed) {
        navigator.vibrate?.(10);
      }
    }
  }

  onPointerUp(track: Track): void {

    this.onRelease();

    if (!this.swiping) {
      this.pressTrack = null;
      return;
    }

    const dx = this.swipeDx;
    const threshold = MusicTableComponent.SWIPE_THRESHOLD;

    // El clic que acompaña al final del gesto no debe reproducir.
    this.justSwiped = true;

    setTimeout(() => (this.justSwiped = false), 350);

    this.finishSwipe();

    if (dx >= threshold) {
      this.swipeFavorite(track);
    } else if (dx <= -threshold) {
      this.swipeQueue(track);
    }
  }

  onPointerCancel(): void {

    this.onRelease();

    if (this.swiping) {
      this.finishSwipe();
    }

    this.pressTrack = null;
  }

  /** Cancela la pulsación larga (suelta, sale del elemento o hace scroll). */
  onRelease(): void {

    if (this.pressTimer !== null) {
      clearTimeout(this.pressTimer);
      this.pressTimer = null;
    }
  }

  /** La tarjeta vuelve a su sitio con una animación de rebote. */
  private finishSwipe(): void {

    const row = this.swipeRow;
    const card = this.swipeCard;

    this.swiping = false;
    this.armed = false;
    this.pressTrack = null;

    if (!row || !card) {
      return;
    }

    card.classList.add('is-snapping');
    card.style.transform = '';

    row.classList.remove('is-swiping', 'is-armed');
    row.style.removeProperty('--swipe');
    delete row.dataset['dir'];

    setTimeout(() => card.classList.remove('is-snapping'), 360);
  }

  private swipeFavorite(track: Track): void {

    const wasFavorite = this.libraryService.isFavorite(track.id);

    this.libraryService.toggleFavorite(track.id);

    navigator.vibrate?.(12);

    this.notifications.success(
      wasFavorite
        ? 'Quitada de favoritos'
        : 'Agregada a favoritos'
    );

    this.cdr.markForCheck();
  }

  private swipeQueue(track: Track): void {

    if (this.queueService.contains(track.id)) {

      this.notifications.info('Ya está en la cola');

      return;
    }

    this.queueService.add(track.id);

    this.playerService.syncQueue();

    navigator.vibrate?.(12);

    this.notifications.success('Agregada a la cola');

    this.cdr.markForCheck();
  }

  /** Toque en una fila: reproduce, o marca si se está seleccionando. */
  onRowClick(track: Track): void {

    // El toque que cierra una pulsación larga o un gesto no reproduce.
    if (this.longPressed) {
      this.longPressed = false;
      return;
    }

    if (this.justSwiped) {
      this.justSwiped = false;
      return;
    }

    if (this.isSelecting) {
      this.toggleTrackSelection(track);
      navigator.vibrate?.(8);
      return;
    }

    navigator.vibrate?.(8);

    this.playTrack(track);
  }

  /** Abre el selector de playlist con la selección actual. */
  addSelectionToPlaylistMobile(): void {
    this.addSelectedTracksToPlaylist();
  }
  /** 
   * Emite las canciones seleccionadas para agregarlas 
   * a una playlist. 
   */ 
  addSelectedTracksToPlaylist(): void { 
 
    const selectedTracks = this.tracks.filter(track => 
      this.selectedTrackIds.has(track.id) 
    ); 
 
    if (selectedTracks.length === 0) { 
      return; 
    } 
 
    this.addSelectedToPlaylist.emit( 
      selectedTracks 
    ); 
  } 
 
 
  /**
   * Emite las canciones seleccionadas para quitarlas
   * de la playlist actual y limpia la selección.
   */
  removeSelectedTracks(): void {

    const selectedTracks = this.tracks.filter(track =>
      this.selectedTrackIds.has(track.id)
    );

    if (selectedTracks.length === 0) {
      return;
    }

    this.removeSelected.emit(selectedTracks);

    this.selectedTrackIds.clear();
  }


  /**
   * Quita una sola canción de la playlist actual.
   */
  removeOne(track: Track): void {

    this.selectedTrackIds.delete(track.id);

    this.removeTrack.emit(track);
  }


  /* ============================================================= 
     TRACK ACTUAL 
     ============================================================= */ 
 
  /** 
   * Canción actualmente seleccionada por el reproductor. 
   * 
   * Se obtiene directamente desde PlayerService para que la 
   * tabla pueda identificar el estado de reproducción actual. 
   */ 
  get currentTrack(): Track | null { 
    return this.playerService.getCurrentTrack() ?? null; 
  } 
 
 
  /** 
   * Indica si la canción actualmente reproducida está marcada 
   * como favorita. 
   */ 
  get currentTrackIsFavorite(): boolean { 
 
    const track = this.currentTrack; 
 
    if (!track) { 
      return false; 
    } 
 
    return this.libraryService.isFavorite( 
      track.id 
    ); 
  } 
 
 
  /* ============================================================= 
     REPRODUCCIÓN 
     ============================================================= */ 
 
  /** 
   * Solicita reproducir o pausar una canción. 
   * 
   * La tabla no controla directamente la reproducción. 
   * Solamente comunica la acción al componente padre. 
   */ 
  playTrack(track: Track): void { 
 
    const state = this.playerService.state(); 
 
    const isCurrentTrack = 
      state.currentTrackId === track.id; 
 
    const action: 'play' | 'pause' = 
      isCurrentTrack && state.playing 
        ? 'pause' 
        : 'play'; 
 
    this.play.emit({ 
      track, 
      action 
    }); 
  } 
 
  /** Indica si la canción está esperando a que comience la reproducción. */
  /**
   * Canción actual y estado de reproducción como señales derivadas.
   *
   * La plantilla las lee en cada fila: al ser `computed` solo se
   * reevalúan cuando cambian de verdad, no en cada avance de
   * posición (varias veces por segundo).
   */
  private readonly nowId = computed(
    () => this.playerService.state().currentTrackId
  );

  private readonly nowPlaying = computed(
    () => this.playerService.state().playing
  );

  isTrackLoading(track: Track): boolean {
    return this.playerService.loadingTrackId() === track.id;
  }

  /** Indica si debe mostrarse el icono de detener para esta canción. */
  isTrackPlaying(track: Track): boolean {
    return (
      !this.isTrackLoading(track) &&
      this.nowPlaying() &&
      this.nowId() === track.id
    );
  }

  /** Es la canción actual (suene o esté en pausa). */
  isCurrent(track: Track): boolean {
    return this.nowId() === track.id;
  }

  /* ============================================================= 
     MODAL — METADATA 
     ============================================================= */ 
 
  /** 
   * Solicita abrir el modal de información y edición 
   * de una canción. 
   * 
   * La implementación visual del modal pertenece a MainLayout. 
   */ 
  openMore(track: Track): void { 
 
    this.more.emit(track); 
  } 
 
 
  /* ============================================================= 
     MODAL — PLAYLIST 
     ============================================================= */ 
 
  /** 
   * Solicita abrir el selector de playlists para una canción. 
   */ 
  openAddToPlaylist(track: Track): void { 
 
    this.addToPlaylist.emit(track); 
  } 
 
 
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
 
    const totalSeconds = Math.max( 
      0, 
      Math.floor(duration) 
    ); 
 
    const minutes = Math.floor( 
      totalSeconds / 60 
    ); 
 
    const seconds = totalSeconds % 60; 
 
    return `${minutes}:${seconds 
      .toString() 
      .padStart(2, '0')}`; 
  } 

}