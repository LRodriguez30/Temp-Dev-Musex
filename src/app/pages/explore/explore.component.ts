// =============================================================
// MUSEX - EXPLORE COMPONENT
// =============================================================
//
// Página de descubrimiento de Musex.
//
// Explore utiliza Musex Sense para generar recomendaciones
// basadas en la biblioteca y el historial reciente.
//
// Sense solamente recomienda:
//   - canción
//   - artista
//   - motivo
//   - proveedor preferido
//
// La disponibilidad real de una vista previa se resolverá
// posteriormente mediante los proveedores externos.
// =============================================================

import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';

import { RouterLink } from '@angular/router';

import { SenseService } from '../../core/services/sense.service';

import {
  RecommendationService,
  RecommendedTrack,
  PreferredSource,
} from '../../core/services/recommendation.service';


// =============================================================
// COMPONENT
// =============================================================

@Component({
  selector: 'app-explore',
  standalone: true,

  imports: [
    RouterLink,
  ],

  templateUrl: './explore.component.html',
  styleUrl: './explore.component.css',
})
export class ExploreComponent implements OnInit {

  // ============================================================
  // SERVICES
  // ============================================================

  private readonly sense =
    inject(SenseService);

  private readonly recommendations =
    inject(RecommendationService);


  // ============================================================
  // SENSE STATUS
  // ============================================================

  readonly settings =
    this.sense.settings;


  /**
   * Explore solo puede mostrar recomendaciones cuando:
   *
   * - Sense está habilitado.
   * - Existe una API key.
   * - La capacidad de recomendaciones está habilitada.
   */
  readonly senseReady = computed(() => {

    const current =
      this.settings();

    return (
      current.enabled &&
      current.hasApiKey &&
      current.capabilities.recommendations
    );

  });


  // ============================================================
  // RECOMMENDATIONS STATE
  // ============================================================

  readonly loadingRecommendations =
    signal(false);

  readonly recommendationsError =
    signal<string | null>(null);

  readonly recommendedTracks =
    signal<RecommendedTrack[]>([]);


  // ============================================================
  // INIT
  // ============================================================

  async ngOnInit(): Promise<void> {

    await this.sense.ensureLoaded();

    if (this.senseReady()) {
      await this.loadRecommendations();
    }

  }


  // ============================================================
  // LOAD
  // ============================================================

  async loadRecommendations(): Promise<void> {

    this.loadingRecommendations.set(true);

    this.recommendationsError.set(null);


    try {

      const tracks =
        await this.recommendations.getRecommendations();

      this.recommendedTracks.set(tracks);

    } catch (error) {

      console.error(
        'No se pudieron obtener recomendaciones:',
        error
      );

      this.recommendationsError.set(
        error instanceof Error
          ? error.message
          : 'No se pudo generar la recomendación.'
      );

    } finally {

      this.loadingRecommendations.set(false);

    }

  }


  // ============================================================
  // RETRY
  // ============================================================

  retry(): void {
    void this.loadRecommendations();
  }


  // ============================================================
  // SOURCE LABEL
  // ============================================================

  /**
   * Convierte el valor técnico de preferredSource en un texto
   * pequeño para mostrar en la tarjeta.
   */
  sourceLabel(
    source: PreferredSource
  ): string {

    switch (source) {

      case 'youtube':
        return 'YouTube';

      case 'newgrounds':
        return 'Newgrounds';

      case 'either':
        return 'YouTube / Newgrounds';

    }

  }

}