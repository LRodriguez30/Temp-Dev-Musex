import {
  Injectable,
  effect,
  inject
} from '@angular/core';

import { IS_ANDROID } from '../platform/invoke';

import { Track } from '../models/track.model';

import { PlayerService } from './player.service';

/**
 * Puente entre el reproductor de Musex y los controles multimedia
 * de Android (notificación, pantalla de bloqueo, audífonos).
 *
 * Hacia Android:
 *   avisa qué canción suena (título, artista, portada, duración),
 *   si está en play o pausa, la posición y los modos
 *   aleatorio / repetir.
 *
 * Desde Android:
 *   recibe los botones (play, pausa, anterior, siguiente, aleatorio,
 *   repetir) y los saltos de posición de la barra de progreso.
 *
 * Solo hace algo en Android.
 */
@Injectable({
  providedIn: 'root'
})
export class AndroidMediaService {

  private readonly player = inject(PlayerService);

  // Lo último que se envió a Android
  private trackKey: string | null = null;
  private lastPlaying = false;
  private lastModes = '';
  private lastPosition = 0;
  private lastPushAt = 0;

  /** Selección del auto-picker ya comunicada a Android. */
  private autoPickKey: string | null = null;
  constructor() {

    if (!IS_ANDROID) {
      return;
    }

    window.__musexMediaCommand = (command: string) =>
      this.handleCommand(command);

    effect(() => this.sync());
  }

  // ===========================================================
  // ANGULAR → ANDROID
  // ===========================================================

  private sync(): void {

    const bridge = window.MusexAndroid;

    if (!bridge) {
      return;
    }

    // El auto-picker va PRIMERO: Android debe saber que hay una espera
    // antes de recibir la "pausa" de fin de canción; si no, soltaría el
    // primer plano y la app quedaría congelada en segundo plano.
    this.syncAutoPick(bridge);

    const state = this.player.state();
    const track = this.player.getCurrentTrack();

    // Nada reproduciéndose: se quita la notificación.
    if (!state.currentTrackId || !track) {

      if (this.trackKey !== null) {
        bridge.stop();
        this.trackKey = null;
      }

      return;
    }

    const now = performance.now();
    const modes = `${state.shuffle}|${state.repeat}`;

    // ---- Canción nueva ----

    if (this.trackKey !== track.id) {

      this.trackKey = track.id;

      bridge.setNowPlaying(
        track.title,
        track.artist,
        track.album ?? '',
        this.coverOf(track),
        track.duration ?? 0,
        state.currentTime,
        state.playing,
        state.shuffle,
        state.repeat
      );

      this.remember(state.currentTime, state.playing, modes, now);

      return;
    }

    // ---- Play / pausa ----

    if (state.playing !== this.lastPlaying) {

      bridge.setPlaybackState(
        state.currentTime,
        state.playing
      );

      this.remember(state.currentTime, state.playing, modes, now);

      return;
    }

    // ---- Aleatorio / repetir ----

    if (modes !== this.lastModes) {

      bridge.setModes(
        state.shuffle,
        state.repeat
      );

      this.lastModes = modes;
    }

    // ---- Salto de posición (el usuario movió la barra) ----
    //
    // La posición NO se envía en cada tick: Android la avanza solo.
    // Solo se corrige cuando se aleja de lo esperado.

    const expected = state.playing
      ? this.lastPosition + (now - this.lastPushAt) / 1000
      : this.lastPosition;

    const tolerance = state.playing ? 1.5 : 0.5;

    if (Math.abs(state.currentTime - expected) > tolerance) {

      bridge.setPlaybackState(
        state.currentTime,
        state.playing
      );

      this.remember(state.currentTime, state.playing, modes, now);
    }
  }

  /** Avisa a Android cuando el auto-picker empieza o termina de esperar. */
  private syncAutoPick(bridge: NonNullable<Window['MusexAndroid']>): void {

    const pending = this.player.autoPickPending();

    const key = pending
      ? `${pending.track.id}|${pending.deadline}`
      : null;

    if (key === this.autoPickKey) {
      return;
    }

    this.autoPickKey = key;

    if (pending) {

      const seconds = Math.max(
        1,
        Math.round((pending.deadline - Date.now()) / 1000)
      );

      bridge.setAutoPick?.(
        pending.track.title,
        pending.track.artist,
        seconds
      );

    } else {

      bridge.clearAutoPick?.();
    }
  }

  private remember(
    position: number,
    playing: boolean,
    modes: string,
    now: number
  ): void {

    this.lastPosition = position;
    this.lastPlaying = playing;
    this.lastModes = modes;
    this.lastPushAt = now;
  }

  /** Android solo puede descargar portadas que sean una URL http(s). */
  private coverOf(track: Track): string {

    return track.image && /^https?:\/\//i.test(track.image)
      ? track.image
      : '';
  }

  // ===========================================================
  // ANDROID → ANGULAR
  // ===========================================================

  private handleCommand(command: string): void {

    const playing = this.player.state().playing;

    if (command.startsWith('seek:')) {

      const seconds = Number(command.slice(5));

      if (Number.isFinite(seconds)) {
        void this.player.seek(seconds);
      }

      return;
    }

    // Notificación especial del auto-picker.
    if (command === 'autopick-now') {
      void this.player.confirmAutoPick(true);
      return;
    }

    if (command === 'autopick-cancel') {
      this.player.cancelAutoPick();
      return;
    }

    // Mientras se espera la confirmación, "play" y "siguiente" de la
    // notificación multimedia confirman la canción elegida; si no,
    // reanudarían la canción que ya terminó.
    if (
      this.player.autoPickPending() &&
      (command === 'play' || command === 'toggle' || command === 'next')
    ) {
      void this.player.confirmAutoPick(true);
      return;
    }

    switch (command) {
      case 'play':
        if (!playing) void this.player.togglePlay();
        break;
      case 'pause':
        if (playing) void this.player.togglePlay();
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

      case 'shuffle':
        this.player.toggleShuffle();
        break;

      case 'repeat':
        this.player.toggleRepeat();
        break;
    }
  }
}