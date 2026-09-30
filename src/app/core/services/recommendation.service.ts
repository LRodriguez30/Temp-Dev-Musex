// =============================================================
// MUSEX - RECOMMENDATION SERVICE
// =============================================================
//
// Arma el payload de biblioteca + historial reciente y pide a
// Rust que genere recomendaciones vía Sense/Gemini.
//
// El prompt real (fijo, con el schema JSON) vive en Rust.
// Este servicio solo envía datos y recibe las recomendaciones.
//
// preferredSource indica qué proveedor debería intentar primero
// Musex al momento de resolver una vista previa:
//
// - youtube
// - newgrounds
// - either
//
// No significa que la canción exista realmente en ese proveedor.
// La disponibilidad deberá verificarse posteriormente.
// =============================================================

import { Injectable, inject } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

import { LibraryService } from './library.service';
import { HistoryService } from './history.service';

// =============================================================
// TYPES
// =============================================================

export type PreferredSource =
  | 'youtube'
  | 'newgrounds'
  | 'either';

export interface RecommendedTrack {
  title: string;
  artist: string;
  reason: string;
  preferredSource: PreferredSource;
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

// =============================================================
// CONFIG
// =============================================================

const MAX_HISTORY_ENTRIES = 30;

// =============================================================
// SERVICE
// =============================================================

@Injectable({ providedIn: 'root' })
export class RecommendationService {

  private readonly library = inject(LibraryService);
  private readonly history = inject(HistoryService);

  // ============================================================
  // GET RECOMMENDATIONS
  // ============================================================

  async getRecommendations(): Promise<RecommendedTrack[]> {

    // ----------------------------------------------------------
    // LIBRARY
    // ----------------------------------------------------------

    const libraryPayload: LibraryTrackPayload[] =
      this.library.getTracks().map(track => ({
        title: track.title,
        artist: track.artist,
        genre: track.genre ?? null,
      }));


    // ----------------------------------------------------------
    // RECENT HISTORY
    // ----------------------------------------------------------

    const recentHistory =
      this.history
        .getHistory()
        .slice(0, MAX_HISTORY_ENTRIES);


    const historyPayload: HistoryEntryPayload[] =
      recentHistory
        .map(entry => {

          const track =
            this.library.getTrack(entry.trackId);

          if (!track) {
            return null;
          }

          return {
            title: track.title,
            artist: track.artist,
            playedAt: entry.playedAt,
          };

        })
        .filter(
          (entry): entry is HistoryEntryPayload =>
            entry !== null
        );


    // ----------------------------------------------------------
    // RUST / SENSE
    // ----------------------------------------------------------

    return invoke<RecommendedTrack[]>(
      'get_sense_recommendations',
      {
        library: libraryPayload,
        history: historyPayload,
      }
    );
  }
}