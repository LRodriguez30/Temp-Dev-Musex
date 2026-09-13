use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

/// Control compartido de una descarga.
///
/// El worker de descarga conserva una instancia de este controlador,
/// mientras que DownloadManager mantiene otra para poder modificar
/// su estado desde los comandos de Tauri.
#[derive(Debug, Clone)]
pub struct DownloadController {
    paused: Arc<AtomicBool>,
    cancelled: Arc<AtomicBool>,
}

impl DownloadController {
    /// Crea un nuevo controlador.
    pub fn new() -> Self {
        Self {
            paused: Arc::new(AtomicBool::new(false)),
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    // =========================================================
    // PAUSE
    // =========================================================

    /// Solicita que la descarga sea pausada.
    pub fn pause(&self) {
        self.paused.store(true, Ordering::SeqCst);
    }

    /// Solicita que la descarga continúe.
    pub fn resume(&self) {
        self.paused.store(false, Ordering::SeqCst);
    }

    /// Comprueba si la descarga está pausada.
    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }

    // =========================================================
    // CANCEL
    // =========================================================

    /// Solicita la cancelación de la descarga.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    /// Comprueba si la descarga fue cancelada.
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    // =========================================================
    // CONTROL
    // =========================================================

    /// Comprueba si existe alguna solicitud de interrupción.
    pub fn should_stop(&self) -> bool {
        self.is_paused() || self.is_cancelled()
    }
}

impl Default for DownloadController {
    fn default() -> Self {
        Self::new()
    }
}