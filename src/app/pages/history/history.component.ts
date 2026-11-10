import {
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { DatePipe } from '@angular/common';

import { IS_ANDROID } from '../../core/platform/invoke';

import { AutoPickHistoryService, AutoPickOutcome } from '../../core/services/auto-pick-history.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { DownloadHistoryService } from '../../core/services/download-history.service';
import { HistoryService } from '../../core/services/history.service';
import { LibraryService } from '../../core/services/library.service';
import { NotificationService } from '../../core/services/notification.service';
import { PlayerService } from '../../core/services/player.service';

type HistoryFilter = 'all' | 'listening' | 'downloads' | 'autopick';

type HistoryKind = 'listening' | 'download' | 'autopick';

type BadgeTone = 'ok' | 'muted' | 'warn';

interface HistoryItem {
  key: string;
  kind: HistoryKind;
  id: string;
  title: string;
  subtitle: string;
  at: string;
  trackId?: string;
  playable: boolean;
  badge?: string;
  badgeTone?: BadgeTone;
}

interface HistoryGroup {
  label: string;
  items: HistoryItem[];
}

const OUTCOME_BADGE: Record<
  AutoPickOutcome,
  { label: string; tone: BadgeTone }
> = {
  pending: { label: 'Pendiente', tone: 'muted' },
  auto: { label: 'Reproducida', tone: 'ok' },
  now: { label: 'Adelantada', tone: 'ok' },
  cancelled: { label: 'Cancelada', tone: 'warn' },
  replaced: { label: 'Reemplazada', tone: 'muted' }
};

const EMPTY_TEXT: Record<HistoryFilter, { title: string; hint: string }> = {
  all: {
    title: 'Todavía no hay actividad en el historial.',
    hint: 'Lo que escuches, descargues o elija el auto-picker aparecerá aquí.'
  },
  listening: {
    title: 'Todavía no has reproducido canciones.',
    hint: 'Las canciones que escuches aparecerán aquí.'
  },
  downloads: {
    title: 'Todavía no hay descargas en el historial.',
    hint: 'Las descargas completadas aparecerán aquí.'
  },
  autopick: {
    title: 'El auto-picker todavía no ha elegido canciones.',
    hint: 'Cuando elija la siguiente canción, quedará registrado aquí.'
  }
};

/**
 * Historial unificado de Musex: reproducción, descargas y
 * selección automática en una sola línea de tiempo, con filtros.
 */
@Component({
  selector: 'app-history',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './history.component.html',
  styleUrl: './history.component.css'
})
export class HistoryComponent implements OnInit {

  private readonly downloadHistoryService = inject(DownloadHistoryService);
  private readonly listeningHistory = inject(HistoryService);
  private readonly autoPickHistory = inject(AutoPickHistoryService);
  private readonly library = inject(LibraryService);
  private readonly player = inject(PlayerService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly notificationService = inject(NotificationService);

  readonly isAndroid = IS_ANDROID;

  readonly loading = this.downloadHistoryService.loading;

  readonly filter = signal<HistoryFilter>('all');

  // ===========================================================
  // DATOS
  // ===========================================================

  private readonly allItems = computed<HistoryItem[]>(() => {

    const items: HistoryItem[] = [];

    for (const entry of this.listeningHistory.entries()) {

      const track = this.library.getTrack(entry.trackId);

      items.push({
        key: `l-${entry.id}`,
        kind: 'listening',
        id: entry.id,
        title: track?.title ?? 'Canción no disponible',
        subtitle: track?.artist ?? 'Ya no está en la biblioteca',
        at: entry.playedAt,
        trackId: entry.trackId,
        playable: Boolean(track)
      });
    }

    if (!this.isAndroid) {

      for (const entry of this.downloadHistoryService.entries()) {

        items.push({
          key: `d-${entry.id}`,
          kind: 'download',
          id: entry.id,
          title: entry.title,
          subtitle: this.capitalize(entry.source),
          at: entry.completedAt,
          playable: false
        });
      }
    }

    for (const entry of this.autoPickHistory.entries()) {

      const badge = OUTCOME_BADGE[entry.outcome];

      items.push({
        key: `a-${entry.id}`,
        kind: 'autopick',
        id: entry.id,
        title: entry.title,
        subtitle: entry.artist,
        at: entry.pickedAt,
        trackId: entry.trackId,
        playable: Boolean(this.library.getTrack(entry.trackId)),
        badge: badge.label,
        badgeTone: badge.tone
      });
    }

    return items.sort(
      (a, b) => this.time(b.at) - this.time(a.at)
    );
  });

  readonly counts = computed(() => {

    const items = this.allItems();

    return {
      all: items.length,
      listening: items.filter(i => i.kind === 'listening').length,
      downloads: items.filter(i => i.kind === 'download').length,
      autopick: items.filter(i => i.kind === 'autopick').length
    };
  });

  readonly filters = computed(() => {

    const counts = this.counts();

    const list: { id: HistoryFilter; label: string; count: number }[] = [
      { id: 'all', label: 'Todo', count: counts.all },
      { id: 'listening', label: 'Reproducción', count: counts.listening }
    ];

    if (!this.isAndroid) {
      list.push({
        id: 'downloads',
        label: 'Descargas',
        count: counts.downloads
      });
    }

    list.push({
      id: 'autopick',
      label: 'Auto-picker',
      count: counts.autopick
    });

    return list;
  });

  readonly visibleItems = computed(() => {

    const filter = this.filter();

    const kind: HistoryKind | null =
      filter === 'listening' ? 'listening'
        : filter === 'downloads' ? 'download'
          : filter === 'autopick' ? 'autopick'
            : null;

    return kind
      ? this.allItems().filter(item => item.kind === kind)
      : this.allItems();
  });

  readonly groups = computed<HistoryGroup[]>(() => {

    const groups: HistoryGroup[] = [];

    for (const item of this.visibleItems()) {

      const label = this.dayLabel(item.at);

      const last = groups[groups.length - 1];

      if (last && last.label === label) {
        last.items.push(item);
      } else {
        groups.push({ label, items: [item] });
      }
    }

    return groups;
  });

  readonly emptyText = computed(() => EMPTY_TEXT[this.filter()]);

  // ===========================================================
  // CICLO DE VIDA
  // ===========================================================

  async ngOnInit(): Promise<void> {

    if (!this.isAndroid) {
      await this.downloadHistoryService.load();
    }
  }

  // ===========================================================
  // ACCIONES
  // ===========================================================

  setFilter(filter: HistoryFilter): void {
    this.filter.set(filter);
  }

  async play(item: HistoryItem): Promise<void> {

    if (!item.trackId || !item.playable) {
      return;
    }

    await this.player.playTrack(item.trackId);
  }

  async remove(item: HistoryItem): Promise<void> {

    try {

      switch (item.kind) {

        case 'listening':
          this.listeningHistory.removeEntry(item.id);
          break;

        case 'autopick':
          this.autoPickHistory.removeEntry(item.id);
          break;

        case 'download':
          await this.downloadHistoryService.removeEntry(item.id);
          break;
      }

      this.notificationService.info(
        'Entrada eliminada del historial.'
      );

    } catch {

      this.notificationService.error(
        'No se pudo eliminar la entrada del historial.'
      );
    }
  }

  async clearCurrent(): Promise<void> {

    const filter = this.filter();

    if (this.visibleItems().length === 0) {
      return;
    }

    const scope =
      filter === 'listening' ? 'el historial de reproducción'
        : filter === 'downloads' ? 'el historial de descargas'
          : filter === 'autopick' ? 'el historial del auto-picker'
            : 'todo el historial';

    const confirmed = await this.confirmDialog.request({
      title: 'Borrar historial',
      message: `Se borrará ${scope}. Las canciones y archivos no se eliminan.`,
      confirmLabel: 'Borrar',
      danger: true
    });

    if (!confirmed) {
      return;
    }

    try {

      if (filter === 'all' || filter === 'listening') {
        this.listeningHistory.clearHistory();
      }

      if (filter === 'all' || filter === 'autopick') {
        this.autoPickHistory.clear();
      }

      if (
        !this.isAndroid &&
        (filter === 'all' || filter === 'downloads')
      ) {
        await this.downloadHistoryService.clear();
      }

      this.notificationService.success('Historial borrado.');

    } catch {

      this.notificationService.error(
        'No se pudo borrar todo el historial.'
      );
    }
  }

  // ===========================================================
  // UTILIDADES
  // ===========================================================

  private time(iso: string): number {

    const value = Date.parse(iso);

    return Number.isNaN(value) ? 0 : value;
  }

  private capitalize(value: string): string {

    return value
      ? value.charAt(0).toUpperCase() + value.slice(1)
      : '';
  }

  private dayLabel(iso: string): string {

    const value = this.time(iso);

    if (!value) {
      return 'Sin fecha';
    }

    const date = new Date(value);

    const startOfDay = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

    const diffDays = Math.round(
      (startOfDay(new Date()) - startOfDay(date)) / 86_400_000
    );

    if (diffDays === 0) {
      return 'Hoy';
    }

    if (diffDays === 1) {
      return 'Ayer';
    }

    return new Intl.DateTimeFormat('es', {
      day: 'numeric',
      month: 'long',
      year:
        date.getFullYear() === new Date().getFullYear()
          ? undefined
          : 'numeric'
    }).format(date);
  }
}
