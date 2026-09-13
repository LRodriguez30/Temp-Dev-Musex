/**
 * Configuración persistente de Musex.
 *
 * Contiene únicamente preferencias del usuario que deben
 * conservarse entre sesiones de la aplicación.
 */
export interface Settings {
  /**
   * Volumen utilizado por defecto al iniciar Musex.
   *
   * El valor esperado está comprendido entre 0 y 100.
   */
  volume: number;

  /**
   * Indica si Musex debe iniciar con el audio silenciado.
   */
  muted: boolean;

  /**
   * Indica si el panel lateral de reproducción
   * debe mostrarse al iniciar la aplicación.
   */
  rightPanel: boolean;

  /**
   * Indica si las descargas deben comenzar automáticamente
   * cuando se agregan a la cola.
   */
  autoDownload: boolean;

  /**
   * Directorio utilizado como ubicación predeterminada
   * para los archivos descargados.
   *
   * Puede quedar vacío mientras Musex utiliza
   * la ubicación predeterminada del sistema.
   */
  downloadDirectory: string;
}