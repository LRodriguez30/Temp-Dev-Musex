import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject
} from '@angular/core';

import { Router } from '@angular/router';

import { Playlist } from '../../core/models/playlist.model';

import { getCoverIconPath } from '../../core/data/playlist-icons';

/**
 * Tarjeta reutilizable para representar una playlist.
 *
 * El componente presenta la información de la playlist
 * y comunica las acciones realizadas por el usuario.
 */
@Component({
  selector: 'app-playlist-card',
  standalone: true,
  templateUrl: './playlist-card.component.html',
  styleUrl: './playlist-card.component.css'
})
export class PlaylistCardComponent {
  private readonly router = inject(Router);

  /**
   * Playlist que será mostrada en la tarjeta.
   */
  @Input({ required: true })
  playlist!: Playlist;

  /**
   * Evento emitido cuando el usuario selecciona la playlist.
   */
  @Output()
  select = new EventEmitter<Playlist>();

  getIconPath(iconId: string | undefined): string {
    return getCoverIconPath(iconId);
  }

  /**
   * Selecciona la playlist actual.
   */
  selectPlaylist(): void {
    this.select.emit(this.playlist);
    this.router.navigate(['/playlist', this.playlist.id]);
  }
}