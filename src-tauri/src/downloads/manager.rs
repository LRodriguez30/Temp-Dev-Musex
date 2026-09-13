// =============================================================
// MUSEX - DOWNLOAD MANAGER
// =============================================================
//
// Responsable de administrar las descargas activas dentro de
// Musex.
//
// El manager coordina el ciclo de vida de las descargas,
// selecciona el descargador correspondiente, mantiene el
// último estado de progreso conocido y conserva el controlador
// de cada descarga activa.
//
// La lógica específica de cada plataforma permanece separada
// en:
//
// - youtube_downloader.rs
// - newgrounds_downloader.rs
//
// El manager no depende de Tauri ni de Angular.
// =============================================================

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::downloads::download_manager::DownloadController;

use crate::downloads::downloader::{
    DownloadProgress,
    Downloader,
};

use crate::downloads::newgrounds_downloader::NewgroundsDownloader;
use crate::downloads::youtube_downloader::YouTubeDownloader;

use crate::filesystem::storage::Storage;

use crate::models::download::{
    Download,
    DownloadSource,
};

// =============================================================
// DOWNLOAD MANAGER
// =============================================================

/// Administrador central de descargas.
///
/// Mantiene las descargas registradas en memoria utilizando
/// su identificador como clave.
#[derive(Debug)]
pub struct DownloadManager {
    /// Descargas actualmente registradas.
    downloads: HashMap<String, Download>,

    /// Último estado de progreso conocido para cada descarga.
    progress: HashMap<String, DownloadProgress>,

    /// Controlador asociado a cada descarga activa.
    ///
    /// El mismo `DownloadController` puede ser compartido entre
    /// el manager y el worker de descarga mediante clones.
    controllers: HashMap<String, DownloadController>,

    /// Administrador de almacenamiento utilizado para
    /// determinar las rutas de los archivos.
    storage: Storage,

    /// Descargador específico para YouTube.
    youtube_downloader: YouTubeDownloader,

    /// Descargador específico para Newgrounds.
    newgrounds_downloader: NewgroundsDownloader,
}

impl DownloadManager {

    /// Crea un administrador de descargas utilizando el
    /// almacenamiento proporcionado.
    pub fn new(
        storage: Storage,
    ) -> Self {
        Self {
            downloads: HashMap::new(),
            progress: HashMap::new(),
            controllers: HashMap::new(),
            storage,
            youtube_downloader: YouTubeDownloader::new(),
            newgrounds_downloader: NewgroundsDownloader::new(),
        }
    }

    /// Obtiene una referencia al almacenamiento utilizado por
    /// el administrador.
    pub fn storage(&self) -> &Storage {
        &self.storage
    }

    // =========================================================
    // DOWNLOAD CREATION
    // =========================================================

    /// Registra una nueva descarga.
    ///
    /// Devuelve `false` si ya existe una descarga con el mismo
    /// identificador.
    pub fn add_download(
        &mut self,
        download: Download,
    ) -> bool {

        let id =
            download.id.clone();

        if self.downloads.contains_key(&id) {
            return false;
        }

        self.downloads.insert(
            id.clone(),
            download,
        );

        self.progress.insert(
            id.clone(),
            DownloadProgress::new(
                0.0,
                "pending",
                "Descarga pendiente.",
            ),
        );

        self.controllers.insert(
            id,
            DownloadController::new(),
        );

        true
    }

    /// Crea y registra una nueva descarga.
    ///
    /// Devuelve `false` si ya existe una descarga con el mismo
    /// identificador.
    pub fn create_download(
        &mut self,
        id: String,
        url: String,
        source: DownloadSource,
    ) -> bool {

        let download =
            Download::new(
                id,
                url,
                source,
            );

        self.add_download(
            download,
        )
    }

    // =========================================================
    // DOWNLOAD CONTROLLERS
    // =========================================================

    /// Obtiene el controlador asociado a una descarga.
    ///
    /// Devuelve una referencia al mismo controlador compartido
    /// que utiliza el worker cuando recibe un `clone()`.
    pub fn get_controller(
        &self,
        id: &str,
    ) -> Option<&DownloadController> {
        self.controllers.get(id)
    }

    /// Obtiene una copia del controlador asociado a una descarga.
    ///
    /// El controlador utiliza `Arc`, por lo que el valor devuelto
    /// continúa apuntando al mismo estado compartido.
    pub fn controller(
        &self,
        id: &str,
    ) -> Option<DownloadController> {
        self.controllers
            .get(id)
            .cloned()
    }

    /// Pausa una descarga activa.
    pub fn pause_download(
        &self,
        id: &str,
    ) -> bool {

        if let Some(controller) =
            self.controllers.get(id)
        {
            controller.pause();
            return true;
        }

        false
    }

    /// Reanuda una descarga pausada.
    pub fn resume_download(
        &self,
        id: &str,
    ) -> bool {

        if let Some(controller) =
            self.controllers.get(id)
        {
            controller.resume();
            return true;
        }

        false
    }

    /// Solicita la cancelación de una descarga activa.
    pub fn request_cancel(
        &self,
        id: &str,
    ) -> bool {

        if let Some(controller) =
            self.controllers.get(id)
        {
            controller.cancel();
            return true;
        }

        false
    }

    /// Comprueba si una descarga está pausada.
    pub fn is_paused(
        &self,
        id: &str,
    ) -> bool {

        self.controllers
            .get(id)
            .map(
                |controller| {
                    controller.is_paused()
                },
            )
            .unwrap_or(false)
    }

    /// Comprueba si una descarga fue cancelada.
    pub fn is_cancelled(
        &self,
        id: &str,
    ) -> bool {

        self.controllers
            .get(id)
            .map(
                |controller| {
                    controller.is_cancelled()
                },
            )
            .unwrap_or(false)
    }

    // =========================================================
    // DOWNLOADER DETECTION
    // =========================================================

    /// Determina qué descargador puede procesar una URL.
    ///
    /// Devuelve `None` cuando ninguna fuente reconoce la URL.
    pub fn downloader_for_url(
        &self,
        url: &str,
    ) -> Option<&dyn Downloader> {

        if self
            .youtube_downloader
            .supports_url(url)
        {
            return Some(
                &self.youtube_downloader
                    as &dyn Downloader
            );
        }

        if self
            .newgrounds_downloader
            .supports_url(url)
        {
            return Some(
                &self.newgrounds_downloader
                    as &dyn Downloader
            );
        }

        None
    }

    /// Determina automáticamente el origen de una URL.
    ///
    /// Esta función permite identificar la plataforma sin que
    /// el código que utiliza el manager tenga que conocer
    /// directamente los descargadores.
    pub fn source_from_url(
        &self,
        url: &str,
    ) -> Option<DownloadSource> {

        if self
            .youtube_downloader
            .supports_url(url)
        {
            return Some(
                DownloadSource::YouTube
            );
        }

        if self
            .newgrounds_downloader
            .supports_url(url)
        {
            return Some(
                DownloadSource::Newgrounds
            );
        }

        None
    }

    // =========================================================
    // DOWNLOAD QUERIES
    // =========================================================

    /// Obtiene una descarga mediante su identificador.
    pub fn get_download(
        &self,
        id: &str,
    ) -> Option<&Download> {
        self.downloads.get(id)
    }

    /// Obtiene una descarga mutable mediante su identificador.
    pub fn get_download_mut(
        &mut self,
        id: &str,
    ) -> Option<&mut Download> {
        self.downloads.get_mut(id)
    }

    /// Obtiene el último estado de progreso conocido.
    pub fn get_progress(
        &self,
        id: &str,
    ) -> Option<&DownloadProgress> {
        self.progress.get(id)
    }

    // =========================================================
    // DOWNLOAD PROGRESS
    // =========================================================

    /// Actualiza el estado de progreso de una descarga.
    ///
    /// El progreso se almacena tanto en el registro detallado
    /// como en el modelo principal de la descarga.
    pub fn update_progress(
        &mut self,
        id: &str,
        progress: DownloadProgress,
    ) -> bool {

        if !self.downloads.contains_key(id) {
            return false;
        }

        if let Some(download) =
            self.downloads.get_mut(id)
        {
            download.set_progress(
                progress.progress,
            );
        }

        self.progress.insert(
            id.to_string(),
            progress,
        );

        true
    }

    // =========================================================
    // DOWNLOAD STATE
    // =========================================================

    /// Marca una descarga como completada.
    pub fn complete_download(
        &mut self,
        id: &str,
        output_path: String,
    ) -> bool {

        if let Some(download) =
            self.downloads.get_mut(id)
        {
            download.complete(
                output_path,
            );

            self.progress.insert(
                id.to_string(),
                DownloadProgress::new(
                    100.0,
                    "completed",
                    "Descarga completada.",
                ),
            );

            self.controllers.remove(id);

            return true;
        }

        false
    }

    /// Marca una descarga como fallida.
    pub fn fail_download(
        &mut self,
        id: &str,
        error: String,
    ) -> bool {

        if let Some(download) =
            self.downloads.get_mut(id)
        {
            download.fail(
                error.clone(),
            );

            self.progress.insert(
                id.to_string(),
                DownloadProgress::new(
                    download.progress,
                    "error",
                    error,
                ),
            );

            self.controllers.remove(id);

            return true;
        }

        false
    }

    /// Marca una descarga como cancelada.
    ///
    /// Primero solicita la cancelación al controller para que
    /// el worker pueda detener la operación.
    ///
    /// `cancelled` pertenece al estado de la descarga, no a su
    /// etapa de progreso. Por eso conservamos como stage la
    /// última etapa válida conocida.
    pub fn cancel_download(
        &mut self,
        id: &str,
    ) -> bool {

        if let Some(controller) =
            self.controllers.get(id)
        {
            controller.cancel();
        }

        if let Some(download) =
            self.downloads.get_mut(id)
        {
            download.cancel();

            let stage =
                self.progress
                    .get(id)
                    .map(
                        |progress| {
                            progress.stage.clone()
                        },
                    )
                    .unwrap_or_else(
                        || "downloading".to_string()
                    );

            self.progress.insert(
                id.to_string(),
                DownloadProgress::new(
                    download.progress,
                    stage,
                    "Descarga cancelada.",
                ),
            );

            return true;
        }

        false
    }

    // =========================================================
    // DOWNLOAD MANAGEMENT
    // =========================================================

    /// Elimina una descarga del administrador.
    ///
    /// También elimina su información de progreso y su
    /// controlador asociado.
    pub fn remove_download(
        &mut self,
        id: &str,
    ) -> Option<Download> {

        self.progress.remove(id);

        self.controllers.remove(id);

        self.downloads.remove(id)
    }

    /// Devuelve la cantidad de descargas registradas.
    pub fn download_count(
        &self,
    ) -> usize {
        self.downloads.len()
    }

    /// Comprueba si existe una descarga con el identificador
    /// proporcionado.
    pub fn contains(
        &self,
        id: &str,
    ) -> bool {
        self.downloads.contains_key(id)
    }

    // =========================================================
    // STORAGE PATHS
    // =========================================================

    /// Genera una ruta para un archivo de descarga.
    ///
    /// Esta función solamente construye la ruta. No crea ni
    /// descarga físicamente el archivo.
    pub fn download_path(
        &self,
        file_name: impl AsRef<Path>,
    ) -> PathBuf {
        self.storage
            .download_file(file_name)
    }

    /// Genera una ruta para un archivo musical.
    ///
    /// Esta será la ubicación definitiva que utilizará Musex
    /// para almacenar las canciones.
    pub fn music_path(
        &self,
        file_name: impl AsRef<Path>,
    ) -> PathBuf {
        self.storage
            .music_file(file_name)
    }
}

// =============================================================
// FLUJO DEL DOWNLOAD MANAGER
// =============================================================
//
// El manager coordina:
//
// Angular
//    ↓
// Tauri Command
//    ↓
// DownloadManager
//    │
//    ├── DownloadController
//    │        ↓
//    │      Worker
//    │
//    ↓
// Downloader
//    ├── YouTubeDownloader
//    └── NewgroundsDownloader
//          ↓
//     DownloadProgress
//          ↓
//    DownloadManager
//
// Cada descarga posee su propio DownloadController.
//
// El controller utiliza Arc<AtomicBool>, permitiendo que el
// manager y el worker compartan el mismo estado de control.
//
// =============================================================