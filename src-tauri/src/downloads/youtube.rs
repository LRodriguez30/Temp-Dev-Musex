// =============================================================
// MUSEX - YOUTUBE DOWNLOAD SOURCE
// =============================================================
//
// Contiene la lógica específica para trabajar con URLs de
// YouTube.
//
// En esta primera etapa solamente validamos URLs y obtenemos
// el identificador del video.
//
// La descarga real se integrará posteriormente mediante el
// mecanismo que utilicemos para obtener el audio.
// =============================================================

/// Información básica obtenida de una URL de YouTube.
#[derive(Debug, Clone)]
pub struct YouTubeVideo {
    /// Identificador único del video en YouTube.
    pub video_id: String,

    /// URL original proporcionada por el usuario.
    pub url: String,
}

impl YouTubeVideo {
    /// Crea una representación de un video a partir de una URL.
    ///
    /// La URL debe corresponder a un formato reconocido de
    /// YouTube.
    pub fn from_url(
        url: impl Into<String>,
    ) -> Result<Self, String> {
        let url = url.into();
        let video_id = extract_video_id(&url)?;

        Ok(Self {
            video_id,
            url,
        })
    }
}

// =============================================================
// VALIDACIÓN DE URL
// =============================================================

/// Comprueba si una URL pertenece a YouTube.
pub fn is_youtube_url(url: &str) -> bool {
    extract_video_id(url).is_ok()
}

/// Extrae el identificador del video desde una URL de YouTube.
///
/// Se contemplan los formatos más habituales:
///
/// - https://www.youtube.com/watch?v=VIDEO_ID
/// - https://youtube.com/watch?v=VIDEO_ID
/// - https://youtu.be/VIDEO_ID
/// - https://www.youtube.com/shorts/VIDEO_ID
/// - https://www.youtube.com/embed/VIDEO_ID
pub fn extract_video_id(url: &str) -> Result<String, String> {
    let url = url.trim();

    if url.is_empty() {
        return Err("La URL de YouTube está vacía.".to_string());
    }

    // ---------------------------------------------------------
    // Formato: youtu.be/VIDEO_ID
    // ---------------------------------------------------------

    if let Some(rest) = url
        .strip_prefix("https://youtu.be/")
        .or_else(|| url.strip_prefix("http://youtu.be/"))
    {
        let video_id = clean_video_id(rest);

        if is_valid_video_id(video_id) {
            return Ok(video_id.to_string());
        }

        return Err("El identificador del video no es válido.".to_string());
    }

    // ---------------------------------------------------------
    // Formatos: youtube.com/watch?v=VIDEO_ID
    // ---------------------------------------------------------

    if url.contains("youtube.com/")
        || url.contains("youtube-nocookie.com/")
    {
        if let Some(query) = url.split_once('?').map(|(_, query)| query) {
            for parameter in query.split('&') {
                if let Some(video_id) = parameter.strip_prefix("v=") {
                    let video_id = clean_video_id(video_id);

                    if is_valid_video_id(video_id) {
                        return Ok(video_id.to_string());
                    }

                    return Err(
                        "El identificador del video no es válido."
                            .to_string(),
                    );
                }
            }
        }

        // -----------------------------------------------------
        // Formato: /shorts/VIDEO_ID
        // -----------------------------------------------------

        if let Some(video_id) = extract_path_id(url, "/shorts/") {
            return Ok(video_id);
        }

        // -----------------------------------------------------
        // Formato: /embed/VIDEO_ID
        // -----------------------------------------------------

        if let Some(video_id) = extract_path_id(url, "/embed/") {
            return Ok(video_id);
        }
    }

    Err("La URL no corresponde a un formato compatible de YouTube.".to_string())
}

// =============================================================
// FUNCIONES INTERNAS
// =============================================================

/// Extrae un identificador ubicado después de un segmento
/// concreto de la ruta.
fn extract_path_id(url: &str, segment: &str) -> Option<String> {
    let position = url.find(segment)?;

    let start = position + segment.len();
    let remainder = &url[start..];

    let video_id = remainder
        .split(['?', '&', '#', '/'])
        .next()
        .unwrap_or("");

    let video_id = clean_video_id(video_id);

    if is_valid_video_id(video_id) {
        Some(video_id.to_string())
    } else {
        None
    }
}

/// Elimina parámetros o fragmentos que puedan encontrarse
/// después del identificador del video.
fn clean_video_id(value: &str) -> &str {
    value
        .split(['?', '&', '#', '/'])
        .next()
        .unwrap_or("")
}

/// Comprueba que el identificador tenga una estructura válida.
///
/// Los IDs normales de YouTube utilizan 11 caracteres y
/// contienen letras, números, guiones o guiones bajos.
fn is_valid_video_id(video_id: &str) -> bool {
    video_id.len() == 11
        && video_id
            .chars()
            .all(|character| {
                character.is_ascii_alphanumeric()
                    || character == '-'
                    || character == '_'
            })
}

// =============================================================
// PREPARACIÓN PARA TAURI
// =============================================================
//
// Posteriormente este módulo podrá utilizarse desde comandos
// Tauri para:
//
// - Validar URLs enviadas desde Angular.
// - Obtener información del video.
// - Iniciar una descarga.
// - Informar progreso.
// - Devolver el resultado a Angular.
//
// No agregamos Tauri ni librerías externas todavía.
// =============================================================