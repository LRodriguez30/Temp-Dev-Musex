import { Component, EventEmitter, inject, Output } from '@angular/core';
import { ThemeService } from '../../core/services/theme.service';
import { SettingsService } from '../../core/services/settings.service';
import { HistoryService } from '../../core/services/history.service';
import { NotificationService } from '../../core/services/notification.service';

@Component({
  selector: 'app-theme-settings-modal',
  standalone: true,
  imports: [],
  templateUrl: './theme-settings-modal.component.html'
})
export class ThemeSettingsModalComponent {
  private readonly themeService = inject(ThemeService);
  readonly theme = this.themeService.currentTheme;

  private readonly settingsService = inject(SettingsService);
  private readonly historyService = inject(HistoryService);
  private readonly notificationService = inject(NotificationService);

  readonly settings = this.settingsService.state;

  readonly graceOptions = [3, 5, 10, 15];

  @Output() closed = new EventEmitter<void>();

  toggleAutoPick(): void {
    this.settingsService.setAutoPick(!this.settings().autoPick);
  }

  setGrace(value: string): void {
    this.settingsService.setAutoPickGraceSeconds(Number(value));
  }

  clearHistory(): void {
    this.historyService.clearHistory();
    this.notificationService.info('Historial de escucha borrado.');
  }

  setAccent(color: string): void {
    this.themeService.setAccentColor(color);
  }

  reset(): void {
    this.themeService.resetTheme();
  }
}