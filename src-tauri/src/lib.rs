// =============================================================
// MUSEX - TAURI CORE (desktop + Android)
// =============================================================

mod commands;
mod filesystem;
mod library;
mod models;

// `audio::metadata` (lofty) lo usan library y models, así que
// el módulo existe siempre; player/decoder son solo desktop.
mod audio;

#[cfg(desktop)]
mod downloads;
#[cfg(desktop)]
mod equalizer;
#[cfg(desktop)]
mod sense;
#[cfg(desktop)]
mod streaming;

#[cfg(mobile)]
mod android_storage;

use std::path::PathBuf;
use tauri::Manager;

use filesystem::storage::Storage;

#[cfg(desktop)]
use std::{
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

#[cfg(desktop)]
use audio::player::AudioPlayer;
#[cfg(desktop)]
use downloads::{history::DownloadHistory, manager::DownloadManager};
#[cfg(desktop)]
use equalizer::EqPresetStore;
#[cfg(desktop)]
use sense::store::SenseStore;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted by Rust!", name)
}

/// Carpeta base de Musex.
///
/// - Desktop: Escritorio/Musex.
/// - Android: /storage/emulated/0/Musex (carpeta pública, requiere
///   "Acceso a todos los archivos"). Si todavía no se concedió el
///   permiso se usa la carpeta privada de la app; al conceder el
///   permiso basta con reabrir Musex.
fn resolve_base_dir(app: &tauri::AppHandle) -> PathBuf {
    #[cfg(desktop)]
    {
        let _ = app;

        PathBuf::from(
            std::env::var("USERPROFILE")
                .expect("No se pudo determinar el perfil del usuario."),
        )
        .join("Desktop")
        .join("Musex")
    }

    #[cfg(mobile)]
    {
        android_storage::shared_base_dir().unwrap_or_else(|| {
            app.path()
                .app_data_dir()
                .expect("No se pudo obtener app_data_dir.")
        })
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_shell::init());
    }

    #[cfg(mobile)]
    {
        builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    }

    // ---------------------------------------------------------
    // COMANDOS
    // ---------------------------------------------------------

    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        // Audio
        commands::audio::play_audio,
        commands::audio::pause_audio,
        commands::audio::resume_audio,
        commands::audio::stop_audio,
        commands::audio::get_audio_metadata,
        commands::audio::get_audio_position,
        commands::audio::seek_audio,
        commands::audio::get_audio_duration,
        commands::audio::update_audio_metadata,
        commands::audio::set_volume,
        commands::audio::reinitialize_audio_device,
        // Downloads
        commands::downloads::detect_download_source,
        commands::downloads::move_download_to_library,
        commands::downloads::download_audio,
        commands::downloads::open_download_location,
        commands::downloads::get_download_history,
        commands::downloads::remove_download_history_entry,
        commands::downloads::clear_download_history,
        // Filesystem
        commands::filesystem::get_storage_info,
        commands::filesystem::get_musex_storage_size,
        commands::filesystem::create_directory,
        commands::filesystem::path_exists,
        commands::filesystem::save_cover,
        // Equalizer
        commands::equalizer::enable_track_for_eq,
        commands::equalizer::list_eq_tracks,
        commands::equalizer::disable_track_for_eq,
        commands::equalizer::play_eq_audio,
        commands::equalizer::pause_eq_audio,
        commands::equalizer::resume_eq_audio,
        commands::equalizer::stop_eq_audio,
        commands::equalizer::get_eq_audio_position,
        commands::equalizer::seek_eq_audio,
        commands::equalizer::set_eq_band,
        commands::equalizer::remove_eq_band,
        commands::equalizer::reset_eq,
        commands::equalizer::get_eq_preset,
        commands::equalizer::save_eq_preset,
        commands::equalizer::remove_eq_preset,
        // Sense
        commands::sense::get_sense_settings,
        commands::sense::set_sense_enabled,
        commands::sense::set_sense_capability,
        commands::sense::set_sense_prompt,
        commands::sense::reset_sense_prompt,
        commands::sense::save_sense_api_key,
        commands::sense::remove_sense_api_key,
        commands::sense::test_sense_connection,
        commands::sense::get_sense_recommendations,
        commands::sense::recommend_eq_preset,
        // Library
        commands::library::scan_library,
        commands::library::scan_temp,
        commands::library::import_tracks,
        // Streaming (QR, dispositivos vinculados, sincronización)
        streaming::get_stream_info,
        streaming::list_paired_devices,
        streaming::revoke_paired_device,
        streaming::set_stream_playlists,
        streaming::set_stream_favorites,
    ]);

    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        commands::filesystem::get_storage_info,
        commands::filesystem::get_musex_storage_size,
        commands::filesystem::create_directory,
        commands::filesystem::path_exists,
        commands::filesystem::save_cover,
        commands::library::scan_library,
        commands::library::scan_temp,
        commands::library::import_tracks,
        // Música local del teléfono
        android_storage::get_local_storage_info,
        android_storage::scan_phone_audio,
        android_storage::browse_phone_directory,
        android_storage::transfer_phone_folder,
        android_storage::delete_local_files,
        android_storage::read_local_audio,
        android_storage::import_phone_audio_files,
        android_storage::analyze_phone_audio_duplicates,
    ]);

    // ---------------------------------------------------------
    // ARRANQUE
    // ---------------------------------------------------------

    builder
        .setup(|app| {
            let base_dir = resolve_base_dir(app.handle());

            let storage = Storage::new(base_dir.clone());
            storage
                .initialize()
                .expect("No se pudo inicializar el almacenamiento de Musex.");
            app.manage(storage);

            #[cfg(desktop)]
            {
                app.manage(DownloadHistory::new(&base_dir));
                app.manage(SenseStore::new(base_dir.clone()));
                app.manage(EqPresetStore::new(&base_dir));
                app.manage(streaming::StreamState::default());

                let manager_storage = Storage::new(base_dir);
                manager_storage.initialize().expect(
                    "No se pudo inicializar el almacenamiento del administrador de descargas.",
                );
                app.manage(Arc::new(Mutex::new(DownloadManager::new(
                    manager_storage,
                ))));

                app.manage(
                    AudioPlayer::new()
                        .expect("No se pudo inicializar el dispositivo de audio."),
                );

                // Detecta cambios del dispositivo de salida.
                let app_handle = app.handle().clone();

                thread::spawn(move || {
                    let mut last = AudioPlayer::current_default_device_name();

                    loop {
                        thread::sleep(Duration::from_secs(2));

                        let current = AudioPlayer::current_default_device_name();

                        if current != last {
                            if let Some(player) =
                                app_handle.try_state::<AudioPlayer>()
                            {
                                if let Err(error) = player.reinitialize_output() {
                                    eprintln!(
                                        "[AUDIO] No se pudo reinicializar la salida: {}",
                                        error
                                    );
                                }
                            }

                            last = current;
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}