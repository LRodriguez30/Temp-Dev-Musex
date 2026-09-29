import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { SenseService } from '../../core/services/sense.service';
import { RecommendationService, RecommendedTrack } from '../../core/services/recommendation.service';
import { RouterLink } from '@angular/router';

/**
 * Página de exploración de Musex.
 *
 * Todo el contenido de descubrimiento depende de Musex Sense:
 * sin una conexión activa a Gemini, esta vista muestra una
 * invitación a activarla en vez de contenido vacío.
 */
@Component({
  selector: 'app-explore',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './explore.component.html',
  styleUrl: './explore.component.css'
})
export class ExploreComponent implements OnInit {

  private readonly sense = inject(SenseService);
  private readonly recommendations = inject(RecommendationService);

  // ============================================================
  // SENSE STATUS
  // ============================================================

  readonly settings = this.sense.settings;

  /**
   * El contenido de descubrimiento solo se muestra cuando Sense
   * está activo, con API key guardada y con la capacidad de
   * recomendaciones habilitada.
   */
  readonly senseReady = computed(() => {
    const current = this.settings();
    return current.enabled && current.hasApiKey && current.capabilities.recommendations;
  });

  // ============================================================
  // RECOMMENDATIONS
  // ============================================================

  readonly loadingRecommendations = signal(false);
  readonly recommendationsError = signal<string | null>(null);
  readonly recommendedTracks = signal<RecommendedTrack[]>([]);

  async ngOnInit(): Promise<void> {
    await this.sense.ensureLoaded();

    if (this.senseReady()) {
      await this.loadRecommendations();
    }
  }

  async loadRecommendations(): Promise<void> {
    this.loadingRecommendations.set(true);
    this.recommendationsError.set(null);

    try {
      const tracks = await this.recommendations.getRecommendations();
      this.recommendedTracks.set(tracks);
    } catch (error) {
      console.error('No se pudieron obtener recomendaciones:', error);
      this.recommendationsError.set(
        error instanceof Error ? error.message : 'No se pudo generar la recomendación.'
      );
    } finally {
      this.loadingRecommendations.set(false);
    }
  }

  retry(): void {
    void this.loadRecommendations();
  }
}