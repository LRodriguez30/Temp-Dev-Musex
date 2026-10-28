use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use serde::Serialize;
use sha2::{Digest, Sha256};

pub const AUDIO_EXTENSIONS: [&str; 8] =
    ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "wma"];

const SKIPPED_TOP_LEVEL: [&str; 7] = [
    "Android",
    "Alarms",
    "Notifications",
    "Ringtones",
    "DCIM",
    "Pictures",
    "Movies",
];

const MAX_BROWSER_DEPTH: u32 = 32;
const MAX_SCAN_DEPTH: u32 = 6;
const HASH_BUFFER_SIZE: usize = 64 * 1024;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PhoneFolder {
    pub path: String,
    pub name: String,
    pub audio_count: u32,
    pub size_bytes: u64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserEntry {
    pub path: String,
    pub name: String,
    pub is_directory: bool,
    pub audio_count: u32,
    pub size_bytes: u64,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult {
    pub transferred: u32,
    pub skipped: u32,
    pub failed: u32,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCheck {
    pub path: String,
    pub status: String,
    pub matched_title: Option<String>,
    pub matched_artist: Option<String>,
}

// =============================================================
// ÍNDICE REUTILIZABLE DE DUPLICADOS
// =============================================================

#[derive(Debug, Clone)]
struct LibraryAudio {
    path: PathBuf,
    size: u64,
    modified: Option<SystemTime>,
    hash: Option<String>,
    normalized_stem: String,
}

#[derive(Default)]
struct LibraryIndex {
    entries: Vec<LibraryAudio>,
    by_size: HashMap<u64, Vec<usize>>,
    by_stem: HashMap<String, Vec<usize>>,
}

static LIBRARY_INDEXES: OnceLock<Mutex<HashMap<PathBuf, LibraryIndex>>> =
    OnceLock::new();

fn library_indexes() -> &'static Mutex<HashMap<PathBuf, LibraryIndex>> {
    LIBRARY_INDEXES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn normalize_metadata(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .chars()
        .filter(|character| character.is_alphanumeric())
        .collect()
}

fn normalized_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(OsStr::to_str)
        .map(normalize_metadata)
        .unwrap_or_default()
}

impl LibraryIndex {
    fn build(music_dir: &Path) -> Self {
        let mut paths = Vec::new();
        collect_audio_files(music_dir, &mut paths, 0);

        let mut index = Self {
            entries: Vec::with_capacity(paths.len()),
            by_size: HashMap::new(),
            by_stem: HashMap::new(),
        };

        for path in paths {
            let Ok(metadata) = fs::metadata(&path) else {
                continue;
            };

            if !metadata.is_file() {
                continue;
            }

            let stem = normalized_stem(&path);
            let entry_index = index.entries.len();

            index.entries.push(LibraryAudio {
                path,
                size: metadata.len(),
                modified: metadata.modified().ok(),
                hash: None,
                normalized_stem: stem.clone(),
            });

            index
                .by_size
                .entry(metadata.len())
                .or_default()
                .push(entry_index);

            if !stem.is_empty() {
                index.by_stem.entry(stem).or_default().push(entry_index);
            }
        }

        index
    }

    fn candidates(&self, size: u64, stem: &str) -> Vec<usize> {
        let mut candidates = HashSet::new();

        if let Some(indices) = self.by_size.get(&size) {
            candidates.extend(indices.iter().copied());
        }

        if !stem.is_empty() {
            if let Some(indices) = self.by_stem.get(stem) {
                candidates.extend(indices.iter().copied());
            }
        }

        let mut candidates: Vec<usize> = candidates.into_iter().collect();
        candidates.sort_unstable();
        candidates
    }

    fn add_hash(&mut self, path: &Path, hash: String) {

        if let Some(index) = self.entries.iter().position(|entry| entry.path == path) {
            self.entries[index].hash = Some(hash);
        }
    }
}

/// Invalida el índice después de importar, eliminar o modificar archivos.
///
/// Debe llamarse con el directorio `music` de Musex.
pub fn invalidate_duplicate_index(music_dir: &Path) {
    let canonical_dir = music_dir.canonicalize().unwrap_or_else(|_| music_dir.to_path_buf());

    if let Ok(mut indexes) = library_indexes().lock() {
        indexes.remove(&canonical_dir);
    }
}

/// Devuelve un índice existente o construye uno si todavía no existe.
///
/// No comprueba los metadatos de todos los archivos en cada consulta:
/// eso volvería a introducir el cuello de botella de la exploración.
fn ensure_library_index(music_dir: &Path) -> Result<PathBuf, String> {
    let canonical_dir = music_dir.canonicalize().map_err(|e| e.to_string())?;

    {
        let indexes = library_indexes()
            .lock()
            .map_err(|_| "El índice de música está bloqueado.".to_string())?;

        if indexes.contains_key(&canonical_dir) {
            return Ok(canonical_dir);
        }
    }

    // Construir el índice fuera del bloqueo para no detener otras consultas.
    let built_index = LibraryIndex::build(&canonical_dir);

    let mut indexes = library_indexes()
        .lock()
        .map_err(|_| "El índice de música está bloqueado.".to_string())?;

    // Otra consulta podría haberlo construido mientras tanto.
    indexes.entry(canonical_dir.clone()).or_insert(built_index);

    Ok(canonical_dir)
}

fn cached_hash(
    music_dir: &Path,
    candidate_path: &Path,
) -> Option<String> {
    // Leer el hash de caché sin mantener el bloqueo durante operaciones de disco.
    {
        let indexes = library_indexes().lock().ok()?;
        let index = indexes.get(music_dir)?;

        if let Some(entry) = index.entries.iter().find(|entry| entry.path == candidate_path) {
            if let Some(hash) = &entry.hash {
                return Some(hash.clone());
            }
        }
    }

    let hash = file_hash(candidate_path).ok()?;

    // Guardar el resultado después de calcularlo, fuera del bloqueo.
    if let Ok(mut indexes) = library_indexes().lock() {
        if let Some(index) = indexes.get_mut(music_dir) {
            index.add_hash(candidate_path, hash.clone());
        }
    }

    Some(hash)
}

/// Compara archivos seleccionados del teléfono con la biblioteca de Musex.
///
/// `exact`: SHA-256 idéntico.
/// `probable`: coincide el nombre normalizado o los metadatos.
/// `none`: no se encontró coincidencia.
pub fn analyze_audio_duplicates(
    paths: &[String],
    source_root: &Path,
    music_dir: &Path,
) -> Result<Vec<DuplicateCheck>, String> {
    let root = source_root.canonicalize().map_err(|e| e.to_string())?;
    let canonical_music_dir = ensure_library_index(music_dir)?;

    let mut results = Vec::with_capacity(paths.len());

    for raw in paths {
        let requested = PathBuf::from(raw);

        if has_parent_dir(&requested) || !is_audio(&requested) {
            continue;
        }

        let source = match requested.canonicalize() {
            Ok(path)
                if path.starts_with(&root)
                    && path.is_file()
                    && !path.starts_with(&canonical_music_dir) =>
            {
                path
            }
            _ => continue,
        };

        let metadata = match fs::metadata(&source) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };

        let size = metadata.len();
        let stem = normalized_stem(&source);

        // Copiar solo la información de los candidatos. No mantener el mutex
        // durante la lectura de archivos ni durante el análisis de metadata.
        let candidates: Vec<LibraryAudio> = {
            let indexes = library_indexes()
                .lock()
                .map_err(|_| "El índice de música está bloqueado.".to_string())?;

            let Some(index) = indexes.get(&canonical_music_dir) else {
                return Err("No se pudo obtener el índice de música.".into());
            };

            index
                .candidates(size, &stem)
                .into_iter()
                .filter_map(|i| index.entries.get(i).cloned())
                .collect()
        };

        if candidates.is_empty() {
            results.push(DuplicateCheck {
                path: source.to_string_lossy().to_string(),
                status: "none".into(),
                matched_title: None,
                matched_artist: None,
            });
            continue;
        }

        // Calcular el hash de origen solo si hay candidatos del mismo tamaño.
        let has_same_size = candidates.iter().any(|candidate| candidate.size == size);

        let source_hash = if has_same_size {
            file_hash(&source).ok()
        } else {
            None
        };

        let mut exact_match = None;

        if let Some(source_hash) = source_hash.as_ref() {
            for candidate in candidates.iter().filter(|candidate| candidate.size == size) {
                let candidate_hash = cached_hash(&canonical_music_dir, &candidate.path);

                if candidate_hash.as_ref() == Some(source_hash) {
                    exact_match = Some(candidate.path.clone());
                    break;
                }
            }
        }

        if exact_match.is_some() {
            results.push(DuplicateCheck {
                path: source.to_string_lossy().to_string(),
                status: "exact".into(),
                matched_title: None,
                matched_artist: None,
            });
            continue;
        }

        // Los metadatos se consultan solo si no se encontró una coincidencia exacta.
        let source_audio =
            crate::audio::metadata::AudioMetadata::from_file(&source).ok();

        let source_title = source_audio
            .as_ref()
            .and_then(|metadata| metadata.title.as_deref())
            .map(normalize_metadata)
            .unwrap_or_default();

        let source_artist = source_audio
            .as_ref()
            .and_then(|metadata| metadata.artist.as_deref())
            .map(normalize_metadata)
            .unwrap_or_default();

        let mut probable_match: Option<(PathBuf, Option<String>, Option<String>)> = None;

        if !source_title.is_empty() && !source_artist.is_empty() {
            for candidate in &candidates {
                let audio =
                    crate::audio::metadata::AudioMetadata::from_file(&candidate.path).ok();

                let title = audio
                    .as_ref()
                    .and_then(|metadata| metadata.title.clone());

                let artist = audio
                    .as_ref()
                    .and_then(|metadata| metadata.artist.clone());

                let title_key = title.as_deref().map(normalize_metadata).unwrap_or_default();
                let artist_key = artist.as_deref().map(normalize_metadata).unwrap_or_default();

                if title_key == source_title && artist_key == source_artist {
                    probable_match = Some((candidate.path.clone(), title, artist));
                    break;
                }
            }
        }

        // Si no coinciden los metadatos, el nombre solo se considera una
        // coincidencia probable, nunca una coincidencia exacta.
        if probable_match.is_none() && !stem.is_empty() {
            if let Some(candidate) = candidates
                .iter()
                .find(|candidate| candidate.normalized_stem == stem)
            {
                let audio =
                    crate::audio::metadata::AudioMetadata::from_file(&candidate.path).ok();

                probable_match = Some((
                    candidate.path.clone(),
                    audio.as_ref().and_then(|metadata| metadata.title.clone()),
                    audio.as_ref().and_then(|metadata| metadata.artist.clone()),
                ));
            }
        }

        let (status, matched_title, matched_artist) = match probable_match {
            Some((_, title, artist)) => ("probable".to_string(), title, artist),
            None => ("none".to_string(), None, None),
        };

        results.push(DuplicateCheck {
            path: source.to_string_lossy().to_string(),
            status,
            matched_title,
            matched_artist,
        });
    }

    Ok(results)
}

// =============================================================
// UTILIDADES DE ARCHIVOS
// =============================================================

pub fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .map(|extension| {
            AUDIO_EXTENSIONS
                .iter()
                .any(|audio| audio.eq_ignore_ascii_case(extension))
        })
        .unwrap_or(false)
}

pub fn has_parent_dir(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn contains_wav(dir: &Path, root: &Path, depth: u32) -> bool {
    if depth > 8 {
        return false;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();

        if name.to_string_lossy().starts_with('.') {
            continue;
        }

        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };

        if metadata.file_type().is_symlink() {
            continue;
        }

        if metadata.is_file()
            && path.extension()
                .and_then(OsStr::to_str)
                .is_some_and(|ext| ext.eq_ignore_ascii_case("wav"))
        {
            return true;
        }

        if metadata.is_dir() {
            let Ok(canonical) = path.canonicalize() else {
                continue;
            };

            if canonical.starts_with(root)
                && contains_wav(&canonical, root, depth + 1)
            {
                return true;
            }
        }
    }

    false
}

/// Escaneo recursivo reservado para el listado de carpetas con música.
/// No se utiliza para listar cada directorio del explorador.
fn contains_audio(dir: &Path, root: &Path, depth: u32) -> bool {
    if depth > 8 {
        return false;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };

    for entry in entries.flatten() {
        let path = entry.path();

        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };

        if metadata.file_type().is_symlink() {
            continue;
        }

        if metadata.is_file() && is_audio(&path) {
            return true;
        }

        if metadata.is_dir() {
            let name = entry.file_name();

            if name.to_string_lossy().starts_with('.') {
                continue;
            }

            let Ok(canonical) = path.canonicalize() else {
                continue;
            };

            if canonical.starts_with(root) && contains_audio(&canonical, root, depth + 1) {
                return true;
            }
        }
    }

    false
}

/// Lista únicamente las entradas inmediatas de la carpeta solicitada.
///
/// No recorre subcarpetas para calcular su contenido: esto evita que
/// abrir una carpeta con miles de archivos provoque un escaneo profundo.
pub fn list_directory(
    dir: &Path,
    root: &Path,
) -> Result<Vec<BrowserEntry>, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let dir = dir.canonicalize().map_err(|e| e.to_string())?;

    if !dir.starts_with(&root) {
        return Err("La carpeta solicitada no está permitida.".into());
    }

    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if name.starts_with('.') {
            continue;
        }

        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };

        if metadata.file_type().is_symlink() {
            continue;
        }

        let is_directory = metadata.is_dir();

        if is_directory {
            // Mostrar solo carpetas que contienen archivos WAV.
            if !contains_wav(&path, &root, 0) {
                continue;
            }
        } else if !metadata.is_file() || !is_audio(&path) {
            continue;
        }

        let Ok(canonical) = path.canonicalize() else {
            continue;
        };

        if !canonical.starts_with(&root) {
            continue;
        }

        result.push(BrowserEntry {
            path: canonical.to_string_lossy().to_string(),
            name,
            is_directory,
            audio_count: if is_directory { 0 } else { 1 },
            size_bytes: if is_directory { 0 } else { metadata.len() },
        });
    }

    result.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(result)
}

/// Conservado para compatibilidad con la pantalla anterior.
pub fn scan_audio_folders(root: &Path, skip: &Path) -> Vec<PhoneFolder> {
    let mut folders = Vec::new();
    walk(root, 0, skip, &mut folders);
    folders.sort_by(|a, b| b.audio_count.cmp(&a.audio_count));
    folders.truncate(300);
    folders
}

fn walk(dir: &Path, depth: u32, skip: &Path, out: &mut Vec<PhoneFolder>) {
    if depth > MAX_SCAN_DEPTH || dir.starts_with(skip) {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    let mut count = 0u32;
    let mut size = 0u64;
    let mut subfolders = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if name.starts_with('.') {
            continue;
        }

        let Ok(kind) = entry.file_type() else {
            continue;
        };

        if kind.is_symlink() {
            continue;
        }

        if kind.is_dir() {
            if depth == 0 && SKIPPED_TOP_LEVEL.contains(&name.as_str()) {
                continue;
            }

            subfolders.push(path);
        } else if kind.is_file() && is_audio(&path) {
            count += 1;
            size += entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        }
    }

    if count > 0 {
        out.push(PhoneFolder {
            path: dir.to_string_lossy().to_string(),
            name: dir.file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| dir.to_string_lossy().to_string()),
            audio_count: count,
            size_bytes: size,
        });
    }

    for child in subfolders {
        walk(&child, depth + 1, skip, out);
    }
}

// =============================================================
// DESTINOS, TRANSFERENCIA E IMPORTACIÓN
// =============================================================

pub fn unique_destination(dir: &Path, file_name: &OsStr) -> PathBuf {
    let candidate = dir.join(file_name);

    if !candidate.exists() {
        return candidate;
    }

    let original = Path::new(file_name);
    let stem = original.file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "audio".into());

    let extension = original.extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();

    let mut number = 2u32;

    loop {
        let candidate = dir.join(format!("{stem} ({number}){extension}"));

        if !candidate.exists() {
            return candidate;
        }

        number += 1;
    }
}

/// Transfiere audio de la carpeta seleccionada, sin incluir subcarpetas.
pub fn transfer_folder(
    source: &Path,
    music_dir: &Path,
    move_files: bool,
) -> TransferResult {
    let mut result = TransferResult::default();

    if fs::create_dir_all(music_dir).is_err() {
        result.failed += 1;
        return result;
    }

    let Ok(entries) = fs::read_dir(source) else {
        result.failed += 1;
        return result;
    };

    for entry in entries.flatten() {
        let path = entry.path();

        if !entry.file_type().map(|kind| kind.is_file()).unwrap_or(false)
            || !is_audio(&path)
        {
            continue;
        }

        let Some(name) = path.file_name() else {
            continue;
        };

        let source_size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        let same_name = music_dir.join(name);

        if same_name.exists()
            && fs::metadata(&same_name)
                .map(|metadata| metadata.len() == source_size)
                .unwrap_or(false)
            && file_hash(&path).ok() == file_hash(&same_name).ok()
        {
            result.skipped += 1;
            continue;
        }

        let destination = unique_destination(music_dir, name);

        match fs::copy(&path, &destination) {
            Ok(copied) if copied == source_size => {
                if move_files && fs::remove_file(&path).is_err() {
                    let _ = fs::remove_file(&destination);
                    result.failed += 1;
                    continue;
                }

                result.transferred += 1;
            }
            _ => {
                let _ = fs::remove_file(&destination);
                result.failed += 1;
            }
        }
    }

    if result.transferred > 0 {
        invalidate_duplicate_index(music_dir);
    }

    result
}

/// Borra archivos solo si están dentro de `music_dir`.
pub fn delete_inside(paths: &[String], music_dir: &Path) -> u32 {
    let Ok(canonical_music_dir) = music_dir.canonicalize() else {
        return 0;
    };

    let mut deleted = 0;

    for raw in paths {
        let requested = PathBuf::from(raw);

        if has_parent_dir(&requested) || !is_audio(&requested) {
            continue;
        }

        let Ok(path) = requested.canonicalize() else {
            continue;
        };

        if !path.starts_with(&canonical_music_dir) || !path.is_file() {
            continue;
        }

        if fs::remove_file(&path).is_ok() {
            deleted += 1;
        }
    }

    if deleted > 0 {
        invalidate_duplicate_index(&canonical_music_dir);
    }

    deleted
}

/// Calcula una huella SHA-256 leyendo el archivo por bloques.
fn file_hash(path: &Path) -> Result<String, String> {
    use std::io::Read;

    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; HASH_BUFFER_SIZE];

    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;

        if read == 0 {
            break;
        }

        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

/// Busca una copia idéntica entre los archivos de audio de Musex.
fn contains_identical_audio(
    source: &Path,
    music_dir: &Path,
) -> Result<bool, String> {
    let source_size = fs::metadata(source).map_err(|e| e.to_string())?.len();
    let source_hash = file_hash(source)?;

    let canonical_music_dir = music_dir.canonicalize().map_err(|e| e.to_string())?;
    let index_dir = ensure_library_index(&canonical_music_dir)?;

    let candidate_paths: Vec<PathBuf> = {
        let indexes = library_indexes()
            .lock()
            .map_err(|_| "El índice de música está bloqueado.".to_string())?;

        let index = indexes
            .get(&index_dir)
            .ok_or_else(|| "No se pudo obtener el índice de música.".to_string())?;

        index
            .by_size
            .get(&source_size)
            .into_iter()
            .flatten()
            .filter_map(|&i| index.entries.get(i).map(|entry| entry.path.clone()))
            .collect()
    };

    for candidate in candidate_paths {
        if cached_hash(&index_dir, &candidate).as_deref() == Some(source_hash.as_str()) {
            return Ok(true);
        }
    }

    Ok(false)
}

/// Importa únicamente los archivos seleccionados por el usuario.
pub fn import_selected_files(
    paths: &[String],
    source_root: &Path,
    music_dir: &Path,
    move_files: bool,
) -> Result<TransferResult, String> {
    let root = source_root.canonicalize().map_err(|e| e.to_string())?;

    fs::create_dir_all(music_dir).map_err(|e| e.to_string())?;

    let destination_root = music_dir.canonicalize().map_err(|e| e.to_string())?;
    let mut result = TransferResult::default();

    for raw in paths {
        let requested = PathBuf::from(raw);

        if has_parent_dir(&requested) || !is_audio(&requested) {
            result.failed += 1;
            continue;
        }

        let source = match requested.canonicalize() {
            Ok(path) => path,
            Err(_) => {
                result.failed += 1;
                continue;
            }
        };

        if !source.starts_with(&root)
            || source.starts_with(&destination_root)
            || !source.is_file()
        {
            result.failed += 1;
            continue;
        }

        match contains_identical_audio(&source, &destination_root) {
            Ok(true) => {
                result.skipped += 1;
                continue;
            }
            Ok(false) => {}
            Err(_) => {
                result.failed += 1;
                continue;
            }
        }

        let Some(name) = source.file_name() else {
            result.failed += 1;
            continue;
        };

        let source_size = match fs::metadata(&source) {
            Ok(metadata) => metadata.len(),
            Err(_) => {
                result.failed += 1;
                continue;
            }
        };

        let destination = unique_destination(&destination_root, name);

        match fs::copy(&source, &destination) {
            Ok(copied) if copied == source_size => {
                let verified = file_hash(&source)
                    .and_then(|source_hash| {
                        file_hash(&destination)
                            .map(|destination_hash| source_hash == destination_hash)
                    })
                    .unwrap_or(false);

                if !verified {
                    let _ = fs::remove_file(&destination);
                    result.failed += 1;
                    continue;
                }

                if move_files && fs::remove_file(&source).is_err() {
                    let _ = fs::remove_file(&destination);
                    result.failed += 1;
                    continue;
                }

                result.transferred += 1;
            }
            _ => {
                let _ = fs::remove_file(&destination);
                result.failed += 1;
            }
        }
    }

    if result.transferred > 0 {
        invalidate_duplicate_index(&destination_root);
    }

    Ok(result)
}

// =============================================================
// ESCANEO RECURSIVO PARA EL ÍNDICE
// =============================================================

fn collect_audio_files(
    dir: &Path,
    output: &mut Vec<PathBuf>,
    depth: u32,
) {
    if depth > MAX_BROWSER_DEPTH {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();

        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };

        if metadata.file_type().is_symlink() {
            continue;
        }

        if metadata.is_file() && is_audio(&path) {
            output.push(path);
        } else if metadata.is_dir() {
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }

            collect_audio_files(&path, output, depth + 1);
        }
    }
}

// =============================================================
// PRUEBAS
// =============================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "musex-ops-{label}-{}",
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn reconoce_audio_sin_importar_mayusculas() {
        assert!(is_audio(Path::new("a/b/tema.MP3")));
        assert!(is_audio(Path::new("tema.flac")));
        assert!(!is_audio(Path::new("foto.jpg")));
        assert!(!is_audio(Path::new("sin_extension")));
    }

    #[test]
    fn detecta_rutas_con_punto_punto() {
        assert!(has_parent_dir(Path::new("/a/../b")));
        assert!(!has_parent_dir(Path::new("/a/b/c.mp3")));
    }

    #[test]
    fn el_escaneo_agrupa_por_carpeta_y_omite_lo_innecesario() {
        let root = temp_dir("scan");
        let musex = root.join("Musex");

        write(&root.join("Music/Rock/a.mp3"), b"aaaa");
        write(&root.join("Music/Rock/b.flac"), b"bb");
        write(&root.join("Download/c.m4a"), b"c");
        write(&root.join("Download/nota.txt"), b"x");
        write(&root.join("Android/data/x/d.mp3"), b"d");
        write(&root.join("DCIM/e.mp3"), b"e");
        write(&root.join(".oculta/f.mp3"), b"f");
        write(&musex.join("music/g.mp3"), b"g");

        let folders = scan_audio_folders(&root, &musex);
        let names: Vec<&str> = folders.iter().map(|folder| folder.name.as_str()).collect();

        assert_eq!(folders.len(), 2, "{names:?}");
        assert_eq!(folders[0].name, "Rock");
        assert_eq!(folders[0].audio_count, 2);
        assert_eq!(folders[0].size_bytes, 6);
        assert_eq!(folders[1].name, "Download");
        assert_eq!(folders[1].audio_count, 1);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn nombres_unicos_no_pisan_archivos() {
        let dir = temp_dir("unique");

        write(&dir.join("tema.mp3"), b"1");
        write(&dir.join("tema (2).mp3"), b"2");

        let free = unique_destination(&dir, OsStr::new("tema.mp3"));

        assert_eq!(free, dir.join("tema (3).mp3"));
        assert_eq!(
            unique_destination(&dir, OsStr::new("nuevo.mp3")),
            dir.join("nuevo.mp3")
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn copiar_deja_el_original() {
        let root = temp_dir("copy");
        let source = root.join("Music/Pop");
        let music = root.join("Musex/music");

        write(&source.join("uno.mp3"), b"12345");
        write(&source.join("portada.jpg"), b"img");

        let result = transfer_folder(&source, &music, false);

        assert_eq!(
            result,
            TransferResult {
                transferred: 1,
                skipped: 0,
                failed: 0,
            }
        );
        assert!(source.join("uno.mp3").exists());
        assert!(music.join("uno.mp3").exists());
        assert!(!music.join("portada.jpg").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn mover_borra_el_original_solo_tras_copiar() {
        let root = temp_dir("move");
        let source = root.join("Download");
        let music = root.join("Musex/music");

        write(&source.join("uno.mp3"), b"12345");

        let result = transfer_folder(&source, &music, true);

        assert_eq!(result.transferred, 1);
        assert!(!source.join("uno.mp3").exists());
        assert_eq!(fs::read(music.join("uno.mp3")).unwrap(), b"12345");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn un_archivo_repetido_se_omite_y_no_se_borra() {
        let root = temp_dir("dup");
        let source = root.join("Music");
        let music = root.join("Musex/music");

        write(&source.join("uno.mp3"), b"12345");
        write(&music.join("uno.mp3"), b"12345");

        let result = transfer_folder(&source, &music, true);

        assert_eq!(result.skipped, 1);
        assert_eq!(result.transferred, 0);
        assert!(source.join("uno.mp3").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn mismo_nombre_pero_distinto_contenido_se_renombra() {
        let root = temp_dir("rename");
        let source = root.join("Music");
        let music = root.join("Musex/music");

        write(&source.join("uno.mp3"), b"12345");
        write(&music.join("uno.mp3"), b"otro");

        let result = transfer_folder(&source, &music, false);

        assert_eq!(result.transferred, 1);
        assert!(music.join("uno (2).mp3").exists());
        assert_eq!(fs::read(music.join("uno.mp3")).unwrap(), b"otro");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn solo_se_borra_dentro_de_la_carpeta_de_musica() {
        let root = temp_dir("delete");
        let music = root.join("Musex/music");
        let outside = root.join("Music/ajeno.mp3");

        write(&music.join("mio.mp3"), b"1");
        write(&music.join("nota.txt"), b"1");
        write(&outside, b"1");

        let traversal = format!("{}/../../Music/ajeno.mp3", music.display());

        let deleted = delete_inside(
            &[
                music.join("mio.mp3").to_string_lossy().to_string(),
                music.join("nota.txt").to_string_lossy().to_string(),
                outside.to_string_lossy().to_string(),
                traversal,
            ],
            &music,
        );

        assert_eq!(deleted, 1);
        assert!(!music.join("mio.mp3").exists());
        assert!(music.join("nota.txt").exists());
        assert!(outside.exists());

        let _ = fs::remove_dir_all(&root);
    }
}