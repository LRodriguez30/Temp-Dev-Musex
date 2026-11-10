import { Injectable, signal } from '@angular/core';

import { Settings } from '../models/settings.model';

/**
 * Valores predeterminados utilizados cuando Musex
 * todavía no tiene una configuración guardada.
 */
const DEFAULT_SETTINGS: Settings = {
  volume: 100,
  muted: false,
  rightPanel: true,
  autoDownload: true,
  downloadDirectory: '',
  autoPick: false,
  autoPickGraceSeconds: 5
};

const STORAGE_KEY = 'musex_settings';

/**
 * Gestiona las preferencias generales de Musex.
 *
 * El servicio centraliza la configuración utilizada por
 * diferentes partes de la aplicación y evita que los componentes
 * tengan que modificar directamente el estado de configuración.
 *
 * La persistencia será conectada posteriormente mediante
 * StorageService.
 */
@Injectable({
  providedIn: 'root'
})
export class SettingsService {

  /**
   * Estado interno de la configuración.
   *
   * Se inicializa utilizando una copia de los valores
   * predeterminados para evitar referencias compartidas.
   */
  private readonly settings = signal<Settings>(
    this.loadSaved()
  );

  /**
   * Exposición de solo lectura de la configuración.
   */
  readonly state = this.settings.asReadonly();

  /**
   * Devuelve la configuración actual.
   */
  getSettings(): Settings {
    return {
      ...this.settings()
    };
  }

  /**
   * Reemplaza completamente la configuración actual.
   *
   * Se utilizará posteriormente al restaurar las preferencias
   * almacenadas entre sesiones.
   */
  setSettings(settings: Settings): void {
    this.settings.set({
      ...settings
    });

    this.persist();
  }

  /**
   * Actualiza únicamente los valores proporcionados.
   */
  updateSettings(
    changes: Partial<Settings>
  ): void {
    this.settings.update(current => ({
      ...current,
      ...changes
    }));

    this.persist();
  }

  /**
   * Cambia el volumen predeterminado.
   */
  setVolume(volume: number): void {
    const normalizedVolume = Math.max(
      0,
      Math.min(volume, 100)
    );

    this.updateSettings({
      volume: normalizedVolume,
      muted: normalizedVolume === 0
    });
  }

  /**
   * Activa o desactiva el silencio inicial.
   */
  setMuted(muted: boolean): void {
    this.updateSettings({
      muted
    });
  }

  /**
   * Activa o desactiva el panel lateral al iniciar Musex.
   */
  setRightPanel(rightPanel: boolean): void {
    this.updateSettings({
      rightPanel
    });
  }

  /**
   * Activa o desactiva el inicio automático de las descargas.
   */
  setAutoDownload(autoDownload: boolean): void {
    this.updateSettings({
      autoDownload
    });
  }

  /**
   * Establece el directorio predeterminado para las descargas.
   *
   * La selección real del directorio se implementará posteriormente
   * mediante las capacidades nativas de Tauri.
   */
  setDownloadDirectory(
    downloadDirectory: string
  ): void {
    this.updateSettings({
      downloadDirectory
    });
  }

  /**
   * Restaura todos los valores predeterminados.
   */
  reset(): void {
    this.settings.set({
      ...DEFAULT_SETTINGS
    });

    this.persist();
  }

  /**
   * Activa o desactiva la selección automática de la
   * siguiente canción.
   */
  setAutoPick(autoPick: boolean): void {
    this.updateSettings({
      autoPick
    });
  }

  /**
   * Cambia el tiempo de gracia (0–30 s) de la selección automática.
   */
  setAutoPickGraceSeconds(seconds: number): void {

    const value = Number.isFinite(seconds)
      ? Math.max(0, Math.min(Math.round(seconds), 30))
      : DEFAULT_SETTINGS.autoPickGraceSeconds;

    this.updateSettings({
      autoPickGraceSeconds: value
    });
  }

  /**
   * Lee las preferencias guardadas (localStorage) y las mezcla
   * con los valores predeterminados.
   */
  private loadSaved(): Settings {

    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (raw) {
        const parsed: unknown = JSON.parse(raw);

        if (parsed && typeof parsed === 'object') {
          return {
            ...DEFAULT_SETTINGS,
            ...(parsed as Partial<Settings>)
          };
        }
      }
    } catch {
      /* se usan los valores predeterminados */
    }

    return { ...DEFAULT_SETTINGS };
  }

  private persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(this.settings())
      );
    } catch {
      /* almacenamiento no disponible */
    }
  }
}