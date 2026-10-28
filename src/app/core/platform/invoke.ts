// =============================================================
// SHIM DE TAURI (Desktop / Android)
// =============================================================
//
// tsconfig redirige '@tauri-apps/api/core' a este archivo, así
// que ningún servicio necesita cambiar su import.
//
// - Desktop: delega todo al invoke real de Tauri.
// - Android: reproduce con <audio>, obtiene la biblioteca del
//   Musex de escritorio (streaming) y desactiva lo demás.
// =============================================================

import {
  invoke as tauriInvoke,
  convertFileSrc as tauriConvertFileSrc
} from '@tauri-real/core';

import type { Playlist } from '../models/playlist.model';

export const IS_ANDROID =
  typeof navigator !== 'undefined' &&
  /android/i.test(navigator.userAgent);

if (IS_ANDROID) {
  document.documentElement.classList.add('is-android');

  // Márgenes de las barras del sistema (estado / navegación).
  const applyInsets = (): void => {
    try {
      const root = document.documentElement.style;
      root.setProperty(
        '--safe-top',
        `${window.MusexAndroid?.safeTop() ?? 0}px`
      );
      root.setProperty(
        '--safe-bottom',
        `${window.MusexAndroid?.safeBottom() ?? 0}px`
      );
    } catch {
      /* sin puente nativo todavía */
    }
  };

  applyInsets();
  [100, 400, 1000, 2500].forEach(ms => setTimeout(applyInsets, ms));
  window.addEventListener('resize', applyInsets);
  window.addEventListener('orientationchange', applyInsets);
}

// -------------------------------------------------------------
// CONEXIÓN REMOTA (guardada tras escanear el QR)
// -------------------------------------------------------------

const REMOTE_KEY = 'musex.remote';

export interface RemoteConfig {
  base: string;
  token: string;
}

export function getRemote(): RemoteConfig | null {
  try {
    const raw = localStorage.getItem(REMOTE_KEY);
    return raw ? (JSON.parse(raw) as RemoteConfig) : null;
  } catch {
    return null;
  }
}

export function setRemote(config: RemoteConfig | null): void {
  if (config) {
    localStorage.setItem(REMOTE_KEY, JSON.stringify(config));
  } else {
    localStorage.removeItem(REMOTE_KEY);
  }
}

// -------------------------------------------------------------
// PLAYLISTS Y FAVORITOS DEL ESCRITORIO (Android)
// -------------------------------------------------------------

async function fetchRemoteJson<T>(path: string): Promise<T | null> {
  const remote = getRemote();

  if (!remote) {
    return null;
  }

  const response = await fetch(
    `${remote.base}${path}?token=${encodeURIComponent(remote.token)}`
  );

  if (!response.ok) {
    throw new Error(
      `El Musex de escritorio respondió ${response.status}.`
    );
  }

  return (await response.json()) as T;
}

export async function fetchRemotePlaylists(): Promise<Playlist[]> {
  const playlists = await fetchRemoteJson<Playlist[]>('/playlists');

  return Array.isArray(playlists) ? playlists : [];
}

/** IDs de las canciones favoritas del escritorio. */
export async function fetchRemoteFavorites(): Promise<string[]> {
  const favorites = await fetchRemoteJson<string[]>('/favorites');

  return Array.isArray(favorites)
    ? favorites.filter(id => typeof id === 'string')
    : [];
}

// -------------------------------------------------------------
// ANDROID: AUDIO CON <audio>
// -------------------------------------------------------------

declare global {
  interface Window {
    MusexAndroid?: {
      safeTop(): number;
      safeBottom(): number;

      /** Cambió la canción (título, portada, duración, estado). */
      setNowPlaying(
        title: string,
        artist: string,
        album: string,
        coverUrl: string,
        durationSec: number,
        positionSec: number,
        playing: boolean,
        shuffle: boolean,
        repeat: string
      ): void;

      /** Play / pausa / salto de posición. */
      setPlaybackState(positionSec: number, playing: boolean): void;

      /** Aleatorio / repetir. */
      setModes(shuffle: boolean, repeat: string): void;

      /** Se terminó la reproducción: quita la notificación. */
      stop(): void;

      /** ¿Android permitió escribir en la carpeta pública "Musex"? */
      hasAllFilesAccess(): boolean;

      /** Abre la pantalla de Android para conceder "Acceso a todos los archivos". */
      requestAllFilesAccess(): void;
    };
    __musexMediaCommand?: (command: string) => void;
  }
}

let audio: HTMLAudioElement | null = null;

/**
 * El <audio> terminó de verdad. Puede pasar antes de la duración que
 * indican los metadatos (por ejemplo, en MP3 de bitrate variable).
 */
let playbackEnded = false;

/** Evita que una canción vieja pise a una más reciente. */
let playToken = 0;

function player(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';

    audio.addEventListener('ended', () => {
      playbackEnded = true;
    });

    audio.addEventListener('error', () => {
      console.error(
        '[Musex] Error de audio',
        audio?.error?.code,
        audio?.error?.message
      );

      // Si falla a mitad de la canción se da por terminada para que
      // el reproductor pase a la siguiente en vez de quedarse mudo.
      if ((audio?.currentTime ?? 0) > 0) {
        playbackEnded = true;
      }
    });
  }

  return audio;
}

// -------------------------------------------------------------
// ARCHIVOS LOCALES
// -------------------------------------------------------------
//
// El protocolo asset de Tauri entrega los audios en trozos de
// ~1 MB y el WebView de Android no pide los siguientes: la música
// suena un rato y se queda muda. Por eso los archivos locales se
// leen completos con Rust y se reproducen desde un Blob.
// -------------------------------------------------------------

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wma: 'audio/x-ms-wma'
};

let blobUrl: string | null = null;
let blobPath: string | null = null;

function releaseBlob(): void {

  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
  }

  blobUrl = null;
  blobPath = null;
}

/** URL reproducible de una canción (remota: tal cual; local: Blob). */
async function audioSource(path: string): Promise<string> {

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (blobUrl && blobPath === path) {
    return blobUrl;
  }

  try {

    const buffer = await tauriInvoke<ArrayBuffer>(
      'read_local_audio',
      { path } as never
    );

    const extension =
      path.split('.').pop()?.toLowerCase() ?? '';

    const blob = new Blob(
      [buffer],
      { type: AUDIO_MIME[extension] ?? 'audio/mpeg' }
    );

    releaseBlob();

    blobUrl = URL.createObjectURL(blob);
    blobPath = path;

    return blobUrl;

  } catch (error) {

    console.warn(
      '[Musex] No se pudo leer el archivo completo; se usa el protocolo asset.',
      error
    );

    return tauriConvertFileSrc(path);
  }
}

function toUrl(path: string): string {
  return /^https?:\/\//i.test(path)
    ? path
    : tauriConvertFileSrc(path);
}

function probeDuration(url: string): Promise<number> {
  return new Promise(resolve => {
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.onloadedmetadata = () =>
      resolve(Number.isFinite(probe.duration) ? probe.duration : 0);
    probe.onerror = () => resolve(0);
    probe.src = url;
  });
}

// -------------------------------------------------------------
// ANDROID: BIBLIOTECA REMOTA
// -------------------------------------------------------------

interface RemoteTrack {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  duration: number | null;
  addedAt: string;
  hasCover: boolean;
}

async function scanRemoteLibrary(): Promise<unknown[]> {
  const remote = getRemote();

  if (!remote) {
    return [];
  }

  const { base, token } = remote;
  const query = `?token=${encodeURIComponent(token)}`;

  const response = await fetch(`${base}/library${query}`);

  if (!response.ok) {
    throw new Error(
      `El Musex de escritorio respondió ${response.status}.`
    );
  }

  const tracks = (await response.json()) as RemoteTrack[];

  return tracks.map(track => ({
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    genre: track.genre,
    duration: track.duration,
    addedAt: track.addedAt,
    path: `${base}/stream/${track.id}${query}`,
    coverPath: track.hasCover
      ? `${base}/cover/${track.id}${query}`
      : null
  }));
}

// -------------------------------------------------------------
// ANDROID: ENRUTADOR DE COMANDOS
// -------------------------------------------------------------

const NOOP = new Set([
  'stop_eq_audio',
  'pause_eq_audio',
  'resume_eq_audio',
  'reinitialize_audio_device'
]);

/** Comandos Rust registrados y disponibles en Android. */
const NATIVE_ON_ANDROID = new Set([
  // Almacenamiento
  'get_local_storage_info',
  'get_storage_info',
  'get_musex_storage_size',
  'create_directory',
  'path_exists',
  'save_cover',

  // Explorador de archivos del teléfono
  'browse_phone_directory',
  'scan_phone_audio',
  'transfer_phone_folder',
  'delete_local_files',
  'read_local_audio',
  'import_phone_audio_files',
  'analyze_phone_audio_duplicates',

  // Biblioteca local
  'scan_library',
  'scan_temp',
  'import_tracks'
]);

async function androidInvoke(
  cmd: string,
  args?: Record<string, unknown>
): Promise<unknown> {

  if (NOOP.has(cmd)) {
    return undefined;
  }

  switch (cmd) {

    // ---- Reproducción ----
    case 'play_audio': {
      const a = player();
      const path = String(args?.['path']);
      const token = ++playToken;

      const source = await audioSource(path);

      // Si mientras se leía el archivo se pidió otra canción, esta se descarta.
      if (token !== playToken) {
        return undefined;
      }

      playbackEnded = false;
      a.src = source;
      await a.play();
      return undefined;
    }

    case 'pause_audio':
      player().pause();
      return undefined;

    case 'resume_audio':
      await player().play();
      return undefined;

    case 'stop_audio': {
      const a = player();
      playToken++;
      a.pause();
      a.currentTime = 0;
      releaseBlob();
      return undefined;
    }

    case 'seek_audio':
      player().currentTime = Number(args?.['seconds'] ?? 0);
      return undefined;

    case 'set_volume':
      player().volume = Math.min(
        1,
        Math.max(0, Number(args?.['volume'] ?? 1))
      );
      return undefined;

    case 'get_audio_position':
    case 'get_eq_audio_position':
      // Si el audio terminó antes de la duración de los metadatos se
      // devuelve un valor enorme: el reproductor lo toma como "terminó"
      // y pasa a la siguiente canción.
      return playbackEnded
        ? Number.MAX_SAFE_INTEGER
        : player().currentTime;

    case 'get_audio_duration':
      return probeDuration(toUrl(String(args?.['path'])));

    // ---- Biblioteca ----
    case 'scan_library':
      return scanRemoteLibrary();

    // La música guardada en el teléfono la lee Rust (carpeta Musex).
    case 'scan_local_library':
      return tauriInvoke('scan_library');

    case 'scan_temp':
    case 'import_tracks':
    case 'list_eq_tracks':
    case 'get_download_history':
      return [];

    // ---- Archivos del teléfono (Rust) ----
    default:
      if (NATIVE_ON_ANDROID.has(cmd)) {
        return tauriInvoke(cmd, args as never);
      }

      // Descargas, ecualizador, Sense, etc.: solo en escritorio.
      throw new Error(
        `"${cmd}" no está disponible en Android.`
      );
  }
}

// -------------------------------------------------------------
// API PÚBLICA (misma firma que @tauri-apps/api/core)
// -------------------------------------------------------------

export function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  return IS_ANDROID
    ? (androidInvoke(cmd, args) as Promise<T>)
    : tauriInvoke<T>(cmd, args as never);
}

export function convertFileSrc(
  filePath: string,
  protocol?: string
): string {
  if (/^https?:\/\//i.test(filePath)) {
    return filePath;
  }

  return tauriConvertFileSrc(filePath, protocol);
}