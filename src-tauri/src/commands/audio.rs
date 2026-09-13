// =============================================================
// COMANDOS - AUDIO
// =============================================================
//
// Expone las operaciones relacionadas con reproducción y
// metadata para que puedan ser invocadas desde Angular mediante
// Tauri.
//
// La lógica principal permanece dentro del Rust Core.
// =============================================================

use std::path::Path;

use tauri::State;

use crate::audio::metadata::{AudioMetadata, MetadataUpdate};
use crate::audio::player::AudioPlayer;

// =============================================================
// REPRODUCCIÓN
// =============================================================

#[tauri::command]
pub fn get_current_audio_device() -> Option<String> {
    AudioPlayer::current_default_device_name()
}

#[tauri::command]
pub fn reinitialize_audio_device(
    player: tauri::State<'_, AudioPlayer>,
) -> Result<(), String> {
    player.reinitialize_output()
}

/// Reproduce un archivo de audio utilizando el reproductor
/// compartido de Musex.
#[tauri::command]
pub fn play_audio(
    path: String,
    player: State<'_, AudioPlayer>,
) -> Result<(), String> {
    player
        .play_file(Path::new(&path))
        .map_err(|error| error.to_string())
}

/// Pausa la reproducción actual.
#[tauri::command]
pub fn pause_audio(
    player: State<'_, AudioPlayer>,
) -> Result<(), String> {
    player.pause();

    Ok(())
}

/// Reanuda la reproducción actual.
#[tauri::command]
pub fn resume_audio(
    player: State<'_, AudioPlayer>,
) -> Result<(), String> {
    player.resume();

    Ok(())
}

/// Detiene la reproducción actual.
#[tauri::command]
pub fn stop_audio(
    player: State<'_, AudioPlayer>,
) -> Result<(), String> {
    player.stop();

    Ok(())
}

// =============================================================
// VOLUMEN
// =============================================================

/// Cambia el volumen del reproductor.
///
/// Angular envía un valor normalizado entre 0.0 y 1.0.
#[tauri::command]
pub fn set_volume(
    volume: f32,
    player: State<'_, AudioPlayer>,
) -> Result<(), String> {
    if !volume.is_finite() {
        return Err(
            "El volumen proporcionado no es válido."
                .to_string()
        );
    }

    let normalized_volume =
        volume.clamp(0.0, 1.0);

    player.set_volume(
        normalized_volume
    );

    Ok(())
}

// =============================================================
// METADATA
// =============================================================

/// Obtiene la metadata de un archivo de audio.
#[tauri::command]
pub fn get_audio_metadata(
    path: String,
) -> Result<AudioMetadata, String> {
    AudioMetadata::from_file(Path::new(&path))
        .map_err(|error| error.to_string())
}

/// Actualiza la metadata seleccionada de un archivo.
#[tauri::command]
pub fn update_audio_metadata(
    path: String,
    update: MetadataUpdate,
) -> Result<(), String> {
    AudioMetadata::update_file(
        Path::new(&path),
        update,
    )
    .map_err(|error| error.to_string())
}

/// Obtiene la posición actual de reproducción.
///
/// La posición se devuelve en segundos para que Angular
/// pueda utilizarla directamente en la línea de tiempo.
#[tauri::command]
pub fn get_audio_position(
    player: State<'_, AudioPlayer>,
) -> f64 {
    player.position().as_secs_f64()
}

/// Cambia la posición actual de reproducción.
///
/// Recibe la posición en segundos desde Angular y la delega
/// al reproductor de Rust para realizar el desplazamiento real.
#[tauri::command]
pub fn seek_audio(
    seconds: f64,
    player: State<'_, AudioPlayer>,
) -> Result<(), String> {
    player
        .seek(seconds)
        .map_err(|error| error.to_string())
}