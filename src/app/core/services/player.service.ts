import {
    Injectable,
    OnDestroy,
    computed,
    inject,
    signal
} from '@angular/core';

import { invoke } from '@tauri-apps/api/core';

import { PlayerState } from '../models/player-state.model';
import { Track } from '../models/track.model';

import { LibraryService } from './library.service';
import { QueueService } from './queue.service';
import { HistoryService } from './history.service';

/**
 * Gestiona el estado y las operaciones principales del reproductor.
 *
 * PlayerService se encarga de la reproducción, posición, volumen
 * y controles del reproductor.
 *
 * La información de las canciones pertenece a LibraryService.
 * De esta manera, el reproductor puede trabajar tanto con los
 * datos de demostración como con archivos reales encontrados
 * mediante el scanner de Rust.
 *
 * La cola de reproducción pertenece exclusivamente a QueueService,
 * evitando mantener dos fuentes de verdad para los mismos datos.
 */
@Injectable({
    providedIn: 'root'
})
export class PlayerService implements OnDestroy {

    constructor()
    {
        window.addEventListener('beforeunload', () => {
            void invoke('stop_audio');
        });
        
        navigator.mediaDevices?.addEventListener('devicechange', () => {
            invoke('reinitialize_audio_device').catch(error => {
            console.error('No se pudo reinicializar el dispositivo de audio.', error);
            });
        });
    }

    /**
     * Servicio encargado de administrar la biblioteca musical.
     */
    private readonly libraryService = inject(LibraryService);

    private readonly historyService = inject(HistoryService);

    /**
     * Servicio encargado de administrar la cola de reproducción.
     */
    private readonly queueService = inject(QueueService);

    /**
     * Estado interno del reproductor.
     */
    private readonly playerState = signal<PlayerState>({
        playing: false,
        currentTrackId: null,
        currentTime: 0,
        volume: 52,
        muted: false,
        shuffle: false,
        repeat: 'off',
        rightPanel: false,
        queue: this.queueService.getQueue()
    });

    /**
     * Estado público de solo lectura.
     */
    readonly state = this.playerState.asReadonly();

    /**
     * Biblioteca musical utilizada por el reproductor.
     */
    readonly tracks = this.libraryService.library;

    /**
     * Temporizador utilizado para consultar periódicamente
     * la posición real del audio en el reproductor de Rust.
     */
    private positionTimer: ReturnType<typeof setInterval> | null = null;

    /**
     * Evita procesar varias veces el final de una misma canción.
     */
    private handlingTrackEnd = false;

    private previousVolume = 50;

    /**
     * Orden de reproducción utilizado cuando shuffle está activo.
     *
     * No modifica la cola visible. Solo determina el orden
     * en que PlayerService recorrerá las canciones.
     */
    private shuffleOrder: string[] = [];

    /**
     * Posición actual dentro del orden aleatorio.
     */
    private shuffleIndex = -1;

    /**
     * Dirección visual utilizada para las transiciones
     * cuando cambia la canción.
     *
     * next:
     *   La nueva canción entra desde la derecha.
     *
     * previous:
     *   La nueva canción entra desde la izquierda.
     */
    readonly trackTransitionDirection =
        signal<'next' | 'previous'>('next');

    /**
     * Contador de transiciones de canción.
     *
     * Se incrementa incluso cuando se reproduce nuevamente
     * la misma canción, por ejemplo con repeat=track.
     *
     * Esto permite que Angular/CSS pueda volver a ejecutar
     * la animación.
     */
    readonly trackTransitionKey = signal(0);
    

    /**
     * Indica si el Full Player está abierto.
     *
     * Este estado pertenece al PlayerService porque tanto el
     * Bottom Player como el Main Layout necesitan conocerlo.
     */
    readonly fullPlayerOpen = signal(false);


    /**
     * Indica si existe contenido reproducible real: una canción
     * actual cargada o una cola con canciones pendientes.
     *
     * El Bottom Player solo tiene sentido cuando existe algo
     * que efectivamente se pueda reproducir.
     */
    readonly hasPlayableContent = computed(() =>
        this.playerState().currentTrackId !== null ||
        this.playerState().queue.length > 0
    );

    /**
     * Abre o cierra el Full Player.
     */
    toggleFullPlayer(): void {
    this.fullPlayerOpen.update(open => !open);
    }


    /**
     * Cierra el Full Player.
     */
    closeFullPlayer(): void {
    this.fullPlayerOpen.set(false);
    }

    /**
     * Reproduce una canción específica.
     *
     * Si la canción todavía no pertenece a la cola,
     * se incorpora automáticamente.
     */
    async playTrack(trackId: string): Promise<void> {
        const track = this.getTrack(trackId);

        if (!track) {
            return;
        }

        if (!track.path) {
            console.warn(
                `La canción "${track.title}" no tiene una ruta de audio.`
            );

            return;
        }

        if (!this.queueService.getQueue().includes(track.id)) {
            this.queueService.add(track.id);
        }

        try {
            /**
             * Una nueva reproducción invalida cualquier proceso
             * anterior que estuviera manejando el final de una pista.
             */
            this.handlingTrackEnd = false;

            await invoke('play_audio', {
                path: track.path
            });

            this.historyService.addEntry(trackId);

            this.playerState.update(state => ({
                ...state,
                playing: true,
                currentTrackId: track.id,
                currentTime: 0,
                queue: this.queueService.getQueue()
            }));

            this.startPositionSync();

        } catch (error) {
            console.error(
                'Error al reproducir la canción:',
                error
            );
        }
    }

    /**
     * Alterna entre reproducción y pausa.
     *
     * Cuando una canción terminó completamente, Rust ya no tiene
     * una pista pendiente dentro de Player. En ese caso no se puede
     * utilizar resume_audio y es necesario volver a cargar la pista
     * desde el inicio mediante playTrack().
     */
    async togglePlay(): Promise<void> {
        const currentState = this.playerState();

        try {
            /**
             * Si está reproduciendo, simplemente pausamos.
             */
            if (currentState.playing) {
                await invoke('pause_audio');

                this.playerState.update(state => ({
                    ...state,
                    playing: false
                }));

                this.stopPositionSync();

                return;
            }

            if (!currentState.currentTrackId) {
                return;
            }

            const currentTrack =
                this.getCurrentTrack();

            if (!currentTrack) {
                return;
            }

            /**
             * Si la posición llegó prácticamente al final de la pista,
             * significa que la reproducción anterior terminó y Rust
             * ya no tiene una fuente que pueda ser reanudada.
             *
             * En lugar de llamar resume_audio, volvemos a cargar
             * la canción desde el principio.
             */
            const hasFinished =
                currentState.currentTime >=
                currentTrack.duration - 0.25;

            if (hasFinished) {
                await this.playTrack(
                    currentTrack.id
                );

                return;
            }

            /**
             * Si la canción estaba pausada a mitad de reproducción,
             * sí existe una pista dentro de Rust que puede reanudarse.
             */
            await invoke('resume_audio');

            this.playerState.update(state => ({
                ...state,
                playing: true
            }));

            this.startPositionSync();

        } catch (error) {
            console.error(
                'Error al cambiar el estado de reproducción:',
                error
            );
        }
    }

    /**
     * Avanza manualmente a la siguiente canción.
     *
     * Respeta:
     *
     * - orden normal de la cola
     * - reproducción aleatoria
     * - repetición de cola
     */
    nextTrack(): void {
        const state = this.playerState();

        if (state.shuffle) {
            this.nextShuffleTrack();
            return;
        }

        const queue = this.queueService.getQueue();

        if (queue.length === 0) {
            return;
        }

        const currentTrackId = state.currentTrackId;

        const currentIndex = currentTrackId
            ? queue.indexOf(currentTrackId)
            : -1;

        let nextIndex: number;

        if (currentIndex === -1) {
            nextIndex = 0;
        } else if (currentIndex < queue.length - 1) {
            nextIndex = currentIndex + 1;
        } else if (state.repeat === 'queue') {
            nextIndex = 0;
        } else {
            return;
        }

        void this.playTrack(queue[nextIndex]);
    }

    /**
     * Avanza dentro del orden aleatorio actual.
     */
    private nextShuffleTrack(): void {
        const state = this.playerState();

        if (this.shuffleOrder.length === 0) {
            return;
        }

        /**
         * Todavía existen canciones dentro del ciclo actual.
         */
        if (this.shuffleIndex < this.shuffleOrder.length - 1) {
            this.shuffleIndex++;

            void this.playTrack(
                this.shuffleOrder[this.shuffleIndex]
            );

            return;
        }

        /**
         * Ya recorrimos toda la cola.
         *
         * Solo comenzamos un nuevo ciclo si repeat=queue.
         */
        if (state.repeat === 'queue') {
            this.generateNextShuffleCycle();
            return;
        }
    }

    /**
     * Genera un nuevo ciclo de reproducción aleatoria.
     *
     * El nuevo ciclo contiene todas las canciones de la cola
     * una sola vez.
     */
    private generateNextShuffleCycle(): void {
        const queue = this.queueService.getQueue();
        const currentTrackId = this.playerState().currentTrackId;

        if (queue.length === 0) {
            return;
        }

        const remaining = queue.filter(
            trackId => trackId !== currentTrackId
        );

        for (let i = remaining.length - 1; i > 0; i--) {
            const j = Math.floor(
                Math.random() * (i + 1)
            );

            [remaining[i], remaining[j]] =
                [remaining[j], remaining[i]];
        }

        this.shuffleOrder = currentTrackId
            ? [currentTrackId, ...remaining]
            : remaining;

        this.shuffleIndex = currentTrackId ? 0 : -1;

        /**
         * Si existe una canción actual, avanzamos
         * inmediatamente hacia la primera canción
         * del nuevo ciclo.
         */
        if (this.shuffleOrder.length > 1) {
            this.shuffleIndex = 1;

            void this.playTrack(
                this.shuffleOrder[this.shuffleIndex]
            );
        }
    }

    /**
     * Regresa manualmente a la canción anterior.
     *
     * Cuando shuffle está activo utiliza el historial
     * del orden aleatorio actual.
     */
    previousTrack(): void {
        const state = this.playerState();

        if (state.shuffle) {
            this.previousShuffleTrack();
            return;
        }

        const queue = this.queueService.getQueue();

        if (queue.length === 0) {
            return;
        }

        const currentTrackId = state.currentTrackId;

        const currentIndex = currentTrackId
            ? queue.indexOf(currentTrackId)
            : -1;

        if (currentIndex === -1) {
            void this.playTrack(queue[0]);
            return;
        }

        if (currentIndex > 0) {
            void this.playTrack(
                queue[currentIndex - 1]
            );

            return;
        }

        if (state.repeat === 'queue') {
            void this.playTrack(
                queue[queue.length - 1]
            );

            return;
        }

        void this.playTrack(queue[0]);
    }

    /**
     * Regresa dentro del orden aleatorio actual.
     */
    private previousShuffleTrack(): void {
        if (
            this.shuffleOrder.length === 0 ||
            this.shuffleIndex <= 0
        ) {
            return;
        }

        this.shuffleIndex--;

        void this.playTrack(
            this.shuffleOrder[this.shuffleIndex]
        );
    }

    /**
     * Establece una posición concreta dentro de la canción.
     */
    async seek(time: number): Promise<void> {
        const track = this.getCurrentTrack();

        if (!track) {
            return;
        }

        const normalizedTime = Math.max(
            0,
            Math.min(time, track.duration)
        );

        try {
            await invoke('seek_audio', {
                seconds: normalizedTime
            });

            this.playerState.update(state => ({
                ...state,
                currentTime: normalizedTime
            }));

        } catch (error) {
            console.error(
                'Error al cambiar la posición del audio:',
                error
            );
        }
    }

    /**
     * Avanza o retrocede una cantidad determinada de segundos.
     */
    seekBy(seconds: number): void {
        void this.seek(
            this.playerState().currentTime + seconds
        );
    }

    /**
     * Establece el volumen del reproductor.
     */
    async setVolume(volume: number): Promise<void> {
        const normalizedVolume = Math.max(
            0,
            Math.min(volume, 100)
        );

        if (normalizedVolume > 0) {
            this.previousVolume = normalizedVolume;
        }

        try {
            await invoke('set_volume', {
                volume: normalizedVolume / 100
            });

            this.playerState.update(state => ({
                ...state,
                volume: normalizedVolume,
                muted: normalizedVolume === 0
            }));

        } catch (error) {
            console.error(
                'Error al cambiar el volumen:',
                error
            );
        }
    }

    /**
     * Activa o desactiva el silencio.
     */
    async toggleMute(): Promise<void> {
        const state = this.playerState();

        if (state.muted || state.volume === 0) {
            // Restaurar el volumen anterior
            await this.setVolume(
                this.previousVolume > 0
                    ? this.previousVolume
                    : 52
            );

            return;
        }

        // Guardamos el volumen actual antes de silenciar
        this.previousVolume = state.volume;

        // Silenciar realmente el reproductor de Rust
        await this.setVolume(0);
    }

    /**
     * Activa o desactiva la reproducción aleatoria.
     *
     * Al activar shuffle se genera un orden aleatorio
     * independiente de la cola visible.
     *
     * La canción actualmente reproducida se mantiene
     * como primera posición del nuevo recorrido.
     */
    toggleShuffle(): void {
        const state = this.playerState();

        if (state.shuffle) {
            /**
             * Desactivar shuffle.
             */
            this.shuffleOrder = [];
            this.shuffleIndex = -1;

            this.playerState.update(currentState => ({
                ...currentState,
                shuffle: false
            }));

            return;
        }

        /**
         * Activar shuffle.
         */
        const queue = this.queueService.getQueue();

        if (queue.length <= 1) {
            this.playerState.update(currentState => ({
                ...currentState,
                shuffle: true
            }));

            return;
        }

        const currentTrackId = state.currentTrackId;

        /**
         * Creamos una copia de la cola para no modificar
         * el orden visible de QueueService.
         */
        const remaining = queue.filter(
            trackId => trackId !== currentTrackId
        );

        /**
         * Fisher-Yates:
         * mezcla la cola de manera mucho más apropiada
         * que sort(() => Math.random() - 0.5).
         */
        for (let i = remaining.length - 1; i > 0; i--) {
            const j = Math.floor(
                Math.random() * (i + 1)
            );

            [remaining[i], remaining[j]] =
                [remaining[j], remaining[i]];
        }

        /**
         * La canción actual siempre permanece como
         * primera posición del recorrido.
         */
        this.shuffleOrder = currentTrackId
            ? [currentTrackId, ...remaining]
            : remaining;

        this.shuffleIndex = currentTrackId
            ? 0
            : -1;

        this.playerState.update(currentState => ({
            ...currentState,
            shuffle: true
        }));
    }

    /**
     * Cambia el modo de repetición.
     *
     * Los tres estados disponibles son:
     *
     * off   → no repetir.
     * track → repetir únicamente la canción actual.
     * queue → repetir la cola completa.
     *
     * El orden de cambio es:
     *
     * off → track → queue → off
     */
    toggleRepeat(): void {
        this.playerState.update(state => {
            let repeat: 'off' | 'track' | 'queue';

            switch (state.repeat) {
                case 'off':
                    repeat = 'track';
                    break;

                case 'track':
                    repeat = 'queue';
                    break;

                case 'queue':
                default:
                    repeat = 'off';
                    break;
            }

            return {
                ...state,
                repeat
            };
        });
    }

    /**
     * Gestiona automáticamente el final de una canción.
     *
     * off:
     *   reproduce la siguiente canción.
     *
     * track:
     *   vuelve a reproducir la canción actual.
     *
     * queue:
     *   reproduce la siguiente canción y vuelve al inicio
     *   cuando se alcanza el final de la cola.
     */
    private handleTrackEnded(): void {
        if (this.handlingTrackEnd) {
            return;
        }

        this.handlingTrackEnd = true;

        const state = this.playerState();
        const currentTrackId = state.currentTrackId;

        if (!currentTrackId) {
            this.handlingTrackEnd = false;
            return;
        }

        /**
         * Repetición de la canción actual.
         */
        if (state.repeat === 'track') {
            void this.playTrack(currentTrackId)
                .finally(() => {
                    this.handlingTrackEnd = false;
                });

            return;
        }

        /**
         * Repetición de cola o reproducción normal.
         */
        void this.playNextAfterEnd()
            .finally(() => {
                this.handlingTrackEnd = false;
            });
    }

    /**
     * Determina qué canción debe reproducirse automáticamente
     * cuando termina la canción actual.
     */
    private async playNextAfterEnd(): Promise<void> {
        const state = this.playerState();
        const currentTrackId = state.currentTrackId;
        const queue = this.queueService.getQueue();

        if (
            !currentTrackId ||
            queue.length === 0
        ) {
            await this.stopPlayback();
            return;
        }

        const currentIndex =
            queue.indexOf(currentTrackId);

        if (currentIndex === -1) {
            await this.stopPlayback();
            return;
        }

        if (state.shuffle) {
            await this.playNextShuffleAfterEnd();
            return;
        }

        /**
         * Existe una siguiente canción.
         */
        if (currentIndex < queue.length - 1) {
            await this.playTrack(
                queue[currentIndex + 1]
            );

            return;
        }

        /**
         * Llegamos al final de la cola.
         *
         * Solo volvemos al principio cuando
         * está activo el modo queue.
         */
        if (state.repeat === 'queue') {
            await this.playTrack(queue[0]);
            return;
        }

        /**
         * No hay más canciones.
         */
        await this.stopPlayback();
    }

    /**
     * Determina la siguiente canción cuando una pista
     * termina estando activo el modo aleatorio.
     */
    private async playNextShuffleAfterEnd(): Promise<void> {
        if (this.shuffleOrder.length === 0) {
            await this.stopPlayback();
            return;
        }

        /**
         * Todavía quedan canciones en el ciclo actual.
         */
        if (
            this.shuffleIndex <
            this.shuffleOrder.length - 1
        ) {
            this.shuffleIndex++;

            await this.playTrack(
                this.shuffleOrder[this.shuffleIndex]
            );

            return;
        }

        /**
         * Se terminó el ciclo aleatorio.
         */
        if (
            this.playerState().repeat === 'queue'
        ) {
            this.generateNextShuffleCycle();
            return;
        }

        /**
         * No hay más canciones.
         */
        await this.stopPlayback();
    }

        /**
     * Detiene la reproducción cuando no existen
     * más canciones disponibles.
     *
     * Este método solo se invoca cuando la cola terminó de
     * forma NATURAL (llegó al final sin repeat=queue), por lo
     * que aquí no solo se pausa: se limpia por completo el
     * estado de reproducción.
     *
     * Esto deja currentTrackId en null y la cola vacía, lo cual
     * hace que hasPlayableContent() pase a false y el
     * MainLayoutComponent cierre el Bottom Player y el
     * Now Playing con su animación de salida.
     *
     * Este método utiliza el comando stop_audio de Rust.
     */
    private async stopPlayback(): Promise<void> {
        try {
            await invoke('stop_audio');
        } catch (error) {
            console.error(
                'Error al detener el audio:',
                error
            );
        }

        this.stopPositionSync();

        /**
         * Reiniciamos también el estado de shuffle: no debe
         * sobrevivir a una cola que ya terminó.
         */
        this.shuffleOrder = [];
        this.shuffleIndex = -1;

        /**
         * Vaciamos la cola real, no solo la referencia local.
         *
         * NOTA: si el método de limpieza de QueueService se
         * llama distinto a `clear()`, ajusta esta línea.
         */
        this.queueService.clear();

        this.playerState.update(state => ({
            ...state,
            playing: false,
            currentTrackId: null,
            currentTime: 0,
            shuffle: false,
            rightPanel: false,
            queue: this.queueService.getQueue()
        }));
    }

    /**
     * Muestra u oculta el panel lateral del reproductor.
     */
    toggleRightPanel(): void {
        this.playerState.update(state => ({
            ...state,
            rightPanel: !state.rightPanel
        }));
    }

    /**
     * Inicia la sincronización de la posición del audio.
     */
    private startPositionSync(): void {
        this.stopPositionSync();

        this.positionTimer = setInterval(() => {
            void this.updatePosition();
        }, 250);
    }

    /**
     * Detiene la sincronización periódica de la posición.
     */
    private stopPositionSync(): void {
        if (this.positionTimer === null) {
            return;
        }

        clearInterval(this.positionTimer);
        this.positionTimer = null;
    }

    /**
     * Obtiene desde Rust la posición actual del audio.
     *
     * También detecta cuándo la canción ha llegado
     * prácticamente a su final.
     */
    private async updatePosition(): Promise<void> {
        const currentState = this.playerState();

        if (
            !currentState.playing ||
            !currentState.currentTrackId
        ) {
            return;
        }

        try {
            const position =
                await invoke<number>(
                    'get_audio_position'
                );

            const track =
                this.getCurrentTrack();

            if (!track) {
                return;
            }

            /**
             * El margen evita depender de que la posición
             * coincida exactamente con la duración de la pista.
             */
            const hasEnded =
                position >= track.duration - 0.25;

            if (hasEnded) {
                this.playerState.update(state => ({
                    ...state,
                    currentTime: track.duration
                }));

                this.handleTrackEnded();

                return;
            }

            this.playerState.update(state => ({
                ...state,
                currentTime: Math.min(
                    position,
                    track.duration
                )
            }));

        } catch (error) {
            console.error(
                'Error al obtener la posición del audio:',
                error
            );
        }
    }

    async playFromPath(path: string, title = 'Reproduciendo'): Promise<void> {
        try {
            this.handlingTrackEnd = false;

            await invoke('play_audio', { path });

            this.playerState.update(state => ({
                ...state,
                playing: true,
                currentTrackId: null, // no pertenece a la biblioteca
                currentTime: 0
            }));

            this.startPositionSync();
        } catch (error) {
            console.error('Error al reproducir archivo externo:', error);
            throw error;
        }
    }

    async stopAudio(): Promise<void> {
        try {
            await invoke('stop_audio');

            this.playerState.update(state => ({
                ...state,
                playing: false,
                currentTime: 0
            }));
        } catch (error) {
            console.error('No se pudo detener el audio.', error);
        }
    }

    /**
     * Libera los recursos utilizados por el servicio.
     */
    ngOnDestroy(): void {
        this.stopAudio();
        this.stopPositionSync();
    }

    /**
     * Devuelve una canción a partir de su identificador.
     */
    getTrack(trackId: string): Track | undefined {
        return this.tracks().find(
            track => track.id === trackId
        );
    }

    /**
     * Devuelve la canción actualmente seleccionada.
     */
    getCurrentTrack(): Track | undefined {
        const currentTrackId =
            this.playerState().currentTrackId;

        if (!currentTrackId) {
            return undefined;
        }

        return this.getTrack(currentTrackId);
    }

    /**
     * Indica si existe una canción disponible para reproducir
     * hacia atrás dentro de la cola actual.
     */
    get canGoPrevious(): boolean {
        const state = this.playerState();
        const currentTrackId = state.currentTrackId;
        const queue = this.queueService.getQueue();

        if (
            queue.length === 0 ||
            !currentTrackId
        ) {
            return false;
        }

        const currentIndex =
            queue.indexOf(currentTrackId);

        if (currentIndex === -1) {
            return false;
        }

        return (
            currentIndex > 0 ||
            state.repeat === 'queue'
        );
    }

    /**
     * Indica si existe una canción disponible para reproducir
     * hacia adelante dentro de la cola actual.
     */
    get canGoNext(): boolean {
        const state = this.playerState();
        const currentTrackId = state.currentTrackId;
        const queue = this.queueService.getQueue();

        if (
            queue.length === 0 ||
            !currentTrackId
        ) {
            return false;
        }

        const currentIndex =
            queue.indexOf(currentTrackId);

        if (currentIndex === -1) {
            return false;
        }

        if (state.shuffle) {
            return (
                this.shuffleIndex <
                    this.shuffleOrder.length - 1 ||
                state.repeat === 'queue'
            );
        }

        return (
            currentIndex < queue.length - 1 ||
            state.repeat === 'queue'
        );
    }

    /**
     * Devuelve todas las canciones disponibles.
     */
    getTracks(): Track[] {
        return [...this.tracks()];
    }

    /**
     * Sincroniza la referencia de la cola dentro del estado
     * del reproductor con QueueService.
     */
    syncQueue(): void {
        this.playerState.update(state => ({
            ...state,
            queue: this.queueService.getQueue()
        }));
    }

    // /**
    //  * Genera un índice aleatorio diferente al actual cuando
    //  * existen varias canciones disponibles.
    //  */
    // private getRandomQueueIndex(
    //     length: number,
    //     currentIndex: number
    // ): number {
    //     if (length <= 1) {
    //         return 0;
    //     }

    //     let index = currentIndex;

    //     while (index === currentIndex) {
    //         index = Math.floor(
    //             Math.random() * length
    //         );
    //     }

    //     return index;
    // }
}