// =============================================================
// MUSEX - SENSE SERVICE
// =============================================================
//
// Fuente única de verdad del estado de Musex Sense en el
// frontend. Todo el estado real (activado/apagado, capacidades,
// prompts, si hay API key guardada) vive en Rust — este servicio
// solo refleja lo que Rust reporta y expone los métodos para
// mutarlo.
//
// La API key en sí NUNCA pasa por este servicio ni por ningún
// signal: se envía directo a `save_sense_api_key` y Rust la
// guarda en el keyring del sistema operativo.
//
// providedIn: 'root' para que cualquier componente (Sense,
// Explore, Equalizer) comparta el mismo estado sin recargar.
// =============================================================

import {
  Injectable,
  signal,
  computed
} from '@angular/core';

import { invoke } from '@tauri-apps/api/core';


// =============================================================
// TYPES
// =============================================================

export type SenseCapabilityKey =
  | 'recommendations'
  | 'eq_assistant'
  | 'library_analysis';


export type SenseEqFilterType =
  | 'peaking'
  | 'lowshelf'
  | 'highshelf';


export interface SenseCapabilities {
  recommendations: boolean;
  eqAssistant: boolean;
  libraryAnalysis: boolean;
}


export interface SensePrompts {
  recommendations: string;
  eqAssistant: string;
  libraryAnalysis: string;
}


export interface SenseSettings {
  enabled: boolean;
  hasApiKey: boolean;
  capabilities: SenseCapabilities;
  prompts: SensePrompts;
}


export interface SenseEqBand {
  filterType: SenseEqFilterType;
  frequency: number;
  gainDb: number;
  q: number;
}


export interface SenseEqPreset {
  name: string;
  bands: SenseEqBand[];
}


// =============================================================
// RAW SETTINGS
// =============================================================
//
// Forma cruda que devuelve Rust.
// Rust utiliza snake_case por defecto con serde.
// =============================================================

interface RawSenseSettings {
  enabled: boolean;
  has_api_key: boolean;

  capabilities: {
    recommendations: boolean;
    eq_assistant: boolean;
    library_analysis: boolean;
  };

  prompts: {
    recommendations: string;
    eq_assistant: string;
    library_analysis: string;
  };
}


// =============================================================
// RAW -> FRONTEND
// =============================================================

function fromRaw(
  raw: RawSenseSettings
): SenseSettings {

  return {
    enabled:
      raw.enabled,

    hasApiKey:
      raw.has_api_key,

    capabilities: {
      recommendations:
        raw.capabilities.recommendations,

      eqAssistant:
        raw.capabilities.eq_assistant,

      libraryAnalysis:
        raw.capabilities.library_analysis,
    },

    prompts: {
      recommendations:
        raw.prompts.recommendations,

      eqAssistant:
        raw.prompts.eq_assistant,

      libraryAnalysis:
        raw.prompts.library_analysis,
    },
  };
}


// =============================================================
// DEFAULT SETTINGS
// =============================================================

const DEFAULT_SETTINGS: SenseSettings = {

  enabled:
    false,

  hasApiKey:
    false,

  capabilities: {

    recommendations:
      false,

    eqAssistant:
      false,

    libraryAnalysis:
      false,
  },

  prompts: {

    recommendations:
      '',

    eqAssistant:
      '',

    libraryAnalysis:
      '',
  },
};


// =============================================================
// SERVICE
// =============================================================

@Injectable({
  providedIn: 'root'
})
export class SenseService {

  // ===========================================================
  // STATE
  // ===========================================================

  private readonly settingsState =
    signal<SenseSettings>(
      DEFAULT_SETTINGS
    );


  /**
   * Estado completo de Sense.
   *
   * Todos los componentes que necesiten información de Sense
   * utilizan este signal como fuente única de verdad.
   */
  readonly settings =
    this.settingsState.asReadonly();


  /**
   * Estado global de activación de Sense.
   *
   * Este computed NO mantiene un estado independiente.
   * Siempre refleja `settingsState().enabled`.
   *
   * Por lo tanto, si Sense se activa desde cualquier componente,
   * todos los demás componentes que consuman `enabled()` se
   * actualizan automáticamente.
   */
  readonly enabled =
    computed(() =>
      this.settingsState().enabled
    );


  private loaded =
    false;


  private loadingPromise:
    Promise<void> | null =
      null;


  // ===========================================================
  // LOAD
  // ===========================================================

  /**
   * Carga la configuración desde Rust si aún no se ha cargado.
   *
   * Esto permite que cualquier servicio o componente pueda
   * consultar Sense sin tener que conocer cómo se almacena
   * internamente su configuración.
   */
  async ensureLoaded(): Promise<void> {

    if (this.loaded) {
      return;
    }


    if (this.loadingPromise) {

      await this.loadingPromise;

      return;
    }


    this.loadingPromise =
      this.refresh();

    await this.loadingPromise;
  }


  async refresh(): Promise<void> {

    try {

      const raw =
        await invoke<RawSenseSettings>(
          'get_sense_settings'
        );


      this.settingsState.set(
        fromRaw(raw)
      );


      this.loaded =
        true;

    } catch (error) {

      console.error(
        'No se pudo cargar la configuración de Sense:',
        error
      );

    } finally {

      this.loadingPromise =
        null;
    }
  }


  // ===========================================================
  // SENSE TOGGLE
  // ===========================================================

  async setEnabled(
    enabled: boolean
  ): Promise<void> {

    const raw =
      await invoke<RawSenseSettings>(
        'set_sense_enabled',
        {
          enabled
        }
      );


    this.settingsState.set(
      fromRaw(raw)
    );
  }


  async toggleEnabled(): Promise<void> {

    await this.setEnabled(
      !this.settingsState().enabled
    );
  }


  // ===========================================================
  // API KEY
  // ===========================================================
  //
  // La clave se guarda en el keyring del sistema mediante Rust.
  //
  // La API key real nunca se almacena en Angular.
  // ===========================================================

  async saveApiKey(
    key: string
  ): Promise<void> {

    const trimmed =
      key.trim();


    if (!trimmed) {

      throw new Error(
        'La API Key no puede estar vacía.'
      );
    }


    const raw =
      await invoke<RawSenseSettings>(
        'save_sense_api_key',
        {
          key:
            trimmed
        }
      );


    this.settingsState.set(
      fromRaw(raw)
    );
  }


  async removeApiKey(): Promise<void> {

    const raw =
      await invoke<RawSenseSettings>(
        'remove_sense_api_key'
      );


    this.settingsState.set(
      fromRaw(raw)
    );
  }


  /**
   * Prueba la conexión con Gemini utilizando la clave
   * almacenada en el keyring.
   *
   * La clave nunca vuelve a Angular.
   */
  async testConnection(): Promise<void> {

    await invoke<boolean>(
      'test_sense_connection'
    );
  }


  // ===========================================================
  // CAPABILITIES
  // ===========================================================

  async setCapability(
    key: SenseCapabilityKey,
    enabled: boolean
  ): Promise<void> {

    if (
      !this.settingsState().enabled
    ) {

      return;
    }


    const raw =
      await invoke<RawSenseSettings>(
        'set_sense_capability',
        {
          capability:
            key,

          enabled
        }
      );


    this.settingsState.set(
      fromRaw(raw)
    );
  }


  async toggleCapability(
    key: SenseCapabilityKey
  ): Promise<void> {

    const current =
      this.capabilityValue(key);


    await this.setCapability(
      key,
      !current
    );
  }


  private capabilityValue(
    key: SenseCapabilityKey
  ): boolean {

    const capabilities =
      this.settingsState().capabilities;


    switch (key) {

      case 'recommendations':
        return capabilities.recommendations;

      case 'eq_assistant':
        return capabilities.eqAssistant;

      case 'library_analysis':
        return capabilities.libraryAnalysis;
    }
  }


  // ===========================================================
  // PROMPTS
  // ===========================================================

  promptFor(
    key: SenseCapabilityKey
  ): string {

    const prompts =
      this.settingsState().prompts;


    switch (key) {

      case 'recommendations':
        return prompts.recommendations;

      case 'eq_assistant':
        return prompts.eqAssistant;

      case 'library_analysis':
        return prompts.libraryAnalysis;
    }
  }


  async savePrompt(
    key: SenseCapabilityKey,
    prompt: string
  ): Promise<void> {

    const raw =
      await invoke<RawSenseSettings>(
        'set_sense_prompt',
        {
          capability:
            key,

          prompt
        }
      );


    this.settingsState.set(
      fromRaw(raw)
    );
  }


  async resetPrompt(
    key: SenseCapabilityKey
  ): Promise<void> {

    const raw =
      await invoke<RawSenseSettings>(
        'reset_sense_prompt',
        {
          capability:
            key
        }
      );


    this.settingsState.set(
      fromRaw(raw)
    );
  }


  // ===========================================================
  // EQ ASSISTANT
  // ===========================================================

  /**
   * Solicita a Sense un preset de ecualización para una canción.
   *
   * La solicitud solo se realiza cuando:
   *
   * - Sense está habilitado.
   * - El asistente EQ está habilitado.
   * - Existe una API key configurada.
   *
   * Rust realiza la comunicación real con Gemini.
   */
  async recommendEqPreset(
    track: {
      title: string;
      artist: string;
      album?: string;
      genre?: string;
    }
  ): Promise<SenseEqPreset> {

    await this.ensureLoaded();


    const settings =
      this.settingsState();


    if (!settings.enabled) {

      throw new Error(
        'Musex Sense está deshabilitado.'
      );
    }


    if (
      !settings.capabilities.eqAssistant
    ) {

      throw new Error(
        'El asistente de ecualización de Sense está deshabilitado.'
      );
    }


    if (!settings.hasApiKey) {

      throw new Error(
        'Sense no tiene una API Key configurada.'
      );
    }


    return invoke<SenseEqPreset>(
      'recommend_eq_preset',
      {
        track: {

          title:
            track.title,

          artist:
            track.artist,

          album:
            track.album ?? '',

          genre:
            track.genre ?? '',
        }
      }
    );
  }
}