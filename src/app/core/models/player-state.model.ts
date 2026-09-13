/**
 * Estado actual del reproductor de Musex.
 *
 * Este modelo concentra únicamente la información necesaria
 * para controlar la reproducción y representar su estado en la UI.
 */
export interface PlayerState {
  /**
   * Indica si existe una reproducción activa.
   */
  playing: boolean;

  /**
   * Identificador de la canción actualmente seleccionada.
   *
   * Puede ser null cuando no existe ninguna canción activa.
   */
  currentTrackId: string | null;

  /**
   * Posición actual dentro de la canción, expresada en segundos.
   */
  currentTime: number;

  /**
   * Nivel de volumen del reproductor.
   *
   * El valor esperado está comprendido entre 0 y 100.
   */
  volume: number;

  /**
   * Indica si el audio está silenciado.
   */
  muted: boolean;

  /**
   * Indica si la reproducción aleatoria está activa.
   */
  shuffle: boolean;

  /**
   * Indica si el modo de repetición está activo.
   */
  repeat: 'off' | 'track' | 'queue';

  /**
   * Indica si el panel lateral de reproducción
   * se encuentra visible.
   */
  rightPanel: boolean;

  /**
   * Identificadores de las canciones que esperan
   * para ser reproducidas.
   */
  queue: string[];
}