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
// También se encarga de localizar las portadas personalizadas
// almacenadas dentro de la carpeta `covers` de Musex.
//
// Posteriormente podrá utilizarse para:
//
// - Escanear la carpeta de música de Musex.
// - Detectar nuevos archivos.
// - Reconstruir la biblioteca al iniciar la aplicación.
// - Actualizar la biblioteca cuando se agreguen canciones.
// - Recuperar las portadas físicas asociadas a cada pista.
// =============================================================

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
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
    /// `covers_directory` corresponde a la carpeta física donde
    /// Musex almacena las portadas personalizadas.
    ///
    /// Los directorios internos también son recorridos para
    /// permitir que la biblioteca tenga subcarpetas.
    pub fn scan(
        &self,
        directory: impl AsRef<Path>,
        covers_directory: impl AsRef<Path>,
    ) -> Result<Vec<Track>, Box<dyn std::error::Error>> {
        let directory = directory.as_ref();
        let covers_directory = covers_directory.as_ref();

        // ---------------------------------------------------------
        // VALIDAR DIRECTORIO DE MÚSICA
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

    /// Recorre recursivamente un directorio y agrega las pistas
    /// encontradas al resultado.
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
            //
            // El ID ya no depende del orden en que `read_dir`
            // encuentre los archivos.
            //
            // Esto es importante porque las portadas se guardan
            // utilizando este ID como nombre de archivo.
            // -----------------------------------------------------

            let id = create_track_id(&path);

            match Track::from_file(id, &path) {
                Ok(mut track) => {
                    // -------------------------------------------------
                    // BUSCAR PORTADA
                    // -------------------------------------------------
                    //
                    // Si existe una portada previamente guardada para
                    // esta canción, se incorpora al Track.
                    //
                    // Si no existe, `cover_path` permanece en `None`.
                    // -------------------------------------------------

                    track.cover_path = find_cover(
                        covers_directory,
                        &track.id,
                    );

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

// =============================================================
// ID ESTABLE
// =============================================================

/// Genera un identificador estable para una pista.
///
/// El identificador se obtiene mediante un hash de la ruta
/// física del archivo.
///
/// A diferencia del antiguo `scan-0001`, este ID no depende
/// del orden en que el sistema operativo encuentre los archivos.
///
/// Esto permite utilizar el ID para asociar una portada física:
///
///     covers/<id>.jpg
///
///     covers/<id>.png
///
///     covers/<id>.webp
fn create_track_id(path: &Path) -> String {
    let mut hasher = DefaultHasher::new();

    path.to_string_lossy().hash(&mut hasher);

    let hash = hasher.finish();

    format!("track-{:016x}", hash)
}

// =============================================================
// BUSCAR PORTADA
// =============================================================

/// Busca una portada personalizada asociada a una pista.
///
/// Musex admite actualmente:
///
/// - PNG
/// - JPG
/// - JPEG
/// - WebP
///
/// El nombre de la portada debe coincidir con el ID de la pista.
///
/// Ejemplo:
///
///     track-4f8a2d....jpg
///
/// Si no existe ninguna portada compatible, devuelve `None`.
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
        let cover_path = covers_directory.join(format!(
            "{}.{}",
            track_id,
            extension
        ));

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

// =============================================================
// PREPARACIÓN PARA TAURI
// =============================================================
//
// Este scanner puede ejecutarse desde comandos Tauri para:
//
// - Escanear la biblioteca.
// - Devolver las pistas a Angular.
// - Detectar nuevos archivos.
// - Actualizar la biblioteca.
// - Recuperar las portadas físicas.
//
// Los `Track` se serializan mediante Serde para cruzar la
// frontera Rust -> Tauri -> Angular.
// =============================================================