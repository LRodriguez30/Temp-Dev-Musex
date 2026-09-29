import {
  Component,
  OnInit,
  computed,
  inject
} from '@angular/core';

import { Track } from '../../core/models/track.model';
import { LibraryService } from '../../core/services/library.service';
import { PlayerService } from '../../core/services/player.service';
import { ModalService } from '../../core/services/modal.service';
import {
  EqualizerService,
  EqTrack
} from '../../core/services/equalizer.service';

@Component({
  selector: 'app-equalizer',
  standalone: true,
  imports: [],
  templateUrl: './equalizer.component.html',
  styleUrl: './equalizer.component.css',
})
export class EqualizerComponent implements OnInit {

  private readonly libraryService =
    inject(LibraryService);

  readonly playerService =
    inject(PlayerService);

  private readonly modalService =
    inject(ModalService);

  readonly eqService =
    inject(EqualizerService);


  // =========================================================
  // LIBRARY
  // =========================================================

  readonly libraryTracks =
    computed<Track[]>(() =>
      this.libraryService.tracks()
    );


  // =========================================================
  // EQUALIZER TRACKS
  // =========================================================

  readonly eqTracks =
    this.eqService.eqTracks;

  readonly hasEnabledTracks =
    this.eqService.hasEnabledTracks;


  // =========================================================
  // INITIALIZATION
  // =========================================================

  async ngOnInit(): Promise<void> {

    try {

      /*
       * La vista del ecualizador trabaja únicamente con
       * canciones reales de la biblioteca.
       *
       * Los archivos temporales siguen existiendo en Rust
       * como infraestructura interna, pero ya no forman parte
       * del estado visual de esta sección.
       */
      await this.eqService.refreshFromDisk(
        this.libraryService.getTracks()
      );

    } catch (error) {

      console.error(
        'No se pudo sincronizar el estado del ecualizador:',
        error
      );

    }

  }


  // =========================================================
  // NORMAL PLAYBACK
  // =========================================================

  playTrack(track: Track): void {

    const current =
      this.playerService.getCurrentTrack();

    if (current?.id === track.id) {

      this.playerService.togglePlay();

      return;

    }

    this.playerService.playTrack(
      track.id
    );

  }


  isTrackPlaying(track: Track): boolean {

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

  async enableForEq(track: Track): Promise<void> {

    try {

      await this.eqService.enableForEq(track);

    } catch (error) {

      console.error(
        'No se pudo habilitar la canción para ecualización:',
        error
      );

    }

  }


  async disableFromEq(track: EqTrack): Promise<void> {

    try {

      await this.eqService.disableFromEq(track);

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

  async openEditor(track: EqTrack): Promise<void> {

    try {

      // Abrimos el modal inmediatamente.
      // Así la vista puede mostrar el estado de carga de Sense.
      this.modalService.openEqualizerEditor(
        track.id
      );

      // La preparación continúa después.
      // EqualizerService controla isSenseLoading().
      await this.eqService.openEditor(track);

    } catch (error) {

      console.error(
        'No se pudo abrir el editor de ecualización:',
        error
      );

    }

  }


  isEnabled(track: Track): boolean {

    return this.eqService.isEnabled(track);

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
      totalSeconds % 60;

    return (
      `${minutes}:${seconds
        .toString()
        .padStart(2, '0')}`
    );

  }

}