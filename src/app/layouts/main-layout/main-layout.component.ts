import {
  Component,
  DestroyRef,
  effect,
  inject,
  signal
} from '@angular/core';

import { RouterOutlet } from '@angular/router';

import { TopBarComponent } from '../../components/top-bar/top-bar.component';
import { SidebarComponent } from '../../components/sidebar/sidebar.component';
import { NowPlayingComponent } from '../../components/now-playing/now-playing.component';
import { BottomPlayerComponent } from '../../components/bottom-player/bottom-player.component';
import { FullPlayerComponent } from '../../components/full-player/full-player.component';
import { ModalComponent } from '../../components/modal/modal.component';
import { ToastContainerComponent } from '../../components/toast-container/toast-container.component';
import { QueuePanelComponent } from '../../components/queue-panel/queue-panel.component';
import { SearchModalComponent } from '../../components/search-modal/search-modal.component';

import { PlayerService } from '../../core/services/player.service';
import { LibraryService } from '../../core/services/library.service';
import { PlaylistService } from '../../core/services/playlist.service';
import { NotificationService } from '../../core/services/notification.service';
import { ModalService } from '../../core/services/modal.service';
import { ThemeService } from '../../core/services/theme.service';

import {
  EqualizerService,
  EqTrack
} from '../../core/services/equalizer.service';

import { Track } from '../../core/models/track.model';

import { convertFileSrc } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';


/**
 * =============================================================
 * MAIN LAYOUT
 * =============================================================
 *
 * Layout principal de Musex.
 *
 * Mantiene las zonas persistentes de la aplicación mientras
 * Angular cambia únicamente el contenido del RouterOutlet.
 *
 * Los modales globales son controlados mediante ModalService.
 * MainLayout se encarga de representar el contenido específico
 * de cada modal y ejecutar sus acciones.
 *
 * El editor de ecualización utiliza EqualizerService como única
 * fuente de verdad para el estado del EQ y Sense.
 *
 * Flujo:
 *
 *     Editar canción
 *          ↓
 *     Abrir modal EQ inmediatamente
 *          ↓
 *     EqualizerService prepara preset
 *          ↓
 *     Sense loading dentro del modal
 *          ↓
 *     Editor EQ
 */
@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    RouterOutlet,
    TopBarComponent,
    SidebarComponent,
    NowPlayingComponent,
    BottomPlayerComponent,
    FullPlayerComponent,
    ModalComponent,
    ToastContainerComponent,
    QueuePanelComponent,
    SearchModalComponent
  ],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.css'
})
export class MainLayoutComponent {

  // =============================================================
  // SERVICIOS
  // =============================================================

  private readonly themeService =
    inject(ThemeService);

  readonly playerService =
    inject(PlayerService);

  private readonly libraryService =
    inject(LibraryService);

  private readonly playlistService =
    inject(PlaylistService);

  private readonly notificationService =
    inject(NotificationService);

  private readonly equalizerService =
    inject(EqualizerService);

  /**
   * Estado del ecualizador expuesto al template.
   *
   * EqualizerService es la única fuente de verdad para:
   *
   * - activeTrack
   * - isSenseLoading
   * - senseError
   * - bands
   * - isPlaying
   * - currentTime
   * - etc.
   */
  readonly eqService =
    this.equalizerService;

  readonly modalService =
    inject(ModalService);

  private readonly destroyRef =
    inject(DestroyRef);


  // =============================================================
  // PLAYER STATE
  // =============================================================

  readonly playerState =
    this.playerService.state;

  private static readonly BOTTOM_PLAYER_EXIT_DURATION = 420;

  readonly bottomPlayerMounted =
    signal(false);

  readonly bottomPlayerExiting =
    signal(false);

  private exitTimeoutId:
    ReturnType<typeof setTimeout> | null = null;


  // =============================================================
  // EQUALIZER OPEN REQUEST
  // =============================================================

  /**
   * Identificador de la operación actual de apertura del EQ.
   *
   * Permite invalidar una operación pendiente si el usuario
   * cierra el modal antes de que termine la preparación.
   */
  private eqEditorOpenRequestId =
    0;


  // =============================================================
  // COVER OPTIONS
  // =============================================================

  readonly coverIcons = [
    'music',
    'vinyl',
    'disc',
    'headphones',
    'wave',
    'note'
  ];

  readonly coverColors = [
    '#9CFF00',
    '#00E5FF',
    '#FF4D6D',
    '#A78BFA',
    '#FFB000',
    '#FFFFFF'
  ];


  // =============================================================
  // PLAYLISTS
  // =============================================================

  readonly playlists =
    this.playlistService.allPlaylists;


  // =============================================================
  // METADATA EDITOR
  // =============================================================

  readonly editingTrack =
    signal<Track | null>(null);

  readonly pendingCoverFile =
    signal<File | null>(null);

  readonly pendingCoverPreviewUrl =
    signal<string | null>(null);


  // =============================================================
  // CONSTRUCTOR
  // =============================================================

  constructor() {

    // -----------------------------------------------------------
    // BOTTOM PLAYER
    // -----------------------------------------------------------

    effect(() => {

      const shouldShow =
        this.playerService.hasPlayableContent();


      if (shouldShow) {

        if (this.exitTimeoutId !== null) {

          clearTimeout(
            this.exitTimeoutId
          );

          this.exitTimeoutId = null;
        }

        this.bottomPlayerExiting.set(false);
        this.bottomPlayerMounted.set(true);

        return;
      }


      if (!this.bottomPlayerMounted()) {
        return;
      }


      this.bottomPlayerExiting.set(true);


      this.exitTimeoutId = setTimeout(() => {

        this.bottomPlayerMounted.set(false);
        this.bottomPlayerExiting.set(false);
        this.exitTimeoutId = null;

      }, MainLayoutComponent.BOTTOM_PLAYER_EXIT_DURATION);
    });


    // -----------------------------------------------------------
    // MODAL SCROLL
    // -----------------------------------------------------------

    effect(() => {

      const isOpen =
        this.modalService.state().open;


      if (isOpen) {

        this.lockModalScroll();

      } else {

        this.unlockModalScroll();
      }
    });


    // -----------------------------------------------------------
    // CLEANUP
    // -----------------------------------------------------------

    this.destroyRef.onDestroy(() => {

      if (this.exitTimeoutId !== null) {

        clearTimeout(
          this.exitTimeoutId
        );

        this.exitTimeoutId = null;
      }


      /**
       * Invalida cualquier apertura pendiente.
       */
      this.eqEditorOpenRequestId++;


      this.clearPendingCover();

      this.unlockModalScroll();
    });
  }


  // =============================================================
  // MODAL ANIMATION
  // =============================================================

  onModalAnimationFinished(): void {

    /**
     * Si el modal volvió a abrirse durante la animación
     * de salida, no finalizamos el cierre.
     */
    if (this.modalService.state().open) {
      return;
    }


    this.editingTrack.set(null);

    this.clearPendingCover();


    /**
     * El editor EQ puede mantener reproducción propia.
     *
     * Solo detenemos esa reproducción cuando el modal que acaba
     * de terminar era realmente el editor de ecualización.
     */
    if (
      this.modalService.is('equalizer-editor')
    ) {

      this.equalizerService
        .closeEditor()
        .catch(error => {

          console.error(
            'No se pudo detener la reproducción de ecualización:',
            error
          );

        });
    }


    this.modalService.finishClose();
  }


  // =============================================================
  // CURRENT TRACK
  // =============================================================

  get currentTrack(): Track | null {

    return (
      this.playerService.getCurrentTrack() ??
      null
    );
  }


  // =============================================================
  // MODAL TRACK
  // =============================================================

  get modalTrack(): Track | null {

    const trackId =
      this.modalService.state().trackId;


    if (!trackId) {
      return null;
    }


    return (
      this.libraryService.getTrack(trackId) ??
      null
    );
  }


  // =============================================================
  // OPEN METADATA
  // =============================================================

  openMetadata(track: Track): void {

    this.editingTrack.set({
      ...track
    });

    this.clearPendingCover();


    this.modalService.open(
      'track-details',
      {
        title: 'Información de la canción',
        trackId: track.id
      }
    );
  }


  // =============================================================
  // CLOSE MODAL
  // =============================================================

  closeModal(): void {

    /**
     * Invalida cualquier apertura pendiente del EQ.
     */
    this.eqEditorOpenRequestId++;


    this.modalService.close();
  }


  // =============================================================
  // TRACK MENU
  // =============================================================

  closeTrackMenu(): void {

    this.modalService.close();
  }


  openTrackDetails(): void {

    const trackId =
      this.modalService.state().trackId;


    if (!trackId) {
      return;
    }


    const track =
      this.libraryService.getTrack(trackId);


    if (!track) {
      return;
    }


    this.editingTrack.set({
      ...track
    });

    this.clearPendingCover();


    this.modalService.open(
      'track-details',
      {
        title: 'Información de la canción',
        trackId
      }
    );
  }


  // =============================================================
  // AI STUDIO
  // =============================================================

  async confirmOpenAiStudio(): Promise<void> {

    this.modalService.close();


    try {

      await openUrl(
        'https://aistudio.google.com/apikey'
      );

    } catch (error) {

      console.error(
        'No se pudo abrir Google AI Studio:',
        error
      );


      this.notificationService.error(
        'No se pudo abrir Google AI Studio.'
      );
    }
  }


  // =============================================================
  // EDITING TRACK
  // =============================================================

  updateEditingField(
    field: keyof Track,
    value: string
  ): void {

    const current =
      this.editingTrack();


    if (!current) {
      return;
    }


    this.editingTrack.set({
      ...current,
      [field]: value
    });
  }


  // =============================================================
  // ADD TO PLAYLIST
  // =============================================================

  /**
   * Abre el selector de playlists para varias canciones
   * seleccionadas desde MusicTable.
   */
  openAddSelectedToPlaylist(
    tracks: Track[]
  ): void {

    if (tracks.length === 0) {
      return;
    }


    this.modalService.openAddSelectedToPlaylist(
      tracks.map(track => track.id)
    );
  }


  /**
   * Agrega la canción o canciones asociadas al modal
   * a la playlist seleccionada.
   *
   * El flujo individual continúa utilizando addTrack().
   * El flujo múltiple utiliza addTracks().
   */
  addTrackToPlaylist(
    playlistId: string
  ): void {

    const modalState =
      this.modalService.state();


    // -----------------------------------------------------------
    // MULTIPLE TRACKS
    // -----------------------------------------------------------

    if (modalState.trackIds.length > 0) {

      try {

        this.playlistService.addTracks(
          playlistId,
          modalState.trackIds
        );


        const addedCount =
          modalState.trackIds.length;


        this.notificationService.success(
          addedCount === 1
            ? 'La canción se agregó a la playlist.'
            : `${addedCount} canciones se agregaron a la playlist.`
        );


        this.modalService.close();

      } catch (error) {

        console.error(
          'Error al agregar las canciones a la playlist:',
          error
        );


        this.notificationService.error(
          'No se pudieron agregar las canciones a la playlist.'
        );
      }


      return;
    }


    // -----------------------------------------------------------
    // SINGLE TRACK
    // -----------------------------------------------------------

    const track =
      this.modalTrack;


    if (!track) {
      return;
    }


    try {

      this.playlistService.addTrack(
        playlistId,
        track.id
      );


      this.notificationService.success(
        `"${track.title}" se agregó a la playlist.`
      );


      this.modalService.close();

    } catch (error) {

      console.error(
        'Error al agregar la canción a la playlist:',
        error
      );


      this.notificationService.error(
        'No se pudo agregar la canción a la playlist.'
      );
    }
  }


  // =============================================================
  // COVER — IMAGE
  // =============================================================

  onCoverImageSelected(
    event: Event
  ): void {

    const input =
      event.target as HTMLInputElement;


    const file =
      input.files?.[0];


    if (!file) {
      return;
    }


    const validTypes = [
      'image/png',
      'image/jpeg',
      'image/webp'
    ];


    if (!validTypes.includes(file.type)) {

      this.notificationService.error(
        'La portada debe ser PNG, JPG o WEBP.'
      );


      input.value = '';

      return;
    }


    const maxSize =
      10 * 1024 * 1024;


    if (file.size > maxSize) {

      this.notificationService.error(
        'La portada no puede superar los 10 MB.'
      );


      input.value = '';

      return;
    }


    this.clearPendingCover();


    const previewUrl =
      URL.createObjectURL(file);


    this.pendingCoverFile.set(file);

    this.pendingCoverPreviewUrl.set(
      previewUrl
    );


    const current =
      this.editingTrack();


    if (!current) {
      return;
    }


    this.editingTrack.set({

      ...current,

      coverType: 'image',

      image: previewUrl

    });


    input.value = '';
  }


  // =============================================================
  // COVER — REMOVE
  // =============================================================

  removeCover(): void {

    const current =
      this.editingTrack();


    if (!current) {
      return;
    }


    this.clearPendingCover();


    this.editingTrack.set({

      ...current,

      coverType: undefined,

      coverIcon: undefined,

      coverColor: undefined,

      image: ''

    });
  }


  // =============================================================
  // COVER — ICON
  // =============================================================

  chooseIconCover(
    icon: string,
    color: string
  ): void {

    const current =
      this.editingTrack();


    if (!current) {
      return;
    }


    this.clearPendingCover();


    this.editingTrack.set({

      ...current,

      coverType: 'icon',

      coverIcon: icon,

      coverColor: color,

      image: ''

    });
  }


  // =============================================================
  // COVER — CLEANUP
  // =============================================================

  clearPendingCover(): void {

    const preview =
      this.pendingCoverPreviewUrl();


    if (preview) {

      URL.revokeObjectURL(
        preview
      );
    }


    this.pendingCoverFile.set(null);

    this.pendingCoverPreviewUrl.set(
      null
    );
  }


  // =============================================================
  // SAVE METADATA
  // =============================================================

  async saveMetadata(): Promise<void> {

    const editing =
      this.editingTrack();


    if (!editing) {
      return;
    }


    const original =
      this.libraryService.getTrack(
        editing.id
      );


    if (!original) {

      this.notificationService.error(
        'No se encontró la canción.'
      );

      return;
    }


    try {

      // ---------------------------------------------------------
      // METADATA
      // ---------------------------------------------------------

      this.libraryService.updateMetadata(
        editing.id,
        {
          title: editing.title,
          artist: editing.artist,
          album: editing.album,
          genre: editing.genre
        }
      );


      // ---------------------------------------------------------
      // NEW IMAGE COVER
      // ---------------------------------------------------------

      const pendingFile =
        this.pendingCoverFile();


      if (pendingFile) {

        const coverPath =
          await this.libraryService.saveCover(
            editing.id,
            pendingFile
          );


        this.libraryService.updateCover(
          editing.id,
          {
            coverType: 'image',
            image: this.getImageSrc(
              coverPath
            )
          }
        );
      }


      // ---------------------------------------------------------
      // ICON COVER
      // ---------------------------------------------------------

      else if (
        editing.coverType === 'icon'
      ) {

        this.libraryService.updateCover(
          editing.id,
          {
            coverType: 'icon',
            coverIcon: editing.coverIcon,
            coverColor: editing.coverColor,
            image: undefined
          }
        );
      }


      // ---------------------------------------------------------
      // NO COVER
      // ---------------------------------------------------------

      else if (
        !editing.coverType &&
        !editing.image
      ) {

        this.libraryService.updateCover(
          editing.id,
          {
            coverType: undefined,
            coverIcon: undefined,
            coverColor: undefined,
            image: undefined
          }
        );
      }


      // ---------------------------------------------------------
      // SUCCESS
      // ---------------------------------------------------------

      this.notificationService.success(
        'Información de la canción actualizada.'
      );


      this.modalService.close();

      this.editingTrack.set(null);

      this.clearPendingCover();

    } catch (error) {

      console.error(
        'Error al guardar los metadatos:',
        error
      );


      this.notificationService.error(
        'No se pudieron guardar los cambios.'
      );
    }
  }


  // =============================================================
  // COVER ICON PATH
  // =============================================================

  getCoverIconPath(
    icon: string | undefined
  ): string {

    if (!icon) {
      return '';
    }


    return `assets/icons/covers/${icon}.svg`;
  }


  // =============================================================
  // DURATION
  // =============================================================

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
      totalSeconds % 60;


    return (
      `${minutes}:${seconds
        .toString()
        .padStart(2, '0')}`
    );
  }


  // =============================================================
  // TAURI IMAGE
  // =============================================================

  getImageSrc(
    path: string | null | undefined
  ): string {

    if (!path) {
      return '';
    }


    try {

      return convertFileSrc(path);

    } catch {

      return path;
    }
  }


  // =============================================================
  // MODAL SCROLL
  // =============================================================

  private lockModalScroll(): void {

    document.body.classList.add(
      'modal-open'
    );
  }


  private unlockModalScroll(): void {

    document.body.classList.remove(
      'modal-open'
    );
  }


  // =============================================================
  // EQUALIZER — OPEN EDITOR
  // =============================================================

  async openEqualizerEditor(
    track: EqTrack
  ): Promise<void> {

    if (
      this.equalizerService.isSenseLoading()
    ) {
      return;
    }


    const requestId =
      ++this.eqEditorOpenRequestId;


    try {

      this.modalService.open(
        'equalizer-editor',
        {
          title: 'Ecualizador',
          trackId: track.id
        }
      );


      await this.equalizerService.openEditor(
        track
      );


      if (
        requestId !==
        this.eqEditorOpenRequestId
      ) {

        return;
      }

    } catch (error) {

      console.error(
        'No se pudo preparar el editor de ecualización:',
        error
      );


      if (
        requestId ===
        this.eqEditorOpenRequestId
      ) {

        this.modalService.close();
      }


      this.notificationService.error(
        'No se pudo preparar el ecualizador.'
      );
    }
  }


  // =============================================================
  // EQUALIZER — CLOSE
  // =============================================================

  closeEqualizerEditor(): void {

    this.eqEditorOpenRequestId++;


    this.modalService.close();
  }


  // =============================================================
  // EQUALIZER — PLAYBACK
  // =============================================================

  async toggleEqPlayback(): Promise<void> {

    try {

      await this.equalizerService.togglePlayback();

    } catch (error) {

      console.error(
        'No se pudo cambiar el estado de reproducción del ecualizador:',
        error
      );
    }
  }


  // =============================================================
  // EQUALIZER — SEEK
  // =============================================================

  startEqSeek(): void {

    this.equalizerService.startSeek();
  }


  updateEqSeekPosition(
    seconds: number
  ): void {

    this.equalizerService.updateSeekPosition(
      seconds
    );
  }


  async finishEqSeek(): Promise<void> {

    try {

      await this.equalizerService.finishSeek();

    } catch (error) {

      console.error(
        'No se pudo confirmar la posición del ecualizador:',
        error
      );
    }
  }


  // =============================================================
  // EQUALIZER — TIME
  // =============================================================

  formatEqTime(
    seconds: number
  ): string {

    return this.formatDuration(
      seconds
    );
  }
}