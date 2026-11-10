import {
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal
} from '@angular/core';

/**
 * Asa en el borde derecho de la pantalla que abre el panel
 * "Reproduciendo". Es el equivalente del disco que oculta el panel
 * (dentro de now-playing) y comparte su estilo y animación.
 *
 * - Gira mientras suena la música.
 * - Se esconde mientras el contenido hace scroll para no estorbar
 *   la barra de desplazamiento.
 */
@Component({
  selector: 'app-player-handle',
  standalone: true,
  templateUrl: './player-handle.component.html',
  styleUrl: './player-handle.component.css'
})
export class PlayerHandleComponent {

  readonly playing = input(false);

  readonly open = output<void>();

  readonly tucked = signal(false);

  constructor() {

    const destroyRef = inject(DestroyRef);

    let timer: ReturnType<typeof setTimeout> | undefined;

    const onScroll = (): void => {

      this.tucked.set(true);

      clearTimeout(timer);

      timer = setTimeout(() => this.tucked.set(false), 700);
    };

    // El evento scroll no burbujea: se escucha en fase de captura.
    document.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true
    });

    destroyRef.onDestroy(() => {

      document.removeEventListener('scroll', onScroll, true);

      clearTimeout(timer);
    });
  }
}
