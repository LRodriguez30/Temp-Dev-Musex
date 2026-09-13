import { Injectable, signal } from '@angular/core';

/**
 * Gestiona la cola de reproducción de Musex.
 *
 * La cola almacena únicamente los identificadores de las canciones.
 * La información completa de cada Track se obtiene posteriormente
 * desde LibraryService o PlayerService.
 */
@Injectable({
  providedIn: 'root'
})
export class QueueService {

  /**
   * Cola interna de reproducción.
   *
   * Los datos iniciales corresponden a la cola definida
   * originalmente en el prototipo de Musex.
   */
  private readonly queue = signal<string[]>([
    'after-dark',
    'good-4-u',
    'blinding-lights',
    'another-love',
    'sweater-weather',
    'sunflower'
  ]);

  /**
   * Exposición de solo lectura de la cola.
   */
  readonly items = this.queue.asReadonly();

  /**
   * Devuelve una copia de los identificadores actualmente
   * presentes en la cola.
   */
  getQueue(): string[] {
    return [...this.queue()];
  }

  /**
   * Comprueba si una canción ya está presente en la cola.
   */
  contains(trackId: string): boolean {
    return this.queue().includes(trackId);
  }

  /**
   * Agrega una canción al final de la cola.
   *
   * Una misma canción no se agrega dos veces de forma consecutiva
   * dentro de la cola.
   */
  add(trackId: string): void {
    if (this.contains(trackId)) {
      return;
    }

    this.queue.update(queue => [
      ...queue,
      trackId
    ]);
  }

  /**
   * Elimina una canción específica de la cola.
   */
  remove(trackId: string): void {
    this.queue.update(queue =>
      queue.filter(id => id !== trackId)
    );
  }

  /**
   * Elimina una canción utilizando su posición dentro de la cola.
   */
  removeAt(index: number): void {
    this.queue.update(queue =>
      queue.filter((_, currentIndex) => currentIndex !== index)
    );
  }

  /**
   * Vacía completamente la cola.
   */
  clear(): void {
    this.queue.set([]);
  }

  /**
   * Reemplaza la cola completa.
   *
   * Se utiliza cuando sea necesario reconstruirla desde
   * una playlist, configuración persistente u otra fuente.
   */
  setQueue(trackIds: string[]): void {
    this.queue.set([...trackIds]);
  }

  /**
   * Elimina de la cola las canciones que ya no existen
   * dentro de la biblioteca actual.
   *
   * Se utiliza después de escanear los archivos musicales
   * reales del equipo para evitar referencias obsoletas.
   */
  syncWithLibrary(trackIds: string[]): void {
    const availableTrackIds = new Set(trackIds);

    this.queue.update(queue =>
      queue.filter(trackId =>
        availableTrackIds.has(trackId)
      )
    );
  }

  /**
   * Mueve una canción dentro de la cola.
   *
   * Permite reorganizar el orden sin modificar directamente
   * el arreglo almacenado en el signal.
   */
  move(fromIndex: number, toIndex: number): void {
    const currentQueue = [...this.queue()];

    if (
      fromIndex < 0 ||
      fromIndex >= currentQueue.length ||
      toIndex < 0 ||
      toIndex >= currentQueue.length
    ) {
      return;
    }

    const [trackId] = currentQueue.splice(fromIndex, 1);

    currentQueue.splice(toIndex, 0, trackId);

    this.queue.set(currentQueue);
  }

  /**
   * Obtiene la posición de una canción dentro de la cola.
   *
   * Devuelve -1 cuando la canción no está presente.
   */
  indexOf(trackId: string): number {
    return this.queue().indexOf(trackId);
  }

  /**
   * Devuelve la cantidad de canciones pendientes en la cola.
   */
  getCount(): number {
    return this.queue().length;
  }
}