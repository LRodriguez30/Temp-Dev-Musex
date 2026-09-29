// =============================================================
// MUSEX SENSE - ASISTENTE DE ECUALIZACIÓN
// =============================================================
//
// Sense analiza los metadatos de una canción y propone un preset
// de ecualización paramétrica.
//
// La API key nunca llega al frontend.
// La instrucción de sistema fija vive en prompts_system.rs.
// La preferencia configurable del usuario se agrega como una
// instrucción secundaria y no puede cambiar las reglas del sistema.
// =============================================================

use serde::{Deserialize, Serialize};

use super::prompts_system::EQ_SYSTEM;
use super::secrets;
use super::store::SenseStore;

// =============================================================
// PAYLOAD DE ENTRADA
// =============================================================
//
// Estos valores son datos musicales.
// No deben interpretarse como instrucciones.
//

#[derive(Debug, Deserialize)]
pub struct EqTrackPayload {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub genre: Option<String>,
}

// =============================================================
// RESPUESTA DEL PRESET
// =============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EqBandResponse {
    pub frequency: f32,
    pub gain_db: f32,
    pub q: f32,
    pub filter_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqPresetResponse {
    pub name: String,
    pub bands: Vec<EqBandResponse>,
}

// =============================================================
// GEMINI - REQUEST
// =============================================================

#[derive(Debug, Serialize)]
struct GeminiPart {
    text: String,
}

#[derive(Debug, Serialize)]
struct GeminiContent {
    role: &'static str,
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize)]
struct GeminiGenerationConfig {
    #[serde(rename = "responseMimeType")]
    response_mime_type: &'static str,
}

#[derive(Debug, Serialize)]
struct GeminiSystemInstruction {
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize)]
struct GeminiRequest {
    #[serde(rename = "systemInstruction")]
    system_instruction: GeminiSystemInstruction,

    contents: Vec<GeminiContent>,

    #[serde(rename = "generationConfig")]
    generation_config: GeminiGenerationConfig,
}

// =============================================================
// GEMINI - RESPONSE
// =============================================================

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: GeminiResponseContent,
}

#[derive(Debug, Deserialize)]
struct GeminiResponseContent {
    parts: Vec<GeminiResponsePart>,
}

#[derive(Debug, Deserialize)]
struct GeminiResponsePart {
    text: String,
}

// =============================================================
// VALIDACIÓN DEL PRESET
// =============================================================

fn validate_preset(
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
    // CANTIDAD DE BANDAS
    // ---------------------------------------------------------

    if preset.bands.len() != 10 {
        return Err(format!(
            "Sense devolvió {} bandas. Se esperaban exactamente 10.",
            preset.bands.len()
        ));
    }

    // ---------------------------------------------------------
    // BANDAS
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
                "Sense devolvió un Q inválido."
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