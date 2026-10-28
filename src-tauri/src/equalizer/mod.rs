// =============================================================
// MUSEX - MÓDULO ECUALIZADOR
// =============================================================
//
// Ecualizador paramétrico: el usuario define libremente cada
// banda (frecuencia, ganancia, Q, tipo de filtro).
//
// band.rs   -> definición de una banda individual
// state.rs  -> estado compartido thread-safe de las bandas
// source.rs -> adaptador Source de Rodio que aplica el filtrado
// =============================================================

mod band;
mod source;
mod state;
mod presets;

pub use band::{EqBand, EqFilterType};
pub use presets::{EqPreset, EqPresetSource, EqPresetStore};
pub use source::EqualizerSource;
pub use state::EqualizerState;