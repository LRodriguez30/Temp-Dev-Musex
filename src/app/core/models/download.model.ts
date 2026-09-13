// =============================================================
// MUSEX - DOWNLOAD MODEL
// =============================================================

/**
 * Estados generales posibles de una descarga dentro de Musex.
 *
 * Representan el estado de la operación completa, no la etapa
 * específica en la que se encuentra el proceso.
 */
export type DownloadStatus =
  | 'pending'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'error'
  | 'cancelled';

/**
 * Etapas internas del proceso de descarga.
 *
 * Estas etapas corresponden con los estados enviados actualmente
 * por la capa Rust mediante `DownloadProgress`.
 */
export type DownloadStage =
  | 'preparing'
  | 'fetching'
  | 'downloading'
  | 'converting'
  | 'saving'
  | 'completed'
  | 'error';

/**
 * Proveedores de contenido que Musex puede utilizar
 * para obtener una descarga.
 */
export type DownloadProvider =
  | 'youtube'
  | 'newgrounds'
  | 'unknown';

/**
 * Representa una descarga dentro de Musex.
 *
 * Este modelo contiene el estado necesario para representar
 * visualmente y administrar una descarga desde Angular.
 *
 * La ejecución real de la operación permanece en Rust/Tauri.
 */
export interface Download {

  /**
   * Identificador único de la descarga.
   */
  id: string;

  /**
   * URL original proporcionada por el usuario.
   */
  url: string;

  /**
   * Nombre del contenido que se está descargando.
   */
  title: string;

  /**
   * Proveedor desde el que se obtiene el contenido.
   */
  provider: DownloadProvider;

  /**
   * Estado general actual de la descarga.
   */
  status: DownloadStatus;

  /**
   * Etapa específica en la que se encuentra actualmente
   * el proceso de descarga.
   */
  stage: DownloadStage;

  /**
   * Porcentaje de progreso de 0 a 100.
   *
   * Cuando el tamaño total del archivo es conocido,
   * este valor se calcula a partir de los bytes reales
   * procesados por el downloader.
   */
  progress: number;

  /**
   * Cantidad real de bytes descargados o procesados.
   *
   * Permite mostrar información como:
   *
   * 2.34 MB / 5.81 MB
   */
  downloadedBytes: number;

  /**
   * Tamaño total del archivo en bytes.
   *
   * Puede permanecer indefinido cuando la fuente no proporciona
   * el tamaño total de forma confiable.
   *
   * Cuando no existe este valor, la interfaz puede representar
   * el progreso mediante una barra indeterminada.
   */
  totalBytes?: number;

  /**
   * Mensaje descriptivo de la operación actual.
   *
   * Ejemplos:
   *
   * - "Preparando descarga..."
   * - "Obteniendo información del contenido..."
   * - "Descargando audio..."
   * - "Convirtiendo a MP3..."
   * - "Guardando archivo..."
   * - "Descarga completada."
   */
  message: string;

  /**
   * Ruta final del archivo cuando la descarga
   * ha terminado correctamente.
   */
  filePath?: string;

  /**
   * Mensaje descriptivo en caso de error.
   */
  errorMessage?: string;

  /**
   * Fecha en la que se inició la descarga.
   */
  createdAt: string;

  /**
   * Fecha en la que terminó la descarga.
   */
  completedAt?: string;
}