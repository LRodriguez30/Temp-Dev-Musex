// =============================================================
// COMANDOS - SENSE
// =============================================================

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::sense::prompts_system::{EQ_SYSTEM, RECOMMENDATIONS_SYSTEM};
use crate::sense::secrets;
use crate::sense::settings::{
    SenseSettings, DEFAULT_EQ_PROMPT, DEFAULT_LIBRARY_PROMPT, DEFAULT_RECOMMENDATIONS_PROMPT,
};
use crate::sense::store::SenseStore;

// =============================================================
// GEMINI
// =============================================================

const GEMINI_MODEL: &str = "gemini-3.5-flash-lite";

const GEMINI_BASE_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/models";

// =============================================================
// CONFIGURACIÓN DE SENSE
// =============================================================

#[tauri::command]
pub fn get_sense_settings(store: State<'_, SenseStore>) -> SenseSettings {
    store.get()
}

#[tauri::command]
pub fn set_sense_enabled(
    enabled: bool,
    store: State<'_, SenseStore>,
) -> Result<SenseSettings, String> {
    store.update(|settings| settings.enabled = enabled)
}

#[tauri::command]
pub fn set_sense_capability(
    capability: String,
    enabled: bool,
    store: State<'_, SenseStore>,
) -> Result<SenseSettings, String> {
    store.update(|settings| match capability.as_str() {
        "recommendations" => settings.capabilities.recommendations = enabled,
        "eq_assistant" => settings.capabilities.eq_assistant = enabled,
        "library_analysis" => settings.capabilities.library_analysis = enabled,
        _ => {}
    })
}

#[tauri::command]
pub fn set_sense_prompt(
    capability: String,
    prompt: String,
    store: State<'_, SenseStore>,
) -> Result<SenseSettings, String> {
    store.update(|settings| match capability.as_str() {
        "recommendations" => settings.prompts.recommendations = prompt,
        "eq_assistant" => settings.prompts.eq_assistant = prompt,
        "library_analysis" => settings.prompts.library_analysis = prompt,
        _ => {}
    })
}

#[tauri::command]
pub fn reset_sense_prompt(
    capability: String,
    store: State<'_, SenseStore>,
) -> Result<SenseSettings, String> {
    store.update(|settings| match capability.as_str() {
        "recommendations" => {
            settings.prompts.recommendations =
                DEFAULT_RECOMMENDATIONS_PROMPT.to_string()
        }

        "eq_assistant" => {
            settings.prompts.eq_assistant =
                DEFAULT_EQ_PROMPT.to_string()
        }

        "library_analysis" => {
            settings.prompts.library_analysis =
                DEFAULT_LIBRARY_PROMPT.to_string()
        }

        _ => {}
    })
}

// =============================================================
// API KEY
// =============================================================

#[tauri::command]
pub fn save_sense_api_key(
    key: String,
    store: State<'_, SenseStore>,
) -> Result<SenseSettings, String> {
    let trimmed = key.trim();

    if trimmed.is_empty() {
        return Err("La API Key no puede estar vacía.".to_string());
    }

    secrets::save_api_key(trimmed)?;

    store.update(|settings| settings.has_api_key = true)
}

#[tauri::command]
pub fn remove_sense_api_key(
    store: State<'_, SenseStore>,
) -> Result<SenseSettings, String> {
    secrets::delete_api_key()?;

    store.update(|settings| settings.has_api_key = false)
}

// =============================================================
// PRUEBA DE CONEXIÓN
// =============================================================
//
// La API Key permanece en Rust y se obtiene desde el keyring.
// Nunca se devuelve al frontend.
//
// La prueba consulta el endpoint de modelos de Gemini para
// verificar que la API Key pueda autenticarse correctamente.
// =============================================================

#[tauri::command]
pub async fn test_sense_connection() -> Result<bool, String> {
    let api_key = secrets::get_api_key()
        .ok_or("No hay ninguna API Key guardada.")?;

    let client = reqwest::Client::new();

    let response = client
        .get(GEMINI_BASE_URL)
        .header("x-goog-api-key", &api_key)
        .send()
        .await
        .map_err(|error| {
            format!("No se pudo contactar a Gemini: {error}")
        })?;

    match response.status().as_u16() {
        200..=299 => Ok(true),

        401 | 403 => Err(
            "La API Key no es válida o no tiene permisos para usar Gemini."
                .to_string(),
        ),

        429 => Err(
            "Se alcanzó el límite de solicitudes o cuota de Gemini."
                .to_string(),
        ),

        503 => Err(
            "Gemini está temporalmente no disponible. Intenta nuevamente en unos segundos."
                .to_string(),
        ),

        status => Err(
            format!("Gemini respondió con HTTP {status}.")
        ),
    }
}

// =============================================================
// RECOMENDACIONES
// =============================================================

#[derive(Debug, Deserialize)]
pub struct LibraryTrackPayload {
    pub title: String,
    pub artist: String,
    pub genre: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct HistoryEntryPayload {
    pub title: String,
    pub artist: String,

    #[serde(rename = "playedAt")]
    pub played_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecommendedTrack {
    pub title: String,
    pub artist: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct RecommendationsPayload {
    tracks: Vec<RecommendedTrack>,
}

// =============================================================
// GEMINI REQUEST
// =============================================================

#[derive(Serialize)]
struct GeminiPart {
    text: String,
}

#[derive(Serialize)]
struct GeminiContent {
    role: &'static str,
    parts: Vec<GeminiPart>,
}

#[derive(Serialize)]
struct GeminiThinkingConfig {
    #[serde(rename = "thinkingLevel")]
    thinking_level: &'static str,
}

#[derive(Serialize)]
struct GeminiGenerationConfig {
    #[serde(rename = "responseMimeType")]
    response_mime_type: &'static str,

    #[serde(rename = "thinkingConfig")]
    thinking_config: GeminiThinkingConfig,
}

#[derive(Serialize)]
struct GeminiSystemInstruction {
    parts: Vec<GeminiPart>,
}

#[derive(Serialize)]
struct GeminiRequest {
    #[serde(rename = "systemInstruction")]
    system_instruction: GeminiSystemInstruction,

    contents: Vec<GeminiContent>,

    #[serde(rename = "generationConfig")]
    generation_config: GeminiGenerationConfig,
}

// =============================================================
// GEMINI RESPONSE
// =============================================================

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: GeminiResponseContent,
}

#[derive(Deserialize)]
struct GeminiResponseContent {
    parts: Vec<GeminiResponsePart>,
}

#[derive(Deserialize)]
struct GeminiResponsePart {
    text: String,
}

// =============================================================
// RECOMENDACIONES
// =============================================================
//
// Angular envía:
// - biblioteca
// - historial reciente
//
// Rust añade:
// - prompt de sistema fijo
// - preferencia configurable del usuario
// - configuración de Gemini
//
// La API Key nunca llega a Angular.
// =============================================================

#[tauri::command]
pub async fn get_sense_recommendations(
    library: Vec<LibraryTrackPayload>,
    history: Vec<HistoryEntryPayload>,
    store: State<'_, SenseStore>,
) -> Result<Vec<RecommendedTrack>, String> {
    // ---------------------------------------------------------
    // 1. Verificar Sense
    // ---------------------------------------------------------

    let settings = store.get();

    if !settings.enabled {
        return Err(
            "Sense está deshabilitado.".to_string()
        );
    }

    if !settings.capabilities.recommendations {
        return Err(
            "Las recomendaciones no están habilitadas en Sense."
                .to_string()
        );
    }

    // ---------------------------------------------------------
    // 2. Obtener API Key
    // ---------------------------------------------------------

    let api_key = secrets::get_api_key()
        .ok_or("No hay ninguna API Key guardada.")?;

    // ---------------------------------------------------------
    // 3. Construir prompt de sistema
    // ---------------------------------------------------------

    let mut system_parts = vec![
        GeminiPart {
            text: RECOMMENDATIONS_SYSTEM.to_string(),
        }
    ];

    let user_style = settings.prompts.recommendations.trim();

    if !user_style.is_empty() {
        system_parts.push(
            GeminiPart {
                text: format!(
                    "Preferencia de estilo del usuario: {}",
                    user_style
                ),
            }
        );
    }

    // ---------------------------------------------------------
    // 4. Preparar información musical
    // ---------------------------------------------------------

    let data_json = serde_json::json!({
        "library": library
            .iter()
            .map(|track| {
                serde_json::json!({
                    "title": track.title,
                    "artist": track.artist,
                    "genre": track.genre,
                })
            })
            .collect::<Vec<_>>(),

        "recentHistory": history
            .iter()
            .map(|entry| {
                serde_json::json!({
                    "title": entry.title,
                    "artist": entry.artist,
                    "playedAt": entry.played_at,
                })
            })
            .collect::<Vec<_>>(),
    });

    // ---------------------------------------------------------
    // 5. Construir request
    // ---------------------------------------------------------

    let request_body = GeminiRequest {
        system_instruction: GeminiSystemInstruction {
            parts: system_parts,
        },

        contents: vec![
            GeminiContent {
                role: "user",

                parts: vec![
                    GeminiPart {
                        text: data_json.to_string(),
                    }
                ],
            }
        ],

        generation_config: GeminiGenerationConfig {
            response_mime_type: "application/json",

            thinking_config: GeminiThinkingConfig {
                thinking_level: "low",
            },
        },
    };

    // ---------------------------------------------------------
    // 6. Endpoint Gemini
    // ---------------------------------------------------------

    let url = format!(
        "{GEMINI_BASE_URL}/{GEMINI_MODEL}:generateContent"
    );

    let client = reqwest::Client::new();

    // ---------------------------------------------------------
    // 7. Solicitud
    // ---------------------------------------------------------

    let response = client
        .post(&url)
        .header("x-goog-api-key", &api_key)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|error| {
            format!("No se pudo contactar a Gemini: {error}")
        })?;

    // ---------------------------------------------------------
    // 8. Manejo de errores
    // ---------------------------------------------------------

    if !response.status().is_success() {
        let status = response.status();
        let status_code = status.as_u16();

        let body = response
            .text()
            .await
            .unwrap_or_default();

        return Err(
            match status_code {
                400 => {
                    format!(
                        "Gemini rechazó la solicitud. Detalle: {body}"
                    )
                }

                401 | 403 => {
                    "La API Key de Gemini no es válida \
                     o no tiene permisos."
                        .to_string()
                }

                429 => {
                    "Se alcanzó el límite de solicitudes \
                     o cuota de Gemini."
                        .to_string()
                }

                503 => {
                    "Gemini está temporalmente no disponible. \
                     Intenta nuevamente en unos segundos."
                        .to_string()
                }

                _ => {
                    format!(
                        "Gemini respondió HTTP {status}: {body}"
                    )
                }
            }
        );
    }

    // ---------------------------------------------------------
    // 9. Parsear respuesta
    // ---------------------------------------------------------

    let parsed: GeminiResponse = response
        .json()
        .await
        .map_err(|error| {
            format!(
                "Respuesta de Gemini inesperada: {error}"
            )
        })?;

    // ---------------------------------------------------------
    // 10. Extraer texto generado
    // ---------------------------------------------------------

    let text = parsed
        .candidates
        .first()
        .and_then(|candidate| {
            candidate.content.parts.first()
        })
        .map(|part| part.text.clone())
        .ok_or(
            "Gemini no devolvió contenido."
        )?;

    // ---------------------------------------------------------
    // 11. Convertir respuesta JSON
    // ---------------------------------------------------------

    let payload: RecommendationsPayload =
        serde_json::from_str(&text)
            .map_err(|error| {
                format!(
                    "Gemini devolvió un formato inválido: {error}"
                )
            })?;

    // ---------------------------------------------------------
    // 12. Resultado
    // ---------------------------------------------------------

    Ok(payload.tracks)
}

// =============================================================
// ASISTENTE DE ECUALIZACIÓN
// =============================================================
//
// Angular envía los metadatos de una canción.
//
// Rust añade:
// - prompt de sistema fijo
// - preferencia configurable del usuario
// - configuración de Gemini
//
// Gemini devuelve únicamente un preset JSON.
//
// La API Key nunca llega a Angular.
// =============================================================

#[derive(Debug, Deserialize)]
pub struct EqTrackPayload {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub genre: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EqBandResponse {
    pub frequency: f32,
    pub gain_db: f32,
    pub q: f32,
    pub filter_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EqPresetResponse {
    pub name: String,
    pub bands: Vec<EqBandResponse>,
}

// =============================================================
// VALIDACIÓN DEL PRESET
// =============================================================

fn validate_eq_preset(
    preset: &mut EqPresetResponse,
) -> Result<(), String> {

    // ---------------------------------------------------------
    // NOMBRE
    // ---------------------------------------------------------

    preset.name = preset.name.trim().to_string();

    if preset.name.is_empty() {
        preset.name = "Sense EQ".to_string();
    }

    // ---------------------------------------------------------
    // MÁXIMO DE BANDAS
    // ---------------------------------------------------------

    if preset.bands.len() > 6 {
        preset.bands.truncate(6);
    }

    // ---------------------------------------------------------
    // VALIDAR BANDAS
    // ---------------------------------------------------------

    for band in &mut preset.bands {

        // -----------------------------------------------------
        // FRECUENCIA
        // -----------------------------------------------------

        if !band.frequency.is_finite() {
            return Err(
                "Sense devolvió una frecuencia inválida."
                    .to_string()
            );
        }

        band.frequency =
            band.frequency.clamp(20.0, 20_000.0);

        // -----------------------------------------------------
        // GANANCIA
        // -----------------------------------------------------

        if !band.gain_db.is_finite() {
            return Err(
                "Sense devolvió una ganancia inválida."
                    .to_string()
            );
        }

        band.gain_db =
            band.gain_db.clamp(-24.0, 24.0);

        // -----------------------------------------------------
        // Q
        // -----------------------------------------------------

        if !band.q.is_finite() {
            return Err(
                "Sense devolvió un valor Q inválido."
                    .to_string()
            );
        }

        band.q =
            band.q.clamp(0.1, 10.0);

        // -----------------------------------------------------
        // TIPO DE FILTRO
        // -----------------------------------------------------

        match band.filter_type.as_str() {
            "peaking" |
            "lowshelf" |
            "highshelf" => {}

            other => {
                return Err(format!(
                    "Sense devolvió un tipo de filtro inválido: {other}"
                ));
            }
        }
    }

    Ok(())
}

// =============================================================
// COMANDO
// =============================================================

#[tauri::command]
pub async fn recommend_eq_preset(
    track: EqTrackPayload,
    store: State<'_, SenseStore>,
) -> Result<EqPresetResponse, String> {

    // ---------------------------------------------------------
    // 1. VERIFICAR SENSE
    // ---------------------------------------------------------

    let settings = store.get();

    if !settings.enabled {
        return Err(
            "Sense está deshabilitado."
                .to_string()
        );
    }

    if !settings.capabilities.eq_assistant {
        return Err(
            "El asistente de ecualización no está habilitado en Sense."
                .to_string()
        );
    }

    // ---------------------------------------------------------
    // 2. OBTENER API KEY
    // ---------------------------------------------------------

    let api_key = secrets::get_api_key()
        .ok_or(
            "No hay ninguna API Key guardada."
        )?;

    // ---------------------------------------------------------
    // 3. CONSTRUIR SYSTEM INSTRUCTION
    // ---------------------------------------------------------

    let mut system_parts = vec![
        GeminiPart {
            text: EQ_SYSTEM.to_string(),
        }
    ];

    // ---------------------------------------------------------
    // 4. PREFERENCIA DEL USUARIO
    // ---------------------------------------------------------

    let user_preference =
        settings.prompts.eq_assistant.trim();

    if !user_preference.is_empty() {
        system_parts.push(
            GeminiPart {
                text: format!(
                    "Preferencia secundaria del usuario: {}",
                    user_preference
                ),
            }
        );
    }

    // ---------------------------------------------------------
    // 5. PREPARAR METADATOS
    // ---------------------------------------------------------
    //
    // Estos valores son datos, no instrucciones.
    //

    let track_json = serde_json::json!({
        "title": track.title,
        "artist": track.artist,
        "album": track.album.unwrap_or_default(),
        "genre": track.genre.unwrap_or_default(),
    });

    // ---------------------------------------------------------
    // 6. CONSTRUIR REQUEST
    // ---------------------------------------------------------

    let request_body = GeminiRequest {
        system_instruction:
            GeminiSystemInstruction {
                parts: system_parts,
            },

        contents: vec![
            GeminiContent {
                role: "user",

                parts: vec![
                    GeminiPart {
                        text: format!(
                            "Datos de la canción:\n{}",
                            track_json
                        ),
                    }
                ],
            }
        ],

        generation_config:
            GeminiGenerationConfig {
                response_mime_type:
                    "application/json",

                thinking_config:
                    GeminiThinkingConfig {
                        thinking_level: "low",
                    },
            },
    };

    // ---------------------------------------------------------
    // 7. ENDPOINT GEMINI
    // ---------------------------------------------------------

    let url = format!(
        "{GEMINI_BASE_URL}/{GEMINI_MODEL}:generateContent"
    );

    let client = reqwest::Client::new();

    // ---------------------------------------------------------
    // 8. SOLICITUD
    // ---------------------------------------------------------

    let response = client
        .post(&url)
        .header("x-goog-api-key", &api_key)
        .header(
            "Content-Type",
            "application/json",
        )
        .json(&request_body)
        .send()
        .await
        .map_err(|error| {
            format!(
                "No se pudo contactar a Gemini: {error}"
            )
        })?;

    // ---------------------------------------------------------
    // 9. MANEJO DE ERRORES
    // ---------------------------------------------------------

    if !response.status().is_success() {
        let status = response.status();
        let status_code = status.as_u16();

        let body = response
            .text()
            .await
            .unwrap_or_default();

        return Err(
            match status_code {
                400 => {
                    format!(
                        "Gemini rechazó la solicitud. Detalle: {body}"
                    )
                }

                401 | 403 => {
                    "La API Key de Gemini no es válida \
                     o no tiene permisos."
                        .to_string()
                }

                429 => {
                    "Se alcanzó el límite de solicitudes \
                     o cuota de Gemini."
                        .to_string()
                }

                503 => {
                    "Gemini está temporalmente no disponible. \
                     Intenta nuevamente en unos segundos."
                        .to_string()
                }

                _ => {
                    format!(
                        "Gemini respondió HTTP {status}: {body}"
                    )
                }
            }
        );
    }

    // ---------------------------------------------------------
    // 10. PARSEAR RESPUESTA
    // ---------------------------------------------------------

    let parsed: GeminiResponse =
        response
            .json()
            .await
            .map_err(|error| {
                format!(
                    "Respuesta de Gemini inesperada: {error}"
                )
            })?;

    // ---------------------------------------------------------
    // 11. EXTRAER TEXTO
    // ---------------------------------------------------------

    let text = parsed
        .candidates
        .first()
        .and_then(|candidate| {
            candidate.content.parts.first()
        })
        .map(|part| part.text.clone())
        .ok_or(
            "Gemini no devolvió contenido."
        )?;

    // ---------------------------------------------------------
    // 12. CONVERTIR JSON
    // ---------------------------------------------------------

    let mut preset: EqPresetResponse =
        serde_json::from_str(&text)
            .map_err(|error| {
                format!(
                    "Gemini devolvió un preset inválido: {error}"
                )
            })?;

    // ---------------------------------------------------------
    // 13. VALIDAR
    // ---------------------------------------------------------

    validate_eq_preset(&mut preset)?;

    // ---------------------------------------------------------
    // 14. RESULTADO
    // ---------------------------------------------------------

    Ok(preset)
}