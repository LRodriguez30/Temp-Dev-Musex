import {
  Injectable,
  effect,
  inject
} from '@angular/core';

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import { IS_ANDROID } from '../platform/invoke';

import { Track } from '../models/track.model';

import { PlayerService } from './player.service';

/** Salto de los botones "adelantar / retroceder" del sistema. */
const MAX_DRIFT_SECONDS = 1.5;

/**
 * Puente entre el reproductor de Musex y los controles multimedia
 * de Windows (superposición de volumen, pantalla de bloqueo, teclas
 * multimedia) y la bandeja del sistema.
 *
 * Hacia el sistema:
 *   título, artista, álbum, portada y duración de la canción, estado
 *   play / pausa y posición de la barra de progreso.
 *
 * Desde el sistema:
 *   play, pausa, anterior, siguiente y saltos de posición.
 *
 * Solo actúa en escritorio dentro de Tauri.
 */
@Injectable({
  providedIn: 'root'
})
export class DesktopMediaService {

  private readonly player = inject(PlayerService);

  // Lo último que se envió al sistema
  private trackKey: string | null = null;
  private lastStatus = '';
  private lastPosition = 0;
  private lastPushAt = 0;

  constructor() {

    const insideTauri =
      typeof window !== 'undefined' &&
      '__TAURI_INTERNALS__' in window;

    if (IS_ANDROID || !insideTauri) {
      return;
    }

    // Sistema → Angular
    void listen<string>(
      'media-control',
      event => this.handleCommand(event.payload)
    );

    // Con la ventana oculta, Rust avisa del final de la canción
    // sin depender de los temporizadores de la interfaz.
    void listen(
      'musex-audio-ended',
      () => window.__musexAudioEvent?.('ended')
    );

    // Angular → sistema
    effect(() => this.sync());
  }

  // ===========================================================
  // ANGULAR → SISTEMA
  // ===========================================================

  private sync(): void {

    const state = this.player.state();
    const track = this.player.getCurrentTrack();

    // Nada reproduciéndose.
    if (!state.currentTrackId || !track) {

      if (this.trackKey !== null) {

        this.trackKey = null;
        this.lastStatus = 'stopped';

        void this.send('media_set_playback', {
          status: 'stopped',
          positionSecs: 0
        });
      }

      return;
    }

    const status = state.playing ? 'playing' : 'paused';
    const now = performance.now();

    // ---- Canción nueva ----

    if (this.trackKey !== track.id) {

      this.trackKey = track.id;

      void this.send('media_set_metadata', {
        title: track.title,
        artist: track.artist,
        album: track.album ?? '',
        coverUrl: this.coverOf(track),
        durationSecs: track.duration ?? 0
      });

      this.pushPlayback(status, state.currentTime, now);

      return;
    }

    // ---- Play / pausa ----

    if (status !== this.lastStatus) {

      this.pushPlayback(status, state.currentTime, now);

      return;
    }

    // ---- Salto de posición ----
    //
    // La posición NO se envía en cada tick: Windows la avanza sola
    // mientras suena. Solo se corrige si se aleja de lo esperado.

    const expected = state.playing
      ? this.lastPosition + (now - this.lastPushAt) / 1000
      : this.lastPosition;

    if (Math.abs(state.currentTime - expected) > MAX_DRIFT_SECONDS) {
      this.pushPlayback(status, state.currentTime, now);
    }
  }

  private pushPlayback(
    status: string,
    position: number,
    now: number
  ): void {

    this.lastStatus = status;
    this.lastPosition = position;
    this.lastPushAt = now;

    void this.send('media_set_playback', {
      status,
      positionSecs: position
    });
  }

  private async send(
    command: string,
    args: Record<string, unknown>
  ): Promise<void> {

    try {
      await invoke(command, args);
    } catch (error) {
      console.error(`[Musex] ${command} falló:`, error);
    }
  }

  /**
   * Windows solo puede leer la portada como URL http(s) o file://.
   * Las portadas locales llegan como URL del protocolo asset: se
   * convierten de vuelta a la ruta del archivo.
   */
  private coverOf(track: Track): string {

    const image = track.image;

    if (!image) {
      return '';
    }

    try {

      const url = new URL(image);

      if (url.hostname === 'asset.localhost') {

        const path = decodeURIComponent(
          url.pathname.replace(/^\//, '')
        ).replace(/\\/g, '/');

        return `file:///${encodeURI(path)}`;
      }

      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return image;
      }

    } catch {
      /* no es una URL válida: sin portada */
    }

    return '';
  }

  // ===========================================================
  // SISTEMA → ANGULAR
  // ===========================================================

  private handleCommand(command: string): void {

    const state = this.player.state();

    if (command.startsWith('seek:')) {

      const seconds = Number(command.slice(5));

      if (Number.isFinite(seconds)) {
        void this.player.seek(Math.max(0, seconds));
      }

      return;
    }

    if (command.startsWith('seekby:')) {

      const delta = Number(command.slice(7));

      if (Number.isFinite(delta)) {
        void this.player.seek(
          Math.max(0, state.currentTime + delta)
        );
      }

      return;
    }

    switch (command) {

      case 'play':
        if (!state.playing) void this.player.togglePlay();
        break;

      case 'pause':
        if (state.playing) void this.player.togglePlay();
        break;

      case 'toggle':
        void this.player.togglePlay();
        break;

      case 'next':
        this.player.nextTrack();
        break;

      case 'prev':
        this.player.previousTrack();
        break;
    }
  }
}
