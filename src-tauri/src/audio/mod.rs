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

pub mod metadata;

#[cfg(desktop)]
pub mod decoder;

#[cfg(desktop)]
pub mod player;