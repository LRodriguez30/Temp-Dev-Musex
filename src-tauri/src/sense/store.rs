// =============================================================
// SENSE - PERSISTENCIA
// =============================================================
//
// Guarda la configuración no sensible de Sense (activado/apagado,
// capacidades, prompts) en un JSON dentro del almacenamiento de
// Musex. La API key NUNCA pasa por aquí — ver secrets.rs.
// =============================================================

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use super::settings::SenseSettings;

pub struct SenseStore {
    file_path: PathBuf,
    cache: Mutex<SenseSettings>,
}

impl SenseStore {
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        let sense_dir = base_dir.into().join("sense");
        let _ = fs::create_dir_all(&sense_dir);

        let file_path = sense_dir.join("settings.json");
        let cache = Self::read_from_disk(&file_path).unwrap_or_default();

        Self {
            file_path,
            cache: Mutex::new(cache),
        }
    }

    fn read_from_disk(path: &PathBuf) -> Option<SenseSettings> {
        let content = fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    fn write_to_disk(&self, settings: &SenseSettings) -> Result<(), String> {
        let json = serde_json::to_string_pretty(settings)
            .map_err(|error| error.to_string())?;

        fs::write(&self.file_path, json).map_err(|error| error.to_string())
    }

    pub fn get(&self) -> SenseSettings {
        self.cache
            .lock()
            .map(|settings| settings.clone())
            .unwrap_or_default()
    }

    /// Aplica una mutación, persiste el resultado en disco y
    /// devuelve la configuración actualizada — así cada comando
    /// puede responder directamente con el nuevo estado.
    pub fn update<F>(&self, mutator: F) -> Result<SenseSettings, String>
    where
        F: FnOnce(&mut SenseSettings),
    {
        let mut guard = self
            .cache
            .lock()
            .map_err(|_| "No se pudo acceder a la configuración de Sense.".to_string())?;

        mutator(&mut guard);
        self.write_to_disk(&guard)?;

        Ok(guard.clone())
    }
}