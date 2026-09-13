import {
    ChangeDetectionStrategy,
    Component,
    EventEmitter,
    Output,
    inject,
    signal
} from '@angular/core';

import { PlayerService } from '../../core/services/player.service';
import { LibraryService } from '../../core/services/library.service';
import { Track } from '../../core/models/track.model';

import { getCoverIconPath } from '../../core/data/playlist-icons';

import { QueueComponent } from '../queue/queue.component';

@Component({
    selector: 'app-full-player',
    standalone: true,
    imports: [QueueComponent],
    templateUrl: './full-player.component.html',
    styleUrl: './full-player.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class FullPlayerComponent {

    readonly playerService = inject(PlayerService);

    readonly libraryService = inject(LibraryService);

    readonly playerState = this.playerService.state;

    @Output()
    readonly close = new EventEmitter<void>();

    /**
     * Controla la visibilidad de la cola dentro del Full Player.
     *
     * En escritorio permanece abierta por defecto.
     * En pantallas pequeñas puede ocultarse para recuperar espacio.
     */
    readonly queueOpen = signal(true);

    get currentTrack(): Track | undefined {
        return this.playerService.getCurrentTrack();
    }

    get currentTrackIsFavorite(): boolean {
        const track = this.currentTrack;

        if (!track) {
            return false;
        }

        return track.favorite;
    }

    readonly visualizerBars = [
        { height: '35%', delay: '0s', duration: '0.9s' },
        { height: '65%', delay: '0.12s', duration: '0.75s' },
        { height: '90%', delay: '0.24s', duration: '0.65s' },
        { height: '55%', delay: '0.36s', duration: '0.85s' },
        { height: '78%', delay: '0.48s', duration: '0.7s' },
        { height: '45%', delay: '0.6s', duration: '0.95s' },
        { height: '70%', delay: '0.72s', duration: '0.8s' },
        { height: '50%', delay: '0.84s', duration: '0.72s' }
    ];

    seekingValue = false;
    seekPositionValue = 0;

    get seeking(): boolean {
        return this.seekingValue;
    }

    get seekPosition(): number {
        return this.seekPositionValue;
    }

    closeFullPlayer(): void {
        this.close.emit();
    }

    togglePlay(): void {
        void this.playerService.togglePlay();
    }

    previousTrack(): void {
        this.playerService.previousTrack();
    }

    nextTrack(): void {
        this.playerService.nextTrack();
    }

    toggleShuffle(): void {
        this.playerService.toggleShuffle();
    }

    toggleRepeat(): void {
        this.playerService.toggleRepeat();
    }

    toggleMute(): void {
        void this.playerService.toggleMute();
    }

    setVolume(volume: number): void {
        void this.playerService.setVolume(volume);
    }

    toggleQueue(): void {
        this.queueOpen.update(open => !open);
    }

    toggleFavorite(): void {
        const track = this.currentTrack;

        if (!track) {
            return;
        }

        this.libraryService.toggleFavorite(track.id);
    }

    startSeek(): void {
        this.seekingValue = true;
        this.seekPositionValue =
            this.playerState().currentTime;
    }

    updateSeekPosition(position: number): void {
        const track = this.currentTrack;

        if (!track) {
            return;
        }

        this.seekPositionValue = Math.max(
            0,
            Math.min(position, track.duration)
        );
    }

    finishSeek(): void {
        if (!this.seekingValue) {
            return;
        }

        const position = this.seekPositionValue;

        this.seekingValue = false;

        void this.playerService.seek(position);
    }

    formatTime(seconds: number): string {
        if (!Number.isFinite(seconds) || seconds < 0) {
            return '0:00';
        }

        const totalSeconds = Math.floor(seconds);

        const minutes = Math.floor(
            totalSeconds / 60
        );

        const remainingSeconds =
            totalSeconds % 60;

        return `${minutes}:${remainingSeconds
            .toString()
            .padStart(2, '0')}`;
    }

    getCoverIconPath = getCoverIconPath;
}