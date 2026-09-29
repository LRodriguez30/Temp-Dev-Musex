// =============================================================
// MUSEX - RECOMMENDATION SERVICE
// =============================================================
//
// Arma el payload de biblioteca + historial reciente y pide a
// Rust que genere recomendaciones vía Sense/Gemini. El prompt
// real (fijo, con el schema JSON) vive en Rust — este servicio
// solo envía datos, nunca instrucciones de sistema.
// =============================================================

import { Injectable, inject } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { LibraryService } from './library.service';
import { HistoryService } from './history.service';

export interface RecommendedTrack {
  title: string;
  artist: string;
  reason: string;
}

interface LibraryTrackPayload {
  title: string;
  artist: string;
  genre: string | null;
}

interface HistoryEntryPayload {
  title: string;
  artist: string;
  playedAt: string;
}

const MAX_HISTORY_ENTRIES = 30;

@Injectable({ providedIn: 'root' })
export class RecommendationService {

  private readonly library = inject(LibraryService);
  private readonly history = inject(HistoryService);

  async getRecommendations(): Promise<RecommendedTrack[]> {
    const libraryPayload: LibraryTrackPayload[] = this.library.getTracks().map(track => ({
      title: track.title,
      artist: track.artist,
      genre: track.genre ?? null,
    }));

    const recentHistory = this.history.getHistory().slice(0, MAX_HISTORY_ENTRIES);

    const historyPayload: HistoryEntryPayload[] = recentHistory
      .map(entry => {
        const track = this.library.getTrack(entry.trackId);
        if (!track) {
          return null;
        }
        return {
          title: track.title,
          artist: track.artist,
          playedAt: entry.playedAt,
        };
      })
      .filter((entry): entry is HistoryEntryPayload => entry !== null);

    return invoke<RecommendedTrack[]>('get_sense_recommendations', {
      library: libraryPayload,
      history: historyPayload,
    });
  }
}