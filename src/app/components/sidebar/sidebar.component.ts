import {
  Component,
  computed,
  HostListener,
  inject,
  OnInit,
  signal
} from '@angular/core';

import {
  Router,
  RouterLink,
  RouterLinkActive
} from '@angular/router';

import { MusexStorageService } from '../../core/services/musex-storage.service';
import { PlaylistService } from '../../core/services/playlist.service';
import { NotificationService } from '../../core/services/notification.service';
import {
  CreatePlaylistModalComponent,
  CreatePlaylistPayload
} from '../create-playlist-modal/create-playlist-modal.component';

import { getCoverIconPath } from '../../core/data/playlist-icons';

import { ThemeSettingsModalComponent } from '../theme-settings-modal/theme-settings-modal.component';

/**
 * Barra lateral principal de Musex.
 *
 * Centraliza la navegación entre las diferentes secciones de la
 * aplicación y muestra las playlists disponibles en la biblioteca.
 *
 * También muestra el espacio físico ocupado por Musex en la máquina.
 */
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [
    RouterLink,
    RouterLinkActive,
    CreatePlaylistModalComponent,
    ThemeSettingsModalComponent
  ],
  templateUrl: './sidebar.component.html'
})
export class SidebarComponent implements OnInit {

  private readonly router = inject(Router);

  private readonly musexStorageService = inject(MusexStorageService);
  readonly playlistService = inject(PlaylistService);
  private readonly notificationService = inject(NotificationService);

  readonly storageSize = signal<number>(0);
  readonly storageLoading = signal<boolean>(true);

  /**
   * Playlists mostradas en el sidebar.
   *
   * Se limita la cantidad visible; "Ver más" navega
   * a la vista completa de playlists.
   */
  readonly playlists =
    this.playlistService.allPlaylists;
    
  /**
   * Cantidad de playlists visibles en el sidebar.
   *
   * Se incrementa con "Ver más" en lugar de renderizar
   * todas las playlists de una vez.
   */
  private readonly visibleCount = signal<number>(6);

  readonly visiblePlaylists = computed(() =>
    this.playlistService.allPlaylists().slice(0, this.visibleCount())
  );

  readonly hasMorePlaylists = computed(() =>
    this.playlistService.allPlaylists().length > this.visibleCount()
  );

  readonly showCreateModal = signal<boolean>(false);

  readonly showThemeModal = signal(false);

  openThemeSettings(): void {
    this.showThemeModal.set(true);
  }

  async ngOnInit(): Promise<void> {
    await this.loadStorageSize();
  }

  async loadStorageSize(): Promise<void> {
    try {
      this.storageLoading.set(true);
      const size = await this.musexStorageService.getStorageSize();
      this.storageSize.set(size);
    } catch (error) {
      console.error('No se pudo cargar el almacenamiento de Musex.', error);
    } finally {
      this.storageLoading.set(false);
    }
  }

  formatStorageSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }

  getPlaylistIconPath(iconId: string | undefined): string {
    return getCoverIconPath(iconId);
  }

  showMorePlaylists(): void {
    this.visibleCount.update(count => count + 6);
  }

  openCreatePlaylist(): void {
    this.showCreateModal.set(true);
  }

  onPlaylistCreated(payload: CreatePlaylistPayload): void {
    const playlist = this.playlistService.createPlaylist(
      payload.name,
      {
        coverType: payload.coverType,
        coverIcon: payload.coverIcon,
        coverColor: payload.coverColor,
        image: payload.image
      }
    );

    this.showCreateModal.set(false);

    if (playlist) {
      this.notificationService.success(`Playlist "${playlist.name}" creada.`);
      this.router.navigate(['/playlist', playlist.id]);
    }
  }

  /**
   * Atajos de teclado para navegar rápidamente
   * entre las principales vistas de Musex.
   *
   * Los atajos utilizan Ctrl en Windows/Linux.
   *
   * No se ejecutan mientras el usuario está escribiendo
   * dentro de un campo de texto o elemento editable.
   */
  @HostListener('window:keydown', ['$event'])
  handleKeyboardShortcut(event: KeyboardEvent): void {

    if (!event.ctrlKey || event.altKey || event.shiftKey) {
      return;
    }

    const target = event.target as HTMLElement | null;

    if (
      target?.tagName === 'INPUT' ||
      target?.tagName === 'TEXTAREA' ||
      target?.tagName === 'SELECT' ||
      target?.isContentEditable
    ) {
      return;
    }

    const routes: Record<string, string> = {
      '1': '/home',
      '2': '/explore',
      '3': '/library',
      '4': '/favorites',
      '5': '/downloads',
      '6': '/history',
      '7': '/equalizer',
      '8': '/ai'
    };

    const route = routes[event.key];

    if (!route) {
      return;
    }

    event.preventDefault();

    void this.router.navigate([route]);
  }
}