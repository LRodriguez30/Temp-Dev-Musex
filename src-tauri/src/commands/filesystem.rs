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

// =============================================================
// PORTADAS
// =============================================================

/// Guarda físicamente una portada dentro de la carpeta
/// `covers` de Musex.
///
/// La ruta final se genera mediante `Storage`, por lo que
/// este comando no necesita conocer directamente la ubicación
/// física de la biblioteca.
///
/// El nombre del archivo se construye utilizando el ID de
/// la canción y su extensión.
///
/// Ejemplo:
///
/// `Musex/covers/abc123.jpg`
#[tauri::command]
pub fn save_cover(
    storage: tauri::State<'_, Storage>,
    track_id: String,
    extension: String,
    data: Vec<u8>,
) -> Result<String, String> {
    if track_id.trim().is_empty() {
        return Err(
            "El ID de la canción no puede estar vacío."
                .to_string()
        );
    }

    if data.is_empty() {
        return Err(
            "La portada no contiene datos."
                .to_string()
        );
    }

    let extension = extension
        .trim()
        .trim_start_matches('.')
        .to_lowercase();

    match extension.as_str() {
        "png" | "jpg" | "jpeg" | "webp" => {}

        _ => {
            return Err(
                "Formato de portada no permitido."
                    .to_string()
            );
        }
    }

    let file_name = format!(
        "{}.{}",
        track_id,
        extension
    );

    let cover_path = storage.cover_file(&file_name);

    std::fs::write(&cover_path, data)
        .map_err(|error| {
            format!(
                "No se pudo guardar la portada: {}",
                error
            )
        })?;

    Ok(cover_path.to_string_lossy().to_string())
}