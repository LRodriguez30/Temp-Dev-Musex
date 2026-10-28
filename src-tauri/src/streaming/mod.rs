// =============================================================
// STREAMING POR RED LOCAL (solo desktop)
// =============================================================
//
// Servidor HTTP que expone la biblioteca de Musex a los teléfonos
// vinculados.
//
//   POST /pair                    -> canjea el código del QR por un token
//   GET  /ping?token=...          -> comprueba la conexión
//   GET  /library?token=...       -> JSON con las pistas
//   GET  /stream/{id}?token=...   -> audio (soporta Range/seek)
//   GET  /cover/{id}?token=...    -> portada
//   GET  /playlists?token=...     -> playlists del escritorio (JSON)
//   GET  /favorites?token=...     -> IDs de canciones favoritas (JSON)
//
// Cada teléfono tiene su propio token (ver registry.rs).
// =============================================================

mod registry;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Path, Query, Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tauri::State as TauriState;
use tower::ServiceExt;
use tower_http::{cors::CorsLayer, services::ServeFile};

use crate::filesystem::storage::Storage;
use crate::library::persistence::LibraryPersistence;
use crate::library::scanner::LibraryScanner;
use crate::models::track::Track;

use registry::{PairError, PairedDeviceInfo, Registry};

const PORT: u16 = 47800;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

// -------------------------------------------------------------
// ESTADO DEL SERVIDOR
// -------------------------------------------------------------

#[derive(Clone)]
struct ServerState {
    storage: Arc<Storage>,
    registry: Arc<Mutex<Registry>>,
    tracks: Arc<RwLock<Vec<Track>>>,
    playlists: Arc<RwLock<String>>,
    favorites: Arc<RwLock<String>>,
}

#[derive(Deserialize)]
struct Auth {
    token: Option<String>,
}

impl ServerState {
    /// ¿El token pertenece a un teléfono vinculado?
    fn authorize(&self, auth: &Auth) -> bool {
        let Some(token) = auth.token.as_deref() else {
            return false;
        };

        match self.registry.lock() {
            Ok(mut registry) => registry.authorize(token, now_secs()),
            Err(_) => false,
        }
    }
}

// -------------------------------------------------------------
// VINCULACIÓN Y CONEXIÓN
// -------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairRequest {
    pairing_code: String,
    device_id: String,
    device_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PairResponse {
    token: String,
    host_id: String,
    host_name: String,
}

async fn pair(
    State(state): State<ServerState>,
    Json(request): Json<PairRequest>,
) -> Response {
    let Ok(mut registry) = state.registry.lock() else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };

    let result = registry.complete_pairing(
        &request.pairing_code,
        &request.device_id,
        &request.device_name,
        now_secs(),
    );

    match result {
        Ok(token) => {
            let (host_id, host_name) = registry.host();

            Json(PairResponse {
                token,
                host_id,
                host_name,
            })
            .into_response()
        }

        Err(PairError::InvalidCode) => StatusCode::UNAUTHORIZED.into_response(),
        Err(PairError::BadRequest) => StatusCode::BAD_REQUEST.into_response(),
        Err(PairError::Internal(_)) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn ping(
    State(state): State<ServerState>,
    Query(auth): Query<Auth>,
) -> Response {
    if !state.authorize(&auth) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let (host_id, host_name) = state
        .registry
        .lock()
        .map(|registry| registry.host())
        .unwrap_or_default();

    Json(serde_json::json!({
        "hostId": host_id,
        "hostName": host_name
    }))
    .into_response()
}

// -------------------------------------------------------------
// BIBLIOTECA
// -------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteTrack {
    id: String,
    title: String,
    artist: Option<String>,
    album: Option<String>,
    genre: Option<String>,
    duration: Option<u64>,
    added_at: String,
    has_cover: bool,
}

async fn scan(state: &ServerState) -> Option<Vec<Track>> {
    let storage = state.storage.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut tracks = LibraryScanner::new()
            .scan(storage.music_dir(), storage.covers_dir())
            .map_err(|error| error.to_string())?;

        if let Ok(mut persistence) =
            LibraryPersistence::load(&storage.library_metadata_file())
        {
            for track in &mut tracks {
                if let Some(added_at) = persistence.get_added_at(&track.id) {
                    track.added_at = added_at.to_string();
                }
            }
        }

        Ok::<Vec<Track>, String>(tracks)
    })
    .await;

    match result {
        Ok(Ok(tracks)) => Some(tracks),
        _ => None,
    }
}

async fn library(
    State(state): State<ServerState>,
    Query(auth): Query<Auth>,
) -> Response {
    if !state.authorize(&auth) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let Some(tracks) = scan(&state).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };

    let remote: Vec<RemoteTrack> = tracks
        .iter()
        .map(|track| RemoteTrack {
            id: track.id.clone(),
            title: track.title.clone(),
            artist: track.artist.clone(),
            album: track.album.clone(),
            genre: track.genre.clone(),
            duration: track.duration,
            added_at: track.added_at.clone(),
            has_cover: track.cover_path.is_some(),
        })
        .collect();

    if let Ok(mut cache) = state.tracks.write() {
        *cache = tracks;
    }

    Json(remote).into_response()
}

// -------------------------------------------------------------
// PLAYLISTS Y FAVORITOS
// -------------------------------------------------------------

/// Devuelve el JSON guardado (o "[]" si todavía no hay nada).
fn shared_json(store: &RwLock<String>) -> Response {
    let json = store
        .read()
        .map(|saved| saved.clone())
        .unwrap_or_default();

    let json = if json.trim().is_empty() {
        "[]".to_string()
    } else {
        json
    };

    (
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        json,
    )
        .into_response()
}

async fn playlists(
    State(state): State<ServerState>,
    Query(auth): Query<Auth>,
) -> Response {
    if !state.authorize(&auth) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    shared_json(&state.playlists)
}

async fn favorites(
    State(state): State<ServerState>,
    Query(auth): Query<Auth>,
) -> Response {
    if !state.authorize(&auth) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    shared_json(&state.favorites)
}

// -------------------------------------------------------------
// ARCHIVOS (audio y portadas)
// -------------------------------------------------------------

fn find_path(state: &ServerState, id: &str, cover: bool) -> Option<PathBuf> {
    let tracks = state.tracks.read().ok()?;
    let track = tracks.iter().find(|track| track.id == id)?;

    if cover {
        track.cover_path.as_ref().map(PathBuf::from)
    } else {
        Some(PathBuf::from(&track.path))
    }
}

async fn serve_file(
    state: ServerState,
    id: String,
    auth: Auth,
    req: Request,
    cover: bool,
) -> Response {
    if !state.authorize(&auth) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let mut path = find_path(&state, &id, cover);

    // Si el escritorio se reinició, la caché está vacía.
    if path.is_none() {
        if let Some(tracks) = scan(&state).await {
            if let Ok(mut cache) = state.tracks.write() {
                *cache = tracks;
            }
        }

        path = find_path(&state, &id, cover);
    }

    let Some(path) = path else {
        return StatusCode::NOT_FOUND.into_response();
    };

    ServeFile::new(path)
        .oneshot(req)
        .await
        .map(|response| response.into_response())
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn stream(
    State(state): State<ServerState>,
    Path(id): Path<String>,
    Query(auth): Query<Auth>,
    req: Request,
) -> Response {
    serve_file(state, id, auth, req, false).await
}

async fn cover(
    State(state): State<ServerState>,
    Path(id): Path<String>,
    Query(auth): Query<Auth>,
    req: Request,
) -> Response {
    serve_file(state, id, auth, req, true).await
}

fn router(state: ServerState) -> Router {
    Router::new()
        .route("/pair", post(pair))
        .route("/ping", get(ping))
        .route("/library", get(library))
        .route("/playlists", get(playlists))
        .route("/favorites", get(favorites))
        .route("/stream/{id}", get(stream))
        .route("/cover/{id}", get(cover))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

// -------------------------------------------------------------
// ESTADO COMPARTIDO CON TAURI
// -------------------------------------------------------------

pub struct StreamState {
    /// Se crea la primera vez que hace falta (necesita la carpeta base).
    registry: Mutex<Option<Arc<Mutex<Registry>>>>,

    /// El servidor ya fue iniciado.
    started: Mutex<bool>,

    playlists: Arc<RwLock<String>>,
    favorites: Arc<RwLock<String>>,
}

impl Default for StreamState {
    fn default() -> Self {
        Self {
            registry: Mutex::new(None),
            started: Mutex::new(false),
            playlists: Arc::new(RwLock::new("[]".to_string())),
            favorites: Arc::new(RwLock::new("[]".to_string())),
        }
    }
}

fn registry_for(
    storage: &Storage,
    stream_state: &StreamState,
) -> Result<Arc<Mutex<Registry>>, String> {
    let mut slot = stream_state
        .registry
        .lock()
        .map_err(|error| error.to_string())?;

    if slot.is_none() {
        let loaded = Registry::load(storage.base_dir())?;

        *slot = Some(Arc::new(Mutex::new(loaded)));
    }

    slot.as_ref()
        .cloned()
        .ok_or_else(|| "No se pudo abrir el registro de dispositivos.".to_string())
}

/// Angular entrega aquí las playlists (JSON) cada vez que cambian,
/// para que el servidor pueda ofrecérselas a los teléfonos.
#[tauri::command]
pub fn set_stream_playlists(
    json: String,
    stream_state: TauriState<'_, StreamState>,
) -> Result<(), String> {
    *stream_state
        .playlists
        .write()
        .map_err(|error| error.to_string())? = json;

    Ok(())
}

/// Igual que las playlists, pero con los IDs de las canciones favoritas.
#[tauri::command]
pub fn set_stream_favorites(
    json: String,
    stream_state: TauriState<'_, StreamState>,
) -> Result<(), String> {
    *stream_state
        .favorites
        .write()
        .map_err(|error| error.to_string())? = json;

    Ok(())
}

// -------------------------------------------------------------
// COMANDOS PARA ANGULAR
// -------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamInfo {
    /// Dirección del servidor, por ejemplo http://192.168.1.5:47800
    pub url: String,

    /// Código de un solo uso para el QR (vence en 5 minutos).
    pub pairing_code: String,
    pub expires_at: u64,

    pub host_id: String,
    pub host_name: String,
}

/// Inicia el servidor (la primera vez) y genera un código de
/// vinculación nuevo para el QR.
#[tauri::command]
pub async fn get_stream_info(
    storage: TauriState<'_, Storage>,
    stream_state: TauriState<'_, StreamState>,
) -> Result<StreamInfo, String> {
    let registry = registry_for(&storage, &stream_state)?;

    let ip = local_ip_address::local_ip()
        .map_err(|error| format!("No se pudo obtener la IP local: {error}"))?;

    // ---- Arranque (una sola vez, sin carreras) ----

    let must_start = {
        let mut started = stream_state
            .started
            .lock()
            .map_err(|error| error.to_string())?;

        let first_time = !*started;
        *started = true;

        first_time
    };

    if must_start {
        let bound = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], PORT))).await;

        let listener = match bound {
            Ok(listener) => listener,

            Err(error) => {
                if let Ok(mut started) = stream_state.started.lock() {
                    *started = false;
                }

                return Err(format!("No se pudo abrir el puerto {PORT}: {error}"));
            }
        };

        let state = ServerState {
            storage: Arc::new(Storage::new(storage.base_dir().to_path_buf())),
            registry: registry.clone(),
            tracks: Arc::default(),
            playlists: stream_state.playlists.clone(),
            favorites: stream_state.favorites.clone(),
        };

        tauri::async_runtime::spawn(async move {
            let _ = axum::serve(listener, router(state)).await;
        });
    }

    // ---- Código nuevo ----

    let (pairing_code, expires_at, host_id, host_name) = {
        let mut registry = registry.lock().map_err(|error| error.to_string())?;

        let (code, expires_at) = registry.begin_pairing(now_secs())?;
        let (host_id, host_name) = registry.host();

        (code, expires_at, host_id, host_name)
    };

    Ok(StreamInfo {
        url: format!("http://{ip}:{PORT}"),
        pairing_code,
        expires_at,
        host_id,
        host_name,
    })
}

#[tauri::command]
pub fn list_paired_devices(
    storage: TauriState<'_, Storage>,
    stream_state: TauriState<'_, StreamState>,
) -> Result<Vec<PairedDeviceInfo>, String> {
    let registry = registry_for(&storage, &stream_state)?;

    let registry = registry.lock().map_err(|error| error.to_string())?;

    Ok(registry.list(now_secs()))
}

#[tauri::command]
pub fn revoke_paired_device(
    id: String,
    storage: TauriState<'_, Storage>,
    stream_state: TauriState<'_, StreamState>,
) -> Result<(), String> {
    let registry = registry_for(&storage, &stream_state)?;

    let mut registry = registry.lock().map_err(|error| error.to_string())?;

    registry.revoke(&id);

    Ok(())
}