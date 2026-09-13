// =============================================================
// MUSEX - PLAYLIST MODEL
// =============================================================
//
// Representa una colección ordenada de pistas dentro de Musex.
//
// Este modelo no depende de Tauri. Primero será probado como
// Rust puro y posteriormente podrá serializarse para enviarlo
// desde Rust hacia Angular mediante Tauri.
// =============================================================

use super::track::Track;

/// Representa una lista de reproducción.
#[derive(Debug, Clone)]
pub struct Playlist {
    /// Identificador interno de la lista.
    pub id: String,

    /// Nombre visible de la lista.
    pub name: String,

    /// Pistas que pertenecen a la lista.
    pub tracks: Vec<Track>,
}

impl Playlist {
    /// Crea una lista de reproducción vacía.
    pub fn new(id: String, name: String) -> Self {
        Self {
            id,
            name,
            tracks: Vec::new(),
        }
    }

    /// Agrega una pista al final de la lista.
    pub fn add_track(&mut self, track: Track) {
        self.tracks.push(track);
    }

    /// Elimina una pista utilizando su identificador.
    ///
    /// Devuelve `true` si se encontró y eliminó la pista.
    pub fn remove_track(&mut self, track_id: &str) -> bool {
        let initial_length = self.tracks.len();

        self.tracks.retain(|track| track.id != track_id);

        self.tracks.len() < initial_length
    }

    /// Devuelve la cantidad de pistas almacenadas.
    pub fn track_count(&self) -> usize {
        self.tracks.len()
    }
}

// =============================================================
// PREPARACIÓN PARA TAURI
// =============================================================
//
// Cuando se integre con Tauri, se utilizará:
//
// use serde::{Deserialize, Serialize};
//
// #[derive(Debug, Clone, Serialize, Deserialize)]
//
// para permitir que Playlist y Track puedan viajar entre:
//
// Rust -> Tauri -> Angular
//
// No activamos serde todavía porque el objetivo actual es
// mantener el laboratorio completamente independiente de Tauri.
// =============================================================