// =============================================================
// COMANDOS - LIBRARY
// =============================================================
//
// Expone las operaciones de la biblioteca musical para que
// puedan ser utilizadas desde la interfaz mediante Tauri.
//
// La ruta de la biblioteca y Temp se obtiene desde Storage
// para que Angular no tenga que conocer la ubicación física
// de Musex.
// =============================================================

use std::path::PathBuf;

use chrono::Utc;
use tauri::State;

use crate::filesystem::storage::Storage;
use crate::library::persistence::LibraryPersistence;
use crate::library::scanner::{
    LibraryScanner,
    TempScanner,
};
use crate::models::track::Track;

// =============================================================
// ESCANEAR BIBLIOTECA
// =============================================================

/// Escanea la carpeta de música de Musex y devuelve las pistas
/// encontradas junto con sus metadatos, portadas y metadata
/// propia de Musex.
#[tauri::command]
pub fn scan_library(
    storage: State<'_, Storage>,
) -> Result<Vec<Track>, String> {
    let scanner = LibraryScanner::new();

    let mut tracks = scanner
        .scan(
            storage.music_dir(),
            storage.covers_dir(),
        )
        .map_err(|error| error.to_string())?;

    let metadata_path =
        storage.library_metadata_file();

    let mut persistence =
        LibraryPersistence::load(&metadata_path)
            .map_err(|error| error.to_string())?;

    for track in &mut tracks {
        if let Some(added_at) =
            persistence.get_added_at(&track.id)
        {
            track.added_at =
                added_at.to_string();
        } else {
            let added_at =
                Utc::now().to_rfc3339();

            track.added_at =
                added_at.clone();

            persistence.set_added_at(
                track.id.clone(),
                added_at,
            );
        }
    }

    persistence
        .save(&metadata_path)
        .map_err(|error| error.to_string())?;

    Ok(tracks)
}

// =============================================================
// ESCANEAR TEMP
// =============================================================

/// Escanea el directorio temporal de Musex y devuelve los
/// archivos de audio disponibles para trabajar.
///
/// Temp no forma parte de la biblioteca permanente y por eso
/// no utiliza `LibraryPersistence` ni busca portadas.
#[tauri::command]
pub fn scan_temp(
    storage: State<'_, Storage>,
) -> Result<Vec<Track>, String> {
    let scanner = TempScanner::new();

    scanner
        .scan(storage.temp_dir())
        .map_err(|error| error.to_string())
}

// =============================================================
// IMPORTAR MÚSICA
// =============================================================

/// Copia archivos de audio externos hacia la biblioteca
/// permanente de Musex.
///
/// Los archivos originales no se modifican. Storage se encarga
/// de generar una ruta disponible y copiar cada archivo dentro
/// de la carpeta de música.
#[tauri::command]
pub fn import_tracks(
    paths: Vec<String>,
    storage: State<'_, Storage>,
) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut imported_paths = Vec::new();

    for path in paths {
        let source_path = PathBuf::from(&path);

        let destination_path = storage
            .copy_to_library(&source_path)
            .map_err(|error| {
                format!(
                    "No se pudo importar '{}': {}",
                    source_path.display(),
                    error
                )
            })?;

        imported_paths.push(
            destination_path
                .to_string_lossy()
                .to_string(),
        );
    }

    Ok(imported_paths)
}