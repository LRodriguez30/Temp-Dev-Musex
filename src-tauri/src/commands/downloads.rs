// =============================================================
// COMANDOS - DESCARGAS
// =============================================================
//
// Expone las operaciones del sistema de descargas para Tauri.
//
// Este módulo funciona como puente entre la interfaz y el
// núcleo de descargas de Musex.
//
// La ejecución de las descargas se realiza en un worker separado
// para evitar bloquear el hilo principal de Tauri mientras
// yt-dlp o las solicitudes HTTP realizan operaciones de I/O.
//
// Los avances del proceso se comunican hacia Angular mediante
// eventos de Tauri.
//
// Flujo:
//
// Angular
//     ↓
// invoke("download_audio")
//     ↓
// Tauri command
//     ↓
// DownloadManager
//     ↓
// DownloadController
//     ↓
// Worker
//     ↓
// Downloader
//     ↓
// Tauri events
//     ↓
// Angular DownloadService
//
// =============================================================

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::downloads::download_manager::DownloadController;

use crate::downloads::downloader::{
    DownloadControlResult, DownloadError, DownloadProgress, DownloadResult, Downloader,
};

use crate::downloads::manager::DownloadManager;

use crate::downloads::newgrounds_downloader::NewgroundsDownloader;
use crate::downloads::youtube_downloader::YouTubeDownloader;

use crate::filesystem::storage::Storage;

use crate::models::download::{Download, DownloadSource};

// =============================================================
// EVENTO DE PROGRESO
// =============================================================
//
// `status` representa el estado general de la descarga.
//
// `stage` representa únicamente la etapa interna del proceso.
//
// Esto permite mantener separados:
//
// status:
// - pending
// - downloading
// - paused
// - completed
// - error
// - cancelled
//
// stage:
// - preparing
// - fetching
// - downloading
// - converting
// - saving
// - completed
// - error
//
// =============================================================

#[derive(Debug, Clone, Serialize)]
struct DownloadProgressEvent {
    /// Identificador único de la descarga.
    id: String,

    /// Estado general de la descarga.
    status: String,

    /// Porcentaje actual del proceso.
    progress: f32,

    /// Etapa interna actual de la descarga.
    stage: String,

    /// Mensaje descriptivo para la interfaz.
    message: String,

    /// Cantidad real de bytes procesados.
    downloaded_bytes: u64,

    /// Tamaño total conocido del archivo.
    total_bytes: Option<u64>,
}

// =============================================================
// EVENTO DE DESCARGA COMPLETADA
// =============================================================

#[derive(Debug, Clone, Serialize)]
struct DownloadCompletedEvent {
    /// Identificador de la descarga.
    id: String,

    /// Ruta física del archivo generado.
    file_path: String,

    title: String,
}

// =============================================================
// EVENTO DE ERROR
// =============================================================

#[derive(Debug, Clone, Serialize)]
struct DownloadErrorEvent {
    /// Identificador de la descarga.
    id: String,

    /// Mensaje del error.
    message: String,
}

// =============================================================
// DETECTAR FUENTE
// =============================================================

/// Determina qué plataforma puede manejar la URL.
///
/// Esta operación no inicia ninguna descarga.
#[tauri::command]
pub fn detect_download_source(url: String) -> Result<String, String> {
    let youtube = YouTubeDownloader::new();

    if youtube.supports_url(&url) {
        return Ok("youtube".to_string());
    }

    let newgrounds = NewgroundsDownloader::new();

    if newgrounds.supports_url(&url) {
        return Ok("newgrounds".to_string());
    }

    Err("No se reconoce la fuente de la URL.".to_string())
}

// =============================================================
// DESCARGAR AUDIO
// =============================================================
//
// Este comando registra la descarga en DownloadManager y
// posteriormente inicia el worker.
//
// El DownloadController pertenece al DownloadManager.
//
// El worker recibe un clone del mismo controller, por lo que
// los comandos pause/resume/cancel pueden modificar exactamente
// el estado que está utilizando el downloader.
//
// =============================================================

#[tauri::command]
pub fn download_audio(
    app: AppHandle,
    id: String,
    url: String,
    storage: State<'_, Storage>,
    manager: State<'_, Arc<std::sync::Mutex<DownloadManager>>>,
    history: State<'_, crate::downloads::history::DownloadHistory>,
) -> Result<(), String> {
    // =========================================================
    // PREPARAR RUTA DE DESTINO
    // =========================================================

    let output_path = PathBuf::from(storage.downloads_dir());

    // =========================================================
    // DETECTAR FUENTE
    // =========================================================

    let source = match detect_source(&url) {
        Some(source) => source,

        None => {
            return Err("No se reconoce la fuente de la URL.".to_string());
        }
    };

    // =========================================================
    // OBTENER MANAGER COMPARTIDO
    // =========================================================

    let manager = manager.inner().clone();

    let history = history.inner().clone();

    // =========================================================
    // REGISTRAR DESCARGA
    // =========================================================

    let controller = {
        let mut manager_guard = manager.lock().map_err(|error| {
            format!(
                "No se pudo acceder al administrador de descargas: {}",
                error
            )
        })?;

        let added = manager_guard.create_download(id.clone(), url.clone(), source.clone());

        if !added {
            return Err("Ya existe una descarga con ese identificador.".to_string());
        }

        manager_guard
            .controller(&id)
            .ok_or_else(|| "No se pudo obtener el controlador de la descarga.".to_string())?
    };

    // =========================================================
    // EVENTO INICIAL
    // =========================================================

    emit_progress(
        &app,
        DownloadProgressEvent {
            id: id.clone(),

            status: "downloading".to_string(),

            progress: 0.0,

            stage: "preparing".to_string(),

            message: "Preparando descarga...".to_string(),

            downloaded_bytes: 0,

            total_bytes: None,
        },
    );

    // =========================================================
    // CREAR WORKER
    // =========================================================

    thread::spawn(move || {
        // -----------------------------------------------------
        // MODELO DE DESCARGA
        // -----------------------------------------------------

        let download = Download::new(id.clone(), url.clone(), source);

        // -----------------------------------------------------
        // CONTROLLER DEL WORKER
        // -----------------------------------------------------

        let worker_controller = controller.clone();

        // -----------------------------------------------------
        // CALLBACK DE PROGRESO
        // -----------------------------------------------------

        let app_for_progress = app.clone();

        let manager_for_progress = manager.clone();

        let download_id = id.clone();

        let mut progress_callback = move |progress: DownloadProgress| {
            // -------------------------------------------------
            // ACTUALIZAR MANAGER
            // -------------------------------------------------

            if let Ok(mut manager_guard) = manager_for_progress.lock() {
                manager_guard.update_progress(&download_id, progress.clone());
            }

            // -------------------------------------------------
            // DETERMINAR ESTADO
            // -------------------------------------------------

            let status = if progress.stage == "error" {
                "error"
            } else {
                "downloading"
            };

            // -------------------------------------------------
            // EMITIR EVENTO
            // -------------------------------------------------

            emit_progress(
                &app_for_progress,
                DownloadProgressEvent {
                    id: download_id.clone(),

                    status: status.to_string(),

                    progress: progress.progress,

                    stage: progress.stage,

                    message: progress.message,

                    downloaded_bytes: progress.downloaded_bytes,

                    total_bytes: progress.total_bytes,
                },
            );
        };

        // =====================================================
        // EJECUTAR DOWNLOADER
        // =====================================================

        let result = source_downloader(
            &app,
            &download,
            &output_path,
            &worker_controller,
            &mut progress_callback,
        );

        // =====================================================
        // PROCESAR RESULTADO
        // =====================================================

        let result = match result {
            // -------------------------------------------------
            // ÉXITO
            // -------------------------------------------------

            Ok(result) => result,

            // -------------------------------------------------
            // DESCARGA PAUSADA
            // -------------------------------------------------

            Err(DownloadError::Control(DownloadControlResult::Paused)) => {
                let progress = get_manager_progress(&manager, &id);

                emit_progress(
                    &app,
                    DownloadProgressEvent {
                        id: id.clone(),

                        status: "paused".to_string(),

                        progress: progress
                            .as_ref()
                            .map(|value| value.progress)
                            .unwrap_or(0.0),

                        stage: progress
                            .as_ref()
                            .map(|value| value.stage.clone())
                            .unwrap_or_else(|| "downloading".to_string()),

                        message: "Descarga pausada.".to_string(),

                        downloaded_bytes: progress
                            .as_ref()
                            .map(|value| value.downloaded_bytes)
                            .unwrap_or(0),

                        total_bytes: progress
                            .as_ref()
                            .and_then(|value| value.total_bytes),
                    },
                );

                return;
            }

            // -------------------------------------------------
            // DESCARGA CANCELADA
            // -------------------------------------------------

            Err(DownloadError::Control(DownloadControlResult::Cancelled)) => {
                if let Ok(mut manager_guard) = manager.lock() {
                    manager_guard.cancel_download(&id);
                }

                let progress = get_manager_progress(&manager, &id);

                emit_progress(
                    &app,
                    DownloadProgressEvent {
                        id,

                        status: "cancelled".to_string(),

                        progress: progress
                            .as_ref()
                            .map(|value| value.progress)
                            .unwrap_or(0.0),

                        stage: progress
                            .as_ref()
                            .map(|value| value.stage.clone())
                            .unwrap_or_else(|| "downloading".to_string()),

                        message: "Descarga cancelada.".to_string(),

                        downloaded_bytes: progress
                            .as_ref()
                            .map(|value| value.downloaded_bytes)
                            .unwrap_or(0),

                        total_bytes: progress
                            .as_ref()
                            .and_then(|value| value.total_bytes),
                    },
                );

                return;
            }

            // -------------------------------------------------
            // ERROR REAL
            // -------------------------------------------------

            Err(error) => {
                let message = error.to_string();

                if let Ok(mut manager_guard) = manager.lock() {
                    manager_guard.fail_download(&id, message.clone());
                }

                emit_error(&app, DownloadErrorEvent { id, message });

                return;
            }
        };

        // =====================================================
        // OBTENER RUTA FINAL
        // =====================================================

        let file_path = result.path().to_string_lossy().into_owned();

        // =====================================================
        // ACTUALIZAR MANAGER
        // =====================================================

        if let Ok(mut manager_guard) = manager.lock() {
            manager_guard.complete_download(&id, file_path.clone());
        }

        // =====================================================
        // EVENTO FINAL DE PROGRESO
        // =====================================================

        emit_progress(
            &app,
            DownloadProgressEvent {
                id: id.clone(),

                status: "completed".to_string(),

                progress: 100.0,

                stage: "completed".to_string(),

                message: "Descarga completada.".to_string(),

                downloaded_bytes: 0,

                total_bytes: None,
            },
        );

        // =====================================================
        // EVENTO DE COMPLETADO
        // =====================================================

        let title = result
            .path()
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Descarga completada")
            .to_string();

        let source_label = match download.source {
            DownloadSource::YouTube => "youtube",
            DownloadSource::Newgrounds => "newgrounds",
            DownloadSource::Unknown => "unknown",
        };

        let entry = crate::downloads::history::DownloadHistoryEntry {
            id: id.clone(),
            title: title.clone(),
            url: download.url.clone(),
            source: source_label.to_string(),
            file_path: file_path.clone(),
            completed_at: chrono::Local::now().to_rfc3339(),
        };

        if let Err(error) = history.add_entry(entry) {
            eprintln!("[HISTORY] No se pudo guardar el historial: {}", error);
        }

        emit_completed(
            &app,
            DownloadCompletedEvent {
                id,
                file_path,
                title,
            },
        );
    });

    // =========================================================
    // RESPUESTA INMEDIATA
    // =========================================================

    Ok(())
}

// =============================================================
// OBTENER PROGRESO DEL MANAGER
// =============================================================

fn get_manager_progress(
    manager: &Arc<std::sync::Mutex<DownloadManager>>,
    id: &str,
) -> Option<DownloadProgress> {
    let manager_guard = manager.lock().ok()?;

    manager_guard.get_progress(id).cloned()
}

// =============================================================
// DETECTAR FUENTE
// =============================================================

/// Determina qué downloader es compatible con la URL.
fn detect_source(url: &str) -> Option<DownloadSource> {
    let youtube = YouTubeDownloader::new();

    if youtube.supports_url(url) {
        return Some(DownloadSource::YouTube);
    }

    let newgrounds = NewgroundsDownloader::new();

    if newgrounds.supports_url(url) {
        return Some(DownloadSource::Newgrounds);
    }

    None
}

// =============================================================
// EJECUTAR DOWNLOADER
// =============================================================

/// Selecciona el downloader apropiado y ejecuta la descarga.
fn source_downloader(
    app: &AppHandle,
    download: &Download,
    output_path: &Path,
    controller: &DownloadController,
    progress_callback: &mut dyn FnMut(DownloadProgress),
) -> Result<DownloadResult, DownloadError> {
    // =========================================================
    // OBTENER URL
    // =========================================================

    let url = download_url(download);

    // =========================================================
    // YOUTUBE
    // =========================================================

    let youtube = YouTubeDownloader::new();

    if youtube.supports_url(&url) {
        return youtube.download(
            app,
            download,
            output_path,
            controller,
            progress_callback,
        );
    }

    // =========================================================
    // NEWGROUNDS
    // =========================================================

    let newgrounds = NewgroundsDownloader::new();

    if newgrounds.supports_url(&url) {
        return newgrounds.download(
            app,
            download,
            output_path,
            controller,
            progress_callback,
        );
    }

    // =========================================================
    // NINGÚN DOWNLOADER COMPATIBLE
    // =========================================================

    Err(DownloadError::Other(
        "No se encontró un descargador compatible.".into(),
    ))
}

// =============================================================
// OBTENER URL DEL DOWNLOAD
// =============================================================

/// Centraliza el acceso a la URL almacenada en `Download`.
fn download_url(download: &Download) -> String {
    download.url.clone()
}

// =============================================================
// EMITIR PROGRESO
// =============================================================

fn emit_progress(app: &AppHandle, event: DownloadProgressEvent) {
    if let Err(error) = app.emit("download-progress", event) {
        eprintln!("[DOWNLOAD] No se pudo emitir progreso: {}", error);
    }
}

// =============================================================
// EMITIR COMPLETADO
// =============================================================

fn emit_completed(app: &AppHandle, event: DownloadCompletedEvent) {
    if let Err(error) = app.emit("download-completed", event) {
        eprintln!("[DOWNLOAD] No se pudo emitir finalización: {}", error);
    }
}

// =============================================================
// EMITIR ERROR
// =============================================================

fn emit_error(app: &AppHandle, event: DownloadErrorEvent) {
    if let Err(error) = app.emit("download-error", event) {
        eprintln!("[DOWNLOAD] No se pudo emitir error: {}", error);
    }
}

// =============================================================
// ABRIR UBICACIÓN DEL ARCHIVO
// =============================================================
//
// Abre el Explorador de Windows y selecciona el archivo
// descargado.
//
// Ejemplo:
//
// C:\Users\LART\Desktop\Musex\Downloads\cancion.mp3
//
// ↓
//
// Explorer abre la carpeta y selecciona:
//
// [cancion.mp3]
//
// =============================================================

#[tauri::command]
pub fn open_download_location(file_path: String) -> Result<(), String> {
    // ---------------------------------------------------------
    // VALIDAR RUTA
    // ---------------------------------------------------------

    let path = Path::new(&file_path);

    if !path.is_file() {
        return Err("El archivo descargado no existe en la ubicación indicada.".to_string());
    }

    // ---------------------------------------------------------
    // ABRIR EXPLORADOR DE WINDOWS
    // ---------------------------------------------------------
    //
    // `/select,` indica a Explorer que debe abrir la carpeta
    // y seleccionar específicamente el archivo.
    //
    // ---------------------------------------------------------

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", path.display()))
            .spawn()
            .map_err(|error| format!("No se pudo abrir la ubicación del archivo: {}", error))?;
    }

    // ---------------------------------------------------------
    // SISTEMAS NO WINDOWS
    // ---------------------------------------------------------

    #[cfg(not(target_os = "windows"))]
    {
        let parent = path
            .parent()
            .ok_or_else(|| "No se pudo determinar la carpeta del archivo.".to_string())?;

        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|error| format!("No se pudo abrir la carpeta del archivo: {}", error))?;
    }

    Ok(())
}

// =============================================================
// MOVER DESCARGA A LA BIBLIOTECA
// =============================================================
//
// Mueve un archivo descargado desde:
//
// Downloads
//     ↓
// Library
//
// La operación física permanece dentro de `Storage`.
//
// =============================================================

#[tauri::command]
pub fn move_download_to_library(
    file_path: String,
    storage: State<'_, Storage>,
) -> Result<String, String> {
    // ---------------------------------------------------------
    // RUTA DE ORIGEN
    // ---------------------------------------------------------

    let source_path = Path::new(&file_path);

    // ---------------------------------------------------------
    // MOVER ARCHIVO
    // ---------------------------------------------------------

    let destination_path = storage
        .move_download_to_library(source_path)
        .map_err(|error| error.to_string())?;

    // ---------------------------------------------------------
    // DEVOLVER RUTA FINAL
    // ---------------------------------------------------------

    Ok(destination_path.to_string_lossy().into_owned())
}

// =============================================================
// OBTENER HISTORIAL DE DESCARGAS
// =============================================================

#[tauri::command]
pub fn get_download_history(
    history: State<'_, crate::downloads::history::DownloadHistory>,
) -> Result<Vec<crate::downloads::history::DownloadHistoryEntry>, String> {
    history.load()
}

// =============================================================
// ELIMINAR ENTRADA DEL HISTORIAL
// =============================================================

#[tauri::command]
pub fn remove_download_history_entry(
    id: String,
    history: State<'_, crate::downloads::history::DownloadHistory>,
) -> Result<(), String> {
    history.remove_entry(&id)
}

// =============================================================
// LIMPIAR HISTORIAL
// =============================================================

#[tauri::command]
pub fn clear_download_history(
    history: State<'_, crate::downloads::history::DownloadHistory>,
) -> Result<(), String> {
    history.clear()
}