// =============================================================
// MUSEX - DOWNLOAD PROGRESS
// =============================================================
//
// Representa la información de progreso de una descarga.
//
// Este modelo permite separar los datos del progreso de la
// lógica que ejecuta la descarga.
//
// Posteriormente estos datos podrán utilizarse para:
//
// - Actualizar la interfaz de Musex.
// - Mostrar porcentaje de descarga.
// - Mostrar bytes transferidos.
// - Mostrar velocidad.
// - Informar cuando no se conoce el tamaño total.
//
// En esta etapa permanece completamente independiente de Tauri.
// =============================================================

// =============================================================
// DOWNLOAD PROGRESS
// =============================================================

/// Información actual del progreso de una descarga.
#[derive(Debug, Clone)]
pub struct DownloadProgress {
    /// Porcentaje completado de la descarga.
    ///
    /// Se mantiene entre 0 y 100.
    pub percentage: f32,

    /// Cantidad de bytes descargados.
    pub downloaded_bytes: u64,

    /// Cantidad total de bytes esperados.
    ///
    /// Puede ser `None` cuando la fuente no proporciona
    /// el tamaño total del archivo.
    pub total_bytes: Option<u64>,

    /// Velocidad actual de descarga en bytes por segundo.
    pub speed_bytes_per_second: Option<u64>,
}

impl DownloadProgress {
    /// Crea un progreso inicial sin datos transferidos.
    pub fn new() -> Self {
        Self {
            percentage: 0.0,
            downloaded_bytes: 0,
            total_bytes: None,
            speed_bytes_per_second: None,
        }
    }

    /// Crea un progreso indicando el tamaño total conocido.
    pub fn with_total_bytes(total_bytes: u64) -> Self {
        Self {
            percentage: 0.0,
            downloaded_bytes: 0,
            total_bytes: Some(total_bytes),
            speed_bytes_per_second: None,
        }
    }

    /// Actualiza la cantidad de bytes descargados.
    ///
    /// Cuando se conoce el tamaño total, el porcentaje se
    /// calcula automáticamente.
    pub fn set_downloaded_bytes(
        &mut self,
        downloaded_bytes: u64,
    ) {
        self.downloaded_bytes = downloaded_bytes;

        if let Some(total_bytes) = self.total_bytes {
            if total_bytes > 0 {
                self.percentage =
                    (downloaded_bytes as f32 / total_bytes as f32)
                        * 100.0;

                self.percentage =
                    self.percentage.clamp(0.0, 100.0);
            }
        }
    }

    /// Actualiza manualmente el porcentaje.
    ///
    /// Esto resulta útil cuando el mecanismo de descarga
    /// proporciona un porcentaje pero no informa los bytes.
    pub fn set_percentage(
        &mut self,
        percentage: f32,
    ) {
        self.percentage = percentage.clamp(0.0, 100.0);
    }

    /// Actualiza la velocidad actual de descarga.
    pub fn set_speed(
        &mut self,
        speed_bytes_per_second: u64,
    ) {
        self.speed_bytes_per_second =
            Some(speed_bytes_per_second);
    }

    /// Marca el progreso como completado.
    pub fn complete(&mut self) {
        self.percentage = 100.0;

        if let Some(total_bytes) = self.total_bytes {
            self.downloaded_bytes = total_bytes;
        }
    }

    /// Comprueba si la descarga ha llegado al 100 %.
    pub fn is_complete(&self) -> bool {
        self.percentage >= 100.0
    }
}

impl Default for DownloadProgress {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================
// PREPARACIÓN PARA TAURI
// =============================================================
//
// Cuando Musex se integre con Tauri, DownloadProgress podrá
// convertirse en la información que Rust envíe hacia Angular:
//
// Rust
//   ↓
// DownloadProgress
//   ↓
// Tauri Event
//   ↓
// Angular
//   ↓
// Barra de progreso
//
// La serialización con Serde se agregará posteriormente.
// =============================================================