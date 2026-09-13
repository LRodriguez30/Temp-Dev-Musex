// =============================================================
// MUSEX - AUDIO METADATA
// =============================================================
//
// Responsable de leer la información descriptiva de los
// archivos de audio.
//
// Este módulo no reproduce el audio. Su función es obtener
// información que Musex utilizará para construir la biblioteca.
//
// Se consultan todas las etiquetas disponibles en el archivo
// en lugar de depender únicamente de la etiqueta primaria.
// Esto permite trabajar correctamente con archivos que fueron
// generados por diferentes herramientas, como yt-dlp, FFmpeg,
// reproductores externos o editores de metadata.
// =============================================================

use serde::{Deserialize, Serialize};

use std::path::{Path, PathBuf};

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;

// =============================================================
// AUDIO METADATA
// =============================================================

/// Información descriptiva de un archivo de audio.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioMetadata {
    /// Ruta del archivo analizado.
    pub path: PathBuf,

    /// Título de la canción.
    pub title: Option<String>,

    /// Artista o intérprete.
    pub artist: Option<String>,

    /// Álbum al que pertenece la canción.
    pub album: Option<String>,

    /// Género musical.
    pub genre: Option<String>,

    /// Fecha o año de lanzamiento.
    pub year: Option<u32>,

    /// Duración del archivo en segundos.
    pub duration: Option<u64>,
}

// =============================================================
// ACTUALIZACIÓN DE METADATA
// =============================================================
//
// Define qué campos deben modificarse en un archivo.
//
// `None` significa que el campo no debe tocarse.
// Una cadena vacía significa que el campo debe eliminarse.
// =============================================================

#[derive(Debug, Clone, Default, Deserialize)]
pub struct MetadataUpdate {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<u32>,
}

impl AudioMetadata {
    /// Lee la metadata de un archivo de audio.
    ///
    /// Lofty identifica automáticamente el formato del archivo
    /// y obtiene la información disponible en sus etiquetas.
    ///
    /// Se recorren todas las etiquetas disponibles para evitar
    /// depender exclusivamente de `primary_tag()`.
    ///
    /// # Errors
    ///
    /// Devuelve un error cuando el archivo no puede abrirse,
    /// identificarse o analizarse.
    pub fn from_file(path: impl AsRef<Path>) -> Result<Self, Box<dyn std::error::Error>> {
        let path = path.as_ref();

        // -----------------------------------------------------
        // Leer archivo de audio
        // -----------------------------------------------------

        let tagged_file = Probe::open(path)?.guess_file_type()?.read()?;

        // -----------------------------------------------------
        // Leer metadata
        // -----------------------------------------------------
        //
        // Un archivo puede contener más de una etiqueta.
        //
        // Por ejemplo, un MP3 puede contener información en
        // ID3v2 y también conservar otras etiquetas.
        //
        // Por eso no utilizamos únicamente `primary_tag()`.
        // Recorremos todas las etiquetas disponibles y tomamos
        // el primer valor válido encontrado para cada campo.
        // -----------------------------------------------------

        let mut title = None;
        let mut artist = None;
        let mut album = None;
        let mut genre = None;
        let mut year = None;

        for tag in tagged_file.tags() {
            // -------------------------------------------------
            // Título
            // -------------------------------------------------

            if title.is_none() {
                title = tag.title().map(|value| value.into_owned());
            }

            // -------------------------------------------------
            // Artista
            // -------------------------------------------------

            if artist.is_none() {
                artist = tag.artist().map(|value| value.into_owned());
            }

            // -------------------------------------------------
            // Álbum
            // -------------------------------------------------

            if album.is_none() {
                album = tag.album().map(|value| value.into_owned());
            }

            // -------------------------------------------------
            // Género
            // -------------------------------------------------

            if genre.is_none() {
                genre = tag.genre().map(|value| value.into_owned());
            }

            // -------------------------------------------------
            // Año
            // -------------------------------------------------

            if year.is_none() {
                year = tag.date().map(|date| date.year as u32);
            }

            // -------------------------------------------------
            // Si ya encontramos toda la información disponible,
            // no necesitamos continuar recorriendo etiquetas.
            // -------------------------------------------------

            if title.is_some()
                && artist.is_some()
                && album.is_some()
                && genre.is_some()
                && year.is_some()
            {
                break;
            }
        }

        // -----------------------------------------------------
        // Duración
        // -----------------------------------------------------
        //
        // La duración no pertenece a las etiquetas. Es una
        // propiedad propia del archivo de audio.
        // -----------------------------------------------------

        let duration = Some(tagged_file.properties().duration().as_secs());

        // -----------------------------------------------------
        // Construir resultado
        // -----------------------------------------------------

        Ok(Self {
            path: path.to_path_buf(),
            title,
            artist,
            album,
            genre,
            year,
            duration,
        })
    }

    pub fn update_file(
        path: impl AsRef<Path>,
        update: MetadataUpdate,
    ) -> Result<(), Box<dyn std::error::Error>> {
        use lofty::config::WriteOptions;
        use lofty::file::TaggedFileExt;
        use lofty::probe::Probe;
        use lofty::tag::{ItemKey, TagType};

        let path = path.as_ref();

        let mut tagged_file = Probe::open(path)?.guess_file_type()?.read()?;

        // ---------------------------------------------------------
        // Obtener la etiqueta ID3v2
        // ---------------------------------------------------------

        let tag = tagged_file
            .tag_mut(TagType::Id3v2)
            .ok_or("No se encontró una etiqueta ID3v2 en el archivo.")?;

        // ---------------------------------------------------------
        // Título
        // ---------------------------------------------------------

        if let Some(value) = update.title {
            if value.is_empty() {
                tag.remove_title();
            } else {
                tag.insert_text(ItemKey::TrackTitle, value);
            }
        }

        // ---------------------------------------------------------
        // Artista
        // ---------------------------------------------------------

        if let Some(value) = update.artist {
            if value.is_empty() {
                tag.remove_artist();
            } else {
                tag.insert_text(ItemKey::TrackArtist, value);
            }
        }

        // ---------------------------------------------------------
        // Álbum
        // ---------------------------------------------------------

        if let Some(value) = update.album {
            if value.is_empty() {
                tag.remove_album();
            } else {
                tag.insert_text(ItemKey::AlbumTitle, value);
            }
        }

        // ---------------------------------------------------------
        // Género
        // ---------------------------------------------------------

        if let Some(value) = update.genre {
            if value.is_empty() {
                tag.remove_genre();
            } else {
                tag.insert_text(ItemKey::Genre, value);
            }
        }

        // ---------------------------------------------------------
        // Año
        // ---------------------------------------------------------

        if let Some(value) = update.year {
            tag.insert_text(ItemKey::RecordingDate, value.to_string());
        }

        // ---------------------------------------------------------
        // Guardar archivo
        // ---------------------------------------------------------

        tagged_file.save_to_path(path, WriteOptions::default())?;

        Ok(())
    }
}

// =============================================================
// ESCRITURA DE METADATA
// =============================================================
//
// Permite guardar información descriptiva dentro de un archivo
// de audio después de haber sido descargado.
//
// Musex utiliza esta función para normalizar la metadata de
// archivos obtenidos desde fuentes externas.
// =============================================================

pub fn write_metadata(
    path: impl AsRef<Path>,
    title: &str,
    artist: Option<&str>,
    album: Option<&str>,
    genre: Option<&str>,
    year: Option<u32>,
) -> Result<(), Box<dyn std::error::Error>> {
    use lofty::config::WriteOptions;
    use lofty::file::TaggedFileExt;
    use lofty::probe::Probe;
    use lofty::tag::{Accessor, ItemKey, Tag, TagType};

    let path = path.as_ref();

    // ---------------------------------------------------------
    // Leer el archivo
    // ---------------------------------------------------------

    let mut tagged_file = Probe::open(path)?.guess_file_type()?.read()?;

    // ---------------------------------------------------------
    // Obtener o crear la etiqueta ID3v2
    // ---------------------------------------------------------

    if tagged_file.tag(TagType::Id3v2).is_none() {
        tagged_file.insert_tag(Tag::new(TagType::Id3v2));
    }

    let tag = tagged_file
        .tag_mut(TagType::Id3v2)
        .ok_or("No se pudo obtener la etiqueta ID3v2.")?;

    // ---------------------------------------------------------
    // Título
    // ---------------------------------------------------------

    tag.insert_text(ItemKey::TrackTitle, title.to_string());

    // ---------------------------------------------------------
    // Artista
    // ---------------------------------------------------------

    if let Some(artist) = artist {
        tag.insert_text(ItemKey::TrackArtist, artist.to_string());
    }

    // ---------------------------------------------------------
    // Álbum
    // ---------------------------------------------------------

    if let Some(album) = album {
        tag.insert_text(ItemKey::AlbumTitle, album.to_string());
    }

    // ---------------------------------------------------------
    // Género
    // ---------------------------------------------------------

    if let Some(genre) = genre {
        tag.insert_text(ItemKey::Genre, genre.to_string());
    }

    // ---------------------------------------------------------
    // Año
    // ---------------------------------------------------------

    if let Some(year) = year {
        tag.insert_text(ItemKey::RecordingDate, year.to_string());
    }

    // ---------------------------------------------------------
    // Guardar cambios
    // ---------------------------------------------------------

    tagged_file.save_to_path(path, WriteOptions::default())?;

    Ok(())
}

// =============================================================
// PREPARACIÓN PARA TAURI
// =============================================================
//
// Esta estructura podrá convertirse posteriormente en una
// respuesta serializable para los comandos de Tauri.
//
// La interfaz Angular podrá recibir:
//
// {
//     title,
//     artist,
//     album,
//     genre,
//     year,
//     duration
// }
//
// La ruta del archivo también se conserva para relacionar
// la metadata con el archivo físico de la biblioteca.
// =============================================================
