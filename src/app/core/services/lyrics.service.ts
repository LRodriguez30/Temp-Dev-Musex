import { Injectable, signal } from '@angular/core';

import { Track } from '../models/track.model';

// =============================================================
// TIPOS
// =============================================================

export interface LyricLine {
  /** Segundo en que empieza la línea. */
  time: number;
  text: string;
}

export type LyricsStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'instrumental'
  | 'notfound'
  | 'error';

export type LyricsSource = 'lrclib' | 'manual';

export interface TrackLyrics {
  /** Líneas sincronizadas (null si solo hay letra sin tiempos). */
  synced: LyricLine[] | null;
  plain: string | null;
  source: LyricsSource;
}

interface CacheEntry {
  synced?: string;
  plain?: string;
  instrumental?: boolean;
  notFound?: boolean;
  source: LyricsSource;
  at: number;
}

interface LrclibItem {
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

// =============================================================
// CONSTANTES
// =============================================================

const API = 'https://lrclib.net/api';
const CACHE_KEY = 'musex_lyrics_cache';
const MAX_ENTRIES = 250;
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

/** Diferencia máxima de duración para aceptar un resultado. */
const MAX_DURATION_DIFF = 8;

class NetworkFailure extends Error { }

/**
 * Obtiene las letras de las canciones.
 *
 * Busca en LRCLIB (base de datos abierta con letras sincronizadas),
 * guarda el resultado en el dispositivo y permite pegar una letra
 * propia. Funciona igual en escritorio y Android porque la consulta
 * se hace desde la interfaz, sin comandos de Rust.
 */
@Injectable({
  providedIn: 'root'
})
export class LyricsService {

  readonly status = signal<LyricsStatus>('idle');

  readonly lyrics = signal<TrackLyrics | null>(null);

  /** Qué canción muestra el estado actual. */
  readonly trackId = signal<string | null>(null);

  private requestId = 0;

  // ===========================================================
  // API PÚBLICA
  // ===========================================================

  reset(): void {

    this.requestId++;

    this.trackId.set(null);
    this.lyrics.set(null);
    this.status.set('idle');
  }

  async load(
    track: Track,
    force = false
  ): Promise<void> {

    const requestId = ++this.requestId;

    this.trackId.set(track.id);
    this.lyrics.set(null);
    this.status.set('loading');

    const cache = this.readCache();
    const cached = cache[track.id];

    if (!force && cached && this.isUsable(cached)) {
      this.apply(cached);
      return;
    }

    let entry: CacheEntry;

    try {

      entry = await this.lookup(track);

    } catch {

      if (requestId === this.requestId) {
        this.status.set('error');
      }

      return;
    }

    if (requestId !== this.requestId) {
      return;
    }

    cache[track.id] = entry;

    this.writeCache(cache);

    this.apply(entry);
  }

  /** Guarda una letra escrita o pegada por el usuario. */
  saveManual(
    track: Track,
    text: string
  ): boolean {

    const clean = text.replace(/\r\n/g, '\n').trim();

    if (!clean) {
      return false;
    }

    const entry: CacheEntry = {
      source: 'manual',
      at: Date.now()
    };

    if (this.parseLrc(clean).length >= 2) {
      entry.synced = clean;
    } else {
      entry.plain = clean;
    }

    const cache = this.readCache();

    cache[track.id] = entry;

    this.writeCache(cache);

    if (this.trackId() === track.id) {
      this.apply(entry);
    }

    return true;
  }

  /** Descarta lo guardado y vuelve a buscar en línea. */
  async removeStored(track: Track): Promise<void> {

    const cache = this.readCache();

    delete cache[track.id];

    this.writeCache(cache);

    await this.load(track, true);
  }

  /** Texto editable de la letra actual (para el editor). */
  editableText(): string {

    const lyrics = this.lyrics();

    if (!lyrics) {
      return '';
    }

    if (lyrics.synced) {
      return lyrics.synced
        .map(line => `[${this.formatStamp(line.time)}]${line.text}`)
        .join('\n');
    }

    return lyrics.plain ?? '';
  }

  // ===========================================================
  // BÚSQUEDA
  // ===========================================================

  private async lookup(track: Track): Promise<CacheEntry> {

    const query = this.buildQuery(track);

    let failed = false;

    const attempt = async <T>(url: string): Promise<T | null> => {

      try {
        return await this.fetchJson<T>(url);
      } catch {
        failed = true;
        return null;
      }
    };

    // 1) Coincidencia exacta (requiere álbum y duración).
    if (query.album && query.duration > 0) {

      const params = new URLSearchParams({
        track_name: query.title,
        artist_name: query.artist,
        album_name: query.album,
        duration: String(Math.round(query.duration))
      });

      const exact = await attempt<LrclibItem>(
        `${API}/get?${params}`
      );

      if (exact) {
        return this.toEntry(exact);
      }
    }

    // 2) Búsqueda por título y artista.
    const searches: string[] = [];

    const byFields = new URLSearchParams({ track_name: query.title });

    if (query.artist) {
      byFields.set('artist_name', query.artist);
    }

    searches.push(`${API}/search?${byFields}`);

    // 3) Búsqueda libre.
    searches.push(
      `${API}/search?${new URLSearchParams({
        q: `${query.artist} ${query.title}`.trim()
      })}`
    );

    for (const url of searches) {

      const results = await attempt<LrclibItem[]>(url);

      const best = results ? this.pickBest(results, query) : null;

      if (best) {
        return this.toEntry(best);
      }
    }

    if (failed) {
      throw new NetworkFailure();
    }

    return {
      notFound: true,
      source: 'lrclib',
      at: Date.now()
    };
  }

  private pickBest(
    results: LrclibItem[],
    query: { title: string; artist: string; duration: number }
  ): LrclibItem | null {

    const normalize = (value: string | undefined) =>
      (value ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const wantedTitle = normalize(query.title);

    let best: LrclibItem | null = null;
    let bestScore = -Infinity;

    for (const item of results) {

      if (
        !item.instrumental &&
        !item.syncedLyrics &&
        !item.plainLyrics
      ) {
        continue;
      }

      let score = 0;

      const title = normalize(item.trackName);

      if (title === wantedTitle) {
        score += 4;
      } else if (
        title.includes(wantedTitle) ||
        wantedTitle.includes(title)
      ) {
        score += 1;
      } else {
        continue;
      }

      if (query.duration > 0 && item.duration) {

        const diff = Math.abs(item.duration - query.duration);

        // Otra versión (en vivo, remix...): se descarta.
        if (diff > MAX_DURATION_DIFF) {
          continue;
        }

        score += Math.max(0, 3 - diff);
      }

      if (query.artist) {

        const artist = normalize(item.artistName);
        const wanted = normalize(query.artist);

        if (artist === wanted) {
          score += 3;
        } else if (
          artist.includes(wanted) ||
          wanted.includes(artist)
        ) {
          score += 1;
        }
      }

      if (item.syncedLyrics) {
        score += 2;
      }

      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }

    return best;
  }

  private toEntry(item: LrclibItem): CacheEntry {

    if (item.instrumental) {
      return {
        instrumental: true,
        source: 'lrclib',
        at: Date.now()
      };
    }

    const entry: CacheEntry = {
      source: 'lrclib',
      at: Date.now()
    };

    if (item.syncedLyrics) {
      entry.synced = item.syncedLyrics;
    }

    if (item.plainLyrics) {
      entry.plain = item.plainLyrics;
    }

    if (!entry.synced && !entry.plain) {
      return { notFound: true, source: 'lrclib', at: Date.now() };
    }

    return entry;
  }

  /** null = no existe (404); lanza si hubo un fallo de red. */
  private async fetchJson<T>(url: string): Promise<T | null> {

    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      TIMEOUT_MS
    );

    try {

      const response = await fetch(url, {
        signal: controller.signal
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new NetworkFailure();
      }

      return await response.json() as T;

    } finally {

      clearTimeout(timer);
    }
  }

  // ===========================================================
  // PREPARACIÓN DE LA CONSULTA
  // ===========================================================

  private buildQuery(track: Track): {
    title: string;
    artist: string;
    album: string;
    duration: number;
  } {

    let title = this.cleanTitle(track.title);

    let artist = (track.artist ?? '').trim();

    const unknownArtist =
      !artist || /desconocid|unknown/i.test(artist);

    if (unknownArtist) {

      // Descargas de YouTube: "Artista - Canción".
      const parts = title.split(/\s[-–]\s/);

      if (parts.length >= 2) {
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
      } else {
        artist = '';
      }

    } else {

      const prefix = `${artist} - `.toLowerCase();

      if (title.toLowerCase().startsWith(prefix)) {
        title = title.slice(prefix.length).trim();
      }
    }

    const album = (track.album ?? '').trim();

    const knownAlbum =
      album && !/^(youtube|desconocid|unknown)/i.test(album)
        ? album
        : '';

    return {
      title,
      artist,
      album: knownAlbum,
      duration: track.duration ?? 0
    };
  }

  private cleanTitle(title: string): string {

    return (title ?? '')
      .replace(
        /[(\[{][^)\]}]*(official|video|audio|lyric|letra|visuali[sz]er|remaster|feat|ft\.|\bhd\b|\bhq\b|4k|m\/v|\bmv\b|clip)[^)\]}]*[)\]}]/gi,
        ''
      )
      .replace(/\s*[-–|]\s*(official|lyric|letra|audio|video).*$/i, '')
      .replace(/\s+(ft\.?|feat\.?|featuring)\s+.*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // ===========================================================
  // LRC
  // ===========================================================

  /** Convierte texto LRC en líneas ordenadas por tiempo. */
  parseLrc(text: string): LyricLine[] {

    const lines: LyricLine[] = [];

    const stamp = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

    for (const raw of text.split(/\r?\n/)) {

      const times: number[] = [];

      let lastEnd = 0;

      let match: RegExpExecArray | null;

      stamp.lastIndex = 0;

      while ((match = stamp.exec(raw)) !== null) {

        const fraction = match[3]
          ? Number(`0.${match[3]}`)
          : 0;

        times.push(
          Number(match[1]) * 60 +
          Number(match[2]) +
          fraction
        );

        lastEnd = stamp.lastIndex;
      }

      // Etiquetas como [ar:...] no tienen tiempo: se ignoran.
      if (times.length === 0) {
        continue;
      }

      const content = raw.slice(lastEnd).trim();

      for (const time of times) {
        lines.push({ time, text: content });
      }
    }

    return lines.sort((a, b) => a.time - b.time);
  }

  private formatStamp(seconds: number): string {

    const minutes = Math.floor(seconds / 60);

    const rest = seconds - minutes * 60;

    return `${String(minutes).padStart(2, '0')}:${rest
      .toFixed(2)
      .padStart(5, '0')}`;
  }

  // ===========================================================
  // ESTADO
  // ===========================================================

  private apply(entry: CacheEntry): void {

    if (entry.instrumental) {
      this.lyrics.set(null);
      this.status.set('instrumental');
      return;
    }

    if (entry.notFound) {
      this.lyrics.set(null);
      this.status.set('notfound');
      return;
    }

    const synced = entry.synced
      ? this.parseLrc(entry.synced)
      : [];

    const plain =
      entry.plain ??
      (synced.length > 0
        ? synced.map(line => line.text).join('\n')
        : null);

    if (synced.length === 0 && !plain) {
      this.lyrics.set(null);
      this.status.set('notfound');
      return;
    }

    this.lyrics.set({
      synced: synced.length > 0 ? synced : null,
      plain,
      source: entry.source
    });

    this.status.set('ready');
  }

  /** Las búsquedas fallidas caducan; lo demás se conserva. */
  private isUsable(entry: CacheEntry): boolean {

    if (entry.notFound) {
      return Date.now() - entry.at < NOT_FOUND_TTL_MS;
    }

    return true;
  }

  // ===========================================================
  // CACHÉ
  // ===========================================================

  private readCache(): Record<string, CacheEntry> {

    try {

      const raw = localStorage.getItem(CACHE_KEY);

      if (!raw) {
        return {};
      }

      const parsed: unknown = JSON.parse(raw);

      return parsed && typeof parsed === 'object'
        ? parsed as Record<string, CacheEntry>
        : {};

    } catch {

      return {};
    }
  }

  private writeCache(cache: Record<string, CacheEntry>): void {

    const ids = Object.keys(cache);

    // Si hay demasiadas, se descartan las más antiguas (nunca las manuales).
    if (ids.length > MAX_ENTRIES) {

      const removable = ids
        .filter(id => cache[id].source !== 'manual')
        .sort((a, b) => cache[a].at - cache[b].at);

      for (const id of removable.slice(0, ids.length - MAX_ENTRIES)) {
        delete cache[id];
      }
    }

    try {

      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));

    } catch (error) {

      console.error(
        '[Musex] No se pudieron guardar las letras:',
        error
      );
    }
  }
}
