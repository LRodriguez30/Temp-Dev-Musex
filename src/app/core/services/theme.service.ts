import { Injectable, signal } from '@angular/core';

export interface MusexTheme {
  accentColor: string;
}

const DEFAULT_THEME: MusexTheme = { accentColor: '#9CFF00' };
const STORAGE_KEY = 'musex_theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {

  private readonly theme = signal<MusexTheme>(this.loadTheme());
  readonly currentTheme = this.theme.asReadonly();

  constructor() {
    this.applyTheme(this.theme());
  }

  setAccentColor(color: string): void {
    const updated = { accentColor: color };
    this.theme.set(updated);
    this.applyTheme(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }

  resetTheme(): void {
    this.theme.set(DEFAULT_THEME);
    this.applyTheme(DEFAULT_THEME);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_THEME));
  }

  private applyTheme(theme: MusexTheme): void {
    document.documentElement.style.setProperty('--musex-accent', theme.accentColor);
    document.documentElement.style.setProperty(
      '--musex-accent-soft',
      this.hexToRgba(theme.accentColor, 0.1)
    );
  }

  private hexToRgba(hex: string, alpha: number): string {
    const sanitized = hex.replace('#', '');
    const r = parseInt(sanitized.substring(0, 2), 16);
    const g = parseInt(sanitized.substring(2, 4), 16);
    const b = parseInt(sanitized.substring(4, 6), 16);

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private loadTheme(): MusexTheme {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_THEME;
    try {
      return { ...DEFAULT_THEME, ...JSON.parse(saved) };
    } catch {
      return DEFAULT_THEME;
    }
  }
}