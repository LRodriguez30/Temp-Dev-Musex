// =============================================================
// COMANDOS TAURI
// =============================================================
//
// Este módulo agrupa las operaciones que estarán disponibles
// para la interfaz de Musex mediante Tauri.
//
// Cada archivo representa un área funcional de la aplicación.
// =============================================================

pub mod filesystem;
pub mod library;

#[cfg(desktop)]
pub mod audio;
#[cfg(desktop)]
pub mod downloads;
#[cfg(desktop)]
pub mod equalizer;
#[cfg(desktop)]
pub mod sense;