import { Injectable, computed, inject, signal } from '@angular/core';

import { DownloadService } from './download.service';
import { LibraryService } from './library.service';
import { PreferredSource, RecommendedTrack } from './recommendation.service';

// =============================================================
// TIPOS
// =============================================================

export type ExploreKind = 'sense' | 'link';

export type ExplorePeriod = 'day' | 'week' | 'month' | 'year' | 'all';

export type LinkProvider = 'youtube' | 'newgrounds';

export interface ExploreItem {
  id: string;
  kind: ExploreKind;
  title: string;
  artist: string;
  reason?: string;
  preferredSource: PreferredSource;

  /** Solo para enlaces añadidos por el usuario. */
  url?: string;
  provider?: LinkProvider;

  /** true = la existencia del enlace se comprobó en línea. */
  verified: boolean;

  createdAt: string;
}

export type AddLinkResult =
  | { ok: true; item: ExploreItem }
  | { ok: false; error: string };

type YouTubeCheck =
  | { status: 'ok'; title: string; author: string }
  | { status: 'missing' }
  | { status: 'offline' };

// =============================================================
// CONSTANTES
// =============================================================

const STORAGE_KEY = 'musex_explore_items';
const MAX_ITEMS = 500;
const CHECK_TIMEOUT_MS = 8000;

/** Cuántas canciones ya recomendadas se envían a Sense para no repetir. */
const MAX_EXCLUDED = 150;

/**
 * Recomendaciones y enlaces guardados de Explore.
 *
 * Todo se conserva en el dispositivo para que no desaparezca al
 * cambiar de página, y se puede filtrar por día, semana, mes, año
 * o todo.
 */
@Injectable({
  providedIn: 'root'
})
export class ExploreStoreService {

  private readonly library = inject(LibraryService);
  private readonly downloads = inject(DownloadService);

  private readonly state = signal<ExploreItem[]>(this.load());

  readonly items = this.state.asReadonly();

  readonly hasItems = computed(() => this.state().length > 0);

  // ===========================================================
  // CONSULTA
  // ===========================================================

  /** Elementos del periodo, los más recientes primero. */
  itemsFor(period: ExplorePeriod): ExploreItem[] {

    const start = this.periodStart(period);

    return this.state()
      .filter(item => this.time(item.createdAt) >= start)
      .sort(
        (a, b) => this.time(b.createdAt) - this.time(a.createdAt)
      );
  }

  /** Canciones ya recomendadas, para que Sense no las repita. */
  excludedForSense(): { title: string; artist: string }[] {

    return [...this.state()]
      .sort((a, b) => this.time(b.createdAt) - this.time(a.createdAt))
      .slice(0, MAX_EXCLUDED)
      .map(item => ({ title: item.title, artist: item.artist }));
  }

  // ===========================================================
  // RECOMENDACIONES DE SENSE
  // ===========================================================

  /**
   * Guarda solo las recomendaciones que son realmente nuevas: no
   * repetidas, ni ya guardadas ni presentes en la biblioteca.
   */
  addSense(tracks: RecommendedTrack[]): ExploreItem[] {

    const known = new Set<string>([
      ...this.state().map(item => this.key(item.title, item.artist)),
      ...this.library.getTracks().map(
        track => this.key(track.title, track.artist)
      )
    ]);

    const added: ExploreItem[] = [];

    for (const track of tracks) {

      const title = (track.title ?? '').trim();
      const artist = (track.artist ?? '').trim();

      if (!title || !artist) {
        continue;
      }

      const key = this.key(title, artist);

      if (known.has(key)) {
        continue;
      }

      known.add(key);

      added.push({
        id: this.newId(),
        kind: 'sense',
        title,
        artist,
        reason: track.reason,
        preferredSource: track.preferredSource,
        verified: false,
        createdAt: new Date().toISOString()
      });
    }

    if (added.length > 0) {
      this.commit([...added, ...this.state()]);
    }

    return added;
  }

  // ===========================================================
  // ENLACES
  // ===========================================================

  async addLink(input: string): Promise<AddLinkResult> {

    const url = this.downloads.normalizeUrl(input);

    if (!url) {
      return { ok: false, error: 'Pega un enlace de YouTube o Newgrounds.' };
    }

    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: 'El enlace no es válido.' };
    }

    const host = parsed.hostname.toLowerCase();

    // ---------------- YouTube ----------------

    if (this.isHost(host, 'youtube.com') || this.isHost(host, 'youtu.be')) {

      const videoId = this.youTubeId(parsed);

      if (!videoId) {
        return {
          ok: false,
          error: 'Ese enlace de YouTube no apunta a un video concreto.'
        };
      }

      const canonical = `https://www.youtube.com/watch?v=${videoId}`;

      if (this.hasUrl(canonical)) {
        return { ok: false, error: 'Ese enlace ya está en tu lista.' };
      }

      const check = await this.checkYouTube(canonical);

      if (check.status === 'missing') {
        return {
          ok: false,
          error: 'El video no existe, es privado o no se puede incrustar.'
        };
      }

      const item: ExploreItem = {
        id: this.newId(),
        kind: 'link',
        title: check.status === 'ok' ? check.title : `Video de YouTube (${videoId})`,
        artist: check.status === 'ok' ? check.author : 'YouTube',
        preferredSource: 'youtube',
        url: canonical,
        provider: 'youtube',
        verified: check.status === 'ok',
        createdAt: new Date().toISOString()
      };

      this.commit([item, ...this.state()]);

      return { ok: true, item };
    }

    // ---------------- Newgrounds ----------------

    if (this.isHost(host, 'newgrounds.com')) {

      const match = parsed.pathname.match(
        /^\/(audio\/listen|portal\/view)\/(\d+)/
      );

      if (!match) {
        return {
          ok: false,
          error: 'Usa un enlace de audio de Newgrounds (…/audio/listen/123).'
        };
      }

      const canonical =
        `https://www.newgrounds.com/${match[1]}/${match[2]}`;

      if (this.hasUrl(canonical)) {
        return { ok: false, error: 'Ese enlace ya está en tu lista.' };
      }

      // Newgrounds no permite comprobar el contenido desde la app:
      // el formato es válido pero no queda verificado.
      const item: ExploreItem = {
        id: this.newId(),
        kind: 'link',
        title: `Audio de Newgrounds (#${match[2]})`,
        artist: 'Newgrounds',
        preferredSource: 'newgrounds',
        url: canonical,
        provider: 'newgrounds',
        verified: false,
        createdAt: new Date().toISOString()
      };

      this.commit([item, ...this.state()]);

      return { ok: true, item };
    }

    return {
      ok: false,
      error: 'Solo se admiten enlaces de YouTube y Newgrounds.'
    };
  }

  /** Reintenta verificar un enlace de YouTube sin verificar. */
  async verifyLink(id: string): Promise<boolean> {

    const item = this.state().find(entry => entry.id === id);

    if (!item?.url || item.provider !== 'youtube') {
      return false;
    }

    const check = await this.checkYouTube(item.url);

    if (check.status !== 'ok') {
      return false;
    }

    this.commit(
      this.state().map(entry =>
        entry.id === id
          ? {
            ...entry,
            title: check.title,
            artist: check.author,
            verified: true
          }
          : entry
      )
    );

    return true;
  }

  // ===========================================================
  // ELIMINAR
  // ===========================================================

  remove(id: string): void {
    this.commit(this.state().filter(item => item.id !== id));
  }

  clear(): void {
    this.commit([]);
  }

  // ===========================================================
  // VERIFICACIÓN EN LÍNEA
  // ===========================================================

  private async checkYouTube(canonicalUrl: string): Promise<YouTubeCheck> {

    const target = encodeURIComponent(canonicalUrl);

    // 1) oEmbed oficial de YouTube.
    try {

      const response = await this.timedFetch(
        `https://www.youtube.com/oembed?url=${target}&format=json`
      );

      if (response.ok) {

        const data = await response.json() as {
          title?: string;
          author_name?: string;
        };

        if (data.title) {
          return {
            status: 'ok',
            title: data.title,
            author: data.author_name ?? 'YouTube'
          };
        }
      }

      if ([400, 401, 403, 404].includes(response.status)) {
        return { status: 'missing' };
      }

    } catch {
      /* se prueba el respaldo */
    }

    // 2) Respaldo con CORS abierto.
    try {

      const response = await this.timedFetch(
        `https://noembed.com/embed?url=${target}`
      );

      const data = await response.json() as {
        title?: string;
        author_name?: string;
        error?: string;
      };

      if (data.title) {
        return {
          status: 'ok',
          title: data.title,
          author: data.author_name ?? 'YouTube'
        };
      }

      if (data.error && /404|not found|unauthorized|401/i.test(data.error)) {
        return { status: 'missing' };
      }

    } catch {
      /* sin conexión */
    }

    return { status: 'offline' };
  }

  private async timedFetch(url: string): Promise<Response> {

    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      CHECK_TIMEOUT_MS
    );

    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // ===========================================================
  // UTILIDADES
  // ===========================================================

  private youTubeId(url: URL): string | null {

    const host = url.hostname.toLowerCase();

    let id: string | null = null;

    if (this.isHost(host, 'youtu.be')) {
      id = url.pathname.split('/')[1] ?? null;
    } else {

      id = url.searchParams.get('v');

      if (!id) {

        const match = url.pathname.match(
          /^\/(?:shorts|embed|live|v)\/([^/?#]+)/
        );

        id = match ? match[1] : null;
      }
    }

    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }

  private isHost(host: string, domain: string): boolean {
    return host === domain || host.endsWith(`.${domain}`);
  }

  private hasUrl(url: string): boolean {
    return this.state().some(item => item.url === url);
  }

  private periodStart(period: ExplorePeriod): number {

    const now = new Date();

    const day = new Date(
      now.getFullYear(), now.getMonth(), now.getDate()
    );

    switch (period) {

      case 'day':
        return day.getTime();

      case 'week': {
        // La semana empieza el lunes.
        const offset = (day.getDay() + 6) % 7;
        day.setDate(day.getDate() - offset);
        return day.getTime();
      }

      case 'month':
        return new Date(now.getFullYear(), now.getMonth(), 1).getTime();

      case 'year':
        return new Date(now.getFullYear(), 0, 1).getTime();

      default:
        return 0;
    }
  }

  private key(title: string, artist: string): string {

    const normalize = (value: string) =>
      value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    return `${normalize(artist)}|${normalize(title)}`;
  }

  private time(iso: string): number {

    const value = Date.parse(iso);

    return Number.isNaN(value) ? 0 : value;
  }

  private newId(): string {
    return `explore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // ===========================================================
  // PERSISTENCIA
  // ===========================================================

  private commit(items: ExploreItem[]): void {

    const trimmed = items.slice(0, MAX_ITEMS);

    this.state.set(trimmed);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (error) {
      console.error('[Musex] No se pudo guardar Explore:', error);
    }
  }

  private load(): ExploreItem[] {

    try {

      const raw = localStorage.getItem(STORAGE_KEY);

      if (raw) {

        const parsed: unknown = JSON.parse(raw);

        if (Array.isArray(parsed)) {
          return parsed as ExploreItem[];
        }
      }

    } catch {
      /* lista ilegible: se empieza vacía */
    }

    return [];
  }
}
