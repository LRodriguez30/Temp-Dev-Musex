// ============================================================
// MUSEX - ROOT COMPONENT
// ============================================================
//
// Componente temporal de prueba para verificar la comunicación
// Angular -> Tauri -> Rust -> Rodio.
//
// Esta implementación será retirada una vez comprobemos que
// la reproducción de audio real funciona correctamente.
// ============================================================

import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';
import { LibraryService } from './core/services/library.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {

  /**
   * Servicio encargado de administrar la biblioteca musical.
   */
  private readonly libraryService = inject(LibraryService);

  /**
   * Inicializa la biblioteca real de Musex.
   *
   * El scanner de Rust busca los archivos de audio dentro de
   * Desktop/Musex/music y devuelve sus metadatos a Angular.
   *
   * Si el escaneo falla, la aplicación conserva los datos
   * disponibles actualmente en LibraryService.
   */
  async ngOnInit(): Promise<void> {
    try {
      await this.libraryService.scanLibrary();

      console.log(
        'Biblioteca de Musex cargada correctamente.'
      );
    } catch (error) {
      console.error(
        'No se pudo cargar la biblioteca de Musex:',
        error
      );
    }
  }

  // // ==========================================================
  // // ARCHIVO DE PRUEBA
  // // ==========================================================

  // //
  // // IMPORTANTE:
  // // Reemplaza únicamente el nombre del archivo por uno que
  // // realmente exista dentro de:
  // //
  // // Desktop/Musex/music/
  // //
  // private readonly testAudioPath =
  //   'C:\\Users\\LART\\Desktop\\Musex\\music\\a-ha_-_Take_On_Me_Official_Video_4K.mp3';

  // // ==========================================================
  // // CONTROLES DEL REPRODUCTOR
  // // ==========================================================

  // async play(): Promise<void> {
  //   try {
  //     await invoke('play_audio', {
  //       path: this.testAudioPath
  //     });

  //     console.log('Audio reproducido correctamente.');
  //   } catch (error) {
  //     console.error('Error al reproducir audio:', error);
  //   }
  // }

  // async pause(): Promise<void> {
  //   try {
  //     await invoke('pause_audio');

  //     console.log('Audio pausado.');
  //   } catch (error) {
  //     console.error('Error al pausar audio:', error);
  //   }
  // }

  // async resume(): Promise<void> {
  //   try {
  //     await invoke('resume_audio');

  //     console.log('Audio reanudado.');
  //   } catch (error) {
  //     console.error('Error al reanudar audio:', error);
  //   }
  // }

  // async stop(): Promise<void> {
  //   try {
  //     await invoke('stop_audio');

  //     console.log('Audio detenido.');
  //   } catch (error) {
  //     console.error('Error al detener audio:', error);
  //   }
  // }
}