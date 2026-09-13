// =============================================================
// MUSEX - MUSIC LIBRARY
// =============================================================
//
// Representa la biblioteca musical cargada en memoria.
//
// Esta estructura será el punto central para trabajar con las
// pistas que Musex encuentra mediante el scanner.
//
// La biblioteca no se encarga de:
//
// - Leer archivos directamente.
// - Reproducir audio.
// - Descargar canciones.
// - Administrar rutas.
//
// Esas responsabilidades pertenecen a otros módulos.
// =============================================================

use crate::models::track::Track;

// =============================================================
// MUSIC LIBRARY
// =============================================================

/// Biblioteca musical de Musex.
///
/// Mantiene las pistas disponibles durante la ejecución de la
/// aplicación.
#[derive(Debug, Default)]
pub struct MusicLibrary {
    /// Colección de pistas disponibles.
    tracks: Vec<Track>,
}

impl MusicLibrary {
    /// Crea una biblioteca vacía.
    pub fn new() -> Self {
        Self {
            tracks: Vec::new(),
        }
    }

    /// Agrega una pista a la biblioteca.
    ///
    /// Devuelve `false` cuando ya existe una pista con el mismo
    /// identificador.
    pub fn add_track(&mut self, track: Track) -> bool {
        if self.contains(&track.id) {
            return false;
        }

        self.tracks.push(track);

        true
    }

    /// Agrega múltiples pistas a la biblioteca.
    ///
    /// Devuelve la cantidad de pistas que fueron agregadas
    /// correctamente.
    pub fn add_tracks(
        &mut self,
        tracks: Vec<Track>,
    ) -> usize {
        let mut added = 0;

        for track in tracks {
            if self.add_track(track) {
                added += 1;
            }
        }

        added
    }

    /// Obtiene una pista mediante su identificador.
    pub fn get_track(&self, track_id: &str) -> Option<&Track> {
        self.tracks
            .iter()
            .find(|track| track.id == track_id)
    }

    /// Obtiene una pista mutable mediante su identificador.
    pub fn get_track_mut(
        &mut self,
        track_id: &str,
    ) -> Option<&mut Track> {
        self.tracks
            .iter_mut()
            .find(|track| track.id == track_id)
    }

    /// Elimina una pista mediante su identificador.
    ///
    /// Devuelve la pista eliminada cuando existe.
    pub fn remove_track(
        &mut self,
        track_id: &str,
    ) -> Option<Track> {
        let position = self
            .tracks
            .iter()
            .position(|track| track.id == track_id)?;

        Some(self.tracks.remove(position))
    }

    /// Comprueba si existe una pista con el identificador
    /// proporcionado.
    pub fn contains(&self, track_id: &str) -> bool {
        self.tracks
            .iter()
            .any(|track| track.id == track_id)
    }

    /// Devuelve la cantidad de pistas almacenadas.
    pub fn track_count(&self) -> usize {
        self.tracks.len()
    }

    /// Comprueba si la biblioteca está vacía.
    pub fn is_empty(&self) -> bool {
        self.tracks.is_empty()
    }

    /// Elimina todas las pistas de la biblioteca.
    pub fn clear(&mut self) {
        self.tracks.clear();
    }

    /// Devuelve todas las pistas disponibles.
    pub fn tracks(&self) -> &[Track] {
        &self.tracks
    }
}

// =============================================================
// PREPARACIÓN PARA TAURI
// =============================================================
//
// Posteriormente `MusicLibrary` podrá mantenerse dentro del
// estado de la aplicación Tauri.
//
// Angular podrá solicitar operaciones como:
//
// - Obtener todas las canciones.
// - Buscar canciones.
// - Agregar canciones.
// - Eliminar canciones.
// - Actualizar información.
//
// Para ese momento `Track` deberá implementar:
//
// Serialize
// Deserialize
//
// mediante Serde.
//
// No agregamos esas dependencias todavía.
// =============================================================