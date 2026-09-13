import { Component, inject, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

import { PlaylistService } from '../../core/services/playlist.service';
import { LibraryService } from '../../core/services/library.service';
import { PlayerService } from '../../core/services/player.service';
import { NotificationService } from '../../core/services/notification.service';
import { QueueService } from '../../core/services/queue.service';

import { MusicTableComponent } from '../music-table/music-table.component';

import { getCoverIconPath } from '../../core/data/playlist-icons';

@Component({
  selector: 'app-playlist-detail',
  standalone: true,
  imports: [MusicTableComponent],
  templateUrl: './playlist-detail.component.html',
  styleUrl: './playlist-detail.component.css'
})
export class PlaylistDetailComponent {

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly getCoverIconPath = getCoverIconPath;

  private readonly playlistService = inject(PlaylistService);
  private readonly libraryService = inject(LibraryService);
  private readonly playerService = inject(PlayerService);
  private readonly notificationService = inject(NotificationService);

  // 1. Convert route params into a reactive signal
  private readonly playlistId = toSignal(
    this.route.paramMap.pipe(map(params => params.get('id') ?? ''))
  );

  // 2. Make playlist a computed property so it updates whenever the ID changes
  readonly playlist = computed(() => {
    const id = this.playlistId();
    return id ? this.playlistService.getPlaylist(id) : undefined;
  });

  // 3. Make tracks a computed property to react to playlist changes
  readonly tracks = computed(() => {
    const p = this.playlist();
    const trackIds = p?.trackIds ?? [];

    return trackIds
      .map(id => this.libraryService.getTrack(id))
      .filter(track => track !== undefined);
  });

  private readonly queueService = inject(QueueService);

  playAll(): void {
    const currentTracks = this.tracks();

    if (currentTracks.length === 0) {
      return;
    }

    const trackIds = currentTracks.map(track => track!.id);

    this.queueService.setQueue(trackIds);
    this.playerService.syncQueue();
    this.playerService.playTrack(trackIds[0]);
  }

  playTrack(trackId: string): void {
    this.playerService.playTrack(trackId);
  }

  removeTrack(trackId: string): void {
    const id = this.playlistId();
    if (!id) return;

    this.playlistService.removeTrack(id, trackId);

    this.notificationService.info(
      'Canción eliminada de la playlist.'
    );
  }

  deletePlaylist(): void {
    const p = this.playlist();
    const id = this.playlistId();

    if (!p?.custom) {
      this.notificationService.warning(
        'Las playlists predeterminadas no se pueden eliminar.'
      );
      return;
    }

    if (!id) return;

    this.playlistService.removePlaylist(id);

    this.notificationService.success(
      'Playlist eliminada.'
    );

    this.router.navigate(['/home']);
  }
}