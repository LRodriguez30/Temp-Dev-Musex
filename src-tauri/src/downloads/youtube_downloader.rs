// =============================================================
// MUSEX - YOUTUBE DOWNLOADER
// =============================================================
//
// Implementación del descargador específico para YouTube.
//
// Utiliza `yt-dlp` como motor externo para obtener el contenido
// y convertirlo a audio.
//
// Responsabilidades:
//
// - Validar la URL.
// - Preparar la ruta de salida.
// - Ejecutar yt-dlp.
// - Leer su salida en tiempo real.
// - Reportar el progreso real de descarga.
// - Generar el archivo MP3 con metadata.
// - Comprobar el resultado.
// - Devolver la ubicación del archivo generado.
//
// El porcentaje de descarga se calcula a partir de los bytes
// reales cuando yt-dlp proporciona el tamaño total.
//
// Además, se muestran mensajes de diagnóstico en consola para
// comprobar el comportamiento de yt-dlp durante las pruebas.
//
// La ejecución continúa siendo síncrona dentro de este módulo.
// Tauri se encarga posteriormente de ejecutarla dentro de un
// worker para no bloquear la interfaz.
// =============================================================

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::SystemTime;

use crate::downloads::download_manager::DownloadController;

use crate::downloads::downloader::{DownloadError, DownloadProgress, DownloadResult, Downloader};

use crate::downloads::youtube::YouTubeVideo;
use crate::models::download::Download;

// =============================================================
// YOUTUBE DOWNLOADER
// =============================================================

/// Descargador específico para contenido de YouTube.
#[derive(Debug, Default)]
pub struct YouTubeDownloader;

impl YouTubeDownloader {
    /// Crea un nuevo descargador de YouTube.
    pub fn new() -> Self {
        Self
    }

    /// Analiza y valida una URL de YouTube.
    pub fn parse_url(&self, url: &str) -> Result<YouTubeVideo, String> {
        YouTubeVideo::from_url(url)
    }
}

// =============================================================
// DOWNLOADER IMPLEMENTATION
// =============================================================

impl Downloader for YouTubeDownloader {
    /// Descarga contenido de YouTube y genera un archivo MP3.
    ///
    /// El progreso recibido desde `yt-dlp` se transforma en
    /// `DownloadProgress` y se entrega mediante el callback.
    fn download(
        &self,
        download: &Download,
        output_path: &Path,
        controller: &DownloadController,
        progress_callback: &mut dyn FnMut(DownloadProgress),
    ) -> Result<DownloadResult, DownloadError> {
        // -----------------------------------------------------
        // Preparar descarga
        // -----------------------------------------------------

        println!();
        println!("========================================");
        println!("MUSEX - INICIO DE DESCARGA DE YOUTUBE");
        println!("========================================");
        println!("URL: {}", download.url);
        println!("Directorio de salida: {}", output_path.display());
        println!();

        progress_callback(DownloadProgress::new(
            0.0,
            "preparing",
            "Preparando descarga...",
        ));

        // -----------------------------------------------------
        // Validar URL
        // -----------------------------------------------------

        let video = self.parse_url(&download.url).map_err(|error| {
            DownloadError::Other(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("URL de YouTube no válida: {}", error),
            )))
        })?;

        println!("[YOUTUBE] Video identificado: {}", video.video_id);

        progress_callback(DownloadProgress::new(
            2.0,
            "fetching",
            "Obteniendo información del contenido...",
        ));

        // -----------------------------------------------------
        // Preparar directorio de salida
        // -----------------------------------------------------

        fs::create_dir_all(output_path).map_err(|error| DownloadError::Other(Box::new(error)))?;

        println!(
            "[YOUTUBE] Directorio de salida preparado: {}",
            output_path.display()
        );

        // -----------------------------------------------------
        // Registrar archivos existentes
        // -----------------------------------------------------
        //
        // Guardamos los MP3 existentes antes de comenzar para
        // poder identificar posteriormente el archivo generado
        // por esta operación.
        // -----------------------------------------------------

        let output_directory = output_path;

        let existing_files = collect_mp3_files(output_directory)?;

        println!(
            "[YOUTUBE] Archivos MP3 existentes: {}",
            existing_files.len()
        );

        // -----------------------------------------------------
        // Preparar plantilla de salida
        // -----------------------------------------------------

        let output_template = output_directory.join("%(title)s.%(ext)s");

        println!(
            "[YOUTUBE] Plantilla de salida: {}",
            output_template.display()
        );

        // -----------------------------------------------------
        // Comprobar cancelación antes de iniciar yt-dlp
        // -----------------------------------------------------

        if controller.is_cancelled() {
            return Err(DownloadError::Control(
                crate::downloads::downloader::DownloadControlResult::Cancelled,
            ));
        }

        if controller.is_paused() {
            return Err(DownloadError::Control(
                crate::downloads::downloader::DownloadControlResult::Paused,
            ));
        }

        // -----------------------------------------------------
        // Ejecutar yt-dlp
        // -----------------------------------------------------

        println!();
        println!("[YOUTUBE] Ejecutando yt-dlp...");
        println!();

        let mut child =
            Command::new("yt-dlp")
                .arg("-x")
                .arg("--audio-format")
                .arg("mp3")
                .arg("--no-playlist")
                .arg("--newline")
                .arg("--restrict-filenames")

                // -------------------------------------------------
                // Control de archivos existentes
                // -------------------------------------------------
                //
                // Musex considera cada operación como una nueva
                // descarga. Por ello, yt-dlp no debe reutilizar
                // silenciosamente un MP3 existente.
                // -------------------------------------------------

                .arg("--force-overwrites")

                // -------------------------------------------------
                // Progress
                // -------------------------------------------------

                .arg("--progress-template")
                .arg(
                    "download:%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s",
                )

                // -------------------------------------------------
                // Metadata
                // -------------------------------------------------

                .arg("--parse-metadata")
                .arg(
                    "%(title)s:%(meta_title)s"
                )

                .arg("--parse-metadata")
                .arg(
                    "%(uploader)s:%(meta_artist)s"
                )

                .arg("--parse-metadata")
                .arg(
                    "%(album|)s:%(meta_album)s"
                )

                .arg("--parse-metadata")
                .arg(
                    "%(genre|)s:%(meta_genre)s"
                )

                .arg("--parse-metadata")
                .arg(
                    "%(upload_date|)s:%(meta_date)s"
                )

                .arg("--embed-metadata")

                // -------------------------------------------------
                // Salida
                // -------------------------------------------------

                .arg("-o")
                .arg(&output_template)

                .arg(&download.url)

                // -------------------------------------------------
                // Comunicación con Rust
                // -------------------------------------------------

                .stdout(
                    Stdio::piped()
                )

                .stderr(
                    Stdio::inherit()
                )

                .spawn()
                .map_err(|error| {
                    DownloadError::Other(
                        Box::new(
                            std::io::Error::new(
                                std::io::ErrorKind::NotFound,
                                format!(
                                    "No se pudo ejecutar yt-dlp. \
                                     Verifica que esté instalado y disponible \
                                     en el PATH del sistema. Detalle: {}",
                                    error
                                ),
                            )
                        )
                    )
                })?;

        // -----------------------------------------------------
        // Leer progreso
        // -----------------------------------------------------
        //
        // La salida estándar de yt-dlp se procesa línea por línea
        // mientras el proceso continúa ejecutándose.
        // -----------------------------------------------------

        println!("[YOUTUBE] Escuchando salida de yt-dlp...");

        if let Some(stdout) = child.stdout.take() {
            let mut reader = BufReader::new(stdout);

            let mut buffer = Vec::new();

            loop {
                // -------------------------------------------------
                // Comprobar controles
                // -------------------------------------------------

                if controller.is_cancelled() {
                    println!("[YOUTUBE] Cancelación solicitada.");

                    let _ = child.kill();

                    let _ = child.wait();

                    return Err(DownloadError::Control(
                        crate::downloads::downloader::DownloadControlResult::Cancelled,
                    ));
                }

                if controller.is_paused() {
                    println!("[YOUTUBE] Pausa solicitada.");

                    let _ = child.kill();

                    let _ = child.wait();

                    return Err(DownloadError::Control(
                        crate::downloads::downloader::DownloadControlResult::Paused,
                    ));
                }

                // -------------------------------------------------
                // Leer línea
                // -------------------------------------------------

                buffer.clear();

                let bytes_read = reader
                    .read_until(b'\n', &mut buffer)
                    .map_err(|error| DownloadError::Other(Box::new(error)))?;

                // -------------------------------------------------
                // Fin del stream
                // -------------------------------------------------

                if bytes_read == 0 {
                    break;
                }

                // -------------------------------------------------
                // Convertir línea
                // -------------------------------------------------
                //
                // yt-dlp puede generar bytes que no sean UTF-8 válido.
                // from_utf8_lossy() evita que esos bytes provoquen
                // el error:
                //
                // "stream did not contain valid UTF-8"
                //
                // Los bytes inválidos son reemplazados por �.
                // -------------------------------------------------

                let line = String::from_utf8_lossy(&buffer);

                let line = line.trim_end_matches(&['\r', '\n'][..]);

                // -------------------------------------------------
                // Diagnóstico
                // -------------------------------------------------

                println!("[YTDLP] {}", line);

                // -------------------------------------------------
                // Intentar interpretar progreso
                // -------------------------------------------------

                if let Some(progress) = parse_progress_line(line) {
                    println!(
                        "[YOUTUBE PROGRESS] \
                 stage={} | \
                 progress={:.2}% | \
                 downloaded={} bytes | \
                 total={:?} bytes | \
                 message={}",
                        progress.stage,
                        progress.progress,
                        progress.downloaded_bytes,
                        progress.total_bytes,
                        progress.message
                    );

                    // -------------------------------------------------
                    // Enviar progreso hacia Tauri
                    // -------------------------------------------------

                    progress_callback(progress);
                } else {
                    println!("[YOUTUBE] Línea no reconocida como progreso.");
                }
            }
        }

        // -----------------------------------------------------
        // Comprobar controles después de stdout
        // -----------------------------------------------------

        if controller.is_cancelled() {
            println!("[YOUTUBE] Cancelación solicitada.");

            let _ = child.kill();

            let _ = child.wait();

            return Err(DownloadError::Control(
                crate::downloads::downloader::DownloadControlResult::Cancelled,
            ));
        }

        if controller.is_paused() {
            println!("[YOUTUBE] Pausa solicitada.");

            let _ = child.kill();

            let _ = child.wait();

            return Err(DownloadError::Control(
                crate::downloads::downloader::DownloadControlResult::Paused,
            ));
        }

        // -----------------------------------------------------
        // Esperar finalización
        // -----------------------------------------------------

        println!();
        println!("[YOUTUBE] Esperando finalización de yt-dlp...");

        let status = child
            .wait()
            .map_err(|error| DownloadError::Other(Box::new(error)))?;

        println!("[YOUTUBE] yt-dlp finalizó con estado: {}", status);

        // -----------------------------------------------------
        // Comprobar controles después de finalizar
        // -----------------------------------------------------

        if controller.is_cancelled() {
            return Err(DownloadError::Control(
                crate::downloads::downloader::DownloadControlResult::Cancelled,
            ));
        }

        if controller.is_paused() {
            return Err(DownloadError::Control(
                crate::downloads::downloader::DownloadControlResult::Paused,
            ));
        }

        // -----------------------------------------------------
        // Comprobar resultado
        // -----------------------------------------------------

        if !status.success() {
            println!("[YOUTUBE] ERROR: yt-dlp no terminó correctamente.");

            return Err(DownloadError::Other(Box::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!(
                    "yt-dlp no pudo completar la descarga. \
                                 Código de salida: {}",
                    status
                ),
            ))));
        }

        // -----------------------------------------------------
        // Conversión / guardado
        // -----------------------------------------------------

        println!();
        println!("[YOUTUBE] Descarga de yt-dlp finalizada.");

        println!("[YOUTUBE] Buscando archivo MP3 generado...");

        progress_callback(DownloadProgress::new(
            98.0,
            "saving",
            "Guardando archivo...",
        ));

        // -----------------------------------------------------
        // Buscar archivo generado
        // -----------------------------------------------------

        let generated_file = find_generated_mp3(output_directory, &existing_files)?;

        println!("[YOUTUBE] Archivo generado: {}", generated_file.display());

        // -----------------------------------------------------
        // Comprobar archivo físicamente
        // -----------------------------------------------------

        let file_size = fs::metadata(&generated_file)
            .map_err(|error| DownloadError::Other(Box::new(error)))?
            .len();

        println!("[YOUTUBE] Tamaño físico del MP3: {} bytes", file_size);

        // -----------------------------------------------------
        // Finalización
        // -----------------------------------------------------

        progress_callback(DownloadProgress::new(
            100.0,
            "completed",
            "Descarga completada.",
        ));

        println!();
        println!("========================================");
        println!("MUSEX - DESCARGA DE YOUTUBE COMPLETADA");
        println!("========================================");
        println!("Archivo: {}", generated_file.display());
        println!("Tamaño: {} bytes", file_size);
        println!("========================================");
        println!();

        Ok(DownloadResult::new(generated_file))
    }

    /// Comprueba si el descargador puede trabajar con la URL.
    fn supports_url(&self, url: &str) -> bool {
        YouTubeVideo::from_url(url).is_ok()
    }
}

// =============================================================
// PROGRESS PARSER
// =============================================================
//
// Convierte la salida generada por yt-dlp:
//
// download:downloading|123456|8705729
//
// en:
//
// DownloadProgress
//
// El porcentaje NO se toma de yt-dlp.
//
// Rust lo calcula mediante:
//
// downloaded_bytes / total_bytes
//
// Esto mantiene el progreso basado en datos reales.
// =============================================================

fn parse_progress_line(line: &str) -> Option<DownloadProgress> {
    let data = line.trim();

    let mut parts = data.split('|');

    // ---------------------------------------------------------
    // Estado
    // ---------------------------------------------------------

    let status = parts.next()?;

    // ---------------------------------------------------------
    // Bytes descargados
    // ---------------------------------------------------------

    let downloaded_bytes = parts.next()?.parse::<u64>().ok()?;

    // ---------------------------------------------------------
    // Bytes totales
    // ---------------------------------------------------------

    let total_bytes = parts.next().and_then(|value| {
        if value == "NA" || value.is_empty() {
            None
        } else {
            value.parse::<u64>().ok()
        }
    });

    // ---------------------------------------------------------
    // Determinar etapa
    // ---------------------------------------------------------

    let (stage, message) = match status {
        "downloading" => ("downloading", "Descargando audio..."),

        "finished" => ("converting", "Convirtiendo a MP3..."),

        _ => ("downloading", "Procesando descarga..."),
    };

    // ---------------------------------------------------------
    // Construir progreso
    // ---------------------------------------------------------

    Some(DownloadProgress::from_bytes(
        downloaded_bytes,
        total_bytes,
        stage,
        message,
    ))
}

// =============================================================
// MP3 FILES
// =============================================================

/// Obtiene todos los archivos MP3 existentes dentro del
/// directorio indicado.
fn collect_mp3_files(directory: &Path) -> Result<Vec<PathBuf>, DownloadError> {
    let mut files = Vec::new();

    let entries = fs::read_dir(directory).map_err(|error| DownloadError::Other(Box::new(error)))?;

    for entry in entries {
        let entry = entry.map_err(|error| DownloadError::Other(Box::new(error)))?;

        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let is_mp3 = path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.eq_ignore_ascii_case("mp3"))
            .unwrap_or(false);

        if is_mp3 {
            files.push(path);
        }
    }

    Ok(files)
}

// =============================================================
// GENERATED FILE
// =============================================================
//
// Busca el MP3 generado o modificado por la operación actual.
//
// Prioridad:
//
// 1. Archivo que no existía antes de la descarga.
// 2. Archivo modificado más recientemente.
// 3. Error si no existe ningún MP3.
// =============================================================

fn find_generated_mp3(
    directory: &Path,
    existing_files: &[PathBuf],
) -> Result<PathBuf, DownloadError> {
    let current_files = collect_mp3_files(directory)?;

    let mut new_files = Vec::new();

    for file in &current_files {
        if !existing_files.contains(file) {
            new_files.push(file.clone());
        }
    }

    if !new_files.is_empty() {
        return newest_file(new_files);
    }

    newest_file(current_files)
}

// =============================================================
// NEWEST FILE
// =============================================================

/// Devuelve el archivo MP3 modificado más recientemente.
fn newest_file(files: Vec<PathBuf>) -> Result<PathBuf, DownloadError> {
    if files.is_empty() {
        return Err(DownloadError::Other(Box::new(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "yt-dlp terminó correctamente, pero no se encontró \
                         ningún archivo MP3 en el directorio de salida.",
        ))));
    }

    let mut newest: Option<(PathBuf, SystemTime)> = None;

    for file in files {
        let modified = fs::metadata(&file)
            .map_err(|error| DownloadError::Other(Box::new(error)))?
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH);

        match &newest {
            Some((_, newest_time)) if modified <= *newest_time => {}

            _ => {
                newest = Some((file, modified));
            }
        }
    }

    newest.map(|(path, _)| path).ok_or_else(|| {
        DownloadError::Other(Box::new(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "No se pudo determinar el archivo MP3 generado.",
        )))
    })
}

// =============================================================
// PREPARACIÓN PARA TAURI
// =============================================================
//
// Flujo:
//
// Angular
//   ↓
// Tauri
//   ↓
// YouTubeDownloader
//   ↓
// yt-dlp
//   ↓
// stdout
//   ↓
// parse_progress_line()
//   ↓
// DownloadProgress
//   ↓
// callback
//   ↓
// Tauri Event
//   ↓
// Angular DownloadService
//   ↓
// Download
//   ↓
// DownloadItemComponent
//
// El progreso de descarga se basa en bytes reales.
//
// Si yt-dlp informa:
//
// download:downloading|4350000|8705729
//
// Rust calcula:
//
// 4350000 / 8705729 * 100
//
// y Angular recibe:
//
// downloadedBytes = 4350000
// totalBytes      = 8705729
// progress        ≈ 49.96
//
// Si yt-dlp informa:
//
// download:downloading|4350000|NA
//
// Angular recibe:
//
// downloadedBytes = 4350000
// totalBytes      = undefined
//
// En este segundo caso no se inventa un porcentaje.
// =============================================================
