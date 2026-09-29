use serde::{Deserialize, Serialize};

// =============================================================
// PROMPTS POR DEFECTO
// =============================================================

pub const DEFAULT_RECOMMENDATIONS_PROMPT: &str =
    "Eres el asistente de recomendaciones de Musex. A partir del \
historial de reproducción y la biblioteca del usuario, sugiere \
canciones o artistas relacionados que probablemente le gusten. \
Responde siempre en JSON con la forma: { \"tracks\": [{ \"title\": \
string, \"artist\": string, \"reason\": string }] }.";

pub const DEFAULT_EQ_PROMPT: &str =
    "Genera una configuración de ecualización musical y claramente \
perceptible, adaptada al género, artista, título, álbum y tags \
proporcionados. Busca una curva tonal coherente, con graves, medios \
y agudos bien definidos. Evita configuraciones prácticamente planas \
y utiliza cada banda cuando aporte una función sonora real.";

pub const DEFAULT_LIBRARY_PROMPT: &str =
    "Eres el analista de biblioteca de Musex. A partir de los \
metadatos de la biblioteca (artistas, álbumes, géneros), genera \
una breve descripción de los gustos musicales dominantes del \
usuario. Responde siempre en JSON con la forma: { \"summary\": \
string, \"topGenres\": string[] }.";


// =============================================================
// CAPACIDADES
// =============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SenseCapabilities {
    pub recommendations: bool,
    pub eq_assistant: bool,
    pub library_analysis: bool,
}

impl Default for SenseCapabilities {
    fn default() -> Self {
        Self {
            recommendations: false,
            eq_assistant: false,
            library_analysis: false,
        }
    }
}


// =============================================================
// PROMPTS
// =============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensePrompts {
    pub recommendations: String,
    pub eq_assistant: String,
    pub library_analysis: String,
}

impl Default for SensePrompts {
    fn default() -> Self {
        Self {
            recommendations:
                DEFAULT_RECOMMENDATIONS_PROMPT.to_string(),

            eq_assistant:
                DEFAULT_EQ_PROMPT.to_string(),

            library_analysis:
                DEFAULT_LIBRARY_PROMPT.to_string(),
        }
    }
}


// =============================================================
// SETTINGS
// =============================================================
//
// `has_api_key` es solo una bandera informativa para la UI.
//
// La clave real nunca vive aquí. Se almacena en el keyring del
// sistema operativo (ver secrets.rs).
// =============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SenseSettings {
    pub enabled: bool,
    pub has_api_key: bool,
    pub capabilities: SenseCapabilities,
    pub prompts: SensePrompts,
}

impl Default for SenseSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            has_api_key: false,
            capabilities:
                SenseCapabilities::default(),
            prompts:
                SensePrompts::default(),
        }
    }
}