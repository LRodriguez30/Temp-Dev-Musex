// =============================================================
// MUSEX - DOWNLOAD MODEL
// =============================================================
//
// Representa una descarga gestionada por Musex.
//
// El modelo es independiente del proveedor. YouTube y
// Newgrounds podrán utilizar la misma estructura sin mezclar
// su lógica específica con el sistema general de descargas.
// =============================================================

/// Fuente desde la cual se obtiene el contenido.
#[derive(Debug, Clone)]
pub enum DownloadSource {
    /// Contenido obtenido desde YouTube.
    YouTube,

    /// Contenido obtenido desde Newgrounds.
    Newgrounds,

    /// Fuente todavía no identificada o genérica.
    Unknown,
}

/// Estado actual de una descarga.
#[derive(Debug, Clone)]
pub enum DownloadStatus {
    /// La descarga fue creada pero todavía no comenzó.
    Pending,

    /// La descarga está actualmente en progreso.
    Downloading,

    /// La descarga fue pausada por el usuario.
    Paused,

    /// La descarga terminó correctamente.
    Completed,

    /// La descarga terminó debido a un error.
    Failed,

    /// La descarga fue cancelada por el usuario.
    Cancelled,
}

/// Representa una descarga dentro de Musex.
#[derive(Debug, Clone)]
pub struct Download {
    /// Identificador interno de la descarga.
    pub id: String,

    /// URL original proporcionada por el usuario.
    pub url: String,

    /// Fuente de la descarga.
    pub source: DownloadSource,

    /// Estado actual de la descarga.
    pub status: DownloadStatus,

    /// Porcentaje de progreso de 0 a 100.
    pub progress: f32,

    /// Ruta donde se almacenará el archivo.
    pub output_path: Option<String>,

    /// Mensaje de error, si la descarga falló.
    pub error: Option<String>,
}

impl Download {
    /// Crea una nueva descarga en estado pendiente.
    pub fn new(
        id: String,
        url: String,
        source: DownloadSource,
    ) -> Self {
        Self {
            id,
            url,
            source,
            status: DownloadStatus::Pending,
            progress: 0.0,
            output_path: None,
            error: None,
        }
    }

    /// Actualiza el progreso de la descarga.
    ///
    /// El valor se mantiene entre 0 y 100 para evitar estados
    /// inválidos dentro del modelo.
    pub fn set_progress(&mut self, progress: f32) {
        self.progress = progress.clamp(0.0, 100.0);
    }

    /// Marca la descarga como completada.
    pub fn complete(&mut self, output_path: String) {
        self.status = DownloadStatus::Completed;
        self.progress = 100.0;
        self.output_path = Some(output_path);
        self.error = None;
    }

    /// Marca la descarga como fallida.
    pub fn fail(&mut self, error: String) {
        self.status = DownloadStatus::Failed;
        self.error = Some(error);
    }

    /// Cancela la descarga.
    pub fn cancel(&mut self) {
        self.status = DownloadStatus::Cancelled;
    }
}

// =============================================================
// PREPARACIÓN PARA TAURI
// =============================================================
//
// Posteriormente, para enviar Download hacia Angular mediante
// Tauri, estos tipos podrán implementar:
//
// Serialize
// Deserialize
//
// mediante serde.
//
// Ejemplo:
//
// #[derive(Debug, Clone, Serialize, Deserialize)]
// pub enum DownloadStatus {
//     Pending,
//     Downloading,
//     Completed,
//     Failed,
//     Cancelled,
// }
//
// No activamos serde todavía. Primero se prueba toda la lógica
// utilizando únicamente Rust.
// =============================================================