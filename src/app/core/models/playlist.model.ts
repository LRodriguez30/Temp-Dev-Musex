/**
 * Representa una playlist dentro de Musex.
 *
 * El modelo permite trabajar tanto con playlists de demostración
 * como con playlists creadas por el usuario.
 */
export interface Playlist {
  /**
   * Identificador único de la playlist.
   */
  id: string;

  /**
   * Nombre visible de la playlist.
   */
  name: string;

  /**
   * Cantidad de canciones que contiene.
   *
   * Este valor puede calcularse a partir de los tracks
   * cuando trabajemos con playlists dinámicas.
   */
  count: number;

  /**
   * Ruta o URL de la portada de la playlist.
   */
  image: string;

  /**
   * Tipo de portada elegido por el usuario.
   *
   * 'icon'  → ícono SVG sobre un fondo de color sólido.
   * 'image' → imagen seleccionada por el usuario.
   */
  coverType?: 'icon' | 'image';

  /**
   * Ícono elegido cuando coverType === 'icon'.
   */
  coverIcon?: string;

  /**
   * Color de fondo elegido cuando coverType === 'icon'.
   */
  coverColor?: string;
  
  /**
   * Identificadores de las canciones que pertenecen
   * a la playlist.
   *
   * Se utilizan IDs en lugar de almacenar objetos Track
   * completos para mantener el estado más ligero.
   */
  trackIds?: string[];

  /**
   * Indica si la playlist fue creada por el usuario.
   *
   * Las playlists de demostración tendrán este valor
   * como false o podrán omitirlo.
   */
  custom?: boolean;
}