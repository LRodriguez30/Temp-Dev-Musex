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

import { PlayerService } from '../../core/services/player.service';
import { LibraryService } from '../../core/services/library.service';
import { PlaylistService } from '../../core/services/playlist.service';
import { NotificationService } from '../../core/services/notification.service';
import { ModalService } from '../../core/services/modal.service';

import { Track } from '../../core/models/track.model';

import { convertFileSrc } from '@tauri-apps/api/core';
import { SearchModalComponent } from '../../components/search-modal/search-modal.component';


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

  readonly playerService =
    inject(PlayerService);

  private readonly libraryService =
    inject(LibraryService);

  private readonly playlistService =
    inject(PlaylistService);

  private readonly notificationService =
    inject(NotificationService);

  /**
   * Servicio global encargado del estado
   * de los modales.
   */
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

  /**
   * Lista reactiva de playlists disponibles.
   *
   * En el HTML se consume mediante playlists().
   */
  readonly playlists =
    this.playlistService.allPlaylists;


  // =============================================================
  // METADATA EDITOR
  // =============================================================

  /**
   * Copia temporal de la canción que se está editando.
   *
   * No modificamos directamente la canción original
   * almacenada en LibraryService.
   */
  readonly editingTrack =
    signal<Track | null>(null);


  /**
   * Archivo de portada seleccionado.
   *
   * Se mantiene temporalmente hasta que el usuario
   * presiona "Guardar cambios".
   */
  readonly pendingCoverFile =
    signal<File | null>(null);


  /**
   * URL temporal utilizada para mostrar el preview
   * de una portada recién seleccionada.
   */
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

    /**
     * Bloqueamos el scroll de la aplicación mientras
     * exista un modal global abierto.
     */
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
      }

      this.clearPendingCover();

      this.unlockModalScroll();
    });
  }

  onModalAnimationFinished(): void {

    if (this.modalService.state().open) {
      return;
    }

    this.editingTrack.set(null);

    this.clearPendingCover();

    this.modalService.finishClose();
  }

  // =============================================================
  // CURRENT TRACK
  // =============================================================

  /**
   * Canción actualmente reproducida.
   */
  get currentTrack(): Track | null {

    return this.playerService.getCurrentTrack() ?? null;
  }


  // =============================================================
  // MODAL TRACK
  // =============================================================

  /**
   * Canción asociada al modal global.
   *
   * ModalService solamente guarda el ID.
   * La información real se obtiene desde LibraryService.
   */
  get modalTrack(): Track | null {

    const trackId =
      this.modalService.state().trackId;


    if (!trackId) {
      return null;
    }


    return this.libraryService.getTrack(trackId) ?? null;
  }


  // =============================================================
  // OPEN METADATA
  // =============================================================

  /**
   * Abre el editor de información de una canción.
   */
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

  /**
   * Cierra el modal global y limpia el estado temporal
   * del editor de metadatos.
   */
  closeModal(): void {
    this.modalService.close();
  }


  // =============================================================
  // TRACK MENU
  // =============================================================

  /**
   * Cierra el menú de opciones de una canción.
   */
  closeTrackMenu(): void {

    this.modalService.close();
  }


  /**
   * Abre los detalles de una canción desde el
   * menú contextual.
   */
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
  // EDITING TRACK
  // =============================================================

  /**
   * Actualiza un campo del Track temporal.
   *
   * Se utiliza en lugar de modificar directamente
   * editingTrack() para mantener la reactividad
   * de Signals.
   */
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
   * Agrega la canción actualmente seleccionada
   * a una playlist.
   */
  addTrackToPlaylist(
    playlistId: string
  ): void {

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

  /**
   * Procesa la imagen seleccionada desde el input
   * de portada.
   */
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


    // -----------------------------------------------------------
    // VALIDAR FORMATO
    // -----------------------------------------------------------

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


    // -----------------------------------------------------------
    // VALIDAR TAMAÑO
    // -----------------------------------------------------------

    const maxSize =
      10 * 1024 * 1024;


    if (file.size > maxSize) {

      this.notificationService.error(
        'La portada no puede superar los 10 MB.'
      );


      input.value = '';

      return;
    }


    // -----------------------------------------------------------
    // LIMPIAR PREVIEW ANTERIOR
    // -----------------------------------------------------------

    this.clearPendingCover();


    // -----------------------------------------------------------
    // CREAR PREVIEW
    // -----------------------------------------------------------

    const previewUrl =
      URL.createObjectURL(file);


    this.pendingCoverFile.set(file);

    this.pendingCoverPreviewUrl.set(
      previewUrl
    );


    // -----------------------------------------------------------
    // ACTUALIZAR PREVIEW DEL EDITOR
    // -----------------------------------------------------------

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

  /**
   * Elimina la portada actual de la copia temporal.
   */
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

  /**
   * Selecciona una portada basada en icono.
   */
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

  /**
   * Libera el Object URL temporal de la portada.
   */
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

  /**
   * Guarda los metadatos modificados y la portada,
   * si el usuario seleccionó una nueva.
   */
  async saveMetadata(): Promise<void> {

    const editing =
      this.editingTrack();


    if (!editing) {
      return;
    }


    // -----------------------------------------------------------
    // VALIDAR CANCIÓN ORIGINAL
    // -----------------------------------------------------------

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

  /**
   * Devuelve la ruta del SVG correspondiente
   * a un icono de portada.
   */
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

  /**
   * Convierte segundos a mm:ss.
   */
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


    return `${minutes}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }


  // =============================================================
  // TAURI IMAGE
  // =============================================================

  /**
   * Convierte una ruta local de Tauri
   * a una URL utilizable por el WebView.
   */
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
}