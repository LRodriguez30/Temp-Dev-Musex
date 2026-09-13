// =============================================================
// MUSEX - LIBRARY SCANNER
// =============================================================
//
// Responsable de recorrer directorios y detectar archivos de
// audio que puedan formar parte de la biblioteca de Musex.
//
// El scanner no reproduce archivos ni administra descargas.
// Su función es localizar canciones y convertirlas en `Track`.
//
// Posteriormente podrá utilizarse para:
//
// - Escanear la carpeta de música de Musex.
// - Detectar nuevos archivos.
// - Reconstruir la biblioteca al iniciar la aplicación.
// - Actualizar la biblioteca cuando se agreguen canciones.
// =============================================================

use std::fs;
use std::path::Path;

use crate::models::track::Track;

// =============================================================
// LIBRARY SCANNER
// =============================================================

/// Escáner encargado de localizar archivos de audio.
#[derive(Debug, Default)]
pub struct LibraryScanner;

impl LibraryScanner {
    /// Crea un nuevo scanner.
    pub fn new() -> Self {
        Self
    }

    /// Escanea un directorio buscando archivos de audio.
    ///
    /// Los archivos encontrados se convierten automáticamente
    /// en objetos `Track`.
    ///
    /// Los directorios internos también son recorridos para
    /// permitir que la biblioteca tenga subcarpetas.
    pub fn scan(
        &self,
        directory: impl AsRef<Path>,
    ) -> Result<Vec<Track>, Box<dyn std::error::Error>> {
        let directory = directory.as_ref();

        if !directory.exists() {
            return Err(format!(
                "El directorio no existe: {}",
                directory.display()
            )
            .into());
        }

        if !directory.is_dir() {
            return Err(format!(
                "La ruta no corresponde a un directorio: {}",
                directory.display()
            )
            .into());
        }

        let mut tracks = Vec::new();

        self.scan_directory(directory, &mut tracks)?;

        Ok(tracks)
    }

    /// Recorre recursivamente un directorio y agrega las pistas
    /// encontradas al resultado.
    fn scan_directory(
        &self,
        directory: &Path,
        tracks: &mut Vec<Track>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                self.scan_directory(&path, tracks)?;
                continue;
            }

            if !is_audio_file(&path) {
                continue;
            }

            let id = create_track_id(tracks.len());

            match Track::from_file(id, &path) {
                Ok(track) => {
                    tracks.push(track);
                }

                Err(error) => {
                    // Un archivo defectuoso no debe impedir que
                    // el resto de la biblioteca sea escaneada.
                    eprintln!(
                        "No se pudo leer '{}': {}",
                        path.display(),
                        error
                    );
                }
            }
        }

        Ok(())
    }
}

// =============================================================
// FUNCIONES AUXILIARES
// =============================================================

/// Comprueba si una ruta corresponde a un formato de audio
/// compatible con Musex.
fn is_audio_file(path: &Path) -> bool {
    let Some(extension) = path.extension() else {
        return false;
    };

    matches!(
        extension
            .to_string_lossy()
            .to_lowercase()
            .as_str(),
        "mp3"
            | "wav"
            | "flac"
            | "ogg"
            | "opus"
            | "m4a"
            | "aac"
    )
}

/// Genera un identificador temporal para una pista detectada.
///
/// Posteriormente podremos utilizar un identificador persistente
/// basado en el archivo o en una base de datos.
fn create_track_id(index: usize) -> String {
    format!("scan-{:04}", index + 1)
}

// =============================================================
// PREPARACIÓN PARA TAURI
// =============================================================
//
// Cuando se integre con Tauri, este scanner podrá ejecutarse
// desde comandos para:
//
// - Escanear la biblioteca.
// - Devolver las pistas encontradas a Angular.
// - Detectar nuevos archivos.
// - Actualizar la biblioteca.
//
// Los `Track` deberán poder serializarse para cruzar la frontera
// Rust -> Tauri -> Angular.
//
// No agregamos Tauri en esta etapa.
// =============================================================