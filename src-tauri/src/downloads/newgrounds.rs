// =============================================================
// MUSEX - NEWGROUNDS DOWNLOAD SOURCE
// =============================================================
//
// Contiene la lógica específica para trabajar con URLs de
// Newgrounds.
//
// En esta primera etapa solamente validamos URLs y obtenemos
// información básica de la pista cuando es posible.
//
// La descarga real se integrará posteriormente en el
// administrador de descargas.
// =============================================================

/// Información básica obtenida de una URL de Newgrounds.
#[derive(Debug, Clone)]
pub struct NewgroundsAudio {
    /// Identificador o referencia de la pista.
    pub audio_id: String,

    /// URL original proporcionada por el usuario.
    pub url: String,
}

impl NewgroundsAudio {
    /// Crea una representación de una pista de Newgrounds
    /// utilizando su URL.
    pub fn from_url(
        url: impl Into<String>,
    ) -> Result<Self, String> {
        let url = url.into();
        let audio_id = extract_audio_id(&url)?;

        Ok(Self {
            audio_id,
            url,
        })
    }
}

// =============================================================
// VALIDACIÓN DE URL
// =============================================================

/// Comprueba si una URL pertenece a Newgrounds y corresponde
/// a una página de audio compatible.
pub fn is_newgrounds_url(url: &str) -> bool {
    extract_audio_id(url).is_ok()
}

/// Extrae la referencia de una pista desde una URL de
/// Newgrounds.
///
/// Se contempla principalmente el formato:
///
/// https://www.newgrounds.com/audio/listen/123456
///
/// También se acepta:
///
/// https://newgrounds.com/audio/listen/123456
pub fn extract_audio_id(url: &str) -> Result<String, String> {
    let url = url.trim();

    if url.is_empty() {
        return Err("La URL de Newgrounds está vacía.".to_string());
    }

    // ---------------------------------------------------------
    // Comprobamos que el dominio corresponda a Newgrounds.
    // ---------------------------------------------------------

    if !is_newgrounds_domain(url) {
        return Err(
            "La URL no corresponde a Newgrounds.".to_string()
        );
    }

    // ---------------------------------------------------------
    // Buscamos el segmento utilizado por las páginas de audio.
    // ---------------------------------------------------------

    if let Some(audio_id) = extract_path_id(url, "/audio/listen/") {
        return Ok(audio_id);
    }

    Err(
        "La URL no corresponde a una pista de audio de Newgrounds."
            .to_string(),
    )
}

// =============================================================
// FUNCIONES INTERNAS
// =============================================================

/// Comprueba si la URL utiliza un dominio válido de Newgrounds.
fn is_newgrounds_domain(url: &str) -> bool {
    let url = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"));

    let Some(url) = url else {
        return false;
    };

    let host = url
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("");

    matches!(
        host,
        "newgrounds.com"
            | "www.newgrounds.com"
    )
}

/// Obtiene el identificador situado después de un segmento
/// específico de la ruta.
fn extract_path_id(url: &str, segment: &str) -> Option<String> {
    let position = url.find(segment)?;

    let start = position + segment.len();
    let remainder = &url[start..];

    let audio_id = remainder
        .split(['?', '&', '#', '/'])
        .next()
        .unwrap_or("");

    if is_valid_audio_id(audio_id) {
        Some(audio_id.to_string())
    } else {
        None
    }
}

/// Comprueba que la referencia de audio tenga contenido válido.
fn is_valid_audio_id(audio_id: &str) -> bool {
    !audio_id.is_empty()
        && audio_id
            .chars()
            .all(|character| character.is_ascii_digit())
}

// =============================================================
// PREPARACIÓN PARA TAURI
// =============================================================
//
// Posteriormente este módulo podrá utilizarse desde comandos
// Tauri para:
//
// - Validar URLs enviadas desde Angular.
// - Identificar pistas de Newgrounds.
// - Obtener información de la pista.
// - Iniciar una descarga.
// - Informar progreso.
// - Devolver el resultado a Angular.
//
// No agregamos Tauri ni librerías externas todavía.
// =============================================================