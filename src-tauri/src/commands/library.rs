// =============================================================
// COMANDOS - LIBRARY
// =============================================================
//
// Expone las operaciones de la biblioteca musical para que
// puedan ser utilizadas desde la interfaz mediante Tauri.
//
// La ruta de la biblioteca se obtiene desde Storage para que
// Angular no tenga que conocer la ubicación física de Musex.
// =============================================================

use std::path::PathBuf;

use tauri::State;

use crate::filesystem::storage::Storage;
use crate::library::scanner::LibraryScanner;
use crate::models::track::Track;

// =============================================================
// ESCANEAR BIBLIOTECA
// =============================================================

/// Escanea la carpeta de música de Musex y devuelve las pistas
/// encontradas junto con sus metadatos.
#[tauri::command]
pub fn scan_library(
    storage: State<'_, Storage>,
) -> Result<Vec<Track>, String> {
    let scanner = LibraryScanner::new();

    scanner
        .scan(storage.music_dir())
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
                .to_string()
        );
    }

    Ok(imported_paths)
}