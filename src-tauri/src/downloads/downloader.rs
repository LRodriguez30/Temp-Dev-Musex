// =============================================================
// MUSEX - DOWNLOADER
// =============================================================
//
// Define la interfaz común que utilizarán los diferentes
// motores de descarga de Musex.
//
// El downloader permanece independiente de:
// - Angular
// - Eventos
// - Interfaz gráfica
//
// El control de la descarga se recibe mediante
// DownloadController.
//
// Para los motores que requieren recursos proporcionados
// por Tauri, se recibe un AppHandle durante la ejecución.
// =============================================================

use std::path::{Path, PathBuf};

use tauri::AppHandle;

use crate::models::download::Download;

use crate::downloads::download_manager::DownloadController;

// =============================================================
// DOWNLOAD CONTROL RESULT
// =============================================================

/// Resultado de una interrupción controlada.
///
/// Una pausa o cancelación no representan un error de descarga.
/// Por eso se manejan explícitamente mediante este enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownloadControlResult {
    /// La descarga fue pausada.
    Paused,

    /// La descarga fue cancelada.
    Cancelled,
}

// =============================================================
// DOWNLOAD PROGRESS
// =============================================================

/// Información sobre el progreso actual de una descarga.
#[derive(Debug, Clone)]
pub struct DownloadProgress {
    /// Porcentaje actual de la operación.
    ///
    /// El valor siempre se mantiene entre 0.0 y 100.0.
    pub progress: f32,

    /// Etapa actual del proceso.
    ///
    /// Ejemplos:
    ///
    /// - `preparing`
    /// - `fetching`
    /// - `downloading`
    /// - `converting`
    /// - `saving`
    /// - `completed`
    /// - `error`
    pub stage: String,

    /// Mensaje descriptivo para mostrar en la interfaz.
    pub message: String,

    /// Cantidad real de bytes descargados o procesados.
    pub downloaded_bytes: u64,

    /// Tamaño total del archivo en bytes.
    ///
    /// `None` indica que todavía no se conoce.
    pub total_bytes: Option<u64>,
}

impl DownloadProgress {
    /// Crea un nuevo estado de progreso general.
    pub fn new(
        progress: f32,
        stage: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            progress: progress.clamp(0.0, 100.0),
            stage: stage.into(),
            message: message.into(),
            downloaded_bytes: 0,
            total_bytes: None,
        }
    }

    /// Crea un estado de progreso utilizando bytes reales.
    pub fn from_bytes(
        downloaded_bytes: u64,
        total_bytes: Option<u64>,
        stage: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        let progress = match total_bytes {
            Some(total) if total > 0 => {
                ((downloaded_bytes as f64 / total as f64) * 100.0)
                    .clamp(0.0, 100.0) as f32
            }

            _ => 0.0,
        };

        Self {
            progress,
            stage: stage.into(),
            message: message.into(),
            downloaded_bytes,
            total_bytes,
        }
    }
}

// =============================================================
// DOWNLOAD RESULT
// =============================================================

/// Resultado de una descarga completada.
///
/// Contiene la ubicación del archivo generado.
#[derive(Debug, Clone)]
pub struct DownloadResult {
    /// Ruta del archivo generado.
    pub output_path: PathBuf,
}

impl DownloadResult {
    /// Crea un nuevo resultado a partir de una ruta.
    pub fn new(
        output_path: impl Into<PathBuf>,
    ) -> Self {
        Self {
            output_path: output_path.into(),
        }
    }

    /// Comprueba si el archivo resultante existe físicamente.
    pub fn exists(&self) -> bool {
        self.output_path.is_file()
    }

    /// Obtiene la ruta del archivo como `Path`.
    pub fn path(&self) -> &Path {
        &self.output_path
    }
}

// =============================================================
// DOWNLOAD ERROR
// =============================================================

/// Error producido durante una descarga.
///
/// Se mantiene separado de las interrupciones controladas.
/// Una pausa o cancelación NO son errores.
#[derive(Debug)]
pub enum DownloadError {
    /// La descarga fue interrumpida de forma controlada.
    Control(DownloadControlResult),

    /// Error producido por el motor de descarga.
    Other(Box<dyn std::error::Error>),
}

impl std::fmt::Display for DownloadError {
    fn fmt(
        &self,
        formatter: &mut std::fmt::Formatter<'_>,
    ) -> std::fmt::Result {
        match self {
            Self::Control(DownloadControlResult::Paused) => {
                write!(formatter, "La descarga fue pausada.")
            }

            Self::Control(DownloadControlResult::Cancelled) => {
                write!(formatter, "La descarga fue cancelada.")
            }

            Self::Other(error) => {
                write!(formatter, "{error}")
            }
        }
    }
}

impl std::error::Error for DownloadError {}

// =============================================================
// DOWNLOADER TRAIT
// =============================================================

/// Contrato común para todos los motores de descarga.
///
/// Cada proveedor implementa su propia lógica, pero todos
/// reciben el mismo mecanismo de control.
pub trait Downloader {
    /// Ejecuta una descarga.
    ///
    /// El downloader puede:
    ///
    /// - completar la operación;
    /// - detectar una pausa;
    /// - detectar una cancelación;
    /// - devolver un error real.
    ///
    /// `AppHandle` permite acceder a recursos proporcionados
    /// por Tauri, como el ejecutable sidecar de yt-dlp.
    ///
    /// `DownloadController` permite al worker consultar si
    /// el usuario solicitó pausar o cancelar.
    fn download(
        &self,
        app: &AppHandle,
        download: &Download,
        output_path: &Path,
        controller: &DownloadController,
        progress_callback: &mut dyn FnMut(DownloadProgress),
    ) -> Result<DownloadResult, DownloadError>;

    /// Comprueba si este motor puede procesar la URL indicada.
    fn supports_url(
        &self,
        url: &str,
    ) -> bool;
}

// =============================================================
// CONTROL HELPERS
// =============================================================

/// Comprueba si una descarga debe pausarse o cancelarse.
///
/// Este helper evita repetir la misma lógica dentro de cada
/// downloader.
pub fn check_download_control(
    controller: &DownloadController,
) -> Option<DownloadControlResult> {
    if controller.is_cancelled() {
        return Some(DownloadControlResult::Cancelled);
    }

    if controller.is_paused() {
        return Some(DownloadControlResult::Paused);
    }

    None
}

// =============================================================
// FLUJO DE COMUNICACIÓN
// =============================================================
//
// Downloader
//     ↓
// DownloadProgress
//     ↓
// Download Command
//     ↓
// Tauri Event
//     ↓
// Angular
//
// Para interrupciones:
//
// Downloader
//     ↓
// DownloadControlResult
//     ↓
// Download Command
//     ↓
// Tauri Event
//     ↓
// Angular
// =============================================================