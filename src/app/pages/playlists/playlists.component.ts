import {
  Component,
  inject,
  OnInit,
  signal
} from '@angular/core';

import { RouterLink } from '@angular/router';

import { PlaylistCardComponent } from '../../components/playlist-card/playlist-card.component';

import { PlaylistService } from '../../core/services/playlist.service';
import { PlaylistSyncService } from '../../core/services/playlist-sync.service';
import { RemoteDevicesService } from '../../core/services/remote-devices.service';

import { IS_ANDROID } from '../../core/platform/invoke';
import { LibraryService } from '../../core/services/library.service';

/**
 * Pestaña de playlists para móvil, en dos grupos:
 *
 *  - Del escritorio: sincronizadas, solo lectura.
 *  - De este teléfono: las que creas aquí.
 */
@Component({
  selector: 'app-playlists',
  standalone: true,
  imports: [
    RouterLink,
    PlaylistCardComponent
  ],
  templateUrl: `./playlists.component.html`,
  styleUrl: `./playlists.component.css`
})
export class PlaylistsComponent implements OnInit {

  readonly libraryService = inject(LibraryService);

  readonly playlistService = inject(PlaylistService);

  readonly sync = inject(PlaylistSyncService);

  readonly devices = inject(RemoteDevicesService);

  readonly isAndroid = IS_ANDROID;

  readonly creating = signal(false);

  async ngOnInit(): Promise<void> {
    await this.libraryService.scanLibrary();
    await this.libraryService.scanLocal();
  }

  create(name: string): void {

    const created = this.playlistService.createPlaylist(
      name,
      {
        coverType: 'icon',
        coverIcon: 'musex',
        coverColor: 'var(--musex-accent)'
      }
    );

    if (created) {
      this.creating.set(false);
    }
  }
}