// =============================================================
// MUSEX - REPRODUCCIÓN EN SEGUNDO PLANO (escritorio)
// =============================================================
//
// - Controles multimedia de Windows (SMTC): superposición de
//   volumen, pantalla de bloqueo y teclas multimedia, con título,
//   artista, portada y barra de progreso.
// - Icono en la bandeja del sistema con acciones rápidas.
// - Al cerrar la ventana con música sonando, Musex sigue en
//   segundo plano en lugar de cerrarse.
//
// Los botones de Windows y de la bandeja se reenvían a Angular
// con el evento `media-control`; Angular mantiene el estado y
// manda aquí los metadatos con `media_set_metadata` y
// `media_set_playback`.
// =============================================================

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};

use crate::audio::player::AudioPlayer;

#[cfg(windows)]
use std::sync::Mutex;

#[cfg(windows)]
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback,
    MediaPosition, PlatformConfig, SeekDirection,
};

// =============================================================
// ESTADO
// =============================================================

/// Envoltorio para guardar los controles en el estado de Tauri.
///
/// SystemMediaTransportControls es un objeto "agile" de WinRT:
/// puede usarse desde cualquier hilo.
#[cfg(windows)]
struct SendControls(MediaControls);

#[cfg(windows)]
unsafe impl Send for SendControls {}

pub struct MediaState {
    #[cfg(windows)]
    controls: Mutex<Option<SendControls>>,

    /// Hay música sonando (decide si cerrar la ventana la oculta).
    playing: AtomicBool,

    /// Duración de la canción actual en milisegundos.
    duration_ms: AtomicU64,
}

impl MediaState {
    pub fn new() -> Self {
        Self {
            #[cfg(windows)]
            controls: Mutex::new(None),
            playing: AtomicBool::new(false),
            duration_ms: AtomicU64::new(0),
        }
    }

    fn is_playing(&self) -> bool {
        self.playing.load(Ordering::Relaxed)
    }
}

fn clean_seconds(value: f64) -> f64 {
    if value.is_finite() {
        value.max(0.0)
    } else {
        0.0
    }
}

fn emit_command(app: &AppHandle, command: &str) {
    let _ = app.emit("media-control", command.to_string());
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// =============================================================
// CONTROLES DE WINDOWS (SMTC)
// =============================================================

#[cfg(windows)]
pub fn init_controls(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    let config = PlatformConfig {
        dbus_name: "musex",
        display_name: "Musex",
        hwnd: Some(hwnd.0 as *mut std::ffi::c_void),
    };

    let mut controls = match MediaControls::new(config) {
        Ok(controls) => controls,
        Err(error) => {
            eprintln!("[MEDIA] No se pudieron crear los controles: {:?}", error);
            return;
        }
    };

    let handle = app.clone();

    let attached = controls.attach(move |event: MediaControlEvent| {
        let command = match event {
            MediaControlEvent::Play => "play".to_string(),
            MediaControlEvent::Pause => "pause".to_string(),
            MediaControlEvent::Toggle => "toggle".to_string(),
            MediaControlEvent::Next => "next".to_string(),
            MediaControlEvent::Previous => "prev".to_string(),
            MediaControlEvent::Stop => "pause".to_string(),

            MediaControlEvent::SetPosition(MediaPosition(position)) => {
                format!("seek:{}", position.as_secs_f64())
            }

            MediaControlEvent::SeekBy(direction, amount) => {
                let seconds = amount.as_secs_f64();

                match direction {
                    SeekDirection::Forward => format!("seekby:{}", seconds),
                    SeekDirection::Backward => format!("seekby:-{}", seconds),
                }
            }

            MediaControlEvent::Seek(direction) => match direction {
                SeekDirection::Forward => "seekby:10".to_string(),
                SeekDirection::Backward => "seekby:-10".to_string(),
            },

            _ => return,
        };

        emit_command(&handle, &command);
    });

    if let Err(error) = attached {
        eprintln!("[MEDIA] No se pudieron enlazar los botones: {:?}", error);
        return;
    }

    if let Some(state) = app.try_state::<MediaState>() {
        if let Ok(mut guard) = state.controls.lock() {
            *guard = Some(SendControls(controls));
        }
    }
}

#[cfg(not(windows))]
pub fn init_controls(_app: &AppHandle) {}

// =============================================================
// COMANDOS (Angular -> Rust)
// =============================================================

#[tauri::command]
pub fn media_set_metadata(
    title: String,
    artist: String,
    album: String,
    cover_url: Option<String>,
    duration_secs: f64,
    state: State<'_, MediaState>,
) -> Result<(), String> {
    let duration = clean_seconds(duration_secs);

    state
        .duration_ms
        .store((duration * 1000.0) as u64, Ordering::Relaxed);

    #[cfg(windows)]
    {
        let mut guard = state.controls.lock().map_err(|e| e.to_string())?;

        if let Some(controls) = guard.as_mut() {
            let cover = cover_url.filter(|url| !url.is_empty());

            controls
                .0
                .set_metadata(MediaMetadata {
                    title: Some(&title),
                    artist: Some(&artist),
                    album: Some(&album),
                    cover_url: cover.as_deref(),
                    duration: if duration > 0.0 {
                        Some(Duration::from_secs_f64(duration))
                    } else {
                        None
                    },
                })
                .map_err(|e| format!("{:?}", e))?;
        }
    }

    #[cfg(not(windows))]
    {
        let _ = (title, artist, album, cover_url);
    }

    Ok(())
}

/// `status`: "playing", "paused" o "stopped".
#[tauri::command]
pub fn media_set_playback(
    status: String,
    position_secs: f64,
    state: State<'_, MediaState>,
) -> Result<(), String> {
    state
        .playing
        .store(status == "playing", Ordering::Relaxed);

    #[cfg(windows)]
    {
        let mut guard = state.controls.lock().map_err(|e| e.to_string())?;

        if let Some(controls) = guard.as_mut() {
            let progress = Some(MediaPosition(Duration::from_secs_f64(
                clean_seconds(position_secs),
            )));

            let playback = match status.as_str() {
                "playing" => MediaPlayback::Playing { progress },
                "paused" => MediaPlayback::Paused { progress },
                _ => MediaPlayback::Stopped,
            };

            controls
                .0
                .set_playback(playback)
                .map_err(|e| format!("{:?}", e))?;
        }
    }

    #[cfg(not(windows))]
    {
        let _ = position_secs;
    }

    Ok(())
}

// =============================================================
// BANDEJA DEL SISTEMA
// =============================================================

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Mostrar Musex", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Reproducir / Pausar", true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "prev", "Anterior", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Siguiente", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &toggle, &previous, &next, &quit])?;

    let mut builder = TrayIconBuilder::with_id("musex-tray")
        .tooltip("Musex")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "toggle" => emit_command(app, "toggle"),
            "prev" => emit_command(app, "prev"),
            "next" => emit_command(app, "next"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;

    Ok(())
}

// =============================================================
// CERRAR VENTANA
// =============================================================

/// Con música sonando, cerrar la ventana la oculta y la música
/// sigue. Con la música en pausa o detenida, Musex se cierra.
pub fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if window.label() != "main" {
            return;
        }

        let playing = window
            .app_handle()
            .try_state::<MediaState>()
            .map(|state| state.is_playing())
            .unwrap_or(false);

        if playing {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

// =============================================================
// FIN DE CANCIÓN EN SEGUNDO PLANO
// =============================================================
//
// Con la ventana oculta o minimizada, Chromium reduce mucho la
// frecuencia de los temporizadores de la interfaz y la siguiente
// canción podría tardar en empezar. Este vigilante avisa a Angular
// en cuanto la canción termina, solo cuando la ventana no es visible.
// =============================================================

pub fn spawn_end_watchdog(app: AppHandle) {
    std::thread::spawn(move || {
        let mut was_playing = false;
        let mut last_position = 0.0_f64;
        let mut empty_polls = 0_u8;

        loop {
            std::thread::sleep(Duration::from_millis(500));

            let Some(player) = app.try_state::<AudioPlayer>() else {
                continue;
            };

            let Some(state) = app.try_state::<MediaState>() else {
                continue;
            };

            if player.is_playing() {
                was_playing = true;
                empty_polls = 0;
                last_position = player.position().as_secs_f64();
                continue;
            }

            if !player.is_empty() {
                // En pausa: no es un final de canción.
                was_playing = false;
                empty_polls = 0;
                continue;
            }

            if !was_playing {
                continue;
            }

            empty_polls += 1;

            // Dos comprobaciones seguidas evitan falsos finales
            // al buscar una posición o cambiar de canción.
            if empty_polls < 2 {
                continue;
            }

            was_playing = false;
            empty_polls = 0;

            let background = app
                .get_webview_window("main")
                .map(|window| {
                    !window.is_visible().unwrap_or(true)
                        || window.is_minimized().unwrap_or(false)
                })
                .unwrap_or(false);

            let duration = state.duration_ms.load(Ordering::Relaxed) as f64 / 1000.0;

            if background && duration > 0.0 && last_position >= duration - 3.0 {
                let _ = app.emit("musex-audio-ended", ());
            }
        }
    });
}
