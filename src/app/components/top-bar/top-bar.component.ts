import {
  Component,
  HostListener,
  inject,
  signal
} from '@angular/core';

import { MobileMenuService } from '../../core/services/mobile-menu.service';
import { ModalService } from '../../core/services/modal.service';

interface Profile {
  id: string;
  name: string;
  subtitle: string;
  active: boolean;
}

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

  readonly profileSwitcherOpen =
    signal(false);


  // =========================================================
  // PERFILES
  // =========================================================

  /**
   * Perfiles de ejemplo para la interfaz visual.
   *
   * TODO:
   * Reemplazar por el sistema real de perfiles locales
   * cuando exista persistencia.
   */
  readonly availableProfiles =
    signal<Profile[]>([
      {
        id: 'lart',
        name: 'LART',
        subtitle: 'Biblioteca personal',
        active: true
      },
      {
        id: 'familia',
        name: 'Familia',
        subtitle: 'Compartido',
        active: false
      }
    ]);


  // =========================================================
  // BÚSQUEDA
  // =========================================================

  /**
   * Abre el buscador global de Musex.
   *
   * El TopBar no administra el estado del buscador.
   * ModalService es ahora el encargado de abrirlo.
   */
  openSearch(): void {

    this.userMenuOpen.set(false);
    this.profileSwitcherOpen.set(false);

    this.modalService.openSearch();

  }


  // =========================================================
  // MENÚ DE PERFIL
  // =========================================================

  toggleUserMenu(): void {

    /*
     * Si el menú está abierto y el usuario vuelve
     * a pulsar el botón, simplemente lo cerramos.
     */

    this.userMenuOpen.update(
      open => !open
    );


    /*
     * Al abrir el menú de perfil nos aseguramos
     * de que el selector interno empiece cerrado.
     */

    if (!this.userMenuOpen()) {

      this.profileSwitcherOpen.set(false);

    }

  }


  // =========================================================
  // SELECTOR DE PERFILES
  // =========================================================

  toggleProfileSwitcher(): void {

    this.profileSwitcherOpen.update(
      open => !open
    );

  }


  selectProfile(profileId: string): void {

    this.availableProfiles.update(
      profiles =>
        profiles.map(profile => ({
          ...profile,
          active: profile.id === profileId
        }))
    );

    this.profileSwitcherOpen.set(false);

  }


  // =========================================================
  // ATAJOS GLOBALES
  // =========================================================

  @HostListener(
    'document:keydown',
    ['$event']
  )
  handleKeyboard(event: KeyboardEvent): void {

    /*
     * Ctrl + K
     *
     * Windows / Linux:
     * Ctrl + K
     *
     * macOS:
     * Cmd + K
     *
     * El buscador se encarga internamente de su
     * navegación por teclado una vez abierto.
     */

    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'k'
    ) {

      event.preventDefault();

      this.openSearch();

      return;

    }


    /*
     * Escape:
     *
     * El ModalComponent global se encarga del Escape
     * cuando existe un modal abierto.
     *
     * Aquí solamente manejamos el menú de perfil,
     * que no pertenece al sistema global de modales.
     */

    if (event.key === 'Escape') {

      if (this.profileSwitcherOpen()) {

        this.profileSwitcherOpen.set(false);

        return;

      }


      if (this.userMenuOpen()) {

        this.userMenuOpen.set(false);

      }

    }

  }

}