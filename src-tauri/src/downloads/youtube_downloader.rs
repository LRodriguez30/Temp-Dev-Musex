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
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::downloads::download_manager::DownloadController;

use crate::downloads::downloader::{
    DownloadError,
    DownloadProgress,
    DownloadResult,
    Downloader,
};

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
    ///
    /// Esta instancia se utiliza principalmente para detectar
    /// y validar URLs de YouTube.
    pub fn new() -> Self {
        Self
    }

    /// Analiza y valida una URL de YouTube.
    pub fn parse_url(&self, url: &str) -> Result<YouTubeVideo, String> {
        YouTubeVideo::from_url(url)
    }

    // =========================================================
    // FFMPEG
    // =========================================================

    /// Busca el ejecutable donde Musex tiene empaquetado FFmpeg.
    ///
    /// Durante desarrollo:
    ///
    ///     src-tauri/
    ///         binaries/
    ///             ffmpeg-x86_64-pc-windows-msvc.exe
    ///
    /// Durante producción Tauri puede colocar los recursos
    /// empaquetados dentro del directorio de recursos de la
    /// aplicación.
    ///
    /// Por ello se prueban varias ubicaciones válidas.
    fn find_ffmpeg_executable(
        &self,
        app: &AppHandle,
    ) -> Result<PathBuf, DownloadError> {
        // -----------------------------------------------------
        // Nombre esperado del ejecutable
        // -----------------------------------------------------

        let ffmpeg_name =
            if cfg!(target_os = "windows") {
                "ffmpeg-x86_64-pc-windows-msvc.exe"
            } else {
                "ffmpeg"
            };

        // -----------------------------------------------------
        // Posibles ubicaciones
        // -----------------------------------------------------
        //
        // La primera ubicación se utiliza específicamente para
        // desarrollo con `tauri dev`.
        //
        // `CARGO_MANIFEST_DIR` apunta a:
        //
        //     src-tauri/
        //
        // por lo que:
        //
        //     CARGO_MANIFEST_DIR/binaries
        //
        // corresponde directamente a:
        //
        //     src-tauri/binaries
        // -----------------------------------------------------

        let development_directory =
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries");

        // -----------------------------------------------------
        // Directorio de recursos de Tauri
        // -----------------------------------------------------

        let resource_dir =
            app.path()
                .resource_dir()
                .map_err(|error| {
                    DownloadError::Other(
                        Box::new(
                            std::io::Error::new(
                                std::io::ErrorKind::NotFound,
                                format!(
                                    "No se pudo obtener el directorio de recursos de Musex: {}",
                                    error
                                ),
                            )
                        )
                    )
                })?;

        // -----------------------------------------------------
        // Posibles ubicaciones en producción
        // -----------------------------------------------------

        let resource_binaries_directory =
            resource_dir.join("binaries");

        let possible_directories = [
            development_directory.clone(),
            resource_binaries_directory.clone(),
            resource_dir.clone(),
        ];

        // -----------------------------------------------------
        // Buscar FFmpeg
        // -----------------------------------------------------

        for directory in possible_directories {
            let executable =
                directory.join(ffmpeg_name);

            println!(
                "[YOUTUBE] Comprobando FFmpeg: {}",
                executable.display()
            );

            if executable.is_file() {
                println!(
                    "[YOUTUBE] FFmpeg encontrado en: {}",
                    executable.display()
                );

                return Ok(executable);
            }
        }

        // -----------------------------------------------------
        // FFmpeg no encontrado
        // -----------------------------------------------------

        Err(
            DownloadError::Other(
                Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        format!(
                            "No se encontró el FFmpeg empaquetado con Musex. \
                             Se buscó en desarrollo: {} \
                             y en los recursos de Tauri: {}.",
                            development_directory.display(),
                            resource_dir.display()
                        ),
                    )
                )
            )
        )
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
        app: &AppHandle,
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
        println!(
            "Directorio de salida: {}",
            output_path.display()
        );
        println!();

        progress_callback(
            DownloadProgress::new(
                0.0,
                "preparing",
                "Preparando descarga...",
            )
        );

        // -----------------------------------------------------
        // Validar URL
        // -----------------------------------------------------

        let video =
            self.parse_url(&download.url)
                .map_err(|error| {
                    DownloadError::Other(
                        Box::new(
                            std::io::Error::new(
                                std::io::ErrorKind::InvalidInput,
                                format!(
                                    "URL de YouTube no válida: {}",
                                    error
                                ),
                            )
                        )
                    )
                })?;

        println!(
            "[YOUTUBE] Video identificado: {}",
            video.video_id
        );

        progress_callback(
            DownloadProgress::new(
                2.0,
                "fetching",
                "Obteniendo información del contenido...",
            )
        );

        // -----------------------------------------------------
        // Preparar directorio de salida
        // -----------------------------------------------------

        fs::create_dir_all(output_path)
            .map_err(|error| {
                DownloadError::Other(
                    Box::new(error)
                )
            })?;

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

        let output_directory =
            output_path;

        let existing_files =
            collect_mp3_files(
                output_directory
            )?;

        println!(
            "[YOUTUBE] Archivos MP3 existentes: {}",
            existing_files.len()
        );

        // -----------------------------------------------------
        // Preparar plantilla de salida
        // -----------------------------------------------------

        let output_template =
            output_directory
                .join("%(title)s.%(ext)s");

        println!(
            "[YOUTUBE] Plantilla de salida: {}",
            output_template.display()
        );

        // -----------------------------------------------------
        // Comprobar cancelación antes de iniciar yt-dlp
        // -----------------------------------------------------

        if controller.is_cancelled() {
            return Err(
                DownloadError::Control(
                    crate::downloads::downloader::DownloadControlResult::Cancelled,
                )
            );
        }

        if controller.is_paused() {
            return Err(
                DownloadError::Control(
                    crate::downloads::downloader::DownloadControlResult::Paused,
                )
            );
        }

        // -----------------------------------------------------
        // Localizar FFmpeg empaquetado con Musex
        // -----------------------------------------------------
        //
        // FFmpeg forma parte de la distribución de Musex.
        //
        // No utilizamos el FFmpeg instalado globalmente en
        // Windows.
        //
        // Durante desarrollo se busca primero en:
        //
        //     src-tauri/binaries
        //
        // En producción se buscan los recursos generados por
        // Tauri.
        //
        // IMPORTANTE:
        //
        // yt-dlp necesita localizar el ejecutable real de
        // FFmpeg.
        //
        // Nuestro archivo no se llama simplemente:
        //
        //     ffmpeg.exe
        //
        // sino:
        //
        //     ffmpeg-x86_64-pc-windows-msvc.exe
        //
        // Por ello se proporciona a yt-dlp la ruta COMPLETA
        // del ejecutable mediante `--ffmpeg-location`.
        // -----------------------------------------------------

        let ffmpeg_executable =
            self.find_ffmpeg_executable(app)?;

        let ffmpeg_location =
            ffmpeg_executable
                .to_string_lossy()
                .into_owned();

        println!(
            "[YOUTUBE] Ejecutable FFmpeg empaquetado: {}",
            ffmpeg_location
        );

        // -----------------------------------------------------
        // Comprobar existencia de FFmpeg
        // -----------------------------------------------------

        if !ffmpeg_executable.is_file() {
            return Err(
                DownloadError::Other(
                    Box::new(
                        std::io::Error::new(
                            std::io::ErrorKind::NotFound,
                            format!(
                                "No se encontró el FFmpeg empaquetado con Musex: {}",
                                ffmpeg_executable.display()
                            ),
                        )
                    )
                )
            );
        }

        println!(
            "[YOUTUBE] FFmpeg encontrado correctamente: {}",
            ffmpeg_executable.display()
        );

        // =====================================================
        // EJECUTAR YT-DLP
        // =====================================================
        //
        // El AppHandle llega directamente desde el comando
        // `download_audio`.
        //
        // No se almacena dentro de `YouTubeDownloader`.
        //
        // Esto permite que `YouTubeDownloader::new()` siga siendo
        // suficiente para detectar y validar URLs.
        // =====================================================

        println!();
        println!(
            "[YOUTUBE] Ejecutando yt-dlp como sidecar..."
        );
        println!();

        // -----------------------------------------------------
        // IMPORTANTE
        // -----------------------------------------------------
        //
        // `yt-dlp` está configurado en:
        //
        // tauri.conf.json
        //
        // "externalBin": [
        //     "binaries/yt-dlp",
        //     "binaries/ffmpeg"
        // ]
        //
        // Tauri se encarga de resolver automáticamente el
        // ejecutable correcto para la plataforma.
        //
        // El nombre utilizado aquí es solamente:
        //
        // "yt-dlp"
        //
        // No se utiliza:
        //
        // "binaries/yt-dlp"
        //
        // según la API Rust de sidecars de Tauri.
        //
        // FFmpeg también se encuentra configurado como sidecar
        // en:
        //
        // "binaries/ffmpeg"
        //
        // Sin embargo, yt-dlp necesita conocer la ubicación
        // física de FFmpeg.
        //
        // Como el ejecutable de Musex tiene el sufijo del
        // target de Tauri, se proporciona la ruta COMPLETA:
        //
        // "--ffmpeg-location"
        //
        //     C:\...\ffmpeg-x86_64-pc-windows-msvc.exe
        //
        // Esto evita depender del PATH de Windows y también
        // evita que yt-dlp busque un archivo llamado simplemente
        // `ffmpeg.exe`.
        // -----------------------------------------------------

        let sidecar_command =
            app
                .shell()
                .sidecar("yt-dlp")
                .map_err(|error| {
                    DownloadError::Other(
                        Box::new(
                            std::io::Error::new(
                                std::io::ErrorKind::NotFound,
                                format!(
                                    "No se pudo localizar el sidecar yt-dlp. Detalle: {}",
                                    error
                                ),
                            )
                        )
                    )
                })?
                .args([
                    "-x",

                    "--audio-format",
                    "mp3",

                    "--no-playlist",

                    // -------------------------------------------------
                    // Progreso
                    // -------------------------------------------------
                    //
                    // `--newline` obliga a yt-dlp a emitir cada
                    // actualización de progreso en una línea
                    // independiente.
                    //
                    // El formato real observado en la salida es:
                    //
                    // downloading|1024|4519524
                    //
                    // Por ello el parser de Rust procesa directamente
                    // esos tres valores.
                    // -------------------------------------------------

                    "--progress",

                    "--newline",

                    "--restrict-filenames",

                    // -------------------------------------------------
                    // FFmpeg empaquetado con Musex
                    // -------------------------------------------------
                    //
                    // Se indica directamente el ejecutable que debe
                    // utilizar yt-dlp.
                    //
                    // Esto evita depender del FFmpeg instalado
                    // globalmente en Windows.
                    // -------------------------------------------------

                    "--ffmpeg-location",
                    &ffmpeg_location,

                    // -------------------------------------------------
                    // Control de archivos existentes
                    // -------------------------------------------------

                    "--force-overwrites",

                    // -------------------------------------------------
                    // Progress template
                    // -------------------------------------------------
                    //
                    // El resultado esperado es:
                    //
                    // downloading|4350000|8705729
                    //
                    // o:
                    //
                    // finished|8705729|8705729
                    //
                    // El prefijo `download:` no se utiliza porque
                    // yt-dlp está entregando directamente el contenido
                    // definido por la plantilla.
                    // -------------------------------------------------

                    "--progress-template",
                    "%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s",

                    // -------------------------------------------------
                    // Metadata
                    // -------------------------------------------------

                    "--parse-metadata",
                    "%(title)s:%(meta_title)s",

                    "--parse-metadata",
                    "%(uploader)s:%(meta_artist)s",

                    "--parse-metadata",
                    "%(album|)s:%(meta_album)s",

                    "--parse-metadata",
                    "%(genre|)s:%(meta_genre)s",

                    "--parse-metadata",
                    "%(upload_date|)s:%(meta_date)s",

                    "--embed-metadata",

                    // -------------------------------------------------
                    // Salida
                    // -------------------------------------------------

                    "-o",

                    output_template
                        .to_string_lossy()
                        .as_ref(),

                    &download.url,
                ]);

        // -----------------------------------------------------
        // Comunicación con Rust
        // -----------------------------------------------------

        let (mut receiver, child) =
            sidecar_command
                .spawn()
                .map_err(|error| {
                    DownloadError::Other(
                        Box::new(
                            std::io::Error::new(
                                std::io::ErrorKind::NotFound,
                                format!(
                                    "No se pudo ejecutar el sidecar yt-dlp. Detalle: {}",
                                    error
                                ),
                            )
                        )
                    )
                })?;

        println!(
            "[YOUTUBE] yt-dlp iniciado correctamente."
        );

        // -----------------------------------------------------
        // Leer progreso
        // -----------------------------------------------------

        println!(
            "[YOUTUBE] Escuchando salida de yt-dlp..."
        );

        let mut exit_code: Option<i32> =
            None;

        let mut stdout_buffer =
            String::new();

        loop {
            // -------------------------------------------------
            // Comprobar controles
            // -------------------------------------------------

            if controller.is_cancelled() {
                println!(
                    "[YOUTUBE] Cancelación solicitada."
                );

                if let Err(error) =
                    child.kill()
                {
                    eprintln!(
                        "[YOUTUBE] No se pudo detener yt-dlp: {}",
                        error
                    );
                }

                return Err(
                    DownloadError::Control(
                        crate::downloads::downloader::DownloadControlResult::Cancelled,
                    )
                );
            }

            if controller.is_paused() {
                println!(
                    "[YOUTUBE] Pausa solicitada."
                );

                if let Err(error) =
                    child.kill()
                {
                    eprintln!(
                        "[YOUTUBE] No se pudo detener yt-dlp: {}",
                        error
                    );
                }

                return Err(
                    DownloadError::Control(
                        crate::downloads::downloader::DownloadControlResult::Paused,
                    )
                );
            }

            // -------------------------------------------------
            // Esperar siguiente evento
            // -------------------------------------------------

            let event =
                tauri::async_runtime::block_on(
                    receiver.recv()
                );

            let Some(event) =
                event
            else {
                println!(
                    "[YOUTUBE] El canal de eventos de yt-dlp se cerró."
                );

                break;
            };

            // =================================================
            // PROCESAR EVENTO
            // =================================================

            match event {

                // -------------------------------------------------
                // STDOUT
                // -------------------------------------------------

                CommandEvent::Stdout(bytes) => {
                    let output =
                        String::from_utf8_lossy(
                            &bytes
                        );

                    // -------------------------------------------------
                    // stdout puede llegar fragmentado.
                    //
                    // Por ejemplo:
                    //
                    // Evento 1:
                    //     downloading|435000
                    //
                    // Evento 2:
                    //     0|870000
                    //
                    // Por ello acumulamos los fragmentos antes de
                    // procesar las líneas completas.
                    // -------------------------------------------------

                    stdout_buffer.push_str(
                        &output
                    );

                    while let Some(newline_position) =
                        stdout_buffer.find('\n')
                    {
                        let line =
                            stdout_buffer
                                [..newline_position]
                                .trim_end_matches('\r')
                                .trim()
                                .to_string();

                        stdout_buffer.drain(
                            ..=newline_position
                        );

                        if line.is_empty() {
                            continue;
                        }

                        println!(
                            "[YTDLP] {}",
                            line
                        );

                        if let Some(progress) =
                            parse_progress_line(
                                &line
                            )
                        {
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

                            progress_callback(
                                progress
                            );
                        }
                    }
                }

                // -------------------------------------------------
                // STDERR
                // -------------------------------------------------

                CommandEvent::Stderr(bytes) => {
                    let output =
                        String::from_utf8_lossy(
                            &bytes
                        );

                    for raw_line in output.lines() {
                        let line =
                            raw_line.trim();

                        if line.is_empty() {
                            continue;
                        }

                        println!(
                            "[YTDLP STDERR] {}",
                            line
                        );
                    }
                }

                // -------------------------------------------------
                // PROCESO TERMINADO
                // -------------------------------------------------

                CommandEvent::Terminated(payload) => {
                    // -------------------------------------------------
                    // Si quedó una línea pendiente en stdout, intentamos
                    // procesarla antes de terminar.
                    // -------------------------------------------------

                    let remaining =
                        stdout_buffer
                            .trim();

                    if !remaining.is_empty() {
                        println!(
                            "[YTDLP] {}",
                            remaining
                        );

                        if let Some(progress) =
                            parse_progress_line(
                                remaining
                            )
                        {
                            progress_callback(
                                progress
                            );
                        }
                    }

                    println!();
                    println!(
                        "========================================"
                    );
                    println!(
                        "[YOUTUBE] YT-DLP TERMINÓ"
                    );
                    println!(
                        "========================================"
                    );

                    println!(
                        "[YOUTUBE] Código de salida: {:?}",
                        payload.code
                    );

                    println!(
                        "[YOUTUBE] Señal: {:?}",
                        payload.signal
                    );

                    println!(
                        "========================================"
                    );
                    println!();

                    exit_code =
                        payload.code;

                    break;
                }

                // -------------------------------------------------
                // ERROR DEL PROCESO
                // -------------------------------------------------

                CommandEvent::Error(error) => {
                    println!(
                        "[YTDLP ERROR] {}",
                        error
                    );
                }

                // -------------------------------------------------
                // OTROS EVENTOS
                // -------------------------------------------------

                _ => {}
            }
        }

        // =====================================================
        // COMPROBAR CONTROLES DESPUÉS DE STDOUT
        // =====================================================

        if controller.is_cancelled() {
            println!(
                "[YOUTUBE] Cancelación solicitada."
            );

            return Err(
                DownloadError::Control(
                    crate::downloads::downloader::DownloadControlResult::Cancelled,
                )
            );
        }

        if controller.is_paused() {
            println!(
                "[YOUTUBE] Pausa solicitada."
            );

            return Err(
                DownloadError::Control(
                    crate::downloads::downloader::DownloadControlResult::Paused,
                )
            );
        }

        // =====================================================
        // RESULTADO DEL PROCESO
        // =====================================================

        println!();
        println!(
            "[YOUTUBE] Procesamiento del evento de finalización..."
        );

        let exit_code =
            exit_code.ok_or_else(|| {
                DownloadError::Other(
                    Box::new(
                        std::io::Error::new(
                            std::io::ErrorKind::Other,
                            "yt-dlp terminó sin proporcionar un código de salida.",
                        )
                    )
                )
            })?;

        println!(
            "[YOUTUBE] yt-dlp finalizó con código de salida: {}",
            exit_code
        );

        // =====================================================
        // COMPROBAR CONTROLES DESPUÉS DE FINALIZAR
        // =====================================================

        if controller.is_cancelled() {
            return Err(
                DownloadError::Control(
                    crate::downloads::downloader::DownloadControlResult::Cancelled,
                )
            );
        }

        if controller.is_paused() {
            return Err(
                DownloadError::Control(
                    crate::downloads::downloader::DownloadControlResult::Paused,
                )
            );
        }

        // =====================================================
        // COMPROBAR RESULTADO
        // =====================================================

        if exit_code != 0 {
            println!();
            println!(
                "========================================"
            );
            println!(
                "[YOUTUBE] ERROR: YT-DLP NO TERMINÓ CORRECTAMENTE"
            );
            println!(
                "========================================"
            );
            println!(
                "[YOUTUBE] Código de salida real: {}",
                exit_code
            );
            println!(
                "[YOUTUBE] Revisar las líneas [YTDLP STDERR]"
            );
            println!(
                "========================================"
            );
            println!();

            return Err(
                DownloadError::Other(
                    Box::new(
                        std::io::Error::new(
                            std::io::ErrorKind::Other,
                            format!(
                                "yt-dlp no pudo completar la descarga. \
                                 Código de salida: {}",
                                exit_code
                            )
                        )
                    )
                )
            );
        }

        // =====================================================
        // CONVERSIÓN / GUARDADO
        // =====================================================

        println!();
        println!(
            "[YOUTUBE] Descarga de yt-dlp finalizada."
        );

        println!(
            "[YOUTUBE] Buscando archivo MP3 generado..."
        );

        progress_callback(
            DownloadProgress::new(
                98.0,
                "saving",
                "Guardando archivo...",
            )
        );

        // =====================================================
        // BUSCAR ARCHIVO GENERADO
        // =====================================================

        let generated_file =
            find_generated_mp3(
                output_directory,
                &existing_files
            )?;

        println!(
            "[YOUTUBE] Archivo generado: {}",
            generated_file.display()
        );

        // =====================================================
        // COMPROBAR ARCHIVO FÍSICAMENTE
        // =====================================================

        let file_size =
            fs::metadata(
                &generated_file
            )
            .map_err(|error| {
                DownloadError::Other(
                    Box::new(error)
                )
            })?
            .len();

        println!(
            "[YOUTUBE] Tamaño físico del MP3: {} bytes",
            file_size
        );

        // =====================================================
        // FINALIZACIÓN
        // =====================================================

        progress_callback(
            DownloadProgress::new(
                100.0,
                "completed",
                "Descarga completada.",
            )
        );

        println!();
        println!(
            "========================================"
        );
        println!(
            "MUSEX - DESCARGA DE YOUTUBE COMPLETADA"
        );
        println!(
            "========================================"
        );
        println!(
            "Archivo: {}",
            generated_file.display()
        );
        println!(
            "Tamaño: {} bytes",
            file_size
        );
        println!(
            "========================================"
        );
        println!();

        Ok(
            DownloadResult::new(
                generated_file
            )
        )
    }

    /// Comprueba si el descargador puede trabajar con la URL.
    fn supports_url(
        &self,
        url: &str,
    ) -> bool {
        YouTubeVideo::from_url(url).is_ok()
    }
}

// =============================================================
// PROGRESS PARSER
// =============================================================
//
// yt-dlp genera:
//
// downloading|4350000|8705729
//
// o:
//
// finished|8705729|8705729
//
// Los campos representan:
//
// status
// downloaded_bytes
// total_bytes
//
// Por ejemplo:
//
// downloading|4350000|8705729
//
// significa:
//
// Estado:
//     downloading
//
// Bytes descargados:
//     4350000
//
// Bytes totales:
//     8705729
//
// El porcentaje se calcula posteriormente mediante:
//
// DownloadProgress::from_bytes()
//
// Si yt-dlp informa:
//
// downloading|4350000|NA
//
// entonces no existe un tamaño total conocido.
//
// En ese caso DownloadProgress conserva:
//
// downloaded_bytes = 4350000
// total_bytes      = None
//
// y no se inventa un porcentaje.
// =============================================================

fn parse_progress_line(
    line: &str,
) -> Option<DownloadProgress> {
    let data =
        line.trim();

    // ---------------------------------------------------------
    // Separar los campos del progreso
    // ---------------------------------------------------------

    let mut parts =
        data.split('|');

    // ---------------------------------------------------------
    // Estado
    // ---------------------------------------------------------

    let status =
        parts.next()?;

    // ---------------------------------------------------------
    // Bytes descargados
    // ---------------------------------------------------------

    let downloaded_bytes =
        parts
            .next()?
            .parse::<u64>()
            .ok()?;

    // ---------------------------------------------------------
    // Bytes totales
    // ---------------------------------------------------------

    let total_bytes =
        parts
            .next()
            .and_then(|value| {
                let value =
                    value.trim();

                if value == "NA"
                    || value.is_empty()
                {
                    None
                } else {
                    value
                        .parse::<u64>()
                        .ok()
                }
            });

    // ---------------------------------------------------------
    // Determinar etapa
    // ---------------------------------------------------------

    let (stage, message) =
        match status {

            "downloading" => (
                "downloading",
                "Descargando audio...",
            ),

            "finished" => (
                "converting",
                "Convirtiendo a MP3...",
            ),

            _ => (
                "downloading",
                "Procesando descarga...",
            ),
        };

    // ---------------------------------------------------------
    // Construir progreso
    // ---------------------------------------------------------

    Some(
        DownloadProgress::from_bytes(
            downloaded_bytes,
            total_bytes,
            stage,
            message,
        )
    )
}

// =============================================================
// MP3 FILES
// =============================================================

/// Obtiene todos los archivos MP3 existentes dentro del
/// directorio indicado.
fn collect_mp3_files(
    directory: &Path,
) -> Result<Vec<PathBuf>, DownloadError> {
    let mut files =
        Vec::new();

    let entries =
        fs::read_dir(
            directory
        )
        .map_err(|error| {
            DownloadError::Other(
                Box::new(error)
            )
        })?;

    for entry in entries {
        let entry =
            entry.map_err(|error| {
                DownloadError::Other(
                    Box::new(error)
                )
            })?;

        let path =
            entry.path();

        if !path.is_file() {
            continue;
        }

        let is_mp3 =
            path
                .extension()
                .and_then(|extension| {
                    extension.to_str()
                })
                .map(|extension| {
                    extension.eq_ignore_ascii_case(
                        "mp3"
                    )
                })
                .unwrap_or(false);

        if is_mp3 {
            files.push(
                path
            );
        }
    }

    Ok(files)
}

// =============================================================
// GENERATED FILE
// =============================================================

fn find_generated_mp3(
    directory: &Path,
    existing_files: &[PathBuf],
) -> Result<PathBuf, DownloadError> {
    let current_files =
        collect_mp3_files(
            directory
        )?;

    let mut new_files =
        Vec::new();

    for file in &current_files {
        if !existing_files.contains(file) {
            new_files.push(
                file.clone()
            );
        }
    }

    if !new_files.is_empty() {
        return newest_file(
            new_files
        );
    }

    newest_file(
        current_files
    )
}

// =============================================================
// NEWEST FILE
// =============================================================

/// Devuelve el archivo MP3 modificado más recientemente.
fn newest_file(
    files: Vec<PathBuf>,
) -> Result<PathBuf, DownloadError> {
    if files.is_empty() {
        return Err(
            DownloadError::Other(
                Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "yt-dlp terminó correctamente, pero no se encontró \
                         ningún archivo MP3 en el directorio de salida.",
                    )
                )
            )
        );
    }

    let mut newest:
        Option<(PathBuf, SystemTime)> =
            None;

    for file in files {
        let modified =
            fs::metadata(
                &file
            )
            .map_err(|error| {
                DownloadError::Other(
                    Box::new(error)
                )
            })?
            .modified()
            .unwrap_or(
                SystemTime::UNIX_EPOCH
            );

        match &newest {
            Some((_, newest_time))
                if modified <= *newest_time => {}

            _ => {
                newest =
                    Some(
                        (
                            file,
                            modified
                        )
                    );
            }
        }
    }

    newest
        .map(|(path, _)| path)
        .ok_or_else(|| {
            DownloadError::Other(
                Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "No se pudo determinar el archivo MP3 generado.",
                    )
                )
            )
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
// Tauri Shell
//   ↓
// yt-dlp sidecar
//   ↓
// FFmpeg empaquetado
//   ↓
// stdout / stderr
//   ↓
// CommandEvent
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
// downloading|4350000|8705729
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
// downloading|4350000|NA
//
// Angular recibe:
//
// downloadedBytes = 4350000
// totalBytes      = undefined
//
// En este segundo caso no se inventa un porcentaje.
// =============================================================