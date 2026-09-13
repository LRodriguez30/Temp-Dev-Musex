import {
  Component,
  EventEmitter,
  Output
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../modal/modal.component';

import { COVER_ICONS, COVER_COLORS, getCoverIconPath } from '../../core/data/playlist-icons';

export interface CreatePlaylistPayload {
  name: string;
  coverType: 'icon' | 'image';
  coverIcon?: string;
  coverColor?: string;
  image?: string;
}

// /**
//  * Íconos disponibles para portadas de tipo 'icon'.
//  *
//  * Cada entrada es un <path> de Lucide/Feather ya listo
//  * para insertarse dentro de un <svg> con viewBox 0 0 24 24.
//  */
// const COVER_ICONS: { id: string; path: string }[] = [
//   { id: 'music', path: 'M9 18V5l12-2v13 M9 9l12-2' },
//   { id: 'heart', path: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z' },
//   { id: 'zap', path: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z' },
//   { id: 'moon', path: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z' },
//   { id: 'sun', path: 'M12 2v4 M12 18v4 M4.93 4.93l2.83 2.83 M16.24 16.24l2.83 2.83 M2 12h4 M18 12h4 M4.93 19.07l2.83-2.83 M16.24 7.76l2.83-2.83' },
//   { id: 'headphones', path: 'M3 18v-6a9 9 0 0 1 18 0v6 M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3ZM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3Z' }
// ];

// const COVER_COLORS: string[] = [
//   'var(--musex-accent)',
//   '#a45cff',
//   '#ff9d00',
//   '#7276ff',
//   '#ff3ab7',
//   '#44e000'
// ];

@Component({
  selector: 'app-create-playlist-modal',
  standalone: true,
  imports: [ModalComponent, FormsModule],
  templateUrl: './create-playlist-modal.component.html',
  styleUrl: './create-playlist-modal.component.css'
})
export class CreatePlaylistModalComponent {

  @Output()
  closed = new EventEmitter<void>();

  @Output()
  create = new EventEmitter<CreatePlaylistPayload>();

  readonly icons = COVER_ICONS;
  readonly colors = COVER_COLORS;

  name = '';
  coverType: 'icon' | 'image' = 'icon';
  selectedIcon = COVER_ICONS[0].id;
  selectedColor = COVER_COLORS[0];
  imagePreview: string | null = null;

  getIconPath(id: string): string {
    return getCoverIconPath(id);
  }

  selectIconMode(): void {
    this.coverType = 'icon';
  }

  selectImageMode(): void {
    this.coverType = 'image';
  }

  chooseIcon(id: string): void {
    this.selectedIcon = id;
  }

  chooseColor(color: string): void {
    this.selectedColor = color;
  }

  /**
   * Convierte la imagen elegida por el usuario a data URL.
   *
   * Se evita cualquier ruta de servidor o archivo temporal:
   * el resultado es autocontenido y se puede guardar
   * directamente en el modelo de la playlist.
   */
  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      this.imagePreview = reader.result as string;
    };

    reader.readAsDataURL(file);
  }

  submit(): void {
    const trimmedName = this.name.trim();

    if (!trimmedName) {
      return;
    }

    if (this.coverType === 'image' && !this.imagePreview) {
      // Sin imagen seleccionada, forzamos modo ícono
      // para no crear una playlist sin portada.
      this.coverType = 'icon';
    }

    this.create.emit({
      name: trimmedName,
      coverType: this.coverType,
      coverIcon: this.coverType === 'icon' ? this.selectedIcon : undefined,
      coverColor: this.coverType === 'icon' ? this.selectedColor : undefined,
      image: this.coverType === 'image' ? this.imagePreview ?? undefined : undefined
    });

    this.reset();
  }

  cancel(): void {
    this.reset();
    this.closed.emit();
  }

  private reset(): void {
    this.name = '';
    this.coverType = 'icon';
    this.selectedIcon = this.icons[0].id;
    this.selectedColor = this.colors[0];
    this.imagePreview = null;
  }
}