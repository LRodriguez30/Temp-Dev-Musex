import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';

import { LibraryService } from '../../core/services/library.service';
import { LyricLine, LyricsService } from '../../core/services/lyrics.service';
import { PlayerService } from '../../core/services/player.service';

/** Pausa del auto-scroll tras mover la letra a mano (ms). */
const MANUAL_SCROLL_PAUSE = 4000;

/**
 * Letras de la canción en reproducción.
 *
 * Si la letra está sincronizada resalta la línea actual y la
 * mantiene centrada; tocar una línea salta a ese momento.
 */
@Component({
  selector: 'app-lyrics',
  standalone: true,
  templateUrl: './lyrics.component.html',
  styleUrl: './lyrics.component.css'
})
export class LyricsComponent {

  readonly lyricsService = inject(LyricsService);

  private readonly player = inject(PlayerService);
  private readonly library = inject(LibraryService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly status = this.lyricsService.status;
  readonly lyrics = this.lyricsService.lyrics;

  readonly editing = signal(false);
  readonly draft = signal('');

  private manualScrollUntil = 0;

  /** Cambia solo cuando cambia la canción (no en cada tick). */
  private readonly currentId = computed(
    () => this.player.state().currentTrackId
  );

  readonly track = computed(() => {

    const id = this.currentId();

    return id ? this.library.getTrack(id) : undefined;
  });

  readonly activeIndex = computed(() => {

    const lines = this.lyrics()?.synced;

    if (!lines) {
      return -1;
    }

    const time = this.player.state().currentTime + 0.25;

    let low = 0;
    let high = lines.length - 1;
    let found = -1;

    while (low <= high) {

      const mid = (low + high) >> 1;

      if (lines[mid].time <= time) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return found;
  });

  constructor() {

    // Carga la letra cuando cambia la canción.
    effect(() => {

      const id = this.currentId();

      untracked(() => {

        this.editing.set(false);

        const track = id ? this.library.getTrack(id) : undefined;

        if (track) {
          void this.lyricsService.load(track);
        } else {
          this.lyricsService.reset();
        }
      });
    });

    // Mantiene centrada la línea actual.
    effect(() => {

      const index = this.activeIndex();

      if (index < 0 || Date.now() < this.manualScrollUntil) {
        return;
      }

      setTimeout(() => {

        this.host.nativeElement
          .querySelector('.lyric-line.is-active')
          ?.scrollIntoView({
            block: 'center',
            behavior: 'smooth'
          });
      }, 0);
    });
  }

  // ===========================================================
  // ACCIONES
  // ===========================================================

  /** El usuario movió la letra: se pausa el auto-scroll un momento. */
  onManualScroll(): void {
    this.manualScrollUntil = Date.now() + MANUAL_SCROLL_PAUSE;
  }

  seekTo(line: LyricLine): void {

    this.manualScrollUntil = 0;

    void this.player.seek(line.time);
  }

  retry(): void {

    const track = this.track();

    if (track) {
      void this.lyricsService.load(track, true);
    }
  }

  startEdit(): void {

    this.draft.set(this.lyricsService.editableText());

    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
  }

  onDraft(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  saveEdit(): void {

    const track = this.track();

    if (!track) {
      return;
    }

    if (this.lyricsService.saveManual(track, this.draft())) {
      this.editing.set(false);
    }
  }

  discardStored(): void {

    const track = this.track();

    if (track) {
      this.editing.set(false);

      void this.lyricsService.removeStored(track);
    }
  }
}
