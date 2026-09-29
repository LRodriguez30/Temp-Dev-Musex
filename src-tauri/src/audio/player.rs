// =============================================================
// MUSEX - AUDIO PLAYER
// =============================================================
//
// Responsable de controlar la reproducción de audio.
//
// Esta implementación utiliza Rodio 0.22.2:
//
// DeviceSinkBuilder -> salida de audio del sistema
// Player            -> control de reproducción y posición
//
// La lógica permanece independiente de Tauri para poder
// probarla directamente desde Rust.
// =============================================================

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait};
use rodio::{DeviceSinkBuilder, Player};

use super::decoder::decode_file;

use crate::equalizer::{
    EqualizerSource,
    EqualizerState,
};


/// Reproductor de audio de Musex.
///
/// `DeviceSinkBuilder` mantiene activa la salida de audio del
/// sistema y `Player` administra las pistas que se están
/// reproduciendo.
pub struct AudioPlayer {
    // =========================================================
    // REPRODUCTOR NORMAL
    // =========================================================

    output: Mutex<rodio::MixerDeviceSink>,
    player: Mutex<Player>,

    /// Ruta del archivo actualmente cargado.
    ///
    /// Se conserva para poder recargar la misma pista si es
    /// necesario reconstruir la salida de audio.
    current_path: Mutex<Option<PathBuf>>,

    // =========================================================
    // REPRODUCTOR DEL ECUALIZADOR
    // =========================================================

    /// Reproductor independiente para el editor del ecualizador.
    eq_player: Mutex<Player>,

    /// Estado compartido de las bandas del ecualizador.
    eq_state: Arc<EqualizerState>,

    /// Ruta de la pista actualmente asociada al ecualizador.
    ///
    /// IMPORTANTE:
    ///
    /// Esta ruta permanece aunque la reproducción llegue
    /// naturalmente al final.
    ///
    /// Solamente se elimina mediante `stop_eq()`.
    eq_current_path: Mutex<Option<PathBuf>>,
}


// =============================================================
// CONSTRUCTOR
// =============================================================

impl AudioPlayer {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let output = DeviceSinkBuilder::open_default_sink()?;

        let player = Player::connect_new(output.mixer());

        // El reproductor EQ comparte el mismo mixer.
        //
        // La UI trata la reproducción normal y el editor EQ
        // como experiencias independientes, por lo que no
        // deberían utilizarse simultáneamente.
        let eq_player = Player::connect_new(output.mixer());

        let eq_state = EqualizerState::new();

        Ok(Self {
            output: Mutex::new(output),
            player: Mutex::new(player),
            current_path: Mutex::new(None),

            eq_player: Mutex::new(eq_player),
            eq_state,

            eq_current_path: Mutex::new(None),
        })
    }


    // =========================================================
    // ECUALIZADOR — REPRODUCCIÓN
    // =========================================================

    /// Reproduce un archivo utilizando el ecualizador.
    ///
    /// Si había otra pista reproduciéndose en el editor,
    /// esta se reemplaza.
    pub fn play_eq_file(
        &self,
        path: impl AsRef<Path>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let path = path.as_ref();

        let player = self
            .eq_player
            .lock()
            .map_err(|_| {
                "No se pudo acceder al reproductor de ecualización."
            })?;

        // Detener la pista EQ anterior.
        player.stop();

        // Decodificar el archivo.
        let decoder = decode_file(path)?;

        // Envolver el decoder con nuestro ecualizador.
        let equalized = EqualizerSource::new(
            decoder,
            self.eq_state.clone(),
        );

        // Agregar la nueva fuente.
        player.append(equalized);

        // Comenzar reproducción.
        player.play();

        drop(player);

        // Registrar la pista actual del editor.
        //
        // Esta información permanece aunque la canción termine.
        let mut current_path = self
            .eq_current_path
            .lock()
            .map_err(|_| {
                "No se pudo registrar la pista de ecualización."
            })?;

        *current_path = Some(path.to_path_buf());

        Ok(())
    }


    /// Pausa la reproducción del ecualizador.
    pub fn pause_eq(&self) {
        if let Ok(player) = self.eq_player.lock() {
            player.pause();
        }
    }


    /// Reanuda la reproducción del ecualizador.
    ///
    /// Si la pista terminó completamente, `Player` estará vacío.
    /// En ese caso se reconstruye el decoder usando la ruta
    /// almacenada en `eq_current_path`.
    pub fn resume_eq(
        &self,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // -----------------------------------------------------
        // Recuperar la pista asociada al editor
        // -----------------------------------------------------

        let current_path = self
            .eq_current_path
            .lock()
            .map_err(|_| {
                "No se pudo acceder a la pista del ecualizador."
            })?
            .clone();

        let Some(path) = current_path else {
            // No hay ninguna pista asociada al editor.
            return Ok(());
        };

        // -----------------------------------------------------
        // Acceder al reproductor EQ
        // -----------------------------------------------------

        let player = self
            .eq_player
            .lock()
            .map_err(|_| {
                "No se pudo acceder al reproductor de ecualización."
            })?;

        // -----------------------------------------------------
        // La pista terminó
        // -----------------------------------------------------
        //
        // Cuando Rodio consume completamente la fuente,
        // Player queda vacío.
        //
        // player.play() por sí solo no puede reconstruir
        // una fuente que ya no existe.
        // -----------------------------------------------------

        if player.empty() {
            let decoder = decode_file(&path)?;

            let equalized = EqualizerSource::new(
                decoder,
                self.eq_state.clone(),
            );

            player.append(equalized);

            // Comenzar nuevamente desde el inicio.
            player.play();

            return Ok(());
        }

        // -----------------------------------------------------
        // La pista simplemente estaba pausada
        // -----------------------------------------------------

        player.play();

        Ok(())
    }


    /// Detiene completamente la reproducción del ecualizador.
    ///
    /// A diferencia de una finalización natural, `stop_eq()`
    /// también elimina la pista asociada al editor.
    pub fn stop_eq(&self) {
        if let Ok(player) = self.eq_player.lock() {
            player.stop();
        }

        if let Ok(mut path) = self.eq_current_path.lock() {
            *path = None;
        }
    }


    /// Obtiene la posición actual del ecualizador.
    pub fn eq_position(&self) -> Duration {
        self.eq_player
            .lock()
            .map(|player| player.get_pos())
            .unwrap_or(Duration::ZERO)
    }


    /// Cambia la posición actual del ecualizador.
    pub fn seek_eq(
        &self,
        seconds: f64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if !seconds.is_finite() || seconds < 0.0 {
            return Err(
                "La posición de reproducción no es válida."
                    .into()
            );
        }

        let player = self
            .eq_player
            .lock()
            .map_err(|_| {
                "No se pudo acceder al reproductor de ecualización."
            })?;

        player
            .try_seek(Duration::from_secs_f64(seconds))
            .map_err(|error| {
                format!(
                    "No se pudo cambiar la posición: {error}"
                )
            })?;

        Ok(())
    }


    /// Indica si el reproductor del ecualizador está vacío.
    ///
    /// Esto describe el estado de reproducción de Rodio,
    /// NO si existe una pista seleccionada en el editor.
    pub fn eq_is_empty(&self) -> bool {
        self.eq_player
            .lock()
            .map(|player| player.empty())
            .unwrap_or(true)
    }


    /// Indica si el ecualizador está reproduciendo activamente.
    pub fn eq_is_playing(&self) -> bool {
        self.eq_player
            .lock()
            .map(|player| {
                !player.is_paused() && !player.empty()
            })
            .unwrap_or(false)
    }


    /// Obtiene la ruta actualmente asociada al editor EQ.
    ///
    /// Puede existir incluso cuando `eq_player.empty()` es true,
    /// porque la pista puede haber terminado naturalmente.
    pub fn eq_current_path(&self) -> Option<PathBuf> {
        self.eq_current_path
            .lock()
            .ok()
            .and_then(|path| path.clone())
    }


    // =========================================================
    // ECUALIZADOR — BANDAS
    // =========================================================

    /// Expone el estado compartido de bandas para que los
    /// comandos de Tauri puedan leerlo o modificarlo.
    pub fn eq_state(&self) -> Arc<EqualizerState> {
        self.eq_state.clone()
    }


    // =========================================================
    // REPRODUCTOR NORMAL
    // =========================================================

    /// Reproduce un archivo de audio.
    ///
    /// Si ya existe una reproducción activa, esta se detiene
    /// antes de cargar la nueva pista.
    pub fn play_file(
        &self,
        path: impl AsRef<Path>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let path = path.as_ref();

        let player = self
            .player
            .lock()
            .map_err(|_| {
                "No se pudo acceder al reproductor."
            })?;

        player.stop();

        let source = decode_file(path)?;

        player.append(source);
        player.play();

        drop(player);

        *self
            .current_path
            .lock()
            .map_err(|_| {
                "No se pudo registrar la pista actual."
            })? = Some(path.to_path_buf());

        Ok(())
    }


    /// Pausa la reproducción actual.
    pub fn pause(&self) {
        if let Ok(player) = self.player.lock() {
            player.pause();
        }
    }


    /// Reanuda la reproducción actual.
    pub fn resume(&self) {
        if let Ok(player) = self.player.lock() {
            player.play();
        }
    }


    /// Detiene completamente la reproducción actual.
    pub fn stop(&self) {
        if let Ok(player) = self.player.lock() {
            player.stop();
        }

        if let Ok(mut path) = self.current_path.lock() {
            *path = None;
        }
    }


    /// Indica si actualmente no existen pistas pendientes
    /// de reproducción.
    pub fn is_empty(&self) -> bool {
        self.player
            .lock()
            .map(|player| player.empty())
            .unwrap_or(true)
    }


    /// Establece el volumen del reproductor.
    ///
    /// El valor esperado está normalizado entre 0.0 y 1.0.
    pub fn set_volume(&self, volume: f32) {
        if let Ok(player) = self.player.lock() {
            player.set_volume(volume);
        }
    }


    /// Obtiene el volumen actual.
    pub fn volume(&self) -> f32 {
        self.player
            .lock()
            .map(|player| player.volume())
            .unwrap_or(1.0)
    }


    /// Obtiene la posición actual de reproducción.
    ///
    /// Rodio devuelve la posición como `Duration`.
    pub fn position(&self) -> Duration {
        self.player
            .lock()
            .map(|player| player.get_pos())
            .unwrap_or(Duration::ZERO)
    }


    /// Cambia la posición actual de reproducción.
    ///
    /// La posición se recibe como segundos desde Angular.
    pub fn seek(
        &self,
        seconds: f64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if !seconds.is_finite() || seconds < 0.0 {
            return Err(
                "La posición de reproducción no es válida."
                    .into()
            );
        }

        let player = self
            .player
            .lock()
            .map_err(|_| {
                "No se pudo acceder al reproductor."
            })?;

        player
            .try_seek(Duration::from_secs_f64(seconds))
            .map_err(|error| {
                format!(
                    "No se pudo cambiar la posición de reproducción: {error}"
                )
            })?;

        Ok(())
    }


    /// Indica si el reproductor está reproduciendo activamente
    /// una pista.
    pub fn is_playing(&self) -> bool {
        self.player
            .lock()
            .map(|player| {
                !player.is_paused() && !player.empty()
            })
            .unwrap_or(false)
    }


    /// Mantiene viva la salida de audio del sistema.
    pub fn keep_alive(&self) {
        let _ = &self.output;
    }


    // =========================================================
    // REINICIALIZACIÓN DE DISPOSITIVO
    // =========================================================

    /// Reconstruye la salida de audio apuntando al dispositivo
    /// predeterminado actual del sistema.
    ///
    /// Si había una pista normal activa, se recarga y se retoma
    /// desde la misma posición.
    pub fn reinitialize_output(
        &self,
    ) -> Result<(), String> {
        // -----------------------------------------------------
        // Capturar estado actual antes de reconstruir
        // -----------------------------------------------------

        let (was_playing, position) = {
            let player = self
                .player
                .lock()
                .map_err(|_| {
                    "No se pudo acceder al reproductor."
                        .to_string()
                })?;

            let was_playing =
                !player.is_paused() && !player.empty();

            let position = player.get_pos();

            (was_playing, position)
        };

        let current_path = self
            .current_path
            .lock()
            .map_err(|_| {
                "No se pudo leer la pista actual."
                    .to_string()
            })?
            .clone();

        // -----------------------------------------------------
        // Reconstruir salida
        // -----------------------------------------------------

        let new_output =
            DeviceSinkBuilder::open_default_sink()
                .map_err(|error| {
                    format!(
                        "No se pudo abrir el nuevo dispositivo de audio: {error}"
                    )
                })?;

        // Ambos reproductores deben conectarse al mixer del
        // nuevo dispositivo antes de mover `new_output`.
        let new_player =
            Player::connect_new(new_output.mixer());

        let new_eq_player =
            Player::connect_new(new_output.mixer());

        // -----------------------------------------------------
        // Reemplazar salida
        // -----------------------------------------------------

        {
            let mut output_guard = self
                .output
                .lock()
                .map_err(|_| {
                    "No se pudo reemplazar la salida de audio."
                        .to_string()
                })?;

            *output_guard = new_output;
        }

        // -----------------------------------------------------
        // Reemplazar reproductor normal
        // -----------------------------------------------------

        {
            let mut player_guard = self
                .player
                .lock()
                .map_err(|_| {
                    "No se pudo reemplazar el reproductor."
                        .to_string()
                })?;

            *player_guard = new_player;
        }

        // -----------------------------------------------------
        // Reemplazar reproductor EQ
        // -----------------------------------------------------

        {
            let mut eq_player_guard = self
                .eq_player
                .lock()
                .map_err(|_| {
                    "No se pudo reemplazar el reproductor de ecualización."
                        .to_string()
                })?;

            *eq_player_guard = new_eq_player;
        }

        // -----------------------------------------------------
        // Retomar pista normal
        // -----------------------------------------------------

        if let Some(path) = current_path {
            let source = decode_file(&path)
                .map_err(|error| {
                    format!(
                        "No se pudo recargar la pista actual: {error}"
                    )
                })?;

            let player = self
                .player
                .lock()
                .map_err(|_| {
                    "No se pudo acceder al reproductor."
                        .to_string()
                })?;

            player.append(source);

            // La fuente nueva comienza desde 0.
            // try_seek la lleva a la posición anterior.
            player
                .try_seek(position)
                .map_err(|error| {
                    format!(
                        "No se pudo restaurar la posición de reproducción: {error}"
                    )
                })?;

            if was_playing {
                player.play();
            } else {
                player.pause();
            }
        }

        Ok(())
    }


    // =========================================================
    // DISPOSITIVO DE AUDIO
    // =========================================================

    /// Obtiene el nombre del dispositivo de salida
    /// predeterminado actual del sistema.
    ///
    /// Se utiliza para detectar cuándo el usuario conecta
    /// o desconecta un dispositivo, como audífonos.
    pub fn current_default_device_name() -> Option<String> {
        let host = cpal::default_host();

        let device = host.default_output_device()?;

        let description = device.description().ok()?;

        Some(description.name().to_string())
    }
}


// =============================================================
// PREPARACIÓN PARA TAURI
// =============================================================
//
// La comunicación será:
//
// Angular
//    ↓
// commands/audio.rs
//    ↓
// AudioPlayer
//    ↓
// Rodio 0.22.2
//    ↓
// Dispositivo de audio
//
// Los comandos de Tauri solamente exponen las operaciones
// necesarias para la interfaz.
// =============================================================