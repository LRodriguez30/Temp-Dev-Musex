import { Injectable } from '@angular/core';

/**
 * Clave utilizada para almacenar el estado persistente de Musex.
 *
 * Se mantiene la misma clave utilizada originalmente por
 * el prototipo para conservar compatibilidad durante esta etapa.
 */
const STORAGE_KEY = 'musex_prototype_state_v2';

/**
 * Gestiona la persistencia local de Musex.
 *
 * Actualmente utiliza localStorage porque la aplicación todavía
 * se encuentra en la etapa de reconstrucción del prototipo.
 *
 * La implementación está aislada en este servicio para que,
 * posteriormente, pueda sustituirse por almacenamiento nativo
 * mediante Tauri sin modificar los componentes de la interfaz.
 */
@Injectable({
  providedIn: 'root'
})
export class StorageService {

  /**
   * Guarda un valor serializable dentro del almacenamiento
   * persistente de Musex.
   *
   * @param value Valor que será convertido a JSON.
   */
  save<T>(value: T): void {
    try {
      const serializedValue = JSON.stringify(value);

      localStorage.setItem(
        STORAGE_KEY,
        serializedValue
      );
    } catch (error) {
      console.error(
        'No se pudo guardar el estado de Musex.',
        error
      );
    }
  }

  /**
   * Recupera el estado persistido de Musex.
   *
   * Devuelve null cuando no existe información almacenada
   * o cuando el contenido no puede ser interpretado correctamente.
   */
  load<T>(): T | null {
    try {
      const serializedValue = localStorage.getItem(
        STORAGE_KEY
      );

      if (!serializedValue) {
        return null;
      }

      return JSON.parse(serializedValue) as T;
    } catch (error) {
      console.error(
        'No se pudo recuperar el estado de Musex.',
        error
      );

      return null;
    }
  }

  /**
   * Comprueba si existe información persistida.
   */
  hasStoredState(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== null;
  }

  /**
   * Elimina completamente el estado persistido.
   */
  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error(
        'No se pudo eliminar el estado de Musex.',
        error
      );
    }
  }

  /**
   * Devuelve la clave utilizada internamente para la persistencia.
   *
   * Puede ser útil durante depuración y pruebas.
   */
  getStorageKey(): string {
    return STORAGE_KEY;
  }
}