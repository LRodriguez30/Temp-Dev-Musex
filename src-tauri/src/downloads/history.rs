// =============================================================
// MUSEX - DOWNLOAD HISTORY
// =============================================================
//
// Persiste un historial de descargas completadas en disco.
//
// Se guarda como JSON dentro de la carpeta base de Musex:
//
// Desktop/Musex/history.json
//
// El historial es independiente del estado en memoria de
// DownloadManager: una descarga puede eliminarse de la cola
// visible en Angular sin que desaparezca del historial.
// =============================================================

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

// =============================================================
// ENTRY
// =============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadHistoryEntry {
    pub id: String,
    pub title: String,
    pub url: String,
    pub source: String,
    pub file_path: String,
    pub completed_at: String,
}

// =============================================================
// HISTORY
// =============================================================

#[derive(Debug, Clone)]
pub struct DownloadHistory {
    file_path: PathBuf,
}

impl DownloadHistory {
    /// Crea el administrador de historial apuntando al archivo
    /// dentro del directorio base de Musex.
    pub fn new(base_dir: impl AsRef<Path>) -> Self {
        Self {
            file_path: base_dir.as_ref().join("history.json"),
        }
    }

    /// Carga todas las entradas guardadas.
    ///
    /// Si el archivo no existe todavía, devuelve una lista vacía
    /// en lugar de un error.
    pub fn load(&self) -> Result<Vec<DownloadHistoryEntry>, String> {
        if !self.file_path.is_file() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&self.file_path)
            .map_err(|error| error.to_string())?;

        if content.trim().is_empty() {
            return Ok(Vec::new());
        }

        serde_json::from_str(&content)
            .map_err(|error| error.to_string())
    }

    /// Agrega una nueva entrada y persiste el archivo completo.
    ///
    /// Las entradas más recientes se colocan al inicio para que
    /// la interfaz no tenga que invertir el arreglo.
    pub fn add_entry(
        &self,
        entry: DownloadHistoryEntry,
    ) -> Result<(), String> {
        let mut entries = self.load()?;

        entries.insert(0, entry);

        self.save(&entries)
    }

    /// Elimina una entrada del historial mediante su id.
    pub fn remove_entry(&self, id: &str) -> Result<(), String> {
        let mut entries = self.load()?;

        entries.retain(|entry| entry.id != id);

        self.save(&entries)
    }

    /// Vacía completamente el historial.
    pub fn clear(&self) -> Result<(), String> {
        self.save(&Vec::new())
    }

    /// Escribe el arreglo completo de entradas en disco.
    fn save(
        &self,
        entries: &[DownloadHistoryEntry],
    ) -> Result<(), String> {
        let serialized = serde_json::to_string_pretty(entries)
            .map_err(|error| error.to_string())?;

        fs::write(&self.file_path, serialized)
            .map_err(|error| error.to_string())
    }
}