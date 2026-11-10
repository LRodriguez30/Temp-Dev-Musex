import {
  Component,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';

import { PlayerService } from '../../core/services/player.service';

/**
 * Aviso del tiempo de gracia de la selección automática:
 * muestra la canción elegida con cuenta regresiva y permite
 * adelantarla o cancelarla.
 */
@Component({
  selector: 'app-auto-pick-banner',
  standalone: true,
  template: `
    @if (pending(); as item) {
      <div class="auto-pick-banner" role="status" aria-live="polite">

        <div class="auto-pick-text">
          <span class="auto-pick-label">
            SIGUIENTE AUTOMÁTICA · {{ remaining() }} s
          </span>

          <strong class="auto-pick-title" [attr.title]="item.track.title">
            {{ item.track.title }}
          </strong>

          <span class="auto-pick-artist">
            {{ item.track.artist }}
          </span>
        </div>

        <div class="auto-pick-actions">
          <button
            type="button"
            class="auto-pick-now"
            (click)="player.confirmAutoPick(true)"
          >
            Ahora
          </button>

          <button
            type="button"
            class="auto-pick-cancel"
            (click)="player.cancelAutoPick()"
          >
            Cancelar
          </button>
        </div>

      </div>
    }
  `,
  styles: [`
    .auto-pick-banner {
      position: fixed;
      left: 50%;
      bottom: calc(var(--safe-bottom, 0px) + 112px);
      transform: translateX(-50%);
      z-index: 60;

      display: flex;
      align-items: center;
      gap: 14px;

      width: max-content;
      max-width: min(92vw, 440px);
      padding: 10px 12px 10px 14px;

      border: 1px solid #363940;
      border-radius: 12px;
      background: #151719;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
      box-sizing: border-box;
    }

    .auto-pick-text {
      display: flex;
      flex-direction: column;
      min-width: 0;
      gap: 2px;
    }

    .auto-pick-label {
      font-family: "Courier New", Courier, monospace;
      font-size: 9px;
      letter-spacing: 0.12em;
      color: var(--musex-accent);
    }

    .auto-pick-title,
    .auto-pick-artist {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .auto-pick-title {
      font-size: 13px;
      font-weight: 600;
      color: #fff;
    }

    .auto-pick-artist {
      font-size: 11px;
      color: #71717a;
    }

    .auto-pick-actions {
      display: flex;
      gap: 6px;
      flex: 0 0 auto;
    }

    .auto-pick-now,
    .auto-pick-cancel {
      height: 30px;
      padding: 0 12px;
      border-radius: 7px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }

    .auto-pick-now {
      border: 1px solid var(--musex-accent);
      background: var(--musex-accent);
      color: #0d0e10;
    }

    .auto-pick-cancel {
      border: 1px solid #363940;
      background: transparent;
      color: #a1a1aa;
    }

    .auto-pick-cancel:hover {
      color: #fff;
    }

    /* Móvil: barra de navegación (72px) + mini-player (64px) + margen,
       para no tapar el bottom-player. */
    @media (max-width: 620px) {
      .auto-pick-banner {
        bottom: calc(var(--safe-bottom, 0px) + 72px + 64px + 8px);
        width: calc(100vw - 24px);
        max-width: none;
        justify-content: space-between;
      }
    }
  `]
})
export class AutoPickBannerComponent {

  readonly player = inject(PlayerService);

  readonly pending = this.player.autoPickPending;

  private readonly now = signal(Date.now());

  readonly remaining = computed(() => {

    const item = this.pending();

    return item
      ? Math.max(0, Math.ceil((item.deadline - this.now()) / 1000))
      : 0;
  });

  constructor() {

    // Reloj de la cuenta regresiva, solo mientras hay una pendiente.
    effect(onCleanup => {

      if (!this.pending()) {
        return;
      }

      this.now.set(Date.now());

      const id = setInterval(() => this.now.set(Date.now()), 250);

      onCleanup(() => clearInterval(id));
    });
  }
}
