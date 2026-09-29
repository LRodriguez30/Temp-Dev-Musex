// =============================================================
// MUSEX - LIBRARY PERSISTENCE
// =============================================================
//
// Persiste metadata propia de Musex relacionada con la
// biblioteca musical.
//
// Esta información no pertenece a los archivos de audio.
// Por ahora se utiliza para conservar la fecha en que una
// canción fue agregada a la biblioteca.
// =============================================================

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackLibraryMetadata {
    #[serde(rename = "addedAt")]
    pub added_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct LibraryPersistence {
    tracks: HashMap<String, TrackLibraryMetadata>,
}

impl LibraryPersistence {
    pub fn new() -> Self {
        Self {
            tracks: HashMap::new(),
        }
    }

    pub fn load(
        path: impl AsRef<Path>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let path = path.as_ref();

        if !path.exists() {
            return Ok(Self::new());
        }

        let content = fs::read_to_string(path)?;
        let persistence = serde_json::from_str(&content)?;

        Ok(persistence)
    }

    pub fn save(
        &self,
        path: impl AsRef<Path>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let path = path.as_ref();

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let content = serde_json::to_string_pretty(self)?;

        fs::write(path, content)?;

        Ok(())
    }

    pub fn get_added_at(&self, track_id: &str) -> Option<&str> {
        self.tracks
            .get(track_id)
            .map(|metadata| metadata.added_at.as_str())
    }

    pub fn set_added_at(
        &mut self,
        track_id: impl Into<String>,
        added_at: impl Into<String>,
    ) {
        self.tracks.insert(
            track_id.into(),
            TrackLibraryMetadata {
                added_at: added_at.into(),
            },
        );
    }

    pub fn contains(&self, track_id: &str) -> bool {
        self.tracks.contains_key(track_id)
    }

    pub fn remove(&mut self, track_id: &str) -> bool {
        self.tracks.remove(track_id).is_some()
    }

    pub fn clear(&mut self) {
        self.tracks.clear();
    }

    pub fn track_count(&self) -> usize {
        self.tracks.len()
    }
}