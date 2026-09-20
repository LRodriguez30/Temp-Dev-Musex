// =============================================================
// MUSEX - NEWGROUNDS DOWNLOADER
// =============================================================
//
// Implementación del descargador específico para Newgrounds.
//
// Responsabilidades:
//
// - Validar la URL.
// - Obtener información de la pista.
// - Obtener el enlace oficial de descarga.
// - Determinar el tamaño real del archivo cuando el servidor
//   lo proporciona.
// - Descargar el archivo por bloques.
// - Reanudar automáticamente una descarga interrumpida mediante
//   solicitudes HTTP Range.
// - Reportar el progreso real basado en bytes recibidos.
// - Escribir metadata.
// - Validar el archivo generado.
// - Devolver la ubicación del archivo.
//
// El downloader permanece independiente de la lógica de Tauri.
// El `AppHandle` recibido por el trait se ignora porque Newgrounds
// utiliza directamente HTTP mediante `reqwest`.
//
// La comunicación del progreso se realiza mediante el callback
// proporcionado por el trait `Downloader`.
//
// El control de la descarga se realiza mediante
// `DownloadController`.
//
// IMPORTANTE:
//
// El porcentaje de descarga nunca se calcula mediante un tiempo
// estimado ni mediante un incremento artificial.
//
// Cuando conocemos el tamaño total:
//
//     bytes recibidos / bytes totales
//
// Cuando el servidor no proporciona el tamaño total, no es posible
// calcular un porcentaje real. En ese caso se conserva el último
// porcentaje conocido.
//
// Si la conexión se interrumpe durante la transferencia y el
// servidor permite Range, se continúa desde el último byte
// realmente escrito en el archivo temporal `.part`.
// =============================================================

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use reqwest::blocking::{Client, Response};
use reqwest::header::CONTENT_RANGE;
use tauri::AppHandle;

use crate::audio::metadata::write_metadata;

use crate::downloads::download_manager::DownloadController;

use crate::downloads::downloader::{
    DownloadControlResult,
    DownloadError,
    DownloadProgress,
    DownloadResult,
    Downloader,
};

use crate::downloads::newgrounds::NewgroundsAudio;
use crate::models::download::Download;

// =============================================================
// CONSTANTS
// =============================================================

/// Cantidad máxima de veces que intentaremos reanudar una
/// transferencia después de una interrupción del stream.
const MAX_RESUME_ATTEMPTS: u32 = 3;

/// Tiempo de espera antes de intentar reanudar la transferencia.
const RESUME_DELAY: Duration = Duration::from_millis(750);

/// Intervalo mínimo entre eventos de progreso.
const PROGRESS_EVENT_INTERVAL: Duration = Duration::from_millis(100);

// =============================================================
// NEWGROUNDS DOWNLOADER
// =============================================================

/// Descargador específico para pistas de Newgrounds.
#[derive(Debug)]
pub struct NewgroundsDownloader {
    client: Client,
}

impl Default for NewgroundsDownloader {
    fn default() -> Self {
        Self::new()
    }
}

impl NewgroundsDownloader {
    /// Crea un nuevo descargador de Newgrounds.
    ///
    /// El cliente HTTP se reutiliza durante las operaciones para
    /// evitar crear una conexión completamente nueva cada vez.
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent("Musex/0.1")
            .build()
            .expect("No se pudo crear el cliente HTTP.");

        Self { client }
    }

    /// Analiza una URL y devuelve la información de la pista.
    pub fn parse_url(
        &self,
        url: &str,
    ) -> Result<NewgroundsAudio, String> {
        NewgroundsAudio::from_url(url)
    }

    /// Obtiene el contenido HTML de una página de Newgrounds.
    fn fetch_page(
        &self,
        url: &str,
    ) -> Result<String, DownloadError> {
        let response = self
            .client
            .get(url)
            .send()
            .map_err(|error| {
                DownloadError::Other(Box::new(error))
            })?
            .error_for_status()
            .map_err(|error| {
                DownloadError::Other(Box::new(error))
            })?;

        let html = response
            .text()
            .map_err(|error| {
                DownloadError::Other(Box::new(error))
            })?;

        Ok(html)
    }

    /// Obtiene el título de la pista desde la página.
    fn find_title(
        &self,
        page_url: &str,
    ) -> Result<String, DownloadError> {
        let html = self.fetch_page(page_url)?;

        let marker = "<title>";

        let start = html
            .find(marker)
            .ok_or_else(|| {
                DownloadError::Other(Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "No se pudo encontrar el título de la pista en Newgrounds.",
                    ),
                ))
            })?;

        let start = start + marker.len();

        let remaining = &html[start..];

        let end = remaining
            .find("</title>")
            .ok_or_else(|| {
                DownloadError::Other(Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "No se pudo determinar el final del título de la pista.",
                    ),
                ))
            })?;

        let mut title = remaining[..end]
            .trim()
            .to_string();

        if let Some(position) = title.find(" - Newgrounds.com") {
            title.truncate(position);
        }

        title = title
            .trim()
            .to_string();

        if title.is_empty() {
            return Err(DownloadError::Other(Box::new(
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Newgrounds devolvió un título vacío.",
                ),
            )));
        }

        Ok(title)
    }

    /// Obtiene el nombre del autor de la pista.
    fn find_artist(
        &self,
        page_url: &str,
    ) -> Result<String, DownloadError> {
        let html = self.fetch_page(page_url)?;

        let marker = r#"<div class="authorlinks">"#;

        let start = html
            .find(marker)
            .ok_or_else(|| {
                DownloadError::Other(Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "No se pudo encontrar la información del artista en Newgrounds.",
                    ),
                ))
            })?;

        let remaining = &html[start..];

        let role_marker = r#"<em>Artist</em>"#;

        let role_position = remaining
            .find(role_marker)
            .ok_or_else(|| {
                DownloadError::Other(Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "No se pudo identificar al artista de la pista.",
                    ),
                ))
            })?;

        let before_role = &remaining[..role_position];

        let href_marker = "<a href=\"";

        let href_start = before_role
            .rfind(href_marker)
            .ok_or_else(|| {
                DownloadError::Other(Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "No se pudo encontrar el enlace del artista.",
                    ),
                ))
            })?;

        let href_start = href_start + href_marker.len();

        let href_remaining = &before_role[href_start..];

        let href_end = href_remaining
            .find('"')
            .ok_or_else(|| {
                DownloadError::Other(Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "No se pudo determinar el enlace del artista.",
                    ),
                ))
            })?;

        let artist_url = &href_remaining[..href_end];

        let artist = artist_url
            .strip_prefix("https://")
            .and_then(|value| value.split('.').next())
            .ok_or_else(|| {
                DownloadError::Other(Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "No se pudo obtener el nombre del artista.",
                    ),
                ))
            })?;

        if artist.is_empty() {
            return Err(DownloadError::Other(Box::new(
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Newgrounds devolvió un artista vacío.",
                ),
            )));
        }

        Ok(artist.to_string())
    }

    /// Obtiene el género de la pista.
    fn find_genre(
        &self,
        page_url: &str,
    ) -> Result<String, DownloadError> {
        let html = self.fetch_page(page_url)?;

        let marker = "<dt>Genre</dt>";

        let start = html
            .find(marker)
            .ok_or_else(|| {
                DownloadError::Other(Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "No se pudo encontrar el género de la pista en Newgrounds.",
                    ),
                ))
            })?;

        let remaining = &html[start + marker.len()..];

        let link_start = remaining
            .find("<a")
            .ok_or_else(|| {
                DownloadError::Other(Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "No se pudo encontrar el enlace del género.",
                    ),
                ))
            })?;

        let remaining = &remaining[link_start..];

        let content_start = remaining
            .find('>')
            .ok_or_else(|| {
                DownloadError::Other(Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "No se pudo determinar el contenido del género.",
                    ),
                ))
            })?;

        let remaining = &remaining[content_start + 1..];

        let content_end = remaining
            .find("</a>")
            .ok_or_else(|| {
                DownloadError::Other(Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "No se pudo determinar el final del género.",
                    ),
                ))
            })?;

        let genre = remaining[..content_end]
            .trim()
            .to_string();

        if genre.is_empty() {
            return Err(DownloadError::Other(Box::new(
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Newgrounds devolvió un género vacío.",
                ),
            )));
        }

        Ok(genre)
    }

    /// Obtiene la URL oficial de descarga de una pista.
    pub fn find_download_url(
        &self,
        page_url: &str,
    ) -> Result<String, DownloadError> {
        let html = self.fetch_page(page_url)?;

        let marker = "/audio/download/";

        let start = html
            .find(marker)
            .ok_or_else(|| {
                DownloadError::Other(Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "La página no contiene un enlace de descarga. \
                         Es posible que el autor no permita descargar esta pista.",
                    ),
                ))
            })?;

        let remaining = &html[start..];

        let end = remaining
            .find('"')
            .or_else(|| remaining.find('\''))
            .ok_or_else(|| {
                DownloadError::Other(Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "No se pudo determinar el final del enlace de descarga.",
                    ),
                ))
            })?;

        let relative_url = &remaining[..end];

        let download_url = format!(
            "https://www.newgrounds.com{}",
            relative_url
        );

        Ok(download_url)
    }

    // =========================================================
    // FILE SIZE
    // =========================================================

    /// Intenta obtener el tamaño real del archivo mediante HEAD.
    fn find_remote_file_size(
        &self,
        download_url: &str,
        page_url: &str,
    ) -> Option<u64> {
        let response = self
            .client
            .head(download_url)
            .header("Referer", page_url)
            .header(
                "Accept",
                "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
            )
            .send()
            .ok()?;

        if !response.status().is_success() {
            return None;
        }

        response.content_length()
    }

    // =========================================================
    // HTTP DOWNLOAD
    // =========================================================

    /// Abre una nueva solicitud HTTP para descargar el archivo.
    ///
    /// Cuando `start_byte` es cero se realiza una descarga normal.
    ///
    /// Cuando `start_byte` es mayor que cero se utiliza:
    ///
    ///     Range: bytes=start_byte-
    ///
    /// Esto permite continuar una descarga que fue interrumpida.
    fn request_download(
        &self,
        download_url: &str,
        page_url: &str,
        start_byte: u64,
    ) -> Result<Response, DownloadError> {
        let mut request = self
            .client
            .get(download_url)
            .header("Referer", page_url)
            .header(
                "Accept",
                "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
            );

        if start_byte > 0 {
            request = request.header(
                "Range",
                format!("bytes={}-", start_byte),
            );
        }

        let response = request
            .send()
            .map_err(|error| {
                DownloadError::Other(Box::new(error))
            })?;

        Ok(response)
    }

    /// Valida la respuesta HTTP utilizada para continuar
    /// una descarga.
    fn validate_resume_response(
        response: &Response,
        start_byte: u64,
    ) -> Result<(), DownloadError> {
        if !response.status().is_success() {
            return Err(DownloadError::Other(Box::new(
                std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!(
                        "Newgrounds rechazó la descarga: HTTP {}.",
                        response.status()
                    ),
                ),
            )));
        }

        if start_byte == 0 {
            return Ok(());
        }

        if response.status().as_u16() != 206 {
            return Err(DownloadError::Other(Box::new(
                std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!(
                        "Newgrounds no permite reanudar la descarga: \
                         se solicitó Range desde {} bytes, pero el servidor \
                         respondió HTTP {}.",
                        start_byte,
                        response.status()
                    ),
                ),
            )));
        }

        let content_range = response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| {
                DownloadError::Other(Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "Newgrounds respondió 206 pero no proporcionó Content-Range.",
                    ),
                ))
            })?;

        let expected_prefix = format!(
            "bytes {}-",
            start_byte
        );

        if !content_range.starts_with(&expected_prefix) {
            return Err(DownloadError::Other(Box::new(
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!(
                        "El Content-Range de Newgrounds no coincide \
                         con el byte solicitado: {}.",
                        content_range
                    ),
                ),
            )));
        }

        Ok(())
    }
}

// =============================================================
// DOWNLOADER IMPLEMENTATION
// =============================================================

impl Downloader for NewgroundsDownloader {
    /// Ejecuta una descarga de Newgrounds.
    ///
    /// El progreso se calcula exclusivamente a partir de bytes
    /// realmente escritos en el archivo temporal.
    ///
    /// Si la conexión se interrumpe:
    ///
    ///     archivo.part
    ///          ↓
    ///     bytes existentes
    ///          ↓
    ///     Range: bytes=N-
    ///          ↓
    ///     continuar
    ///
    /// El archivo definitivo `.mp3` solamente se genera una vez
    /// que todos los bytes esperados fueron recibidos y validados.
    fn download(
        &self,
        _app: &AppHandle,
        download: &Download,
        output_path: &Path,
        controller: &DownloadController,
        progress_callback: &mut dyn FnMut(DownloadProgress),
    ) -> Result<DownloadResult, DownloadError> {
        // -----------------------------------------------------
        // Preparar descarga
        // -----------------------------------------------------

        progress_callback(
            DownloadProgress::new(
                0.0,
                "preparing",
                "Preparando descarga...",
            ),
        );

        // -----------------------------------------------------
        // Validar URL
        // -----------------------------------------------------

        let audio = self
            .parse_url(&download.url)
            .map_err(|error| {
                DownloadError::Other(Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        format!(
                            "URL de Newgrounds no válida: {}",
                            error
                        ),
                    ),
                ))
            })?;

        // -----------------------------------------------------
        // Obtener información
        // -----------------------------------------------------

        progress_callback(
            DownloadProgress::new(
                2.0,
                "fetching",
                "Obteniendo información de la pista...",
            ),
        );

        let title = self.find_title(&download.url)?;

        println!(
            "Título detectado: {}",
            title
        );

        let artist = self.find_artist(&download.url)?;

        println!(
            "Artista detectado: {}",
            artist
        );

        let genre = self.find_genre(&download.url)?;

        println!(
            "Género detectado: {}",
            genre
        );

        // -----------------------------------------------------
        // Preparar nombre del archivo
        // -----------------------------------------------------

        let file_name = sanitize_filename(&title);

        let output_path = output_path.join(
            format!(
                "{}.mp3",
                file_name
            ),
        );

        // -----------------------------------------------------
        // Archivo temporal
        // -----------------------------------------------------

        let part_path = output_path.with_extension("mp3.part");

        println!();
        println!(
            "Preparando descarga de Newgrounds: {}",
            audio.audio_id
        );

        // -----------------------------------------------------
        // Obtener enlace oficial
        // -----------------------------------------------------

        let download_url = self.find_download_url(&download.url)?;

        println!();
        println!(
            "Enlace oficial encontrado:"
        );

        println!(
            "{}",
            download_url
        );

        // -----------------------------------------------------
        // Preparar directorio
        // -----------------------------------------------------

        if let Some(parent) = output_path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)
                    .map_err(|error| {
                        DownloadError::Other(Box::new(error))
                    })?;
            }
        }

        // -----------------------------------------------------
        // Obtener tamaño remoto
        // -----------------------------------------------------

        let head_size = self.find_remote_file_size(
            &download_url,
            &download.url,
        );

        if let Some(size) = head_size {
            println!();
            println!(
                "Tamaño informado por Newgrounds: {} bytes",
                size
            );
        } else {
            println!();
            println!(
                "Newgrounds no informó el tamaño mediante HEAD."
            );
        }

        // -----------------------------------------------------
        // Determinar tamaño del archivo temporal
        // -----------------------------------------------------

        let mut downloaded_bytes = if part_path.is_file() {
            fs::metadata(&part_path)
                .map_err(|error| {
                    DownloadError::Other(Box::new(error))
                })?
                .len()
        } else {
            0
        };

        // -----------------------------------------------------
        // Protección contra archivo temporal inválido
        // -----------------------------------------------------

        if let Some(total) = head_size {
            if total > 0 && downloaded_bytes > total {
                println!();
                println!(
                    "El archivo temporal supera el tamaño esperado."
                );

                println!(
                    "Temporal: {} bytes",
                    downloaded_bytes
                );

                println!(
                    "Esperado: {} bytes",
                    total
                );

                println!(
                    "Reiniciando descarga temporal."
                );

                if part_path.is_file() {
                    fs::remove_file(&part_path)
                        .map_err(|error| {
                            DownloadError::Other(Box::new(error))
                        })?;
                }

                downloaded_bytes = 0;
            }
        }

        // -----------------------------------------------------
        // Comprobar controles antes de iniciar
        // -----------------------------------------------------

        if controller.is_cancelled() {
            return Err(
                DownloadError::Control(
                    DownloadControlResult::Cancelled,
                ),
            );
        }

        if controller.is_paused() {
            return Err(
                DownloadError::Control(
                    DownloadControlResult::Paused,
                ),
            );
        }

        // -----------------------------------------------------
        // Estado inicial de progreso
        // -----------------------------------------------------

        if downloaded_bytes > 0 {
            println!();
            println!(
                "Archivo temporal encontrado: {} bytes",
                downloaded_bytes
            );

            progress_callback(
                DownloadProgress::new(
                    calculate_progress(
                        downloaded_bytes,
                        head_size,
                    ),
                    "downloading",
                    format!(
                        "Reanudando descarga... {} recibidos",
                        format_bytes(downloaded_bytes)
                    ),
                ),
            );
        } else {
            progress_callback(
                DownloadProgress::new(
                    5.0,
                    "downloading",
                    "Conectando con el servidor...",
                ),
            );
        }

        println!();
        println!(
            "Descargando archivo..."
        );

        // -----------------------------------------------------
        // Variables de progreso
        // -----------------------------------------------------

        let mut last_progress = calculate_progress(
            downloaded_bytes,
            head_size,
        );

        let mut last_event = Instant::now();

        // -----------------------------------------------------
        // Transferencia con reanudación
        // -----------------------------------------------------

        let mut resume_attempts = 0_u32;

        loop {
            // -------------------------------------------------
            // Comprobar controles antes de cada petición.
            // -------------------------------------------------

            if controller.is_cancelled() {
                return Err(
                    DownloadError::Control(
                        DownloadControlResult::Cancelled,
                    ),
                );
            }

            if controller.is_paused() {
                return Err(
                    DownloadError::Control(
                        DownloadControlResult::Paused,
                    ),
                );
            }

            // -------------------------------------------------
            // Si ya tenemos todos los bytes, no necesitamos
            // realizar otra solicitud.
            // -------------------------------------------------

            if let Some(total) = head_size {
                if total > 0 && downloaded_bytes == total {
                    println!();
                    println!(
                        "Todos los bytes esperados ya fueron recibidos."
                    );

                    break;
                }
            }

            // -------------------------------------------------
            // Solicitar transferencia actual.
            // -------------------------------------------------

            let start_byte = downloaded_bytes;

            println!();

            if start_byte > 0 {
                println!(
                    "Reanudando desde byte {}...",
                    start_byte
                );
            } else {
                println!(
                    "Iniciando descarga desde el byte 0..."
                );
            }

            let mut response = self.request_download(
                &download_url,
                &download.url,
                start_byte,
            )?;

            // -------------------------------------------------
            // Validar respuesta HTTP.
            // -------------------------------------------------

            if let Err(error) = Self::validate_resume_response(
                &response,
                start_byte,
            ) {
                if start_byte > 0 {
                    return Err(match error {
                        DownloadError::Other(inner) => {
                            DownloadError::Other(Box::new(
                                std::io::Error::new(
                                    std::io::ErrorKind::Other,
                                    format!(
                                        "No se pudo reanudar la descarga de Newgrounds: {}",
                                        inner
                                    ),
                                ),
                            ))
                        }

                        control => control,
                    });
                }

                return Err(error);
            }

            // -------------------------------------------------
            // Obtener tamaño comunicado por GET.
            // -------------------------------------------------

            let response_size = response.content_length();

            let total_size = response_size
                .map(|size| {
                    if start_byte > 0 {
                        start_byte + size
                    } else {
                        size
                    }
                })
                .or(head_size);

            if let Some(total) = total_size {
                if total > 0 {
                    println!(
                        "Tamaño total confirmado: {} bytes",
                        total
                    );
                }
            } else {
                println!(
                    "El servidor no proporciona un tamaño total conocido."
                );
            }

            // -------------------------------------------------
            // Abrir archivo temporal.
            // -------------------------------------------------
            //
            // Si estamos reanudando, anexamos.
            //
            // Si comenzamos desde cero, creamos un archivo nuevo.
            // -------------------------------------------------

            let mut file = if start_byte > 0 {
                OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&part_path)
                    .map_err(|error| {
                        DownloadError::Other(Box::new(error))
                    })?
            } else {
                File::create(&part_path)
                    .map_err(|error| {
                        DownloadError::Other(Box::new(error))
                    })?
            };

            // -------------------------------------------------
            // Lectura por bloques.
            // -------------------------------------------------

            let mut buffer = [0u8; 64 * 1024];

            let mut stream_failed = false;

            loop {
                // -------------------------------------------------
                // Control durante la transferencia.
                // -------------------------------------------------

                if controller.is_cancelled() {
                    println!(
                        "[NEWGROUNDS] Cancelación solicitada."
                    );

                    drop(response);
                    drop(file);

                    return Err(
                        DownloadError::Control(
                            DownloadControlResult::Cancelled,
                        ),
                    );
                }

                if controller.is_paused() {
                    println!(
                        "[NEWGROUNDS] Pausa solicitada."
                    );

                    drop(response);
                    drop(file);

                    return Err(
                        DownloadError::Control(
                            DownloadControlResult::Paused,
                        ),
                    );
                }

                // -------------------------------------------------
                // Leer bloque.
                // -------------------------------------------------

                let bytes_read = match response.read(&mut buffer) {
                    Ok(bytes) => bytes,

                    Err(error) => {
                        println!();
                        println!(
                            "========================================"
                        );
                        println!(
                            "INTERRUPCIÓN DEL STREAM DE NEWGROUNDS"
                        );
                        println!(
                            "========================================"
                        );
                        println!(
                            "Bytes recibidos: {}",
                            downloaded_bytes
                        );

                        match total_size {
                            Some(total) => {
                                println!(
                                    "Bytes esperados: {}",
                                    total
                                );
                            }

                            None => {
                                println!(
                                    "Bytes esperados: desconocidos"
                                );
                            }
                        }

                        println!(
                            "Error HTTP: {}",
                            error
                        );

                        println!(
                            "========================================"
                        );
                        println!();

                        stream_failed = true;

                        break;
                    }
                };

                // -------------------------------------------------
                // Fin normal del stream.
                // -------------------------------------------------

                if bytes_read == 0 {
                    break;
                }

                // -------------------------------------------------
                // Escribir exactamente los bytes recibidos.
                // -------------------------------------------------

                file.write_all(&buffer[..bytes_read])
                    .map_err(|error| {
                        DownloadError::Other(Box::new(error))
                    })?;

                downloaded_bytes += bytes_read as u64;

                // -------------------------------------------------
                // Calcular progreso real.
                // -------------------------------------------------

                if let Some(total) = total_size {
                    if total > 0 {
                        if downloaded_bytes > total {
                            return Err(
                                DownloadError::Other(
                                    Box::new(
                                        std::io::Error::new(
                                            std::io::ErrorKind::InvalidData,
                                            format!(
                                                "Newgrounds envió más datos de los anunciados: \
                                                 {} bytes recibidos de {}.",
                                                downloaded_bytes,
                                                total
                                            ),
                                        ),
                                    ),
                                ),
                            );
                        }

                        last_progress = calculate_progress(
                            downloaded_bytes,
                            Some(total),
                        );
                    }
                }

                // -------------------------------------------------
                // Reportar progreso.
                // -------------------------------------------------

                if last_event.elapsed()
                    >= PROGRESS_EVENT_INTERVAL
                {
                    let message = match total_size {
                        Some(total) if total > 0 => {
                            format!(
                                "Descargando audio... {} de {}",
                                format_bytes(downloaded_bytes),
                                format_bytes(total)
                            )
                        }

                        _ => {
                            format!(
                                "Descargando audio... {} recibidos",
                                format_bytes(downloaded_bytes)
                            )
                        }
                    };

                    progress_callback(
                        DownloadProgress::new(
                            last_progress,
                            "downloading",
                            message,
                        ),
                    );

                    last_event = Instant::now();
                }
            }

            // -----------------------------------------------------
            // Cerrar archivo temporal antes de comprobar
            // si necesitamos reanudar.
            // -----------------------------------------------------

            file.flush()
                .map_err(|error| {
                    DownloadError::Other(Box::new(error))
                })?;

            drop(file);

            // -----------------------------------------------------
            // El stream terminó correctamente.
            // -----------------------------------------------------

            if !stream_failed {
                println!();
                println!(
                    "Stream finalizado correctamente."
                );

                println!(
                    "Bytes acumulados: {}",
                    downloaded_bytes
                );

                break;
            }

            // -----------------------------------------------------
            // El stream falló.
            // -----------------------------------------------------
            //
            // No borramos el archivo.
            //
            // Los bytes ya escritos son válidos y podrán utilizarse
            // para continuar.
            // -----------------------------------------------------

            if let Some(total) = total_size {
                if total > 0 && downloaded_bytes >= total {
                    break;
                }
            }

            resume_attempts += 1;

            if resume_attempts > MAX_RESUME_ATTEMPTS {
                return Err(
                    DownloadError::Other(
                        Box::new(
                            std::io::Error::new(
                                std::io::ErrorKind::Interrupted,
                                format!(
                                    "Newgrounds interrumpió la descarga después de {} \
                                     intentos de reanudación. Se recibieron {} bytes.",
                                    MAX_RESUME_ATTEMPTS,
                                    downloaded_bytes
                                ),
                            ),
                        ),
                    ),
                );
            }

            println!();
            println!(
                "La conexión fue interrumpida."
            );

            println!(
                "Intentando reanudar ({}/{})...",
                resume_attempts,
                MAX_RESUME_ATTEMPTS
            );

            println!(
                "Bytes conservados: {}",
                downloaded_bytes
            );

            progress_callback(
                DownloadProgress::new(
                    last_progress,
                    "downloading",
                    format!(
                        "Conexión interrumpida. Reanudando... {} recibidos",
                        format_bytes(downloaded_bytes)
                    ),
                ),
            );

            std::thread::sleep(RESUME_DELAY);
        }

        // -----------------------------------------------------
        // Último evento de descarga.
        // -----------------------------------------------------

        let final_download_message = match head_size {
            Some(total) if total > 0 => {
                format!(
                    "Descarga recibida: {} de {}",
                    format_bytes(downloaded_bytes),
                    format_bytes(total)
                )
            }

            _ => {
                format!(
                    "Descarga recibida: {}",
                    format_bytes(downloaded_bytes)
                )
            }
        };

        progress_callback(
            DownloadProgress::new(
                last_progress,
                "downloading",
                final_download_message,
            ),
        );

        // -----------------------------------------------------
        // Validar archivo temporal.
        // -----------------------------------------------------

        let file_size = fs::metadata(&part_path)
            .map_err(|error| {
                DownloadError::Other(Box::new(error))
            })?
            .len();

        if file_size == 0 {
            return Err(
                DownloadError::Other(
                    Box::new(
                        std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            "Newgrounds devolvió un archivo vacío.",
                        ),
                    ),
                ),
            );
        }

        // -----------------------------------------------------
        // Validar tamaño esperado.
        // -----------------------------------------------------

        if let Some(total) = head_size {
            if total > 0 && file_size != total {
                return Err(
                    DownloadError::Other(
                        Box::new(
                            std::io::Error::new(
                                std::io::ErrorKind::UnexpectedEof,
                                format!(
                                    "La descarga quedó incompleta: \
                                     se recibieron {} bytes de {} esperados.",
                                    file_size,
                                    total
                                ),
                            ),
                        ),
                    ),
                );
            }
        }

        // -----------------------------------------------------
        // Validación adicional.
        // -----------------------------------------------------

        if file_size != downloaded_bytes {
            return Err(
                DownloadError::Other(
                    Box::new(
                        std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            format!(
                                "El archivo temporal no coincide con los datos recibidos: \
                                 archivo={} bytes, recibidos={} bytes.",
                                file_size,
                                downloaded_bytes
                            ),
                        ),
                    ),
                ),
            );
        }

        println!();
        println!(
            "Bytes recibidos: {}",
            downloaded_bytes
        );

        println!(
            "Tamaño físico del archivo temporal: {} bytes",
            file_size
        );

        // -----------------------------------------------------
        // Si conocemos el tamaño total, exigir coincidencia.
        // -----------------------------------------------------

        if let Some(total) = head_size {
            if total > 0 && downloaded_bytes != total {
                return Err(
                    DownloadError::Other(
                        Box::new(
                            std::io::Error::new(
                                std::io::ErrorKind::UnexpectedEof,
                                format!(
                                    "La descarga no alcanzó el tamaño esperado: \
                                     {} de {} bytes.",
                                    downloaded_bytes,
                                    total
                                ),
                            ),
                        ),
                    ),
                );
            }
        }

        // -----------------------------------------------------
        // Renombrar archivo temporal.
        // -----------------------------------------------------
        //
        // A partir de este punto sabemos que la transferencia
        // terminó y que el tamaño físico es correcto.
        //
        // El archivo definitivo solamente aparece después de
        // esta validación.
        // -----------------------------------------------------

        if output_path.is_file() {
            fs::remove_file(&output_path)
                .map_err(|error| {
                    DownloadError::Other(Box::new(error))
                })?;
        }

        fs::rename(
            &part_path,
            &output_path,
        )
        .map_err(|error| {
            DownloadError::Other(Box::new(error))
        })?;

        // -----------------------------------------------------
        // Metadata
        // -----------------------------------------------------

        progress_callback(
            DownloadProgress::new(
                96.0,
                "saving",
                "Guardando metadata...",
            ),
        );

        match write_metadata(
            &output_path,
            &title,
            Some(&artist),
            Some("Newgrounds"),
            Some(&genre),
            None,
        ) {
            Ok(_) => {
                println!(
                    "Metadata escrita correctamente."
                );
            }

            Err(error) => {
                println!();
                println!(
                    "La descarga del archivo fue correcta,"
                );

                println!(
                    "pero no se pudo escribir la metadata."
                );

                println!(
                    "Error de metadata: {}",
                    error
                );

                println!();
            }
        }

        // -----------------------------------------------------
        // Finalizar
        // -----------------------------------------------------

        println!();
        println!(
            "Archivo descargado correctamente."
        );

        println!(
            "Ruta: {}",
            output_path.display()
        );

        println!(
            "Tamaño: {} bytes",
            file_size
        );

        progress_callback(
            DownloadProgress::new(
                100.0,
                "completed",
                "Descarga completada.",
            ),
        );

        Ok(
            DownloadResult::new(
                output_path,
            )
        )
    }

    /// Comprueba si la URL puede ser procesada por este
    /// descargador.
    fn supports_url(
        &self,
        url: &str,
    ) -> bool {
        NewgroundsAudio::from_url(url).is_ok()
    }
}

// =============================================================
// PROGRESS
// =============================================================

/// Calcula el progreso de la fase de descarga.
///
/// La descarga ocupa desde el 5% hasta el 95% del proceso total.
///
/// El cálculo interno siempre utiliza bytes reales.
///
/// Si no conocemos el tamaño total, se conserva el 5% como mínimo
/// porque no existe información suficiente para calcular un
/// porcentaje real.
fn calculate_progress(
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
) -> f32 {
    let Some(total) = total_bytes else {
        return 5.0;
    };

    if total == 0 {
        return 5.0;
    }

    let ratio =
        downloaded_bytes as f64
            / total as f64;

    let progress =
        5.0
            + (ratio * 90.0) as f32;

    progress.clamp(
        5.0,
        95.0,
    )
}

// =============================================================
// BYTE FORMAT
// =============================================================

/// Convierte una cantidad de bytes en una representación
/// legible para mostrar el progreso de descarga.
fn format_bytes(
    bytes: u64,
) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;

    let bytes_f64 = bytes as f64;

    if bytes_f64 >= GB {
        format!(
            "{:.2} GB",
            bytes_f64 / GB
        )
    } else if bytes_f64 >= MB {
        format!(
            "{:.2} MB",
            bytes_f64 / MB
        )
    } else if bytes_f64 >= KB {
        format!(
            "{:.2} KB",
            bytes_f64 / KB
        )
    } else {
        format!(
            "{} B",
            bytes
        )
    }
}

// =============================================================
// SANITIZE FILENAME
// =============================================================

/// Limpia un título para convertirlo en un nombre de archivo válido.
///
/// Se eliminan caracteres que pueden provocar problemas en Windows
/// y se evita generar nombres vacíos o terminados en espacios/puntos.
fn sanitize_filename(
    title: &str,
) -> String {
    let invalid_characters = [
        '<',
        '>',
        ':',
        '"',
        '/',
        '\\',
        '|',
        '?',
        '*',
    ];

    let sanitized: String = title
        .chars()
        .map(|character| {
            if invalid_characters.contains(&character) {
                '_'
            } else {
                character
            }
        })
        .collect();

    let sanitized = sanitized
        .trim()
        .trim_end_matches('.')
        .trim()
        .to_string();

    if sanitized.is_empty() {
        "Sin título".to_string()
    } else {
        sanitized
    }
}

// =============================================================
// FLUJO DE PROGRESO Y REANUDACIÓN
// =============================================================
//
// Newgrounds
//     ↓
// Página de la pista
//     ↓
// Metadata
//     ↓
// URL oficial de descarga
//     ↓
// HEAD
//     ↓
// Tamaño total
//     ↓
// GET
//     ↓
// bytes reales
//     ↓
// archivo .part
//     ↓
// ¿stream interrumpido?
//     │
//     ├── NO ────────────────┐
//     │                      │
//     └── SÍ                 │
//          ↓                 │
//       Range: N-            │
//          ↓                 │
//       continuar            │
//          └─────────────────┘
//                 ↓
//       validar tamaño
//                 ↓
//       renombrar .part → .mp3
//                 ↓
//       metadata
//                 ↓
//       completado
//
// El porcentaje nunca se estima mediante tiempo.
//
// Si:
//
//     total = 8,705,729
//     recibidos = 8,666,983
//
// entonces:
//
//     faltan = 38,746 bytes
//
// y la siguiente petición será conceptualmente:
//
//     Range: bytes=8666983-
//
// De esta forma Musex no vuelve a descargar los 8.66 MB
// que ya recibió correctamente.
//
// -------------------------------------------------------------
//
// CONTROL DE DESCARGA
// -------------------------------------------------------------
//
// Mientras el archivo se está descargando:
//
//     controller.is_paused()
//             ↓
//          Paused
//
//     controller.is_cancelled()
//             ↓
//         Cancelled
//
// Una pausa conserva:
//
//     archivo.mp3.part
//
// Una cancelación detiene la operación y devuelve:
//
//     DownloadError::Control(Cancelled)
//
// La decisión de eliminar el `.part` queda a cargo de la capa
// superior de gestión de descargas.
// =============================================================