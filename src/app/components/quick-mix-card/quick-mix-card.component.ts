import {
  Component,
  EventEmitter,
  Input,
  Output
} from '@angular/core';

/**
 * Tarjeta reutilizable para los mixes rápidos de Musex.
 *
 * El componente se encarga únicamente de representar
 * la información del mix y comunicar la acción de reproducción.
 */
@Component({
  selector: 'app-quick-mix-card',
  standalone: true,
  templateUrl: './quick-mix-card.component.html',
  styleUrl: './quick-mix-card.component.css'
})
export class QuickMixCardComponent {
  /**
   * Nombre visible del mix.
   */
  @Input({ required: true })
  title!: string;

  /**
   * Descripción breve del mix.
   */
  @Input({ required: true })
  subtitle!: string;

  /**
   * Evento emitido cuando el usuario solicita reproducir el mix.
   */
  @Output()
  play = new EventEmitter<void>();

  /**
   * Solicita la reproducción del mix.
   */
  playMix(): void {
    this.play.emit();
  }
}