// =============================================================
// ECUALIZADOR - ESTADO COMPARTIDO
// =============================================================

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use super::band::EqBand;

/// Estado compartido del ecualizador paramétrico.
///
/// `version` se incrementa en cada modificación de `bands` para
/// que `EqualizerSource` sepa, con una simple lectura atómica en
/// cada muestra, cuándo debe reconstruir la cadena de filtros.
pub struct EqualizerState {
    bands: Mutex<Vec<EqBand>>,
    version: AtomicU64,
}

impl EqualizerState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            bands: Mutex::new(Vec::new()),
            version: AtomicU64::new(0),
        })
    }

    pub fn bands(&self) -> Vec<EqBand> {
        self.bands
            .lock()
            .map(|bands| bands.clone())
            .unwrap_or_default()
    }

    pub fn version(&self) -> u64 {
        self.version.load(Ordering::Acquire)
    }

    pub fn set_bands(&self, bands: Vec<EqBand>) {
        if let Ok(mut guard) = self.bands.lock() {
            *guard = bands;
        }

        self.version.fetch_add(1, Ordering::Release);
    }

    pub fn upsert_band(&self, band: EqBand) {
        if let Ok(mut guard) = self.bands.lock() {
            match guard.iter_mut().find(|existing| existing.id == band.id) {
                Some(existing) => *existing = band,
                None => guard.push(band),
            }
        }

        self.version.fetch_add(1, Ordering::Release);
    }

    pub fn remove_band(&self, id: u32) {
        if let Ok(mut guard) = self.bands.lock() {
            guard.retain(|band| band.id != id);
        }

        self.version.fetch_add(1, Ordering::Release);
    }

    pub fn reset(&self) {
        self.set_bands(Vec::new());
    }
}