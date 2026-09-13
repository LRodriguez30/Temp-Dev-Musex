// =============================================================
// MUSEX - AUDIO MODULE
// =============================================================
//
// Contiene la lógica relacionada con la reproducción y
// procesamiento de archivos de audio.
//
// La implementación se mantiene independiente de Tauri para
// poder probarla directamente desde Rust.
// =============================================================

pub mod decoder;
pub mod player;
pub mod metadata;