// =============================================================
// ALMACENAMIENTO LOCAL EN ANDROID
// =============================================================
//
// Carpeta pública "Musex" en el almacenamiento del teléfono, con la
// misma estructura que en escritorio:
//
//   /storage/emulated/0/Musex/
//       music/      ← tu música
//       covers/     ← portadas
//       temp/
//       library.json
//
// Para escribir ahí Android pide "Acceso a todos los archivos"
// (ver MainActivity.requestAllFilesAccess). Sin ese permiso Musex
// usa su carpeta privada y avisa en la pantalla de la biblioteca.
// =============================================================

pub mod ops;

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::filesystem::storage::Storage;

use ops::{PhoneFolder, TransferResult};

/// Raíz del almacenamiento compartido.
pub const SHARED_ROOT: &str = "/storage/emulated/0";

/// Carpeta donde viven los datos de Musex en Android.
///
/// Devuelve la carpeta pública si se puede escribir en ella.
/// Si no, devuelve `None` y el llamador usa la carpeta privada.
pub fn shared_base_dir() -> Option<PathBuf> {
    let base = Path::new(SHARED_ROOT).join("Musex");

    if std::fs::create_dir_all(base.join("music")).is_err() {
        return None;
    }

    if is_writable(&base) {
        Some(base)
    } else {
        None
    }
}

fn is_writable(dir: &Path) -> bool {
    let probe = dir.join(".musex_write_test");

    match std::fs::write(&probe, b"ok") {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }

        Err(_) => false,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStorageInfo {
    pub base_dir: String,
    pub music_dir: String,

    /// true = carpeta pública "Musex"; false = carpeta privada de la app.
    pub shared: bool,

    pub writable: bool,
}

#[tauri::command]
pub fn get_local_storage_info(storage: State<'_, Storage>) -> LocalStorageInfo {
    let base = storage.base_dir().to_path_buf();

    LocalStorageInfo {
        base_dir: base.to_string_lossy().to_string(),
        music_dir: storage.music_dir().to_string_lossy().to_string(),
        shared: base.starts_with(SHARED_ROOT),
        writable: is_writable(&base),
    }
}

/// Carpetas del teléfono que tienen música (fuera de Musex).
#[tauri::command]
pub async fn scan_phone_audio(
    storage: State<'_, Storage>,
) -> Result<Vec<PhoneFolder>, String> {
    let musex_base = storage.base_dir().to_path_buf();

    tauri::async_runtime::spawn_blocking(move || {
        ops::scan_audio_folders(Path::new(SHARED_ROOT), &musex_base)
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn browse_phone_directory(
    path: String,
) -> Result<Vec<ops::BrowserEntry>, String> {
    let requested = PathBuf::from(&path);
    let root = PathBuf::from(SHARED_ROOT);
    let musex = root.join("Musex");

    if ops::has_parent_dir(&requested) {
        return Err("Ruta no permitida.".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        let requested = requested.canonicalize().map_err(|e| e.to_string())?;
        let musex = musex.canonicalize().unwrap_or(musex);

        if !requested.starts_with(&root) || requested.starts_with(&musex) {
            return Err("La carpeta solicitada no está permitida.".into());
        }

        ops::list_directory(&requested, &root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn analyze_phone_audio_duplicates(
    paths: Vec<String>,
    storage: State<'_, Storage>,
) -> Result<Vec<ops::DuplicateCheck>, String> {
    let music_dir = storage.music_dir().to_path_buf();
    let root = PathBuf::from(SHARED_ROOT);

    tauri::async_runtime::spawn_blocking(move || {
        let canonical_root =
            root.canonicalize().map_err(|e| e.to_string())?;

        let canonical_music_dir = music_dir
            .canonicalize()
            .map_err(|e| e.to_string())?;

        ops::analyze_audio_duplicates(
            &paths,
            &canonical_root,
            &canonical_music_dir,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Copia o mueve la música de una carpeta del teléfono a Musex.
///
/// `mode`: "copy" (deja los originales) o "move" (los borra después
/// de verificar la copia).
#[tauri::command]
pub async fn transfer_phone_folder(
    path: String,
    mode: String,
    storage: State<'_, Storage>,
) -> Result<TransferResult, String> {
    let source = PathBuf::from(&path);
    let base = storage.base_dir().to_path_buf();
    let music_dir = storage.music_dir();

    if ops::has_parent_dir(&source)
        || !source.starts_with(SHARED_ROOT)
        || source.starts_with(&base)
    {
        return Err("Esa carpeta no se puede usar.".to_string());
    }

    let move_files = mode == "move";

    tauri::async_runtime::spawn_blocking(move || {
        ops::transfer_folder(&source, &music_dir, move_files)
    })
    .await
    .map_err(|error| error.to_string())
}

/// Importa canciones seleccionadas desde el almacenamiento público.
#[tauri::command]
pub async fn import_phone_audio_files(
    paths: Vec<String>,
    mode: String,
    storage: State<'_, Storage>,
) -> Result<TransferResult, String> {
    let base = storage.base_dir().to_path_buf();
    let music_dir = storage.music_dir();
    let root = PathBuf::from(SHARED_ROOT);
    let move_files = mode == "move";

    if mode != "copy" && mode != "move" {
        return Err("Modo de importación no válido.".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
        let canonical_base = base.canonicalize().map_err(|e| e.to_string())?;

        ops::import_selected_files(
            &paths,
            &canonical_root,
            &music_dir,
            move_files,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Máximo que se lee completo en memoria para reproducir.
const MAX_AUDIO_BYTES: u64 = 200 * 1024 * 1024;

/// Entrega un archivo de música completo (solo dentro de Musex/music).
///
/// El WebView de Android no reproduce bien los audios servidos por el
/// protocolo asset de Tauri (llegan en trozos de ~1 MB y el audio se
/// corta). Angular recibe aquí los bytes completos y los reproduce
/// desde un Blob.
#[tauri::command]
pub async fn read_local_audio(
    path: String,
    storage: State<'_, Storage>,
) -> Result<tauri::ipc::Response, String> {
    let file = PathBuf::from(&path);
    let music_dir = storage.music_dir();

    if ops::has_parent_dir(&file)
        || !file.starts_with(&music_dir)
        || !ops::is_audio(&file)
    {
        return Err("Archivo no permitido.".to_string());
    }

    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let size = std::fs::metadata(&file)
            .map_err(|error| error.to_string())?
            .len();

        if size > MAX_AUDIO_BYTES {
            return Err("El archivo es demasiado grande.".to_string());
        }

        std::fs::read(&file).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;

    Ok(tauri::ipc::Response::new(bytes))
}

/// Borra archivos de música (solo dentro de Musex/music).
#[tauri::command]
pub async fn delete_local_files(
    paths: Vec<String>,
    storage: State<'_, Storage>,
) -> Result<u32, String> {
    let music_dir = storage.music_dir();

    tauri::async_runtime::spawn_blocking(move || ops::delete_inside(&paths, &music_dir))
        .await
        .map_err(|error| error.to_string())
}