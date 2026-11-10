import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';

import { EqBand } from '../../core/services/equalizer.service';

// =============================================================
// GEOMETRÍA DE LA GRÁFICA
// =============================================================

const WIDTH = 640;
const HEIGHT = 230;

const LEFT = 38;
const RIGHT = 10;
const TOP = 10;
const BOTTOM = 22;

const PLOT_W = WIDTH - LEFT - RIGHT;
const PLOT_H = HEIGHT - TOP - BOTTOM;

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const RANGE_DB = 15;

/** Frecuencia de muestreo usada solo para dibujar la curva. */
const SAMPLE_RATE = 48000;

const POINTS = 220;

const GRID_FREQS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const GRID_DB = [-12, -6, 0, 6, 12];

export interface CurveBandMove {
  id: number;
  frequency: number;
  gainDb: number;
}

export interface CurveBandQ {
  id: number;
  q: number;
}

interface Coeffs {
  b0: number; b1: number; b2: number;
  a1: number; a2: number;
}

/**
 * Curva de respuesta en frecuencia del ecualizador.
 *
 * Dibuja la respuesta combinada de todas las bandas. Cada banda es
 * un nodo: arrástralo para cambiar frecuencia (horizontal) y
 * ganancia (vertical); la rueda del ratón ajusta su Q.
 */
@Component({
  selector: 'app-eq-curve',
  standalone: true,
  templateUrl: './eq-curve.component.html',
  styleUrl: './eq-curve.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EqCurveComponent {

  readonly bands = input.required<EqBand[]>();

  readonly bandMove = output<CurveBandMove>();
  readonly bandQ = output<CurveBandQ>();

  readonly width = WIDTH;
  readonly height = HEIGHT;

  private readonly svg = viewChild.required<ElementRef<SVGSVGElement>>('svg');

  readonly selectedId = signal<number | null>(null);

  private draggingId: number | null = null;
  private pending: CurveBandMove | null = null;
  private frame = 0;

  // ===========================================================
  // REJILLA
  // ===========================================================

  readonly freqLines = GRID_FREQS.map(freq => ({
    x: this.xOf(freq),
    label: freq >= 1000 ? `${freq / 1000}k` : `${freq}`
  }));

  readonly dbLines = GRID_DB.map(db => ({
    y: this.yOf(db),
    label: db > 0 ? `+${db}` : `${db}`,
    zero: db === 0
  }));

  readonly zeroY = this.yOf(0);

  // ===========================================================
  // CURVA
  // ===========================================================

  /** Respuesta combinada en dB para cada punto de la gráfica. */
  private readonly response = computed(() => {

    const coeffs = this.bands()
      .map(band => this.coefficients(band))
      .filter((c): c is Coeffs => c !== null);

    const values: { x: number; db: number }[] = [];

    for (let i = 0; i < POINTS; i++) {

      const freq = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / (POINTS - 1));

      let db = 0;

      for (const c of coeffs) {
        db += this.magnitudeDb(c, freq);
      }

      values.push({ x: this.xOf(freq), db });
    }

    return values;
  });

  readonly linePath = computed(() =>
    this.response()
      .map((p, i) =>
        `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${this.yOf(p.db).toFixed(1)}`
      )
      .join(' ')
  );

  readonly areaPath = computed(() => {

    const points = this.response();

    if (points.length === 0) {
      return '';
    }

    const first = points[0];
    const last = points[points.length - 1];

    return `${this.linePath()} L${last.x.toFixed(1)} ${this.zeroY} L${first.x.toFixed(1)} ${this.zeroY} Z`;
  });

  /** Pico de la respuesta (dB) y margen automático que se aplica. */
  readonly peakDb = computed(() =>
    Math.max(0, ...this.response().map(p => p.db))
  );

  readonly headroomDb = computed(() => {

    const peak = this.peakDb();

    return peak < 0.05 ? 0 : Math.min(peak, 24);
  });

  readonly nodes = computed(() =>
    this.bands().map(band => ({
      id: band.id,
      x: this.xOf(band.frequency),
      y: this.yOf(band.gainDb),
      clipped: Math.abs(band.gainDb) > RANGE_DB,
      label: this.nodeLabel(band)
    }))
  );

  // ===========================================================
  // INTERACCIÓN
  // ===========================================================

  onPointerDown(event: PointerEvent, id: number): void {

    event.preventDefault();

    (event.target as Element).setPointerCapture?.(event.pointerId);

    this.draggingId = id;
    this.selectedId.set(id);
  }

  onPointerMove(event: PointerEvent): void {

    if (this.draggingId === null) {
      return;
    }

    const rect = this.svg().nativeElement.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    // Coordenadas del puntero en el sistema del viewBox.
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;

    const ratioX = Math.min(1, Math.max(0, (x - LEFT) / PLOT_W));
    const ratioY = Math.min(1, Math.max(0, (y - TOP) / PLOT_H));

    const frequency = Math.round(
      MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, ratioX)
    );

    const gainDb = Math.round(((1 - ratioY) * 2 * RANGE_DB - RANGE_DB) * 10) / 10;

    // Un único envío por fotograma: evita saturar el audio de órdenes.
    this.pending = { id: this.draggingId, frequency, gainDb };

    if (!this.frame) {

      this.frame = requestAnimationFrame(() => {

        this.frame = 0;

        if (this.pending) {
          this.bandMove.emit(this.pending);
          this.pending = null;
        }
      });
    }
  }

  onPointerUp(): void {
    this.draggingId = null;
  }

  onWheel(event: WheelEvent, band: { id: number }): void {

    event.preventDefault();

    const current = this.bands().find(b => b.id === band.id);

    if (!current) {
      return;
    }

    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;

    const q = Math.min(20, Math.max(0.1, Math.round(current.q * factor * 100) / 100));

    this.selectedId.set(band.id);

    this.bandQ.emit({ id: band.id, q });
  }

  // ===========================================================
  // CÁLCULO DE FILTROS (RBJ Audio EQ Cookbook)
  // ===========================================================

  private coefficients(band: EqBand): Coeffs | null {

    const frequency = Math.min(
      Math.max(band.frequency, MIN_FREQ),
      Math.min(MAX_FREQ, SAMPLE_RATE * 0.45)
    );

    const q = Math.min(Math.max(band.q, 0.1), 20);
    const gain = Math.min(Math.max(band.gainDb, -24), 24);

    if (![frequency, q, gain].every(Number.isFinite)) {
      return null;
    }

    const w0 = (2 * Math.PI * frequency) / SAMPLE_RATE;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const A = Math.pow(10, gain / 40);
    const sqrtA2alpha = 2 * Math.sqrt(A) * alpha;

    let b0: number, b1: number, b2: number;
    let a0: number, a1: number, a2: number;

    switch (band.filterType) {

      case 'lowshelf':
        b0 = A * ((A + 1) - (A - 1) * cos + sqrtA2alpha);
        b1 = 2 * A * ((A - 1) - (A + 1) * cos);
        b2 = A * ((A + 1) - (A - 1) * cos - sqrtA2alpha);
        a0 = (A + 1) + (A - 1) * cos + sqrtA2alpha;
        a1 = -2 * ((A - 1) + (A + 1) * cos);
        a2 = (A + 1) + (A - 1) * cos - sqrtA2alpha;
        break;

      case 'highshelf':
        b0 = A * ((A + 1) + (A - 1) * cos + sqrtA2alpha);
        b1 = -2 * A * ((A - 1) + (A + 1) * cos);
        b2 = A * ((A + 1) + (A - 1) * cos - sqrtA2alpha);
        a0 = (A + 1) - (A - 1) * cos + sqrtA2alpha;
        a1 = 2 * ((A - 1) - (A + 1) * cos);
        a2 = (A + 1) - (A - 1) * cos - sqrtA2alpha;
        break;

      default: // peaking
        b0 = 1 + alpha * A;
        b1 = -2 * cos;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cos;
        a2 = 1 - alpha / A;
    }

    return {
      b0: b0 / a0, b1: b1 / a0, b2: b2 / a0,
      a1: a1 / a0, a2: a2 / a0
    };
  }

  private magnitudeDb(c: Coeffs, frequency: number): number {

    const w = (2 * Math.PI * frequency) / SAMPLE_RATE;

    const c1 = Math.cos(w);
    const s1 = Math.sin(w);
    const c2 = Math.cos(2 * w);
    const s2 = Math.sin(2 * w);

    const numRe = c.b0 + c.b1 * c1 + c.b2 * c2;
    const numIm = -(c.b1 * s1 + c.b2 * s2);

    const denRe = 1 + c.a1 * c1 + c.a2 * c2;
    const denIm = -(c.a1 * s1 + c.a2 * s2);

    const num = numRe * numRe + numIm * numIm;
    const den = denRe * denRe + denIm * denIm;

    return num > 0 && den > 0 ? 10 * Math.log10(num / den) : 0;
  }

  // ===========================================================
  // UTILIDADES
  // ===========================================================

  private xOf(frequency: number): number {

    const clamped = Math.min(MAX_FREQ, Math.max(MIN_FREQ, frequency));

    return LEFT + (Math.log(clamped / MIN_FREQ) / Math.log(MAX_FREQ / MIN_FREQ)) * PLOT_W;
  }

  private yOf(db: number): number {

    const clamped = Math.min(RANGE_DB, Math.max(-RANGE_DB, db));

    return TOP + (1 - (clamped + RANGE_DB) / (2 * RANGE_DB)) * PLOT_H;
  }

  private nodeLabel(band: EqBand): string {

    const freq = band.frequency >= 1000
      ? `${(band.frequency / 1000).toFixed(band.frequency >= 10000 ? 0 : 1)} kHz`
      : `${Math.round(band.frequency)} Hz`;

    const gain = `${band.gainDb > 0 ? '+' : ''}${band.gainDb.toFixed(1)} dB`;

    return `${freq} · ${gain} · Q ${band.q.toFixed(2)}`;
  }
}
