// =============================================================
// MUSEX - FILESYSTEM STORAGE
// =============================================================
//
// Responsable de administrar las ubicaciones de almacenamiento
// utilizadas por Musex.
//
// Este módulo centraliza las rutas de la aplicación para evitar
// que otros componentes tengan que construirlas manualmente.
//
// En el futuro será utilizado por:
//
// - Descargas.
// - Biblioteca musical.
// - Archivos temporales.
// - Metadatos y configuraciones.
//
// No depende de Tauri en esta etapa.
// =============================================================

use std::fs;
use std::path::{Path, PathBuf};

// =============================================================
// STORAGE
// =============================================================

/// Administrador de almacenamiento de Musex.
///
/// Mantiene las rutas principales utilizadas por la aplicación.
#[derive(Debug, Clone)]
pub struct Storage {
    /// Directorio principal donde Musex almacena sus datos.
    base_dir: PathBuf,
}

impl Storage {
    /// Crea un nuevo administrador utilizando el directorio
    /// proporcionado como ubicación principal.
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
        }
    }

    /// Devuelve la ruta principal de almacenamiento.
    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }

    /// Devuelve la carpeta donde se almacenan las canciones.
    pub fn music_dir(&self) -> PathBuf {
        self.base_dir.join("music")
    }

    /// Devuelve la carpeta donde se almacenan las portadas.
    pub fn covers_dir(&self) -> PathBuf {
        self.base_dir.join("covers")
    }

    /// Devuelve la carpeta destinada a descargas temporales.
    pub fn downloads_dir(&self) -> PathBuf {
        self.base_dir.join("downloads")
    }

    /// Devuelve la carpeta destinada a archivos temporales.
    pub fn temp_dir(&self) -> PathBuf {
        self.base_dir.join("temp")
    }

    /// Crea todas las carpetas necesarias para Musex.
    ///
    /// Si las carpetas ya existen, no se considera un error.
    pub fn initialize(&self) -> Result<(), Box<dyn std::error::Error>> {
        fs::create_dir_all(self.music_dir())?;
        fs::create_dir_all(self.covers_dir())?;
        fs::create_dir_all(self.downloads_dir())?;
        fs::create_dir_all(self.temp_dir())?;

        Ok(())
    }

    // =========================================================
    // STORAGE INFORMATION
    // =========================================================

    /// Calcula cuánto espacio ocupan actualmente los archivos
    /// almacenados dentro del directorio de Musex.
    ///
    /// El cálculo recorre de forma recursiva todas las carpetas
    /// y suma el tamaño de cada archivo encontrado.
    ///
    /// El resultado se devuelve en bytes.
    pub fn total_size(&self) -> Result<u64, Box<dyn std::error::Error>> {
        Self::calculate_directory_size(&self.base_dir)
    }

    /// Calcula recursivamente el tamaño de un directorio.
    ///
    /// Los directorios solamente se recorren; únicamente el
    /// tamaño de los archivos se suma al resultado.
    fn calculate_directory_size(
        path: &Path,
    ) -> Result<u64, Box<dyn std::error::Error>> {
        if !path.exists() {
            return Ok(0);
        }

        if path.is_file() {
            return Ok(fs::metadata(path)?.len());
        }

        let mut total_size = 0u64;

        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let entry_path = entry.path();

            if entry_path.is_dir() {
                total_size +=
                    Self::calculate_directory_size(&entry_path)?;
            } else if entry_path.is_file() {
                total_size +=
                    fs::metadata(&entry_path)?.len();
            }
        }

        Ok(total_size)
    }

    /// Comprueba si existe un archivo dentro del almacenamiento.
    pub fn file_exists(&self, path: impl AsRef<Path>) -> bool {
        path.as_ref().is_file()
    }

    /// Comprueba si existe un directorio dentro del almacenamiento.
    pub fn directory_exists(&self, path: impl AsRef<Path>) -> bool {
        path.as_ref().is_dir()
    }

    // =========================================================
    // MUSIC
    // =========================================================

    /// Genera una ruta dentro de la carpeta de música.
    ///
    /// Esta función solamente construye la ruta; no crea
    /// físicamente el archivo.
    pub fn music_file(&self, file_name: impl AsRef<Path>) -> PathBuf {
        self.music_dir().join(file_name)
    }

    // =========================================================
    // COVERS
    // =========================================================

    /// Genera una ruta dentro de la carpeta de portadas.
    ///
    /// Esta función solamente construye la ruta;
    /// no crea físicamente el archivo.
    pub fn cover_file(
        &self,
        file_name: impl AsRef<Path>,
    ) -> PathBuf {
        self.covers_dir().join(file_name)
    }

    /// Copia un archivo externo hacia la biblioteca permanente
    /// de Musex.
    ///
    /// El archivo original permanece intacto en su ubicación.
    ///
    /// Si ya existe un archivo con el mismo nombre, genera
    /// automáticamente una ruta disponible.
    pub fn copy_to_library(
        &self,
        source_path: impl AsRef<Path>,
    ) -> Result<PathBuf, Box<dyn std::error::Error>> {
        let source_path = source_path.as_ref();

        // -----------------------------------------------------
        // Validar archivo de origen
        // -----------------------------------------------------

        if !source_path.is_file() {
            return Err(format!(
                "El archivo de origen no existe: {}",
                source_path.display()
            )
            .into());
        }

        // -----------------------------------------------------
        // Obtener nombre del archivo
        // -----------------------------------------------------

        let file_name = source_path
            .file_name()
            .ok_or("No se pudo determinar el nombre del archivo.")?;

        // -----------------------------------------------------
        // Asegurar que la biblioteca exista
        // -----------------------------------------------------

        let music_dir = self.music_dir();

        fs::create_dir_all(&music_dir)?;

        // -----------------------------------------------------
        // Determinar una ruta disponible
        // -----------------------------------------------------

        let destination_path =
            self.unique_music_path(file_name);

        // -----------------------------------------------------
        // Copiar archivo
        // -----------------------------------------------------

        fs::copy(source_path, &destination_path)?;

        Ok(destination_path)
    }

    /// Mueve una descarga completada a la biblioteca permanente
    /// de Musex.
    ///
    /// El archivo se mueve desde la carpeta `downloads` hacia
    /// la carpeta `music`.
    ///
    /// Si ya existe un archivo con el mismo nombre, se genera
    /// automáticamente un nombre disponible:
    ///
    /// `cancion.mp3`
    /// `cancion (1).mp3`
    /// `cancion (2).mp3`
    pub fn move_download_to_library(
        &self,
        source_path: impl AsRef<Path>,
    ) -> Result<PathBuf, Box<dyn std::error::Error>> {
        let source_path = source_path.as_ref();

        // -----------------------------------------------------
        // Validar archivo de origen
        // -----------------------------------------------------

        if !source_path.is_file() {
            return Err(format!(
                "El archivo de descarga no existe: {}",
                source_path.display()
            )
            .into());
        }

        // -----------------------------------------------------
        // Obtener nombre del archivo
        // -----------------------------------------------------

        let file_name = source_path
            .file_name()
            .ok_or("No se pudo determinar el nombre del archivo.")?;

        // -----------------------------------------------------
        // Asegurar que la biblioteca exista
        // -----------------------------------------------------

        let music_dir = self.music_dir();

        fs::create_dir_all(&music_dir)?;

        // -----------------------------------------------------
        // Determinar una ruta disponible
        // -----------------------------------------------------

        let destination_path =
            self.unique_music_path(file_name);

        // -----------------------------------------------------
        // Mover archivo
        // -----------------------------------------------------

        fs::rename(source_path, &destination_path)?;

        Ok(destination_path)
    }

    /// Genera una ruta disponible dentro de la biblioteca.
    ///
    /// Evita sobrescribir archivos existentes cuando una canción
    /// importada o descargada tiene el mismo nombre que otra
    /// ya almacenada.
    fn unique_music_path(
        &self,
        file_name: &std::ffi::OsStr,
    ) -> PathBuf {
        let original_path = self.music_dir().join(file_name);

        if !original_path.exists() {
            return original_path;
        }

        let file_name = Path::new(file_name);

        let stem = file_name
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("audio");

        let extension = file_name
            .extension()
            .and_then(|value| value.to_str());

        let mut counter = 1;

        loop {
            let candidate_name = match extension {
                Some(extension) => {
                    format!(
                        "{} ({}).{}",
                        stem,
                        counter,
                        extension
                    )
                }

                None => {
                    format!(
                        "{} ({})",
                        stem,
                        counter
                    )
                }
            };

            let candidate =
                self.music_dir().join(candidate_name);

            if !candidate.exists() {
                return candidate;
            }

            counter += 1;
        }
    }

    // =========================================================
    // DOWNLOADS
    // =========================================================

    /// Genera una ruta dentro de la carpeta de descargas.
    pub fn download_file(
        &self,
        file_name: impl AsRef<Path>,
    ) -> PathBuf {
        self.downloads_dir().join(file_name)
    }

    // =========================================================
    // TEMPORARY FILES
    // =========================================================

    /// Genera una ruta dentro de la carpeta temporal.
    pub fn temp_file(
        &self,
        file_name: impl AsRef<Path>,
    ) -> PathBuf {
        self.temp_dir().join(file_name)
    }
}

// =============================================================
// PREPARACIÓN PARA TAURI
// =============================================================
//
// Cuando Musex se integre con Tauri, `base_dir` podrá obtenerse
// mediante las rutas proporcionadas por Tauri.
//
// De esta forma no tendremos rutas fijas como:
//
// C:\Users\Usuario\Desktop\Musex
//
// sino rutas adecuadas para cada sistema operativo.
//
// La lógica de almacenamiento permanecerá independiente de la
// interfaz Angular.
// =============================================================