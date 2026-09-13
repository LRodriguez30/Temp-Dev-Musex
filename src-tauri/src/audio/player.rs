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
use std::sync::Mutex;
use std::time::Duration;

use rodio::{DeviceSinkBuilder, Player};
use cpal::traits::{DeviceTrait, HostTrait};

use super::decoder::decode_file;

/// Reproductor de audio de Musex.
///
/// `DeviceSinkBuilder` mantiene activa la salida de audio del
/// sistema y `Player` administra la pista que se está reproduciendo.
pub struct AudioPlayer {
    output: Mutex<rodio::MixerDeviceSink>,
    player: Mutex<Player>,

    /// Ruta del archivo actualmente cargado.
    ///
    /// Se conserva para poder recargar la misma pista si es
    /// necesario reconstruir la salida de audio.
    current_path: Mutex<Option<PathBuf>>,
}

impl AudioPlayer {
     pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let output = DeviceSinkBuilder::open_default_sink()?;
        let player = Player::connect_new(output.mixer());

        Ok(Self {
            output: Mutex::new(output),
            player: Mutex::new(player),
            current_path: Mutex::new(None),
        })
    }

    /// Reproduce un archivo de audio.
    ///
    /// Si ya existe una reproducción activa, esta se detiene
    /// antes de cargar la nueva pista.
    pub fn play_file(
        &self,
        path: impl AsRef<Path>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let path = path.as_ref();

        let player = self.player.lock()
            .map_err(|_| "No se pudo acceder al reproductor.")?;

        player.stop();

        let source = decode_file(path)?;

        player.append(source);
        player.play();

        drop(player);

        *self.current_path.lock()
            .map_err(|_| "No se pudo registrar la pista actual.")? =
            Some(path.to_path_buf());

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
        self.player.lock()
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
        self.player.lock()
            .map(|player| player.volume())
            .unwrap_or(1.0)
    }

    /// Obtiene la posición actual de reproducción.
    ///
    /// Rodio devuelve la posición como `Duration`, por lo que
    /// se convierte a segundos para poder enviarla posteriormente
    /// a Angular mediante Tauri.
    pub fn position(&self) -> Duration {
        self.player.lock()
            .map(|player| player.get_pos())
            .unwrap_or(Duration::ZERO)
    }

    /// Cambia la posición actual de reproducción.
    ///
    /// La posición se recibe como segundos desde Angular
    /// y se convierte a `Duration` antes de enviarla a Rodio.
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

        let player = self.player.lock()
            .map_err(|_| "No se pudo acceder al reproductor.")?;

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
        self.player.lock()
            .map(|player| !player.is_paused() && !player.empty())
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
    /// `DeviceSinkBuilder::open_default_sink()` solo se evalúa
    /// una vez al iniciar Musex, por lo que conectar o
    /// desconectar audífonos después no migra automáticamente
    /// la salida existente. Este método reconstruye `output`
    /// y `player` desde cero contra el nuevo dispositivo default,
    /// y si había una pista sonando, la retoma en la misma
    /// posición para no perder el progreso.
    pub fn reinitialize_output(&self) -> Result<(), String> {
        // ---------------------------------------------------
        // Capturar estado actual antes de reconstruir
        // ---------------------------------------------------

        let (was_playing, position, path) = {
            let player = self.player.lock()
                .map_err(|_| "No se pudo acceder al reproductor.".to_string())?;

            let was_playing = !player.is_paused() && !player.empty();
            let position = player.get_pos();

            (was_playing, position, ())
        };

        let current_path = self.current_path.lock()
            .map_err(|_| "No se pudo leer la pista actual.".to_string())?
            .clone();

        let _ = path;

        // ---------------------------------------------------
        // Reconstruir salida y reproductor
        // ---------------------------------------------------

        let new_output = DeviceSinkBuilder::open_default_sink()
            .map_err(|error| {
                format!("No se pudo abrir el nuevo dispositivo de audio: {error}")
            })?;

        let new_player = Player::connect_new(new_output.mixer());

        {
            let mut output_guard = self.output.lock()
                .map_err(|_| "No se pudo reemplazar la salida de audio.".to_string())?;

            *output_guard = new_output;
        }

        {
            let mut player_guard = self.player.lock()
                .map_err(|_| "No se pudo reemplazar el reproductor.".to_string())?;

            *player_guard = new_player;
        }

        // ---------------------------------------------------
        // Retomar la pista, si había una activa
        // ---------------------------------------------------

        if let Some(path) = current_path {
            let source = decode_file(&path)
                .map_err(|error| {
                    format!("No se pudo recargar la pista actual: {error}")
                })?;

            let player = self.player.lock()
                .map_err(|_| "No se pudo acceder al reproductor.".to_string())?;

            player.append(source);

            let _ = player.try_seek(position);

            if was_playing {
                player.play();
            } else {
                player.pause();
            }
        }

        Ok(())
    }

    /// Obtiene el nombre del dispositivo de salida predeterminado
    /// actual del sistema.
    ///
    /// Se usa para detectar cuándo el usuario conecta o desconecta
    /// un dispositivo (p. ej. audífonos) después de que Musex ya
    /// inició, ya que DeviceSinkBuilder::open_default_sink() solo
    /// se evalúa una vez.
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
// La futura comunicación será:
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
// Los comandos de Tauri solamente expondrán las operaciones
// necesarias para la interfaz.
// =============================================================