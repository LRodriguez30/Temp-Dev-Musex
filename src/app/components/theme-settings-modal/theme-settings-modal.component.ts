import { Component, EventEmitter, inject, Output, signal } from '@angular/core';
import { ModalComponent } from '../modal/modal.component';
import { ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-theme-settings-modal',
  standalone: true,
  imports: [ModalComponent],
  templateUrl: './theme-settings-modal.component.html'
})
export class ThemeSettingsModalComponent {
  private readonly themeService = inject(ThemeService);
  readonly theme = this.themeService.currentTheme;

  @Output() closed = new EventEmitter<void>();

  setAccent(color: string): void {
    this.themeService.setAccentColor(color);
  }

  reset(): void {
    this.themeService.resetTheme();
  }
}