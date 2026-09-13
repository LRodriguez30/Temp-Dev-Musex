// =============================================================
// MUSEX - LIBRARY METADATA
// =============================================================
//
// Contiene operaciones relacionadas con la información
// descriptiva utilizada por la biblioteca musical.
//
// La lectura física de las etiquetas permanece en
// `audio::metadata`. Este módulo se enfoca en cómo esa
// información será utilizada dentro de la biblioteca.
//
// De esta manera mantenemos separadas las responsabilidades:
//
// audio::metadata
//     -> Lee metadata desde archivos.
//
// library::metadata
//     -> Utiliza esa metadata dentro de la biblioteca.
// =============================================================

use std::path::Path;

use crate::audio::metadata::AudioMetadata;

// =============================================================
// LIBRARY METADATA
// =============================================================

/// Utilidad para trabajar con metadata de archivos musicales
/// desde el contexto de la biblioteca.
#[derive(Debug, Default)]
pub struct LibraryMetadata;

impl LibraryMetadata {
    /// Crea un nuevo administrador de metadata.
    pub fn new() -> Self {
        Self
    }

    /// Obtiene la metadata de un archivo de audio.
    ///
    /// La lectura real se delega a `AudioMetadata`, evitando
    /// duplicar la lógica de análisis de archivos.
    pub fn read(
        &self,
        path: impl AsRef<Path>,
    ) -> Result<AudioMetadata, Box<dyn std::error::Error>> {
        AudioMetadata::from_file(path)
    }

    /// Devuelve el título disponible en la metadata.
    ///
    /// Si el archivo no contiene título, utiliza el nombre del
    /// archivo como alternativa.
    pub fn title_or_filename(
        &self,
        metadata: &AudioMetadata,
    ) -> String {
        if let Some(title) = &metadata.title {
            if !title.trim().is_empty() {
                return title.clone();
            }
        }

        metadata
            .path
            .file_stem()
            .and_then(|name| name.to_str())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or("Sin título")
            .to_string()
    }

    /// Devuelve el artista o un texto alternativo cuando no
    /// existe información disponible.
    pub fn artist_or_default(
        &self,
        metadata: &AudioMetadata,
    ) -> String {
        metadata
            .artist
            .as_deref()
            .filter(|artist| !artist.trim().is_empty())
            .unwrap_or("Artista desconocido")
            .to_string()
    }

    /// Devuelve el álbum o un texto alternativo cuando no
    /// existe información disponible.
    pub fn album_or_default(
        &self,
        metadata: &AudioMetadata,
    ) -> String {
        metadata
            .album
            .as_deref()
            .filter(|album| !album.trim().is_empty())
            .unwrap_or("Álbum desconocido")
            .to_string()
    }

    /// Convierte una duración en segundos a un formato
    /// legible para mostrar en la biblioteca.
    pub fn format_duration(
        &self,
        duration: Option<u64>,
    ) -> String {
        let Some(seconds) = duration else {
            return "Desconocida".to_string();
        };

        let minutes = seconds / 60;
        let remaining_seconds = seconds % 60;

        format!(
            "{:02}:{:02}",
            minutes,
            remaining_seconds
        )
    }
}

// =============================================================
// PREPARACIÓN PARA TAURI
// =============================================================
//
// Posteriormente esta capa podrá participar en operaciones
// solicitadas desde Angular como:
//
// - Mostrar información de una canción.
// - Editar metadata.
// - Actualizar información de la biblioteca.
// - Preparar información para mostrar en tarjetas o listas.
//
// La comunicación con Angular se realizará posteriormente
// mediante comandos Tauri.
// =============================================================