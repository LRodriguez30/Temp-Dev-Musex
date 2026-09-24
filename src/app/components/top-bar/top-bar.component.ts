import {
  Component,
  HostListener,
  inject,
  signal
} from '@angular/core';

import { MobileMenuService } from '../../core/services/mobile-menu.service';
import { ModalService } from '../../core/services/modal.service';

@Component({
  selector: 'app-top-bar',
  standalone: true,
  imports: [],
  templateUrl: './top-bar.component.html',
  styleUrl: './top-bar.component.css'
})
export class TopBarComponent {

  // =========================================================
  // SERVICIOS
  // =========================================================

  readonly mobileMenuService =
    inject(MobileMenuService);

  private readonly modalService =
    inject(ModalService);


  // =========================================================
  // ESTADO
  // =========================================================

  readonly userMenuOpen =
    signal(false);


  // =========================================================
  // BÚSQUEDA
  // =========================================================

  /**
   * Abre el buscador global de Musex.
   *
   * El estado del buscador es administrado por ModalService.
   */
  openSearch(): void {

    this.userMenuOpen.set(false);

    this.modalService.openSearch();

  }


  // =========================================================
  // MENÚ DE USUARIO
  // =========================================================

  /**
   * Abre o cierra el menú del usuario.
   */
  toggleUserMenu(): void {

    this.userMenuOpen.update(
      open => !open
    );

  }


  // =========================================================
  // ATAJOS GLOBALES
  // =========================================================

  @HostListener(
    'document:keydown',
    ['$event']
  )
  handleKeyboard(event: KeyboardEvent): void {

    // Ctrl + K / Cmd + K

    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'k'
    ) {

      event.preventDefault();

      this.openSearch();

      return;

    }


    // Escape

    if (
      event.key === 'Escape' &&
      this.userMenuOpen()
    ) {

      this.userMenuOpen.set(false);

    }

  }

}