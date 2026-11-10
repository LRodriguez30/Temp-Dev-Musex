import { Injectable, inject } from '@angular/core';

import { Track } from '../models/track.model';

import { LibraryService } from './library.service';
import { QueueService } from './queue.service';
import { HistoryService } from './history.service';

/** Cuántas reproducciones recientes se excluyen para no repetir. */
const RECENT_EXCLUDE = 15;

/** Cuántas entradas del historial pesan en el gusto del usuario. */
const HISTORY_WINDOW = 40;

/** Se elige al azar entre las N mejores para no ser predecible. */
const TOP_CANDIDATES = 5;

/**
 * Elige la siguiente canción "por ti".
 *
 * Es local y determinista en su base (sin red ni Gemini): puntúa
 * las canciones de la biblioteca según qué artistas y géneros
 * aparecen en la canción que acaba de terminar, en tu historial
 * reciente y en tu cola.
 */
@Injectable({
  providedIn: 'root'
})
export class AutoPickService {

  private readonly library = inject(LibraryService);
  private readonly queue = inject(QueueService);
  private readonly history = inject(HistoryService);

  pick(current: Track | undefined): Track | null {

    const tracks = this.library
      .getTracks()
      .filter(track => Boolean(track.path));

    if (tracks.length === 0) {
      return null;
    }

    const byId = new Map(tracks.map(track => [track.id, track]));

    const artists = new Map<string, number>();
    const genres = new Map<string, number>();

    const learn = (track: Track | undefined, weight: number) => {

      if (!track) {
        return;
      }

      const artist = this.key(track.artist);
      const genre = this.key(track.genre);

      if (artist) {
        artists.set(artist, (artists.get(artist) ?? 0) + weight);
      }

      if (genre) {
        genres.set(genre, (genres.get(genre) ?? 0) + weight);
      }
    };

    // Lo que acaba de sonar es la señal más fuerte.
    learn(current, 2.5);

    // Historial reciente: pesa menos cuanto más antiguo.
    const recentHistory = this.history
      .getHistory()
      .slice(0, HISTORY_WINDOW);

    recentHistory.forEach((entry, index) =>
      learn(byId.get(entry.trackId), 1.5 / (1 + index * 0.2))
    );

    // La cola es el contexto actual de escucha.
    const queueIds = new Set(this.queue.getQueue());

    queueIds.forEach(id => learn(byId.get(id), 0.8));

    // No repetir lo reciente, lo actual ni lo que ya viene en la cola.
    const recent = new Set(
      recentHistory
        .slice(0, RECENT_EXCLUDE)
        .map(entry => entry.trackId)
    );

    if (current) {
      recent.add(current.id);
    }

    let candidates = tracks.filter(
      track => !recent.has(track.id) && !queueIds.has(track.id)
    );

    // Biblioteca pequeña: se relajan las exclusiones.
    if (candidates.length === 0) {
      candidates = tracks.filter(track => !recent.has(track.id));
    }

    if (candidates.length === 0) {
      candidates = tracks.filter(track => track.id !== current?.id);
    }

    if (candidates.length === 0) {
      return null;
    }

    const currentAlbum = this.key(current?.album);

    const scored = candidates
      .map(track => {

        const album = this.key(track.album);

        const score =
          (artists.get(this.key(track.artist)) ?? 0) * 3 +
          (genres.get(this.key(track.genre)) ?? 0) * 2 +
          (track.favorite ? 1.5 : 0) +
          (currentAlbum && album === currentAlbum ? 1 : 0) +
          Math.random() * 0.4;

        return { track, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_CANDIDATES);

    // Sorteo ponderado entre los mejores.
    const total = scored.reduce(
      (sum, item) => sum + item.score + 1,
      0
    );

    let roll = Math.random() * total;

    for (const item of scored) {

      roll -= item.score + 1;

      if (roll <= 0) {
        return item.track;
      }
    }

    return scored[0].track;
  }

  private key(value: string | undefined | null): string {
    return (value ?? '').trim().toLowerCase();
  }
}
