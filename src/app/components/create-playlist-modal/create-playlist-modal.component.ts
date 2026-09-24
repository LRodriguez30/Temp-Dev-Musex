import {
  Component,
  EventEmitter,
  Output,
  signal
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../modal/modal.component';

import {
  COVER_ICONS,
  COVER_COLORS,
  getCoverIconPath
} from '../../core/data/playlist-icons';

export interface CreatePlaylistPayload {
  name: string;
  coverType: 'icon' | 'image';
  coverIcon?: string;
  coverColor?: string;
  image?: string;
}

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

  imagePreview = signal<string | null>(null);

  /**
   * Indica que la imagen está siendo procesada.
   */
  imageLoading = signal(false);


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
   * Lee la imagen seleccionada y muestra una animación
   * mientras se procesa.
   */
  onImageSelected(event: Event): void {

    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    // Comienza la animación.
    this.imageLoading.set(true);

    // Ocultamos cualquier imagen anterior.
    this.imagePreview.set(null);


    const reader = new FileReader();


    reader.onload = () => {

      const result = reader.result;

      if (typeof result !== 'string') {
        this.imageLoading.set(false);
        return;
      }


      /*
       * Pequeña pausa únicamente para que la animación
       * visual sea perceptible.
       */
      setTimeout(() => {

        this.imagePreview.set(result);
        this.imageLoading.set(false);

      }, 400);
    };


    reader.onerror = () => {

      this.imageLoading.set(false);
      this.imagePreview.set(null);

    };


    reader.readAsDataURL(file);


    /*
     * Limpiamos el valor del input para permitir
     * seleccionar nuevamente el mismo archivo.
     */
    input.value = '';
  }


  submit(): void {

    const trimmedName = this.name.trim();

    if (!trimmedName) {
      return;
    }

    if (this.imageLoading()) {
      return;
    }


    if (this.coverType === 'image' && !this.imagePreview()) {

      // Sin imagen seleccionada, forzamos modo ícono.
      this.coverType = 'icon';

    }


    this.create.emit({
      name: trimmedName,

      coverType: this.coverType,

      coverIcon:
        this.coverType === 'icon'
          ? this.selectedIcon
          : undefined,

      coverColor:
        this.coverType === 'icon'
          ? this.selectedColor
          : undefined,

      image:
        this.coverType === 'image'
          ? this.imagePreview() ?? undefined
          : undefined
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

    this.imagePreview.set(null);
    this.imageLoading.set(false);

  }
}