import {
  Component,
  EventEmitter,
  Input,
  Output
} from '@angular/core';

/**
 * Tarjeta reutilizable para representar una recomendación
 * disponible dentro de Musex.
 *
 * El componente se limita a presentar la recomendación
 * y comunicar la acción solicitada por el usuario.
 */
@Component({
  selector: 'app-recommendation-card',
  standalone: true,
  templateUrl: './recommendation-card.component.html',
  styleUrl: './recommendation-card.component.css'
})
export class RecommendationCardComponent {
  /**
   * Nombre de la recomendación.
   */
  @Input({ required: true })
  title!: string;

  /**
   * Descripción o estado de actualización.
   */
  @Input({ required: true })
  subtitle!: string;

  /**
   * Evento emitido cuando el usuario abre la recomendación.
   */
  @Output()
  open = new EventEmitter<void>();

  /**
   * Solicita la apertura de la recomendación.
   */
  openRecommendation(): void {
    this.open.emit();
  }
}