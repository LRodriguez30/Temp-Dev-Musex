// =============================================================
// MUSEX - LIBRARY & TEMP SCANNER
// =============================================================
//
// Responsable de recorrer los directorios de música y temporal
// de Musex, detectar archivos de audio y convertirlos en `Track`.
//
// LibraryScanner:
// - Escanea la biblioteca permanente.
// - Recupera portadas personalizadas.
//
// TempScanner:
// - Escanea el directorio temporal.
// - Detecta archivos disponibles para trabajar.
// - No busca portadas.
// =============================================================

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;

use crate::models::track::Track;

// =============================================================
// LIBRARY SCANNER
// =============================================================

/// Escáner encargado de localizar archivos de audio
/// pertenecientes a la biblioteca permanente.
#[derive(Debug, Default)]
pub struct LibraryScanner;

impl LibraryScanner {
    /// Crea un nuevo scanner.
    pub fn new() -> Self {
        Self
    }

    /// Escanea un directorio buscando archivos de audio.
    ///
    /// También busca las portadas personalizadas asociadas
    /// a cada pista.
    pub fn scan(
        &self,
        directory: impl AsRef<Path>,
        covers_directory: impl AsRef<Path>,
    ) -> Result<Vec<Track>, Box<dyn std::error::Error>> {
        let directory = directory.as_ref();
        let covers_directory = covers_directory.as_ref();

        // ---------------------------------------------------------
        // VALIDAR DIRECTORIO
        // ---------------------------------------------------------

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

        // ---------------------------------------------------------
        // ESCANEAR
        // ---------------------------------------------------------

        let mut tracks = Vec::new();

        self.scan_directory(
            directory,
            covers_directory,
            &mut tracks,
        )?;

        Ok(tracks)
    }

    fn scan_directory(
        &self,
        directory: &Path,
        covers_directory: &Path,
        tracks: &mut Vec<Track>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();

            // -----------------------------------------------------
            // SUBDIRECTORIO
            // -----------------------------------------------------

            if path.is_dir() {
                self.scan_directory(
                    &path,
                    covers_directory,
                    tracks,
                )?;

                continue;
            }

            // -----------------------------------------------------
            // ARCHIVO DE AUDIO
            // -----------------------------------------------------

            if !is_audio_file(&path) {
                continue;
            }

            // -----------------------------------------------------
            // ID ESTABLE
            // -----------------------------------------------------

            let id = create_track_id(&path);

            match Track::from_file(id, &path) {
                Ok(mut track) => {
                    // -------------------------------------------------
                    // BUSCAR PORTADA
                    // -------------------------------------------------

                    track.cover_path = find_cover(
                        covers_directory,
                        &track.id,
                    );

                    tracks.push(track);
                }

                Err(error) => {
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
// TEMP SCANNER
// =============================================================

/// Escáner encargado de localizar archivos de audio temporales.
///
/// A diferencia de `LibraryScanner`, no busca portadas ni
/// modifica ningún dato de la biblioteca.
#[derive(Debug, Default)]
pub struct TempScanner;

impl TempScanner {
    /// Crea un nuevo scanner.
    pub fn new() -> Self {
        Self
    }

    /// Escanea el directorio temporal buscando archivos de audio.
    ///
    /// Los subdirectorios también son recorridos.
    pub fn scan(
        &self,
        directory: impl AsRef<Path>,
    ) -> Result<Vec<Track>, Box<dyn std::error::Error>> {
        let directory = directory.as_ref();

        // ---------------------------------------------------------
        // VALIDAR DIRECTORIO TEMP
        // ---------------------------------------------------------

        if !directory.exists() {
            return Err(format!(
                "El directorio temporal no existe: {}",
                directory.display()
            )
            .into());
        }

        if !directory.is_dir() {
            return Err(format!(
                "La ruta temporal no corresponde a un directorio: {}",
                directory.display()
            )
            .into());
        }

        // ---------------------------------------------------------
        // ESCANEAR
        // ---------------------------------------------------------

        let mut tracks = Vec::new();

        self.scan_directory(
            directory,
            &mut tracks,
        )?;

        Ok(tracks)
    }

    fn scan_directory(
        &self,
        directory: &Path,
        tracks: &mut Vec<Track>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();

            // -----------------------------------------------------
            // SUBDIRECTORIO
            // -----------------------------------------------------

            if path.is_dir() {
                self.scan_directory(
                    &path,
                    tracks,
                )?;

                continue;
            }

            // -----------------------------------------------------
            // ARCHIVO DE AUDIO
            // -----------------------------------------------------

            if !is_audio_file(&path) {
                continue;
            }

            // -----------------------------------------------------
            // ID ESTABLE
            // -----------------------------------------------------

            let id = create_temp_track_id(&path);

            match Track::from_file(id, &path) {
                Ok(track) => {
                    tracks.push(track);
                }

                Err(error) => {
                    eprintln!(
                        "No se pudo leer el archivo temporal '{}': {}",
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

// =============================================================
// ID DE BIBLIOTECA
// =============================================================

/// Genera un identificador estable para una pista de biblioteca.
///
/// El ID se obtiene mediante un hash de la ruta física.
fn create_track_id(path: &Path) -> String {
    let mut hasher = DefaultHasher::new();

    path.to_string_lossy().hash(&mut hasher);

    let hash = hasher.finish();

    format!("track-{:016x}", hash)
}

// =============================================================
// ID TEMPORAL
// =============================================================

/// Genera un identificador estable para un archivo temporal.
///
/// Se utiliza un prefijo diferente al de la biblioteca para
/// distinguir claramente ambos tipos de pistas.
fn create_temp_track_id(path: &Path) -> String {
    let mut hasher = DefaultHasher::new();

    path.to_string_lossy().hash(&mut hasher);

    let hash = hasher.finish();

    format!("temp-{:016x}", hash)
}

// =============================================================
// BUSCAR PORTADA
// =============================================================

/// Busca una portada personalizada asociada a una pista.
///
/// El nombre de la portada debe coincidir con el ID de la pista.
fn find_cover(
    covers_directory: &Path,
    track_id: &str,
) -> Option<String> {
    let extensions = [
        "png",
        "jpg",
        "jpeg",
        "webp",
    ];

    for extension in extensions {
        let cover_path = covers_directory.join(
            format!("{}.{}", track_id, extension)
        );

        if cover_path.is_file() {
            return Some(
                cover_path
                    .to_string_lossy()
                    .into_owned(),
            );
        }
    }

    None
}