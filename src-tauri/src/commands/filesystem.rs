// =============================================================
// COMANDOS - FILESYSTEM
// =============================================================
//
// Expone las operaciones relacionadas con archivos y
// almacenamiento local para la interfaz de Musex mediante Tauri.
//
// La gestión real del almacenamiento permanece dentro del
// Rust Core.
// =============================================================

use std::path::Path;

use crate::filesystem::storage::Storage;

// =============================================================
// INFORMACIÓN DEL ALMACENAMIENTO
// =============================================================

/// Obtiene la información de una ruta de almacenamiento.
///
/// Devuelve si la ruta corresponde a un archivo, directorio
/// o un elemento desconocido.
#[tauri::command]
pub fn get_storage_info(path: String) -> Result<String, String> {
    let path = Path::new(&path);

    let metadata = std::fs::metadata(path)
        .map_err(|error| error.to_string())?;

    if metadata.is_dir() {
        return Ok("directory".to_string());
    }

    if metadata.is_file() {
        return Ok("file".to_string());
    }

    Ok("unknown".to_string())
}

// =============================================================
// TAMAÑO DEL ALMACENAMIENTO DE MUSEX
// =============================================================

/// Obtiene el tamaño total que ocupa Musex en la máquina.
///
/// El tamaño se calcula recorriendo el directorio principal
/// de almacenamiento de Musex y sumando el tamaño de todos
/// sus archivos.
///
/// El resultado se devuelve en bytes.
#[tauri::command]
pub fn get_musex_storage_size(
    storage: tauri::State<'_, Storage>,
) -> Result<u64, String> {
    storage
        .total_size()
        .map_err(|error| error.to_string())
}

// =============================================================
// CREAR DIRECTORIO
// =============================================================

/// Crea un directorio si todavía no existe.
#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    std::fs::create_dir_all(Path::new(&path))
        .map_err(|error| error.to_string())
}

// =============================================================
// COMPROBAR EXISTENCIA
// =============================================================

/// Comprueba si existe un archivo o directorio.
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}