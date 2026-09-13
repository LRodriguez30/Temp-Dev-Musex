export interface Track {
  /**
   * Identificador interno de la canción.
   */
  id: string;

  /**
   * Título de la canción.
   */
  title: string;

  /**
   * Artista de la canción.
   *
   * Puede no estar disponible cuando el archivo
   * no contiene información de artista.
   */
  artist: string;

  /**
   * Álbum al que pertenece la canción.
   */
  album: string;

  /**
   * Género musical.
   */
  genre?: string;

  /**
   * Duración total de la canción en segundos.
   */
  duration: number;

  /**
   * Ruta física del archivo de audio.
   *
   * Esta propiedad es utilizada por Tauri para
   * enviar el archivo real al reproductor de Rust.
   */
  path: string;

  /**
   * Imagen utilizada por la interfaz.
   *
   * Los archivos reales podrán utilizar posteriormente
   * carátulas obtenidas desde sus metadatos.
   */
  image: string;

  /**
   * Fuente externa de la canción, cuando corresponda.
   */
  source: string | null;

  /**
   * Indica si la canción pertenece a favoritos.
   */
  favorite: boolean;

  /**
   * Tipo de portada elegido por el usuario.
   *
   * Si no se define, se usa 'image' con el valor de `image`
   * (compatibilidad con canciones demo/escaneadas existentes).
   */
  coverType?: 'icon' | 'image';

  coverIcon?: string;
  coverColor?: string;
}