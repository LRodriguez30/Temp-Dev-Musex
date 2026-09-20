// =============================================================
// MUSEX - TAURI CORE
// =============================================================
//
// Punto de entrada principal del backend de Musex.
//
// Aquí se inicializan:
// - Almacenamiento.
// - Reproductor de audio.
// - Administrador de descargas.
// - Plugins de Tauri.
// - Comandos disponibles para Angular.
// =============================================================

mod commands;

mod audio;
mod downloads;
mod filesystem;
mod library;
mod models;

use tauri::Manager;
use std::thread;
use std::time::Duration;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use audio::player::AudioPlayer;
use downloads::manager::DownloadManager;
use filesystem::storage::Storage;

use downloads::history::DownloadHistory;

// =============================================================
// COMANDO DE PRUEBA
// =============================================================

#[tauri::command]
fn greet(name: &str) -> String {
    format!(
        "Hello, {}! You've been greeted by Rust!",
        name
    )
}

// =============================================================
// ENTRADA PRINCIPAL DE TAURI
// =============================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {

    // =========================================================
    // RUTA BASE DE MUSEX
    // =========================================================

    let user_profile = std::env::var("USERPROFILE")
        .expect(
            "No se pudo determinar el perfil del usuario."
        );

    let base_dir = PathBuf::from(user_profile)
        .join("Desktop")
        .join("Musex");

    // =========================================================
    // INICIALIZACIÓN DEL ALMACENAMIENTO
    // =========================================================

    let storage =
        Storage::new(
            base_dir.clone()
        );

    storage
        .initialize()
        .expect(
            "No se pudo inicializar el almacenamiento de Musex."
        );

    let download_history = DownloadHistory::new(&base_dir);

    // =========================================================
    // INICIALIZACIÓN DEL DOWNLOAD MANAGER
    // =========================================================
    //
    // DownloadManager necesita su propia instancia de Storage
    // para resolver las rutas relacionadas con las descargas.
    //
    // El manager se coloca dentro de:
    //
    // Arc
    //   ↓
    // Mutex
    //   ↓
    // DownloadManager
    //
    // Esto permite que los workers de descarga compartan el
    // mismo manager sin intentar mover una referencia prestada
    // por Tauri al thread.
    //
    // =========================================================

    let manager_storage =
        Storage::new(
            base_dir
        );

    manager_storage
        .initialize()
        .expect(
            "No se pudo inicializar el almacenamiento del administrador de descargas."
        );

    let download_manager =
        DownloadManager::new(
            manager_storage
        );

    let download_manager =
        Arc::new(
            Mutex::new(
                download_manager
            )
        );

    // =========================================================
    // INICIALIZACIÓN DEL REPRODUCTOR
    // =========================================================
    //
    // El reproductor se crea una sola vez al iniciar Musex.
    //
    // De esta manera, los comandos:
    //
    // play_audio
    // pause_audio
    // resume_audio
    // stop_audio
    //
    // trabajan sobre la misma instancia de AudioPlayer.
    //
    // =========================================================

    let audio_player =
        AudioPlayer::new()
            .expect(
                "No se pudo inicializar el dispositivo de audio."
            );

    // =========================================================
    // INICIO DE TAURI
    // =========================================================

    tauri::Builder::default()

        // -----------------------------------------------------
        // ESTADO GLOBAL
        // -----------------------------------------------------
        //
        // Storage:
        // operaciones generales de almacenamiento.
        //
        // AudioPlayer:
        // reproducción de audio.
        //
        // DownloadManager:
        // administración compartida de descargas.
        //
        // -----------------------------------------------------

        .manage(storage)
        .manage(audio_player)
        .manage(download_manager)
        .manage(download_history)

        .setup(|app| {
            let app_handle = app.handle().clone();

            thread::spawn(move || {
                let mut last_device =
                    AudioPlayer::current_default_device_name();

                loop {
                    thread::sleep(Duration::from_secs(2));

                    let current_device =
                        AudioPlayer::current_default_device_name();

                    if current_device != last_device {
                        println!(
                            "[AUDIO] Dispositivo de salida cambió: {:?} -> {:?}",
                            last_device, current_device
                        );

                        if let Some(player) =
                            app_handle.try_state::<AudioPlayer>()
                        {
                            if let Err(error) = player.reinitialize_output() {
                                eprintln!(
                                    "[AUDIO] No se pudo reinicializar la salida: {}",
                                    error
                                );
                            } else {
                                println!(
                                    "[AUDIO] Salida de audio reinicializada correctamente."
                                );
                            }
                        }

                        last_device = current_device;
                    }
                }
            });

            Ok(())
        })
        
        // -----------------------------------------------------
        // PLUGINS
        // -----------------------------------------------------

        .plugin(
            tauri_plugin_opener::init()
        )

        .plugin(
            tauri_plugin_dialog::init()
        )

        .plugin(
            tauri_plugin_shell::init()
        )

        // -----------------------------------------------------
        // COMANDOS
        // -----------------------------------------------------

        .invoke_handler(
            tauri::generate_handler![

                // =============================================
                // GENERAL
                // =============================================

                greet,


                // =============================================
                // AUDIO / PLAYER
                // =============================================

                commands::audio::play_audio,
                commands::audio::pause_audio,
                commands::audio::resume_audio,
                commands::audio::stop_audio,

                commands::audio::get_audio_metadata,
                commands::audio::get_audio_position,
                commands::audio::seek_audio,
                commands::audio::update_audio_metadata,

                commands::audio::set_volume,

                commands::audio::reinitialize_audio_device,

                // =============================================
                // DOWNLOADS
                // =============================================

                commands::downloads::detect_download_source,
                commands::downloads::move_download_to_library,
                commands::downloads::download_audio,
                commands::downloads::open_download_location,

                commands::downloads::get_download_history,
                commands::downloads::remove_download_history_entry,
                commands::downloads::clear_download_history,

                // =============================================
                // FILESYSTEM
                // =============================================

                // Comprueba el tipo de una ruta.
                commands::filesystem::get_storage_info,

                // Obtiene cuánto ocupa Musex físicamente
                // dentro de la máquina.
                commands::filesystem::get_musex_storage_size,

                // Operaciones generales de filesystem.
                commands::filesystem::create_directory,
                commands::filesystem::path_exists,

                // Guarda físicamente una portada de canción.
                commands::filesystem::save_cover,


                // =============================================
                // LIBRARY
                // =============================================

                commands::library::scan_library,
                commands::library::import_tracks,
            ]
        )

        // -----------------------------------------------------
        // EJECUCIÓN DE TAURI
        // -----------------------------------------------------

        .run(
            tauri::generate_context!()
        )
        .expect(
            "error while running tauri application"
        );
}