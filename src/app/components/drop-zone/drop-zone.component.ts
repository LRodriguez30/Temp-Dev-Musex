import {
  Component,
  EventEmitter,
  HostListener,
  Output
} from '@angular/core';

/**
 * Zona reutilizable para importar archivos de audio.
 *
 * El componente únicamente gestiona la interacción con el usuario:
 * selección mediante el explorador de archivos y drag & drop.
 *
 * El procesamiento e incorporación de los archivos a la biblioteca
 * corresponde al componente padre y a los servicios de dominio.
 */
@Component({
  selector: 'app-drop-zone',
  standalone: true,
  templateUrl: './drop-zone.component.html',
  styleUrl: './drop-zone.component.css'
})
export class DropZoneComponent {
  @Output()
  filesSelected = new EventEmitter<File[]>();

  /**
   * Abre el selector de archivos del sistema.
   */
  selectFiles(): void {
    const input = document.createElement('input');

    input.type = 'file';
    input.multiple = true;
    input.accept = 'audio/*';

    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);

      if (files.length > 0) {
        this.filesSelected.emit(files);
      }
    });

    input.click();
  }

  /**
   * Permite activar la zona mediante teclado.
   */
  handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    this.selectFiles();
  }

  /**
   * Permite arrastrar archivos sobre la zona.
   */
  handleDragOver(event: DragEvent): void {
    event.preventDefault();

    event.dataTransfer!.dropEffect = 'copy';

    event.currentTarget
      && (event.currentTarget as HTMLElement).classList.add('drag');
  }

  /**
   * Restablece el estado visual al abandonar la zona.
   */
  handleDragLeave(event: DragEvent): void {
    event.preventDefault();

    (event.currentTarget as HTMLElement).classList.remove('drag');
  }

  /**
   * Procesa los archivos soltados sobre la zona.
   */
  handleDrop(event: DragEvent): void {
    event.preventDefault();

    const element = event.currentTarget as HTMLElement;
    element.classList.remove('drag');

    const files = Array.from(event.dataTransfer?.files ?? [])
      .filter(file => file.type.startsWith('audio/'));

    if (files.length > 0) {
      this.filesSelected.emit(files);
    }
  }
}