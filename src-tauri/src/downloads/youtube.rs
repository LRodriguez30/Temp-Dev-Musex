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

    /// URL canónica construida a partir del identificador.
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

        // URL canónica: elimina listas, tiempos y texto extra pegado.
        let url = format!(
            "https://www.youtube.com/watch?v={}",
            video_id
        );

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
/// Acepta el texto tal como lo pega el usuario: con o sin esquema
/// (`youtube.com/...`), con texto alrededor ("Mira esto https://..."),
/// con mayúsculas en el dominio y con parámetros extra.
///
/// Formatos compatibles:
///
/// - youtube.com/watch?v=ID (también m., music., www.)
/// - youtu.be/ID
/// - youtube.com/shorts/ID, /embed/ID, /live/ID, /v/ID
pub fn extract_video_id(url: &str) -> Result<String, String> {
    if url.trim().is_empty() {
        return Err("La URL de YouTube está vacía.".to_string());
    }

    let normalized = normalize_input(url).ok_or_else(|| {
        "La URL no corresponde a un formato compatible de YouTube.".to_string()
    })?;

    let (host, path, query) = split_url(&normalized);

    // youtu.be/ID
    if host == "youtu.be" || host == "www.youtu.be" {
        let id = path.trim_start_matches('/').split('/').next().unwrap_or("");
        return validate_video_id(id);
    }

    if is_youtube_host(&host) {
        // watch?v=ID (el parámetro puede ir en cualquier posición)
        for parameter in query.split('&') {
            if let Some(id) = parameter.strip_prefix("v=") {
                return validate_video_id(id);
            }
        }

        // /shorts/ID, /embed/ID, /live/ID, /v/ID
        for prefix in ["/shorts/", "/embed/", "/live/", "/v/"] {
            if let Some(rest) = path.strip_prefix(prefix) {
                let id = rest.split('/').next().unwrap_or("");
                return validate_video_id(id);
            }
        }
    }

    Err("La URL no corresponde a un formato compatible de YouTube.".to_string())
}

// =============================================================
// FUNCIONES INTERNAS
// =============================================================

/// Localiza la URL dentro del texto pegado y le añade el esquema
/// si falta. Devuelve `None` si no hay nada parecido a YouTube.
fn normalize_input(raw: &str) -> Option<String> {
    let token = raw.split_whitespace().find(|part| {
        let lower = part.to_ascii_lowercase();
        lower.contains("youtu.be")
            || lower.contains("youtube.com")
            || lower.contains("youtube-nocookie.com")
    })?;

    let token = token.trim_matches(|character: char| {
        matches!(
            character,
            '<' | '>' | '"' | '\'' | '(' | ')' | '[' | ']' | ',' | ';' | '.'
        )
    });

    let lower = token.to_ascii_lowercase();

    if lower.starts_with("http://") || lower.starts_with("https://") {
        Some(token.to_string())
    } else {
        Some(format!("https://{}", token.trim_start_matches('/')))
    }
}

/// Separa una URL en (host en minúsculas, ruta, query).
fn split_url(url: &str) -> (String, String, String) {
    let rest = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let rest = rest.split('#').next().unwrap_or("");

    let (before_query, query) = match rest.split_once('?') {
        Some((before, query)) => (before, query),
        None => (rest, ""),
    };

    let (authority, path) = match before_query.find('/') {
        Some(index) => (&before_query[..index], &before_query[index..]),
        None => (before_query, "/"),
    };

    let host = authority
        .rsplit('@')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();

    (host, path.to_string(), query.to_string())
}

fn is_youtube_host(host: &str) -> bool {
    host == "youtube.com"
        || host.ends_with(".youtube.com")
        || host == "youtube-nocookie.com"
        || host.ends_with(".youtube-nocookie.com")
}

fn validate_video_id(id: &str) -> Result<String, String> {
    if is_valid_video_id(id) {
        Ok(id.to_string())
    } else {
        Err("El identificador del video no es válido.".to_string())
    }
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