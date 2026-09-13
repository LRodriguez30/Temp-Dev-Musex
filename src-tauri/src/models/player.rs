// =============================================================
// MUSEX - PLAYER MODEL
// =============================================================
//
// Representa el estado actual del reproductor de Musex.
//
// Este modelo describe qué está reproduciendo el sistema y en
// qué posición se encuentra. La reproducción real se implementará
// posteriormente en audio/player.rs.
//
// Mantener el estado separado del reproductor permite que la
// interfaz pueda consultar información sin depender directamente
// del motor de audio.
// =============================================================

/// Estado actual de reproducción.
#[derive(Debug, Clone, PartialEq)]
pub enum PlaybackState {
    /// No existe ninguna reproducción activa.
    Stopped,

    /// La pista está siendo reproducida.
    Playing,

    /// La reproducción está pausada.
    Paused,
}

/// Estado del reproductor de Musex.
#[derive(Debug, Clone)]
pub struct PlayerState {
    /// Identificador de la pista actualmente seleccionada.
    pub current_track_id: Option<String>,

    /// Estado actual de reproducción.
    pub playback_state: PlaybackState,

    /// Posición actual dentro de la pista, expresada en segundos.
    pub position: f64,

    /// Volumen del reproductor, representado entre 0.0 y 1.0.
    pub volume: f32,
}

impl PlayerState {
    /// Crea un reproductor en su estado inicial.
    pub fn new() -> Self {
        Self {
            current_track_id: None,
            playback_state: PlaybackState::Stopped,
            position: 0.0,
            volume: 1.0,
        }
    }

    /// Selecciona una pista para reproducir.
    pub fn load_track(&mut self, track_id: String) {
        self.current_track_id = Some(track_id);
        self.position = 0.0;
        self.playback_state = PlaybackState::Stopped;
    }

    /// Inicia la reproducción.
    pub fn play(&mut self) {
        if self.current_track_id.is_some() {
            self.playback_state = PlaybackState::Playing;
        }
    }

    /// Pausa la reproducción.
    pub fn pause(&mut self) {
        if self.playback_state == PlaybackState::Playing {
            self.playback_state = PlaybackState::Paused;
        }
    }

    /// Detiene la reproducción y reinicia la posición.
    pub fn stop(&mut self) {
        self.playback_state = PlaybackState::Stopped;
        self.position = 0.0;
    }

    /// Cambia la posición actual de reproducción.
    pub fn seek(&mut self, position: f64) {
        self.position = position.max(0.0);
    }

    /// Cambia el volumen.
    ///
    /// El valor se limita automáticamente al rango 0.0 - 1.0.
    pub fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.0);
    }
}

impl Default for PlayerState {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================
// PREPARACIÓN PARA TAURI
// =============================================================
//
// Posteriormente este modelo podrá implementar:
//
// Serialize
// Deserialize
//
// mediante serde:
//
// #[derive(Debug, Clone, Serialize, Deserialize)]
//
// Esto permitirá enviar el estado del reproductor desde Rust
// hacia Angular mediante Tauri.
//
// Ejemplo conceptual:
//
// Rust PlayerState
//       ↓
// Tauri Command
//       ↓
// Angular
//
// No activamos serde todavía porque este laboratorio continúa
// funcionando independientemente de Tauri.
// =============================================================