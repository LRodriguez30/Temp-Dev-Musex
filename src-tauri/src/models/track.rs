// =============================================================
// MUSEX - TRACK MODEL
// =============================================================
//
// Representa una canción dentro del núcleo de Musex.
//
// Este modelo sirve como punto de unión entre
// Rust -> Tauri -> Angular.
//
// Rust obtiene la información desde los archivos reales y,
// posteriormente, Tauri podrá serializarla para que Angular
// pueda utilizarla como un modelo de biblioteca.
// =============================================================

use std::path::Path;

use serde::Serialize;

use crate::audio::metadata::AudioMetadata;

// =============================================================
// TRACK
// =============================================================

/// Representa una pista musical detectada por Musex.
#[derive(Debug, Clone, Serialize)]
pub struct Track {
    /// Identificador interno de la pista.
    pub id: String,

    /// Título de la canción.
    pub title: String,

    /// Artista obtenido desde los metadatos del archivo.
    pub artist: Option<String>,

    /// Álbum obtenido desde los metadatos del archivo.
    pub album: Option<String>,

    /// Género obtenido desde los metadatos del archivo.
    pub genre: Option<String>,

    /// Ruta física del archivo de audio.
    pub path: String,

    /// Duración de la canción en segundos.
    pub duration: Option<u64>,

    /// Ruta física de la portada personalizada.
    ///
    /// La portada se almacena dentro de:
    ///
    /// Musex/covers/
    ///
    /// Si la canción no tiene una portada personalizada,
    /// este valor será `None`.
    #[serde(rename = "coverPath")]
    pub cover_path: Option<String>,
}

impl Track {
    /// Crea una nueva pista utilizando únicamente la información
    /// básica disponible al momento de su creación.
    pub fn new(
        id: String,
        title: String,
        path: String,
    ) -> Self {
        Self {
            id,
            title,
            artist: None,
            album: None,
            genre: None,
            path,
            duration: None,
            cover_path: None,
        }
    }

    /// Construye una pista a partir de un archivo de audio.
    ///
    /// Los metadatos se obtienen mediante AudioMetadata.
    /// Si el archivo no contiene título, se utiliza el nombre
    /// del archivo como alternativa.
    pub fn from_file(
        id: String,
        path: impl AsRef<Path>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let metadata = AudioMetadata::from_file(&path)?;

        let path = path.as_ref();

        let title = metadata
            .title
            .clone()
            .or_else(|| {
                path.file_stem()
                    .and_then(|name| name.to_str())
                    .map(String::from)
            })
            .unwrap_or_else(|| "Sin título".to_string());

        Ok(Self {
            id,
            title,
            artist: metadata.artist,
            album: metadata.album,
            genre: metadata.genre,
            path: path.to_string_lossy().into_owned(),
            duration: metadata.duration,
            cover_path: None,
        })
    }
}