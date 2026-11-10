import { Injectable, effect, inject, signal } from '@angular/core';

import { LibraryService } from './library.service';
import { PlayerService } from './player.service';

// =============================================================
// TIPOS
// =============================================================

/** Una reproducción que cuenta para las estadísticas. */
export interface PlayLogEntry {
  id: string;
  trackId: string;

  /** Copia de los datos: sigue contando aunque se borre la canción. */
  title: string;
  artist: string;
  album: string;
  genre?: string;

  /** Cuándo empezó (ISO). */
  at: string;

  /** Segundos realmente escuchados. */
  seconds: number;
}

interface SessionMeta {
  title: string;
  artist: string;
  album: string;
  genre?: string;
  duration: number;
}

interface Session {
  trackId: string;
  startedAt: string;
  seconds: number;

  /** Datos de la canción, copiados en cuanto la biblioteca los tiene. */
  meta?: SessionMeta;
}

// =============================================================
// CONSTANTES
// =============================================================

const STORAGE_KEY = 'musex_play_log';
const SESSION_KEY = 'musex_play_session';
const MAX_ENTRIES = 5000;

/** Para contar como reproducción: 30 s, o la mitad si la canción es corta. */
const MIN_SECONDS = 30;

/** Un tick no puede sumar más que esto (la ventana oculta se ralentiza). */
const MAX_TICK_SECONDS = 2;

/** Cada cuánto se guarda una instantánea de la reproducción en curso. */
const SNAPSHOT_INTERVAL_MS = 15_000;

/**
 * Registra qué se escucha y durante cuánto tiempo, para la página
 * de estadísticas.
 *
 * Mide el tiempo real de reproducción (no la duración de la canción):
 * si saltas a los 10 s, no cuenta como reproducción.
 */
@Injectable({
  providedIn: 'root'
})
export class ListeningStatsService {

  private readonly player = inject(PlayerService);
  private readonly library = inject(LibraryService);

  private readonly log = signal<PlayLogEntry[]>(this.load());

  readonly entries = this.log.asReadonly();

  private session: Session | null = null;
  private lastTick = 0;

  constructor() {

    // Si la app se cerró en mitad de una canción, se recupera lo escuchado.
    this.recoverSession();

    effect(() => this.onTick());

    if (typeof window !== 'undefined') {

      // La instantánea NO crea una reproducción nueva: solo evita
      // perder lo escuchado si la app se cierra de golpe.
      window.addEventListener('pagehide', () => this.snapshot());

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.snapshot();
        }
      });

      setInterval(() => this.snapshot(), SNAPSHOT_INTERVAL_MS);
    }
  }

  // ===========================================================
  // SEGUIMIENTO
  // ===========================================================

  private onTick(): void {

    const state = this.player.state();
    const now = performance.now();

    // Cambió la canción (o no hay ninguna): se cierra la sesión anterior.
    if (this.session && this.session.trackId !== state.currentTrackId) {
      this.finishSession();
    }

    if (!state.currentTrackId) {
      this.lastTick = now;
      return;
    }

    if (!this.session) {

      this.session = {
        trackId: state.currentTrackId,
        startedAt: new Date().toISOString(),
        seconds: 0
      };
    }

    if (!this.session.meta) {

      const track = this.library.getTrack(this.session.trackId);

      if (track) {
        this.session.meta = {
          title: track.title,
          artist: track.artist,
          album: track.album,
          genre: track.genre,
          duration: track.duration
        };
      }
    }

    if (state.playing && this.lastTick > 0) {

      const delta = (now - this.lastTick) / 1000;

      this.session.seconds += Math.min(Math.max(delta, 0), MAX_TICK_SECONDS);
    }

    this.lastTick = now;
  }

  /** Cierra la sesión actual y la guarda si cuenta como reproducción. */
  private finishSession(): void {

    const session = this.session;

    this.session = null;

    this.clearSnapshot();

    if (session) {
      this.commit(session);
    }
  }

  /** Convierte una sesión en una entrada del registro, si corresponde. */
  private commit(session: Session): void {

    const track = this.library.getTrack(session.trackId);

    const meta: SessionMeta | undefined = session.meta ?? (track
      ? {
        title: track.title,
        artist: track.artist,
        album: track.album,
        genre: track.genre,
        duration: track.duration
      }
      : undefined);

    if (!meta) {
      return;
    }

    const threshold = meta.duration > 0
      ? Math.min(MIN_SECONDS, meta.duration / 2)
      : MIN_SECONDS;

    if (session.seconds < threshold) {
      return;
    }

    const entry: PlayLogEntry = {
      id: `play-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      trackId: session.trackId,
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      genre: meta.genre,
      at: session.startedAt,
      seconds: Math.round(session.seconds)
    };

    this.log.update(list => [entry, ...list].slice(0, MAX_ENTRIES));

    this.persist();
  }

  // ===========================================================
  // INSTANTÁNEA DE LA SESIÓN EN CURSO
  // ===========================================================

  private snapshot(): void {

    if (!this.session || !this.session.meta) {
      return;
    }

    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
    } catch {
      /* sin espacio: se pierde solo la instantánea */
    }
  }

  private clearSnapshot(): void {

    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* nada que limpiar */
    }
  }

  private recoverSession(): void {

    try {

      const raw = localStorage.getItem(SESSION_KEY);

      if (!raw) {
        return;
      }

      localStorage.removeItem(SESSION_KEY);

      const session = JSON.parse(raw) as Session;

      if (session?.trackId && session.meta && session.seconds > 0) {
        this.commit(session);
      }

    } catch {
      /* instantánea ilegible: se descarta */
    }
  }

  // ===========================================================
  // ADMINISTRACIÓN
  // ===========================================================

  clear(): void {

    this.log.set([]);

    this.persist();
  }

  // ===========================================================
  // PERSISTENCIA
  // ===========================================================

  private persist(): void {

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.log()));
    } catch (error) {
      console.error('[Musex] No se pudieron guardar las estadísticas:', error);
    }
  }

  private load(): PlayLogEntry[] {

    try {

      const raw = localStorage.getItem(STORAGE_KEY);

      if (raw) {

        const parsed: unknown = JSON.parse(raw);

        if (Array.isArray(parsed)) {
          return parsed as PlayLogEntry[];
        }
      }

    } catch {
      /* registro ilegible: se empieza vacío */
    }

    return [];
  }
}
