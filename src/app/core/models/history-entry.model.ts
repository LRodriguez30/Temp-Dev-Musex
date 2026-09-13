/**
 * Representa una entrada del historial de reproducción.
 *
 * El historial mantiene una referencia a la canción mediante
 * su identificador y almacena únicamente la información propia
 * de la actividad realizada.
 */
export interface HistoryEntry {
  /**
   * Identificador único de la entrada del historial.
   */
  id: string;

  /**
   * Identificador de la canción reproducida.
   *
   * Permite recuperar la información actual del Track
   * desde la biblioteca de canciones.
   */
  trackId: string;

  /**
   * Momento en el que comenzó la reproducción.
   *
   * Se almacena como una fecha ISO para facilitar
   * su persistencia y posterior procesamiento.
   */
  playedAt: string;

  /**
   * Tiempo aproximado de reproducción en segundos.
   *
   * Permite distinguir entre una reproducción completa
   * y una reproducción que fue detenida anticipadamente.
   */
  playedDuration?: number;
}