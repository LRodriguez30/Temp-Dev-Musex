import { Component, computed, inject } from '@angular/core';

import { LibraryService } from '../../core/services/library.service';
import { PlayerService } from '../../core/services/player.service';

/**
 * Línea de progreso de la canción actual dentro de su fila.
 *
 * Es un componente aparte a propósito: lee la posición (que cambia
 * varias veces por segundo) y así solo se redibuja esta línea, no
 * toda la lista.
 */
@Component({
  selector: 'app-row-progress',
  standalone: true,
  template: `<span class="fill" [style.transform]="'scaleX(' + ratio() + ')'"></span>`,
  styles: [`
    :host {
      position: absolute;
      right: 14px;
      bottom: 2px;
      left: 14px;
      height: 3px;
      overflow: hidden;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.08);
      pointer-events: none;
    }

    .fill {
      display: block;
      width: 100%;
      height: 100%;
      border-radius: inherit;
      background: var(--musex-accent, #9cff00);
      box-shadow: 0 0 8px color-mix(in srgb, var(--musex-accent, #9cff00) 55%, transparent);
      transform-origin: left center;
      transform: scaleX(0);
      transition: transform 260ms linear;
    }
  `]
})
export class RowProgressComponent {

  private readonly player = inject(PlayerService);
  private readonly library = inject(LibraryService);

  readonly ratio = computed(() => {

    const state = this.player.state();

    const track = state.currentTrackId
      ? this.library.getTrack(state.currentTrackId)
      : undefined;

    const duration = track?.duration ?? 0;

    return duration > 0
      ? Math.min(1, Math.max(0, state.currentTime / duration)).toFixed(4)
      : '0';
  });
}
