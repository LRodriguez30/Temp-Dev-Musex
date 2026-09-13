// =============================================================
// MUSEX - AUDIO DECODER
// =============================================================
//
// Responsable de abrir y decodificar archivos de audio.
//
// Este componente no controla la reproducción. Su función es
// preparar el audio para que posteriormente player.rs pueda
// enviarlo al dispositivo de salida.
//
// La configuración del decoder mantiene habilitado el acceso
// aleatorio al archivo para permitir desplazamientos hacia
// adelante y hacia atrás durante la reproducción.
// =============================================================

use std::fs::File;
use std::path::Path;

use rodio::Decoder;

/// Abre y decodifica un archivo de audio.
///
/// La función acepta cualquier ruta que pueda convertirse en
/// `Path` y devuelve una fuente de audio compatible con Rodio.
///
/// El tamaño real del archivo se proporciona explícitamente al
/// decoder para que Symphonia pueda realizar operaciones de
/// acceso aleatorio durante los desplazamientos de reproducción.
///
/// # Errors
///
/// Devuelve un error cuando:
///
/// - El archivo no existe.
/// - No se puede acceder al archivo.
/// - El contenido no corresponde a un formato compatible.
/// - El decoder no puede inicializarse correctamente.
pub fn decode_file(
    path: impl AsRef<Path>,
) -> Result<Decoder<File>, Box<dyn std::error::Error>> {
    let path = path.as_ref();

    let file = File::open(path)?;

    let byte_len = file.metadata()?.len();

    let decoder = Decoder::builder()
        .with_data(file)
        .with_byte_len(byte_len)
        .with_seekable(true)
        .build()?;

    Ok(decoder)
}

// =============================================================
// PREPARACIÓN PARA TAURI
// =============================================================
//
// Este componente no necesita convertirse directamente en un
// comando de Tauri.
//
// La comunicación continúa siendo:
//
// Angular
//    ↓
// commands/audio.rs
//    ↓
// audio/player.rs
//    ↓
// audio/decoder.rs
//
// De esta manera, Tauri actúa como puente y la lógica de audio
// permanece dentro del núcleo de Rust.
// =============================================================