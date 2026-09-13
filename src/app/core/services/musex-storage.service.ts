import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

@Injectable({
  providedIn: 'root'
})
export class MusexStorageService {

  /**
   * Obtiene el tamaño total que ocupa Musex
   * dentro de la máquina del usuario.
   *
   * Rust recorre físicamente la carpeta Musex
   * y devuelve el tamaño total en bytes.
   */
  async getStorageSize(): Promise<number> {
    try {
      return await invoke<number>(
        'get_musex_storage_size'
      );
    } catch (error) {
      console.error(
        'No se pudo obtener el almacenamiento de Musex.',
        error
      );

      throw error;
    }
  }
}