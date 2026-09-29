// =============================================================
// MUSEX - MÓDULO SENSE
// =============================================================
//
// Configuración y credenciales de Musex Sense.
//
// settings.rs -> estructura de configuración (capacidades, prompts)
// store.rs    -> persistencia de la configuración no sensible (JSON)
// secrets.rs  -> API key en el almacén de credenciales del sistema
// =============================================================

pub mod secrets;
pub mod settings;
pub mod store;
pub mod prompts_system;
pub mod recommendations;
pub mod eq;