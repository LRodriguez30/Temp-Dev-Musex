import {
  Component,
  EventEmitter,
  Input,
  Output
} from '@angular/core';

import { Track } from '../../core/models/track.model';

/**
 * Tarjeta reutilizable para representar una canción.
 *
 * El componente se encarga de mostrar la información visual
 * de una canción y emitir las acciones realizadas por el usuario.
 *
 * La reproducción, gestión de favoritos, playlists y metadatos
 * permanecen fuera del componente para mantener separadas
 * presentación y lógica.
 */
@Component({
  selector: 'app-song-card',
  standalone: true,
  templateUrl: './song-card.component.html',
  styleUrl: './song-card.component.css'
})
export class SongCardComponent {

  /**
   * Canción que será mostrada en la tarjeta.
   */
  @Input({ required: true })
  track!: Track;

  /**
   * Indica si la canción está marcada como favorita.
   */
  @Input()
  favorite = false;

  /**
   * Evento emitido cuando el usuario solicita reproducir
   * la canción.
   */
  @Output()
  play = new EventEmitter<void>();

  /**
   * Evento emitido cuando el usuario cambia el estado
   * de favorito.
   */
  @Output()
  favoriteToggle = new EventEmitter<void>();

  /**
   * Evento emitido cuando el usuario solicita agregar
   * la canción a una playlist.
   */
  @Output()
  addToPlaylist = new EventEmitter<Track>();

  /**
   * Evento emitido cuando el usuario solicita abrir
   * las opciones de información y edición de la canción.
   */
  @Output()
  more = new EventEmitter<Track>();

  /**
   * Iconos disponibles para las portadas personalizadas.
   */
  readonly coverIcons: { id: string; path: string }[] = [
    {
      id: 'music',
      path: 'M9 18V5l12-2v13 M9 9l12-2'
    },
    {
      id: 'star',
      path: 'M12 3l2.63 5.33 5.87.85-4.25 4.14 1 5.85L12 16.9l-5.25 2.77 1-5.85L3.5 9.68l5.87-.85L12 3Z'
    },
    {
      id: 'zap',
      path: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z'
    }
  ];

  /**
   * Obtiene la ruta SVG correspondiente al icono
   * seleccionado para una portada.
   */
  getCoverIconPath(id: string | undefined): string {
    return this.coverIcons.find(
      icon => icon.id === id
    )?.path ?? this.coverIcons[0].path;
  }

  /**
   * Formatea la duración almacenada en segundos.
   */
  formatDuration(seconds: number): string {
    const totalSeconds = Math.max(
      0,
      Math.floor(seconds)
    );

    const minutes = Math.floor(
      totalSeconds / 60
    );

    const remainingSeconds =
      totalSeconds % 60;

    return `${minutes}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`;
  }

  /**
   * Solicita la reproducción de la canción.
   */
  playTrack(): void {
    this.play.emit();
  }

  /**
   * Cambia el estado de favorito de la canción.
   */
  toggleFavorite(event: MouseEvent): void {
    event.stopPropagation();
    this.favoriteToggle.emit();
  }

  /**
   * Solicita agregar la canción a una playlist.
   */
  openAddToPlaylist(event: MouseEvent): void {
    event.stopPropagation();
    this.addToPlaylist.emit(this.track);
  }

  /**
   * Solicita abrir las opciones de información
   * y edición de la canción.
   */
  openMore(event: MouseEvent): void {
    event.stopPropagation();
    this.more.emit(this.track);
  }
}