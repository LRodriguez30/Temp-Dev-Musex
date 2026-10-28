use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::audio::player::AudioPlayer;
use crate::equalizer::{
    EqBand,
    EqFilterType,
    EqPreset,
    EqPresetStore,
};
use crate::filesystem::storage::Storage;


// =============================================================
// TEMP
// =============================================================

#[derive(Serialize)]
pub struct EqTrackInfo {
    pub path: String,
    pub file_name: String,
}


#[tauri::command]
pub fn enable_track_for_eq(
    path: String,
    storage: State<'_, Storage>,
) -> Result<String, String> {

    let destination =
        storage
            .copy_to_temp(Path::new(&path))
            .map_err(|error| error.to_string())?;

    Ok(
        destination
            .to_string_lossy()
            .to_string()
    )
}


#[tauri::command]
pub fn list_eq_tracks(
    storage: State<'_, Storage>,
) -> Result<Vec<EqTrackInfo>, String> {

    let files =
        storage
            .list_temp_files()
            .map_err(|error| error.to_string())?;

    Ok(
        files
            .into_iter()
            .map(|path| EqTrackInfo {

                file_name: path
                    .file_name()
                    .map(|name| {
                        name.to_string_lossy().to_string()
                    })
                    .unwrap_or_default(),

                path: path
                    .to_string_lossy()
                    .to_string(),
            })
            .collect()
    )
}


#[tauri::command]
pub fn disable_track_for_eq(
    path: String,
    storage: State<'_, Storage>,
) -> Result<(), String> {

    storage
        .remove_temp_file(Path::new(&path))
        .map_err(|error| error.to_string())
}


// =============================================================
// REPRODUCCIÓN
// =============================================================

#[tauri::command]
pub fn play_eq_audio(
    path: String,
    player: State<'_, AudioPlayer>,
) -> Result<(), String> {

    player
        .play_eq_file(Path::new(&path))
        .map_err(|error| error.to_string())
}


#[tauri::command]
pub fn pause_eq_audio(
    player: State<'_, AudioPlayer>,
) -> Result<(), String> {

    player.pause_eq();

    Ok(())
}


#[tauri::command]
pub fn resume_eq_audio(
    player: State<'_, AudioPlayer>,
) -> Result<(), String> {

    player.resume_eq();

    Ok(())
}


#[tauri::command]
pub fn stop_eq_audio(
    player: State<'_, AudioPlayer>,
) -> Result<(), String> {

    player.stop_eq();

    Ok(())
}


#[tauri::command]
pub fn get_eq_audio_position(
    player: State<'_, AudioPlayer>,
) -> f64 {

    player
        .eq_position()
        .as_secs_f64()
}


#[tauri::command]
pub fn seek_eq_audio(
    seconds: f64,
    player: State<'_, AudioPlayer>,
) -> Result<(), String> {

    player
        .seek_eq(seconds)
        .map_err(|error| error.to_string())
}


// =============================================================
// BANDAS
// =============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EqBandInput {
    pub id: u32,
    pub filter_type: String,
    pub frequency: f32,
    pub gain_db: f32,
    pub q: f32,
}


fn parse_filter_type(
    value: &str,
) -> Result<EqFilterType, String> {

    match value {

        "peaking" =>
            Ok(EqFilterType::Peaking),

        "lowshelf" =>
            Ok(EqFilterType::LowShelf),

        "highshelf" =>
            Ok(EqFilterType::HighShelf),

        other =>
            Err(
                format!(
                    "Tipo de filtro desconocido: {other}"
                )
            ),
    }
}


#[tauri::command]
pub fn set_eq_band(
    band: EqBandInput,
    player: State<'_, AudioPlayer>,
) -> Result<(), String> {

    let filter_type =
        parse_filter_type(
            &band.filter_type
        )?;

    if !band.frequency.is_finite()
        || band.frequency <= 0.0
    {
        return Err(
            "La frecuencia debe ser un número positivo."
                .to_string()
        );
    }

    if !band.q.is_finite()
        || band.q <= 0.0
    {
        return Err(
            "El valor de Q debe ser un número positivo."
                .to_string()
        );
    }

    player
        .eq_state()
        .upsert_band(
            EqBand {
                id: band.id,
                filter_type,
                frequency: band.frequency,
                gain_db: band.gain_db,
                q: band.q,
            }
        );

    Ok(())
}


#[tauri::command]
pub fn remove_eq_band(
    band_id: u32,
    player: State<'_, AudioPlayer>,
) -> Result<(), String> {

    player
        .eq_state()
        .remove_band(band_id);

    Ok(())
}


#[tauri::command]
pub fn reset_eq(
    player: State<'_, AudioPlayer>,
) -> Result<(), String> {

    player
        .eq_state()
        .reset();

    Ok(())
}


// =============================================================
// PRESETS
// =============================================================

#[tauri::command]
pub fn get_eq_preset(
    track_id: String,
    store: State<'_, EqPresetStore>,
) -> Result<Option<EqPreset>, String> {

    store.get(&track_id)
}


#[tauri::command]
pub fn save_eq_preset(
    preset: EqPreset,
    store: State<'_, EqPresetStore>,
) -> Result<(), String> {

    store.save(preset)
}


#[tauri::command]
pub fn remove_eq_preset(
    track_id: String,
    store: State<'_, EqPresetStore>,
) -> Result<(), String> {

    store.remove(&track_id)
}