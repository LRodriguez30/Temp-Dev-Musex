// =============================================================
// MUSEX - EQUALIZER PRESETS
// =============================================================
//
// Persiste los presets del ecualizador por track.
//
// Se guarda como JSON dentro de:
//
// Desktop/Musex/equalizer/presets.json
//
// Cada preset pertenece a un track mediante su `track_id`.
// =============================================================

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::band::{EqBand, EqFilterType};


// =============================================================
// PRESET SOURCE
// =============================================================

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EqPresetSource {
    Manual,
    Sense,
}


// =============================================================
// BAND
// =============================================================
//
// Modelo serializable utilizado únicamente para persistencia.
// No reemplaza a `EqBand`, que sigue siendo el modelo real del
// ecualizador en memoria.
// =============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredEqBand {
    pub id: u32,
    pub filter_type: String,
    pub frequency: f32,
    pub gain_db: f32,
    pub q: f32,
}

impl From<&EqBand> for StoredEqBand {
    fn from(band: &EqBand) -> Self {
        Self {
            id: band.id,

            filter_type: match band.filter_type {
                EqFilterType::Peaking => "peaking".to_string(),
                EqFilterType::LowShelf => "lowshelf".to_string(),
                EqFilterType::HighShelf => "highshelf".to_string(),
            },

            frequency: band.frequency,
            gain_db: band.gain_db,
            q: band.q,
        }
    }
}

impl TryFrom<StoredEqBand> for EqBand {
    type Error = String;

    fn try_from(band: StoredEqBand) -> Result<Self, Self::Error> {
        let filter_type = match band.filter_type.as_str() {
            "peaking" => EqFilterType::Peaking,
            "lowshelf" => EqFilterType::LowShelf,
            "highshelf" => EqFilterType::HighShelf,

            other => {
                return Err(format!(
                    "Tipo de filtro inválido en preset: {other}"
                ));
            }
        };

        Ok(Self {
            id: band.id,
            filter_type,
            frequency: band.frequency,
            gain_db: band.gain_db,
            q: band.q,
        })
    }
}


// =============================================================
// PRESET
// =============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EqPreset {
    pub track_id: String,
    pub source: EqPresetSource,
    pub name: String,
    pub bands: Vec<StoredEqBand>,
}


// =============================================================
// STORE
// =============================================================

#[derive(Debug, Clone)]
pub struct EqPresetStore {
    file_path: PathBuf,
}

impl EqPresetStore {
    /// Crea el administrador de presets apuntando al archivo
    /// dentro del directorio base de Musex.
    pub fn new(base_dir: impl AsRef<Path>) -> Self {
        let equalizer_dir =
            base_dir.as_ref().join("equalizer");

        let _ = fs::create_dir_all(&equalizer_dir);

        Self {
            file_path: equalizer_dir.join("presets.json"),
        }
    }

    /// Carga todos los presets guardados.
    ///
    /// Si el archivo todavía no existe o está vacío,
    /// devuelve una lista vacía.
    pub fn load(&self) -> Result<Vec<EqPreset>, String> {
        if !self.file_path.is_file() {
            return Ok(Vec::new());
        }

        let content =
            fs::read_to_string(&self.file_path)
                .map_err(|error| error.to_string())?;

        if content.trim().is_empty() {
            return Ok(Vec::new());
        }

        serde_json::from_str(&content)
            .map_err(|error| error.to_string())
    }

    /// Obtiene el preset correspondiente a un track.
    pub fn get(
        &self,
        track_id: &str,
    ) -> Result<Option<EqPreset>, String> {
        let presets = self.load()?;

        Ok(
            presets
                .into_iter()
                .find(|preset| preset.track_id == track_id)
        )
    }

    /// Guarda o reemplaza el preset de un track.
    pub fn save(
        &self,
        preset: EqPreset,
    ) -> Result<(), String> {
        let mut presets = self.load()?;

        presets.retain(|existing| {
            existing.track_id != preset.track_id
        });

        presets.push(preset);

        self.write(&presets)
    }

    /// Elimina el preset de un track.
    pub fn remove(
        &self,
        track_id: &str,
    ) -> Result<(), String> {
        let mut presets = self.load()?;

        presets.retain(|preset| {
            preset.track_id != track_id
        });

        self.write(&presets)
    }

    /// Escribe todos los presets en disco.
    fn write(
        &self,
        presets: &[EqPreset],
    ) -> Result<(), String> {

        let serialized =
            serde_json::to_string_pretty(presets)
                .map_err(|error| error.to_string())?;

        fs::write(
            &self.file_path,
            serialized,
        )
        .map_err(|error| error.to_string())
    }
}