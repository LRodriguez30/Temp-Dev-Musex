// =============================================================
// MUSEX - EXPLORE COMPONENT
// =============================================================
//
// Página de descubrimiento de Musex.
//
// - Las recomendaciones de Sense y los enlaces añadidos por el
//   usuario se guardan en el dispositivo (ExploreStoreService).
// - Se pueden filtrar por día, semana, mes, año o todo.
// - "Recomendar algo nuevo" pide a Sense canciones basadas en el
//   historial de escucha, excluyendo las que ya se recomendaron.
//   Sin historial no se genera nada.
// - Los enlaces de YouTube se verifican antes de añadirse.
// =============================================================

import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';

import { RouterLink } from '@angular/router';
import { openUrl } from '@tauri-apps/plugin-opener';

import { DownloadService } from '../../core/services/download.service';
import {
  ExploreItem,
  ExplorePeriod,
  ExploreStoreService,
} from '../../core/services/explore-store.service';
import { HistoryService } from '../../core/services/history.service';
import { NotificationService } from '../../core/services/notification.service';
import {
  PreferredSource,
  RecommendationService,
} from '../../core/services/recommendation.service';
import { SenseService } from '../../core/services/sense.service';

interface PeriodOption {
  id: ExplorePeriod;
  label: string;
}

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

  private readonly sense = inject(SenseService);
  private readonly recommendations = inject(RecommendationService);
  private readonly history = inject(HistoryService);
  private readonly downloads = inject(DownloadService);
  private readonly notifications = inject(NotificationService);

  readonly store = inject(ExploreStoreService);

  // ============================================================
  // SENSE STATUS
  // ============================================================

  readonly settings = this.sense.settings;

  readonly senseReady = computed(() => {

    const current = this.settings();

    return (
      current.enabled &&
      current.hasApiKey &&
      current.capabilities.recommendations
    );
  });

  /** Sin historial de escucha no hay nada en qué basar una recomendación. */
  readonly hasHistory = computed(
    () => this.history.entries().length > 0
  );

  // ============================================================
  // STATE
  // ============================================================

  readonly periods: PeriodOption[] = [
    { id: 'day', label: 'Hoy' },
    { id: 'week', label: 'Esta semana' },
    { id: 'month', label: 'Este mes' },
    { id: 'year', label: 'Este año' },
    { id: 'all', label: 'Siempre' },
  ];

  readonly period = signal<ExplorePeriod>('all');

  readonly visibleItems = computed(
    () => this.store.itemsFor(this.period())
  );

  readonly loadingRecommendations = signal(false);
  readonly recommendationsError = signal<string | null>(null);

  /** Mensaje informativo tras pedir recomendaciones nuevas. */
  readonly recommendationsNotice = signal<string | null>(null);

  // Enlaces
  readonly linkFormOpen = signal(false);
  readonly linkInput = signal('');
  readonly addingLink = signal(false);
  readonly linkError = signal<string | null>(null);

  readonly verifyingId = signal<string | null>(null);

  // ============================================================
  // INIT
  // ============================================================

  async ngOnInit(): Promise<void> {

    await this.sense.ensureLoaded();

    // Primera visita: se generan las primeras recomendaciones.
    if (
      this.senseReady() &&
      this.hasHistory() &&
      !this.store.hasItems()
    ) {
      await this.recommendNew();
    }
  }

  // ============================================================
  // RECOMENDAR ALGO NUEVO
  // ============================================================

  async recommendNew(): Promise<void> {

    if (this.loadingRecommendations()) {
      return;
    }

    if (!this.hasHistory()) {

      this.recommendationsNotice.set(
        'Aún no hay historial de escucha. Escucha algunas canciones y vuelve a intentarlo.'
      );

      return;
    }

    this.loadingRecommendations.set(true);
    this.recommendationsError.set(null);
    this.recommendationsNotice.set(null);

    try {

      const suggested = await this.recommendations.getRecommendations(
        this.store.excludedForSense()
      );

      // Solo se guardan las que de verdad son nuevas.
      const added = this.store.addSense(suggested);

      if (added.length === 0) {

        this.recommendationsNotice.set(
          'No hay recomendaciones nuevas por ahora. Escucha más música y vuelve a intentarlo.'
        );

      } else {

        this.period.set('all');

        this.notifications.success(
          added.length === 1
            ? '1 recomendación nueva'
            : `${added.length} recomendaciones nuevas`
        );
      }

    } catch (error) {

      console.error(
        'No se pudieron obtener recomendaciones:',
        error
      );

      this.recommendationsError.set(
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'No se pudo generar la recomendación.'
      );

    } finally {

      this.loadingRecommendations.set(false);
    }
  }

  // ============================================================
  // FILTRO
  // ============================================================

  setPeriod(period: ExplorePeriod): void {
    this.period.set(period);
  }

  // ============================================================
  // ENLACES
  // ============================================================

  toggleLinkForm(): void {

    this.linkFormOpen.update(open => !open);

    this.linkError.set(null);
  }

  onLinkInput(event: Event): void {

    this.linkInput.set((event.target as HTMLInputElement).value);

    this.linkError.set(null);
  }

  async addLink(): Promise<void> {

    if (this.addingLink()) {
      return;
    }

    this.addingLink.set(true);
    this.linkError.set(null);

    try {

      const result = await this.store.addLink(this.linkInput());

      if (!result.ok) {
        this.linkError.set(result.error);
        return;
      }

      this.linkInput.set('');
      this.linkFormOpen.set(false);
      this.period.set('all');

      this.notifications.success(
        result.item.verified
          ? 'Enlace verificado y añadido.'
          : 'Enlace añadido, pero no se pudo verificar.'
      );

    } finally {

      this.addingLink.set(false);
    }
  }

  async verify(item: ExploreItem): Promise<void> {

    this.verifyingId.set(item.id);

    try {

      const ok = await this.store.verifyLink(item.id);

      if (ok) {
        this.notifications.success('Enlace verificado.');
      } else {
        this.notifications.error('No se pudo verificar el enlace.');
      }

    } finally {

      this.verifyingId.set(null);
    }
  }

  // ============================================================
  // ACCIONES DE TARJETA
  // ============================================================

  async open(item: ExploreItem): Promise<void> {

    if (!item.url) {
      return;
    }

    try {
      await openUrl(item.url);
    } catch (error) {

      console.error('No se pudo abrir el enlace:', error);

      this.notifications.error('No se pudo abrir el enlace.');
    }
  }

  download(item: ExploreItem): void {

    if (!item.url) {
      return;
    }

    const added = this.downloads.addDownload(item.url, item.title);

    if (added) {
      this.notifications.success('Añadida a descargas.');
    } else {
      this.notifications.error('No se pudo añadir a descargas.');
    }
  }

  remove(item: ExploreItem): void {
    this.store.remove(item.id);
  }

  // ============================================================
  // LABELS
  // ============================================================

  sourceLabel(source: PreferredSource): string {

    switch (source) {

      case 'youtube':
        return 'YouTube';

      case 'newgrounds':
        return 'Newgrounds';

      case 'either':
        return 'YouTube / Newgrounds';
    }
  }

  /** "Hoy", "Ayer" o fecha corta. */
  dateLabel(iso: string): string {

    const time = Date.parse(iso);

    if (Number.isNaN(time)) {
      return '';
    }

    const date = new Date(time);

    const startOfDay = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

    const diff = Math.round(
      (startOfDay(new Date()) - startOfDay(date)) / 86_400_000
    );

    if (diff === 0) {
      return 'Hoy';
    }

    if (diff === 1) {
      return 'Ayer';
    }

    return new Intl.DateTimeFormat('es', {
      day: 'numeric',
      month: 'short',
    }).format(date);
  }

}
