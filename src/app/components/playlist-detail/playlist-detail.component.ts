import {
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  signal,
  ViewChild
} from '@angular/core';

import {
  ActivatedRoute,
  Router
} from '@angular/router';

import {
  toSignal
} from '@angular/core/rxjs-interop';

import {
  map
} from 'rxjs';

import {
  PlaylistService
} from '../../core/services/playlist.service';

import {
  LibraryService
} from '../../core/services/library.service';

import {
  PlayerService
} from '../../core/services/player.service';

import {
  NotificationService
} from '../../core/services/notification.service';

import {
  QueueService
} from '../../core/services/queue.service';

import {
  ModalService
} from '../../core/services/modal.service';

import {
  MusicTableComponent
} from '../music-table/music-table.component';

import {
  getCoverIconPath
} from '../../core/data/playlist-icons';

import {
  Track
} from '../../core/models/track.model';


@Component({
  selector: 'app-playlist-detail',
  standalone: true,
  imports: [
    MusicTableComponent
  ],
  templateUrl: './playlist-detail.component.html',
  styleUrl: './playlist-detail.component.css'
})
export class PlaylistDetailComponent {

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly playlistService =
    inject(PlaylistService);

  private readonly libraryService =
    inject(LibraryService);

  private readonly playerService =
    inject(PlayerService);

  private readonly notificationService =
    inject(NotificationService);

  private readonly queueService =
    inject(QueueService);

  private readonly modalService =
    inject(ModalService);


  readonly getCoverIconPath =
    getCoverIconPath;


  // =========================================================
  // PLAYLIST ID
  // =========================================================

  private readonly playlistId = toSignal(
    this.route.paramMap.pipe(
      map(params => params.get('id') ?? '')
    ),
    {
      initialValue: ''
    }
  );


  // =========================================================
  // PLAYLIST
  // =========================================================

  readonly playlist = computed(() => {

    const id = this.playlistId();

    return id
      ? this.playlistService.getPlaylist(id)
      : undefined;

  });


  // =========================================================
  // SORTING
  // =========================================================

  readonly sortBy = signal
  <
    'title' |
    'artist' |
    'recent' |
    'original'
  >('original');

  sortMenuOpen = false;


  toggleSortMenu(): void {

    this.sortMenuOpen =
      !this.sortMenuOpen;

  }


  setSort(
    sort:
      | 'title'
      | 'artist'
      | 'recent'
      | 'original'
  ): void {

    this.sortBy.set(sort);

    this.sortMenuOpen = false;

  }


  // =========================================================
  // TRACKS
  // =========================================================

  readonly tracks = computed(() => {

    const p = this.playlist();

    const trackIds =
      p?.trackIds ?? [];


    const originalTracks = trackIds
      .map(id =>
        this.libraryService.getTrack(id)
      )
      .filter(
        (track): track is Track =>
          track !== undefined
      );


    switch (this.sortBy()) {

      case 'title':

        return [...originalTracks].sort(
          (a, b) =>
            a.title.localeCompare(
              b.title,
              undefined,
              {
                sensitivity: 'base'
              }
            )
        );


      case 'artist':

        return [...originalTracks].sort(
          (a, b) =>
            a.artist.localeCompare(
              b.artist,
              undefined,
              {
                sensitivity: 'base'
              }
            )
        );


      case 'recent':

        /*
         * Track actualmente no posee una propiedad
         * temporal como addedAt.
         *
         * Por eso esta opción interpreta "Más recientes"
         * como las canciones añadidas más recientemente
         * según su posición en la playlist.
         *
         * El último elemento pasa al principio.
         */

        return [...originalTracks].reverse();


      case 'original':

      default:

        return originalTracks;

    }

  });


  // =========================================================
  // TRACK ACTIONS
  // =========================================================

  openMore(track: Track): void {

    this.modalService.openTrackMenu(
      track.id
    );

  }


  openAddToPlaylist(track: Track): void {

    this.modalService.openAddToPlaylist(
      track.id
    );

  }


  // =========================================================
  // REORDER STATE
  // =========================================================

  isReordering = false;

  readonly reorderTracks =
    signal<Track[]>([]);

  readonly originalReorderTracks =
    signal<Track[]>([]);


  /*
   * Indica si el orden actual es diferente
   * al orden con el que se inició el modo
   * de reordenamiento.
   *
   * Al ser computed y depender de signals,
   * se actualiza inmediatamente mientras
   * las canciones se mueven.
   */

  readonly canResetReorder = computed(() => {

    if (!this.isReordering) {
      return false;
    }


    const current =
      this.reorderTracks();

    const original =
      this.originalReorderTracks();


    if (
      current.length !==
      original.length
    ) {
      return true;
    }


    return current.some(
      (track, index) =>
        track.id !==
        original[index]?.id
    );

  });


  // =========================================================
  // DRAG STATE (Pointer Events)
  // ---------------------------------------------------------
  // El drag & drop nativo de HTML5 (draggable/dragstart/drop)
  // no funciona de forma confiable dentro del WebView de
  // Tauri. Se reemplaza por Pointer Events, que funcionan
  // igual con mouse y con touch.
  // =========================================================

  @ViewChild('reorderList')
  private reorderListRef?:
    ElementRef<HTMLDivElement>;


  draggingIndex:
    number | null = null;

  dragOverIndex:
    number | null = null;


  /*
   * ID de la canción que se está arrastrando.
   */

  draggingTrackId:
    string | null = null;


  /*
   * Posición original de la canción
   * cuando comenzó el drag.
   *
   * Esta posición NO cambia aunque
   * reorderTracks se modifique.
   */

  originalDragIndex:
    number | null = null;


  /*
   * Copia de la canción tal como estaba
   * cuando comenzó el drag.
   *
   * Se utiliza para mostrar el ghost
   * transparente en su posición original.
   */

  draggingTrackSnapshot:
    Track | null = null;


  private activePointerId:
    number | null = null;


  // =========================================================
  // ORIGINAL TRACKS
  // =========================================================

  private getOriginalTracks(): Track[] {

    const p = this.playlist();

    const trackIds =
      p?.trackIds ?? [];


    return trackIds
      .map(id =>
        this.libraryService.getTrack(id)
      )
      .filter(
        (track): track is Track =>
          track !== undefined
      );

  }


  // =========================================================
  // START REORDER
  // =========================================================

  startReorder(): void {

    const currentTracks =
      this.getOriginalTracks();


    if (currentTracks.length <= 1) {

      this.notificationService.info(
        'No hay suficientes canciones para reordenar.'
      );

      return;
    }


    /*
     * Una copia representa el estado editable.
     */

    this.reorderTracks.set([
      ...currentTracks
    ]);


    /*
     * Otra copia representa el estado
     * original contra el que se comparará
     * cualquier modificación.
     */

    this.originalReorderTracks.set([
      ...currentTracks
    ]);


    this.isReordering = true;

    this.sortMenuOpen = false;


    this.draggingIndex = null;
    this.dragOverIndex = null;

    this.draggingTrackId = null;
    this.originalDragIndex = null;

    this.draggingTrackSnapshot = null;

    this.activePointerId = null;

  }


  // =========================================================
  // RESET REORDER
  // =========================================================

  resetReorder(): void {

    /*
     * Si ya está en el orden original,
     * no hacemos nada.
     */

    if (!this.canResetReorder()) {
      return;
    }


    /*
     * Restauramos una nueva copia para
     * provocar la actualización del signal.
     */

    this.reorderTracks.set([
      ...this.originalReorderTracks()
    ]);


    /*
     * Cancelamos cualquier drag activo.
     */

    this.draggingIndex = null;
    this.dragOverIndex = null;

    this.draggingTrackId = null;
    this.originalDragIndex = null;

    this.draggingTrackSnapshot = null;

    this.activePointerId = null;

  }


  // =========================================================
  // CANCEL REORDER
  // =========================================================

  cancelReorder(): void {

    this.reorderTracks.set([]);

    this.originalReorderTracks.set([]);


    this.draggingIndex = null;
    this.dragOverIndex = null;

    this.draggingTrackId = null;
    this.originalDragIndex = null;

    this.draggingTrackSnapshot = null;

    this.activePointerId = null;


    this.isReordering = false;

  }


  // =========================================================
  // DRAG START (pointerdown sobre el handle)
  // =========================================================

  onHandlePointerDown(
    event: PointerEvent,
    index: number
  ): void {

    if (!this.isReordering) {
      return;
    }


    event.preventDefault();


    const track =
      this.reorderTracks()[index];


    if (!track) {
      return;
    }


    /*
     * Posición actual en el momento
     * exacto en que comenzó el drag.
     */

    this.draggingIndex = index;


    /*
     * Esta posición queda congelada.
     * Es la posición que utilizaremos
     * para dibujar el ghost.
     */

    this.originalDragIndex = index;


    /*
     * Guardamos el ID para identificar
     * la canción aunque el array cambie.
     */

    this.draggingTrackId =
      track.id;


    /*
     * Guardamos una copia visual de la
     * canción antes de moverla.
     */

    this.draggingTrackSnapshot = {
      ...track
    };


    this.dragOverIndex = index;

    this.activePointerId =
      event.pointerId;


    (
      event.currentTarget as HTMLElement
    ).setPointerCapture(
      event.pointerId
    );

  }


  // =========================================================
  // DRAG MOVE
  // ---------------------------------------------------------
  // Se escucha a nivel de documento porque el pointer puede
  // moverse fuera del elemento original una vez capturado.
  //
  // El array se modifica EN VIVO mientras se arrastra.
  // =========================================================

  @HostListener(
    'document:pointermove',
    ['$event']
  )
  onDocumentPointerMove(
    event: PointerEvent
  ): void {

    if (
      this.draggingIndex === null ||
      event.pointerId !==
        this.activePointerId
    ) {
      return;
    }


    const list =
      this.reorderListRef?.nativeElement;


    if (!list) {
      return;
    }


    const items =
      Array.from(
        list.children
      ) as HTMLElement[];


    const pointerY =
      event.clientY;


    let targetIndex =
      this.reorderTracks().length - 1;


    for (
      let i = 0;
      i < items.length;
      i++
    ) {

      const rect =
        items[i].getBoundingClientRect();


      const middle =
        rect.top +
        rect.height / 2;


      if (
        pointerY < middle
      ) {

        targetIndex = i;

        break;
      }

    }


    /*
     * Si seguimos sobre nuestra misma
     * posición no hay nada que modificar.
     */

    if (
      targetIndex ===
      this.draggingIndex
    ) {

      this.dragOverIndex =
        targetIndex;

      return;
    }


    const updatedTracks =
      [
        ...this.reorderTracks()
      ];


    const currentIndex =
      this.draggingIndex;


    const [movedTrack] =
      updatedTracks.splice(
        currentIndex,
        1
      );


    /*
     * Al eliminar el elemento arrastrado,
     * los índices posteriores se desplazan
     * una posición hacia atrás.
     */

    const insertIndex =
      targetIndex > currentIndex
        ? targetIndex - 1
        : targetIndex;


    updatedTracks.splice(
      insertIndex,
      0,
      movedTrack
    );


    /*
     * Actualizamos el signal.
     *
     * Esto hace que:
     *
     * - Angular actualice la lista.
     * - canResetReorder() se recalcule.
     * - El botón Reiniciar se active
     *   inmediatamente.
     */

    this.reorderTracks.set(
      updatedTracks
    );


    /*
     * El nuevo índice de la canción
     * después del movimiento.
     */

    this.draggingIndex =
      insertIndex;


    this.dragOverIndex =
      insertIndex;

  }


  // =========================================================
  // DRAG END
  // =========================================================

  @HostListener(
    'document:pointerup'
  )
  onDocumentPointerUp(): void {

    if (
      this.draggingIndex === null
    ) {
      return;
    }


    this.draggingIndex = null;
    this.dragOverIndex = null;

    this.draggingTrackId = null;
    this.originalDragIndex = null;

    this.draggingTrackSnapshot = null;

    this.activePointerId = null;

  }


  // =========================================================
  // DRAG CANCEL
  // =========================================================

  @HostListener(
    'document:pointercancel'
  )
  onDocumentPointerCancel(): void {

    this.draggingIndex = null;
    this.dragOverIndex = null;

    this.draggingTrackId = null;
    this.originalDragIndex = null;

    this.draggingTrackSnapshot = null;

    this.activePointerId = null;

  }


  // =========================================================
  // SAVE REORDER
  // =========================================================

  saveReorder(): void {

    const id =
      this.playlistId();


    if (!id) {
      return;
    }


    const currentTracks =
      this.reorderTracks();


    if (
      currentTracks.length === 0
    ) {

      this.cancelReorder();

      return;
    }


    const trackIds =
      currentTracks.map(
        track => track.id
      );


    this.playlistService.updateTrackOrder(
      id,
      trackIds
    );


    this.sortBy.set(
      'original'
    );


    this.reorderTracks.set([]);

    this.originalReorderTracks.set([]);


    this.draggingIndex = null;
    this.dragOverIndex = null;

    this.draggingTrackId = null;
    this.originalDragIndex = null;

    this.draggingTrackSnapshot = null;

    this.activePointerId = null;


    this.isReordering = false;


    this.notificationService.success(
      'Orden de la playlist actualizado.'
    );

  }


  // =========================================================
  // PLAY ALL
  // =========================================================

  playAll(): void {

    if (this.isReordering) {
      return;
    }


    const currentTracks =
      this.tracks();


    if (
      currentTracks.length === 0
    ) {
      return;
    }


    const trackIds =
      currentTracks.map(
        track => track.id
      );


    this.queueService.setQueue(
      trackIds
    );


    this.playerService.syncQueue();


    this.playerService.playTrack(
      trackIds[0]
    );

  }


  // =========================================================
  // PLAY TRACK
  // =========================================================

  playTrack(
    track: Track
  ): void {

    if (this.isReordering) {
      return;
    }


    this.playerService.playTrack(
      track.id
    );

  }


  // =========================================================
  // REMOVE TRACK
  // =========================================================

  removeTrack(
    trackId: string
  ): void {

    const id =
      this.playlistId();


    if (!id) {
      return;
    }


    this.playlistService.removeTrack(
      id,
      trackId
    );


    this.notificationService.info(
      'Canción eliminada de la playlist.'
    );

  }


  // =========================================================
  // DELETE PLAYLIST
  // =========================================================

  deletePlaylist(): void {

    const p =
      this.playlist();

    const id =
      this.playlistId();


    if (!p?.custom) {

      this.notificationService.warning(
        'Las playlists predeterminadas no se pueden eliminar.'
      );

      return;
    }


    if (!id) {
      return;
    }


    this.playlistService.removePlaylist(
      id
    );


    this.notificationService.success(
      'Playlist eliminada.'
    );


    this.router.navigate([
      '/home'
    ]);

  }


  // =========================================================
  // FORMAT DURATION
  // =========================================================

  formatDuration(
    duration:
      number |
      undefined |
      null
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
      totalSeconds % 60;


    return `${minutes}:${seconds
      .toString()
      .padStart(2, '0')}`;

  }

}