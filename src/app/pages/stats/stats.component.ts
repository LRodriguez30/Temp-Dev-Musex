import { Component, computed, inject, signal } from '@angular/core';

import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import {
    ListeningStatsService,
    PlayLogEntry
} from '../../core/services/listening-stats.service';
import { NotificationService } from '../../core/services/notification.service';

type StatsPeriod = 'week' | 'month' | 'year' | 'all';

interface RankRow {
    label: string;
    sublabel?: string;
    plays: number;
    seconds: number;
    /** 0–100, relativo al primero de la lista. */
    width: number;
}

interface Bar {
    label: string;
    value: number;
    /** 0–100 */
    height: number;
    peak: boolean;
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/**
 * Estadísticas de escucha: tiempo, favoritos y hábitos.
 *
 * Todo se calcula en el dispositivo a partir del registro de
 * reproducciones (ListeningStatsService).
 */
@Component({
    selector: 'app-stats',
    standalone: true,
    templateUrl: './stats.component.html',
    styleUrl: './stats.component.css'
})
export class StatsComponent {

    private readonly stats = inject(ListeningStatsService);
    private readonly confirmDialog = inject(ConfirmDialogService);
    private readonly notifications = inject(NotificationService);

    readonly periods: { id: StatsPeriod; label: string }[] = [
        { id: 'week', label: 'Esta semana' },
        { id: 'month', label: 'Este mes' },
        { id: 'year', label: 'Este año' },
        { id: 'all', label: 'Siempre' }
    ];

    readonly period = signal<StatsPeriod>('month');

    // ===========================================================
    // DATOS DEL PERIODO
    // ===========================================================

    private readonly inPeriod = computed<PlayLogEntry[]>(() => {

        const start = this.periodStart(this.period());

        return this.stats.entries().filter(
            entry => this.time(entry.at) >= start
        );
    });

    readonly hasAnyData = computed(() => this.stats.entries().length > 0);

    readonly isEmpty = computed(() => this.inPeriod().length === 0);

    // ===========================================================
    // TARJETAS
    // ===========================================================

    readonly totalSeconds = computed(() =>
        this.inPeriod().reduce((sum, entry) => sum + entry.seconds, 0)
    );

    readonly playCount = computed(() => this.inPeriod().length);

    readonly uniqueTracks = computed(
        () => new Set(this.inPeriod().map(entry => entry.trackId)).size
    );

    readonly uniqueArtists = computed(
        () => new Set(
            this.inPeriod().map(entry => entry.artist.toLowerCase())
        ).size
    );

    /** Días seguidos escuchando música (cuenta hasta hoy). */
    readonly streak = computed(() => {

        const days = new Set(
            this.stats.entries().map(entry => this.dayKey(new Date(this.time(entry.at))))
        );

        const cursor = new Date();

        // Si hoy aún no se escuchó nada, la racha continúa desde ayer.
        if (!days.has(this.dayKey(cursor))) {
            cursor.setDate(cursor.getDate() - 1);
        }

        let count = 0;

        while (days.has(this.dayKey(cursor))) {
            count++;
            cursor.setDate(cursor.getDate() - 1);
        }

        return count;
    });

    // ===========================================================
    // RANKINGS
    // ===========================================================

    readonly topTracks = computed(() =>
        this.rank(
            entry => entry.trackId,
            entry => entry.title,
            entry => entry.artist,
            10
        )
    );

    readonly topArtists = computed(() =>
        this.rank(
            entry => entry.artist.toLowerCase(),
            entry => entry.artist,
            () => undefined,
            8
        )
    );

    readonly topAlbums = computed(() =>
        this.rank(
            entry => `${entry.album}|${entry.artist}`.toLowerCase(),
            entry => entry.album,
            entry => entry.artist,
            6
        ).filter(row => row.label && !/^(youtube|desconocid)/i.test(row.label))
    );

    readonly topGenres = computed(() => {

        const withGenre = this.inPeriod().filter(entry => entry.genre?.trim());

        return this.rankFrom(
            withGenre,
            entry => (entry.genre as string).toLowerCase(),
            entry => entry.genre as string,
            () => undefined,
            6
        );
    });

    // ===========================================================
    // HÁBITOS
    // ===========================================================

    /** Minutos escuchados en cada hora del día. */
    readonly byHour = computed<Bar[]>(() => {

        const minutes = new Array<number>(24).fill(0);

        for (const entry of this.inPeriod()) {
            minutes[new Date(this.time(entry.at)).getHours()] += entry.seconds / 60;
        }

        return this.toBars(
            minutes,
            index => (index % 6 === 0 ? `${String(index).padStart(2, '0')}h` : '')
        );
    });

    readonly byWeekday = computed<Bar[]>(() => {

        const minutes = new Array<number>(7).fill(0);

        for (const entry of this.inPeriod()) {
            // getDay(): domingo = 0 → se reordena para empezar en lunes.
            const day = (new Date(this.time(entry.at)).getDay() + 6) % 7;
            minutes[day] += entry.seconds / 60;
        }

        return this.toBars(minutes, index => WEEKDAYS[index]);
    });

    readonly peakHourLabel = computed(() => {

        const bars = this.byHour();

        const peak = bars.findIndex(bar => bar.peak);

        return peak >= 0 && bars[peak].value > 0
            ? `${String(peak).padStart(2, '0')}:00`
            : null;
    });

    readonly peakWeekdayLabel = computed(() => {

        const bars = this.byWeekday();

        const peak = bars.findIndex(bar => bar.peak);

        return peak >= 0 && bars[peak].value > 0 ? WEEKDAYS[peak] : null;
    });

    // ===========================================================
    // ACCIONES
    // ===========================================================

    setPeriod(period: StatsPeriod): void {
        this.period.set(period);
    }

    async clearAll(): Promise<void> {

        const confirmed = await this.confirmDialog.request({
            title: 'Reiniciar estadísticas',
            message: 'Se reiniciarán tus estadísticas, esta acción es irreversible. ¿Deseas continuar?.',
            confirmLabel: 'Borrar',
            danger: true
        });

        if (!confirmed) {
            return;
        }

        this.stats.clear();

        this.notifications.success('Estadísticas borradas.');
    }

    // ===========================================================
    // FORMATO
    // ===========================================================

    formatDuration(seconds: number): string {

        const totalMinutes = Math.round(seconds / 60);

        if (totalMinutes < 1) {
            return seconds > 0 ? '<1 min' : '0 min';
        }

        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        if (hours === 0) {
            return `${minutes} min`;
        }

        return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
    }

    // ===========================================================
    // CÁLCULO
    // ===========================================================

    private rank(
        key: (entry: PlayLogEntry) => string,
        label: (entry: PlayLogEntry) => string,
        sublabel: (entry: PlayLogEntry) => string | undefined,
        limit: number
    ): RankRow[] {
        return this.rankFrom(this.inPeriod(), key, label, sublabel, limit);
    }

    private rankFrom(
        entries: PlayLogEntry[],
        key: (entry: PlayLogEntry) => string,
        label: (entry: PlayLogEntry) => string,
        sublabel: (entry: PlayLogEntry) => string | undefined,
        limit: number
    ): RankRow[] {

        const groups = new Map<string, Omit<RankRow, 'width'>>();

        for (const entry of entries) {

            const id = key(entry);

            const current = groups.get(id);

            if (current) {
                current.plays++;
                current.seconds += entry.seconds;
            } else {
                groups.set(id, {
                    label: label(entry),
                    sublabel: sublabel(entry),
                    plays: 1,
                    seconds: entry.seconds
                });
            }
        }

        const rows = [...groups.values()]
            .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)
            .slice(0, limit);

        const max = rows[0]?.plays ?? 1;

        return rows.map(row => ({
            ...row,
            width: Math.max(6, Math.round((row.plays / max) * 100))
        }));
    }

    private toBars(
        values: number[],
        label: (index: number) => string
    ): Bar[] {

        const max = Math.max(...values, 0);

        return values.map((value, index) => ({
            label: label(index),
            value,
            height: max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 4,
            peak: max > 0 && value === max
        }));
    }

    private periodStart(period: StatsPeriod): number {

        const now = new Date();

        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        switch (period) {

            case 'week':
                // La semana empieza el lunes.
                day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
                return day.getTime();

            case 'month':
                return new Date(now.getFullYear(), now.getMonth(), 1).getTime();

            case 'year':
                return new Date(now.getFullYear(), 0, 1).getTime();

            default:
                return 0;
        }
    }

    private dayKey(date: Date): string {
        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    }

    private time(iso: string): number {

        const value = Date.parse(iso);

        return Number.isNaN(value) ? 0 : value;
    }
}
