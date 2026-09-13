// =============================================================
// MUSEX - DATA MODELS
// =============================================================
//
// Este módulo centraliza las estructuras de datos utilizadas
// por los diferentes componentes del núcleo de Musex.
//
// La lógica de negocio no debe depender de Tauri. Estos modelos
// están diseñados para funcionar tanto en Rust puro como,
// posteriormente, dentro de Tauri.
// =============================================================

pub mod track;
pub mod playlist;
pub mod download;
pub mod player;