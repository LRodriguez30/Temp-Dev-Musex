// =============================================================
// SENSE - RECOMENDACIONES
// =============================================================

use serde::{Deserialize, Serialize};

use super::prompts_system::RECOMMENDATIONS_SYSTEM;
use super::secrets;
use super::store::SenseStore;

// =============================================================
// PAYLOAD DE ENTRADA (lo que Angular envía)
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

// =============================================================
// RESPUESTA (lo que Gemini debe devolver, validado)
// =============================================================

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
// GEMINI REQUEST / RESPONSE
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
struct GeminiGenerationConfig {
    #[serde(rename = "responseMimeType")]
    response_mime_type: &'static str,
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

// // =============================================================
// // COMANDO
// // =============================================================

// #[tauri::command]
// pub async fn get_sense_recommendations(
//     library: Vec<LibraryTrackPayload>,
//     history: Vec<HistoryEntryPayload>,
//     store: tauri::State<'_, SenseStore>,
// ) -> Result<Vec<RecommendedTrack>, String> {
//     let settings = store.get();

//     if !settings.enabled || !settings.capabilities.recommendations {
//         return Err("Las recomendaciones no están habilitadas en Sense.".to_string());
//     }

//     let api_key = secrets::get_api_key().ok_or("No hay ninguna API Key guardada.")?;

//     // ---------------------------------------------------------
//     // Instrucción de sistema: fija + preferencia de estilo del
//     // usuario, en ese orden, como partes del mismo bloque system.
//     // ---------------------------------------------------------

//     let mut system_parts = vec![GeminiPart {
//         text: RECOMMENDATIONS_SYSTEM.to_string(),
//     }];

//     let user_style = settings.prompts.recommendations.trim();

//     if !user_style.is_empty() {
//         system_parts.push(GeminiPart {
//             text: format!("Preferencia de estilo del usuario: {}", user_style),
//         });
//     }

//     // ---------------------------------------------------------
//     // Datos: biblioteca + historial, siempre como DATOS, nunca
//     // como parte de las instrucciones de sistema.
//     // ---------------------------------------------------------

//     let data_json = serde_json::json!({
//         "library": library.iter().map(|t| serde_json::json!({
//             "title": t.title,
//             "artist": t.artist,
//             "genre": t.genre,
//         })).collect::<Vec<_>>(),
//         "recentHistory": history.iter().map(|h| serde_json::json!({
//             "title": h.title,
//             "artist": h.artist,
//             "playedAt": h.played_at,
//         })).collect::<Vec<_>>(),
//     });

//     let request_body = GeminiRequest {
//         system_instruction: GeminiSystemInstruction { parts: system_parts },
//         contents: vec![GeminiContent {
//             role: "user",
//             parts: vec![GeminiPart {
//                 text: data_json.to_string(),
//             }],
//         }],
//         generation_config: GeminiGenerationConfig {
//             response_mime_type: "application/json",
//         },
//     };

//     let url = format!(
//         "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key={}",
//         api_key
//     );

//     let client = reqwest::Client::new();

//     let response = client
//         .post(&url)
//         .json(&request_body)
//         .send()
//         .await
//         .map_err(|error| format!("No se pudo contactar a Gemini: {error}"))?;

//     if !response.status().is_success() {
//         let status = response.status();
//         let body = response.text().await.unwrap_or_default();
//         return Err(format!("Gemini respondió {status}: {body}"));
//     }

//     let parsed: GeminiResponse = response
//         .json()
//         .await
//         .map_err(|error| format!("Respuesta de Gemini inesperada: {error}"))?;

//     let text = parsed
//         .candidates
//         .first()
//         .and_then(|c| c.content.parts.first())
//         .map(|p| p.text.clone())
//         .ok_or("Gemini no devolvió contenido.")?;

//     let payload: RecommendationsPayload = serde_json::from_str(&text)
//         .map_err(|error| format!("Gemini devolvió un formato inválido: {error}"))?;

//     Ok(payload.tracks)
// }