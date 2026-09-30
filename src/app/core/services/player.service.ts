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
        this.loadContinueListening();

        window.addEventListener('beforeunload', () => {
            this.saveContinueListening();
            void invoke('stop_audio');
        });

        window.addEventListener('beforeunload', () => {
            this.saveContinueListening();
            void invoke('stop_eq_audio');
        });

        navigator.mediaDevices?.addEventListener('devicechange', () => {
            invoke('reinitialize_audio_device').catch(error => {
                console.error(
                    'No se pudo reinicializar el dispositivo de audio.',
                    error
                );
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
     * Track externo que se está reproduciendo temporalmente.
     *
     * Se utiliza para archivos descargados que todavía no
     * pertenecen a la biblioteca.
     *
     * No se agrega a LibraryService ni a QueueService.
     */
    private readonly externalTrack =
        signal<Track | null>(null);

    /**
     * Indica si la canción actual está siendo reproducida
     * mediante el reproductor EQ.
     *
     * IMPORTANTE:
     *
     * Esto no representa el estado del editor.
     *
     * Solo se activa cuando una canción de la página
     * de Ecualizador está utilizando play_eq_audio().
     */
    private eqPlayback = false;

    /**
     * Indica si el historial de reproducción está procesando
     * la canción que acaba de comenzar.
     *
     * Home utiliza este estado para mostrar una animación
     * de carga en "Escuchado recientemente".
     */
    readonly historyLoading = signal(false);

    /**
     * Estado público de solo lectura.
     */
    readonly state = this.playerState.asReadonly();

    /**
     * Biblioteca musical utilizada por el reproductor.
     */
    readonly tracks = this.libraryService.library;

    /**
     * Estado persistente de la última reproducción pendiente.
     *
     * Se utiliza exclusivamente para "Continuar escuchando".
     */
    private readonly continueListeningStorageKey =
        'musex_continue_listening';

    /**
     * Estado reactivo de "Continuar escuchando".
     *
     * Mantiene en memoria el mismo estado que se persiste
     * en localStorage para que Angular pueda reaccionar
     * inmediatamente cuando cambia la canción o la posición.
     */
    private readonly continueListening =
        signal<{
            trackId: string;
            position: number;
        } | null>(null);

    /**
     * Indica que existe un guardado de progreso pendiente.
     *
     * Este estado permanece activo durante el segundo utilizado
     * para evitar escrituras continuas en localStorage.
     */
    readonly continueListeningSaving = signal(false);

    /**
     * Estado público de solo lectura de "Continuar escuchando".
     */
    readonly continueListeningState =
        this.continueListening.asReadonly();

    private continueListeningSaveTimer:
        ReturnType<typeof setTimeout> | null = null;

    /**
     * Temporizador utilizado para consultar periódicamente
     * la posición real del audio en el reproductor de Rust.
     */
    private positionTimer:
        ReturnType<typeof setInterval> | null = null;

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

        /*
         * Si anteriormente estaba reproduciéndose una canción
         * mediante EQ, dejamos ese modo antes de iniciar
         * la reproducción normal.
         */
        if (this.eqPlayback) {

            await this.stopEqPlayback();

        }


        const currentTrackId =
            this.playerState().currentTrackId;

        if (
            currentTrackId &&
            currentTrackId !== trackId
        ) {
            this.saveContinueListening();
        }

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

            this.handlingTrackEnd = false;

            /**
             * Home utiliza este estado para mostrar
             * la carga de "Escuchado recientemente".
             */
            this.historyLoading.set(true);

            /**
             * Permitimos que Angular renderice el estado
             * de carga antes de iniciar la reproducción.
             */
            await new Promise<void>(resolve => {
                requestAnimationFrame(() => resolve());
            });

            await invoke('play_audio', {
                path: track.path
            });

            this.historyService.addEntry(trackId);

            this.eqPlayback = false;

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

        } finally {

            /**
             * El estado siempre se libera aunque la reproducción
             * falle durante invoke('play_audio').
             */
            this.historyLoading.set(false);
        }
    }

    /**
     * Registra en PlayerService una reproducción que utiliza
     * el backend del ecualizador.
     *
     * Este método NO inicia el audio.
     *
     * EqualizerService ya se encarga de preparar las bandas
     * y ejecutar play_eq_audio().
     *
     * PlayerService solamente incorpora esa reproducción
     * al estado global del reproductor para que:
     *
     * - Bottom Player pueda mostrar la canción.
     * - Full Player conozca la canción actual.
     * - Play/Pause pueda controlar el audio EQ.
     * - Seek pueda controlar el audio EQ.
     * - La posición pueda sincronizarse.
     */
    startEqPlayback(
        track: Track
    ): void {

        if (!track.path) {
            console.warn(
                `La canción "${track.title}" no tiene una ruta de audio.`
            );

            return;
        }

        if (!this.queueService.getQueue().includes(track.id)) {
            this.queueService.add(track.id);
        }

        this.handlingTrackEnd = false;

        this.eqPlayback = true;

        this.playerState.update(state => ({
            ...state,
            playing: true,
            currentTrackId: track.id,
            currentTime: 0,
            queue: this.queueService.getQueue()
        }));

        this.startPositionSync();
    }

    /**
     * Indica si la reproducción actual pertenece al backend EQ.
     *
     * Se mantiene como API pública para que otros servicios
     * puedan consultar el modo actual sin acceder al estado interno.
     */
    isEqPlayback(): boolean {

        return this.eqPlayback;
    }

    /**
     * Detiene únicamente la reproducción EQ registrada
     * como reproducción global del PlayerService.
     *
     * El editor de EQ no utiliza este método porque su
     * reproducción es independiente del Bottom Player.
     */
    async stopEqPlayback(): Promise<void> {

        if (!this.eqPlayback) {
            return;
        }

        try {

            await invoke(
                'stop_eq_audio'
            );

        } catch (error) {

            console.error(
                'Error al detener la reproducción EQ:',
                error
            );

        } finally {

            this.eqPlayback = false;

            this.stopPositionSync();

            this.playerState.update(state => ({
                ...state,
                playing: false,
                currentTrackId: null,
                currentTime: 0
            }));
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
             * La reproducción EQ utiliza su propio backend
             * de audio, pero mantiene el mismo estado global
             * del reproductor.
             */
            if (this.eqPlayback) {

                if (currentState.playing) {

                    await invoke(
                        'pause_eq_audio'
                    );

                    this.playerState.update(state => ({
                        ...state,
                        playing: false
                    }));

                    this.stopPositionSync();

                    this.saveContinueListening();

                    return;
                }

                await invoke(
                    'resume_eq_audio'
                );

                this.playerState.update(state => ({
                    ...state,
                    playing: true
                }));

                this.startPositionSync();

                return;
            }

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

                this.saveContinueListening();

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
             * ya no tiene una fuente que pueda reanudarse.
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

        const currentTrackId =
            state.currentTrackId;

        const currentIndex =
            currentTrackId
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

        void this.playTrack(
            queue[nextIndex]
        );
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
        if (
            this.shuffleIndex <
            this.shuffleOrder.length - 1
        ) {

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
        }
    }

    /**
     * Genera un nuevo ciclo de reproducción aleatoria.
     *
     * El nuevo ciclo contiene todas las canciones de la cola
     * una sola vez.
     */
    private generateNextShuffleCycle(): void {

        const queue =
            this.queueService.getQueue();

        const currentTrackId =
            this.playerState().currentTrackId;

        if (queue.length === 0) {
            return;
        }

        const remaining =
            queue.filter(
                trackId => trackId !== currentTrackId
            );

        for (
            let i = remaining.length - 1;
            i > 0;
            i--
        ) {

            const j =
                Math.floor(
                    Math.random() * (i + 1)
                );

            [
                remaining[i],
                remaining[j]
            ] = [
                remaining[j],
                remaining[i]
            ];
        }

        this.shuffleOrder =
            currentTrackId
                ? [currentTrackId, ...remaining]
                : remaining;

        this.shuffleIndex =
            currentTrackId
                ? 0
                : -1;

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

        const queue =
            this.queueService.getQueue();

        if (queue.length === 0) {
            return;
        }

        const currentTrackId =
            state.currentTrackId;

        const currentIndex =
            currentTrackId
                ? queue.indexOf(currentTrackId)
                : -1;

        if (currentIndex === -1) {

            void this.playTrack(
                queue[0]
            );

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

        void this.playTrack(
            queue[0]
        );
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

        const track =
            this.getCurrentTrack();

        if (!track) {
            return;
        }

        const normalizedTime =
            Math.max(
                0,
                Math.min(
                    time,
                    track.duration
                )
            );

        try {

            if (this.eqPlayback) {

                await invoke(
                    'seek_eq_audio',
                    {
                        seconds: normalizedTime
                    }
                );

            } else {

                await invoke(
                    'seek_audio',
                    {
                        seconds: normalizedTime
                    }
                );
            }

            this.playerState.update(state => ({
                ...state,
                currentTime: normalizedTime
            }));

            this.saveContinueListening();

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

        const normalizedVolume =
            Math.max(
                0,
                Math.min(
                    volume,
                    100
                )
            );

        if (normalizedVolume > 0) {
            this.previousVolume = normalizedVolume;
        }

        try {

            await invoke(
                'set_volume',
                {
                    volume: normalizedVolume / 100
                }
            );

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

        const state =
            this.playerState();

        if (
            state.muted ||
            state.volume === 0
        ) {

            await this.setVolume(
                this.previousVolume > 0
                    ? this.previousVolume
                    : 52
            );

            return;
        }

        /**
         * Guardamos el volumen actual antes de silenciar.
         */
        this.previousVolume =
            state.volume;

        /**
         * Silenciar realmente el reproductor de Rust.
         */
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

        const state =
            this.playerState();

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
        const queue =
            this.queueService.getQueue();

        if (queue.length <= 1) {

            this.playerState.update(currentState => ({
                ...currentState,
                shuffle: true
            }));

            return;
        }

        const currentTrackId =
            state.currentTrackId;

        /**
         * Creamos una copia de la cola para no modificar
         * el orden visible de QueueService.
         */
        const remaining =
            queue.filter(
                trackId => trackId !== currentTrackId
            );

        /**
         * Fisher-Yates:
         * mezcla la cola de manera mucho más apropiada
         * que sort(() => Math.random() - 0.5).
         */
        for (
            let i = remaining.length - 1;
            i > 0;
            i--
        ) {

            const j =
                Math.floor(
                    Math.random() * (i + 1)
                );

            [
                remaining[i],
                remaining[j]
            ] = [
                remaining[j],
                remaining[i]
            ];
        }

        /**
         * La canción actual siempre permanece como
         * primera posición del recorrido.
         */
        this.shuffleOrder =
            currentTrackId
                ? [currentTrackId, ...remaining]
                : remaining;

        this.shuffleIndex =
            currentTrackId
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

            let repeat:
                'off' |
                'track' |
                'queue';

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

        const state =
            this.playerState();

        const currentTrackId =
            state.currentTrackId;

        if (!currentTrackId) {

            this.handlingTrackEnd = false;

            return;
        }

        /**
         * Repetición de la canción actual.
         */
        if (state.repeat === 'track') {

            void this.playTrack(
                currentTrackId
            ).finally(() => {

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

        const state =
            this.playerState();

        const currentTrackId =
            state.currentTrackId;

        const queue =
            this.queueService.getQueue();

        if (
            !currentTrackId ||
            queue.length === 0
        ) {

            await this.stopPlayback();

            return;
        }

        const currentIndex =
            queue.indexOf(
                currentTrackId
            );

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

            await this.playTrack(
                queue[0]
            );

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

            if (this.eqPlayback) {

                await invoke(
                    'stop_eq_audio'
                );

            } else {

                await invoke(
                    'stop_audio'
                );
            }

        } catch (error) {

            console.error(
                'Error al detener el audio:',
                error
            );
        }

        this.eqPlayback = false;

        this.stopPositionSync();

        /**
         * Reiniciamos también el estado de shuffle:
         * no debe sobrevivir a una cola que ya terminó.
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

        this.externalTrack.set(null);
        
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

        this.positionTimer =
            setInterval(() => {
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

        clearInterval(
            this.positionTimer
        );

        this.positionTimer = null;
    }

    /**
     * Obtiene desde Rust la posición actual del audio.
     *
     * También detecta cuándo la canción ha llegado
     * prácticamente a su final.
     */
    private async updatePosition(): Promise<void> {

        const currentState =
            this.playerState();

        if (
            !currentState.playing ||
            !currentState.currentTrackId
        ) {
            return;
        }

        try {

            const position =
                await invoke<number>(
                    this.eqPlayback
                        ? 'get_eq_audio_position'
                        : 'get_audio_position'
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

            /**
             * Los tracks externos pueden no tener todavía
             * una duración conocida.
             *
             * En ese caso no intentamos detectar el final
             * mediante duration.
             */
            if (track.duration > 0) {

                const hasEnded =
                    position >=
                    track.duration - 0.25;

                if (hasEnded) {

                    this.playerState.update(state => ({
                        ...state,
                        currentTime: track.duration
                    }));

                    this.clearContinueListening();

                    this.handleTrackEnded();

                    return;
                }
            }

            this.playerState.update(state => ({
                ...state,
                currentTime:
                    track.duration > 0
                        ? Math.min(
                            position,
                            track.duration
                        )
                        : position
            }));

            this.scheduleContinueListeningSave();

        } catch (error) {

            console.error(
                'Error al obtener la posición del audio:',
                error
            );
        }
    }

    /**
     * Reproduce un archivo externo que no pertenece
     * a la biblioteca de Musex.
     */
    async playFromPath(
        path: string,
        title = 'Reproduciendo'
    ): Promise<void> {

        try {

            this.handlingTrackEnd = false;

            /**
             * Cada reproducción externa recibe un ID propio.
             *
             * El prefijo evita cualquier posibilidad de colisión
             * con los IDs reales de la biblioteca.
             */
            const externalTrackId =
                `external:${crypto.randomUUID()}`;

            /**
             * Creamos una representación temporal del archivo.
             *
             * Este Track NO se agrega a LibraryService.
             * Solo existe mientras este archivo está siendo
             * utilizado por el reproductor.
             */
            const duration = await invoke<number>(
                'get_audio_duration',
                { path }
            );

            const track: Track = {
                id: externalTrackId,
                title,
                artist: 'Descarga',
                album: '',
                genre: undefined,
                duration,
                path,
                addedAt: '',
                image: '',
                source: 'download',
                favorite: false
            };
            /**
             * Guardamos el track externo para que
             * getTrack() y getCurrentTrack() puedan encontrarlo.
             */
            this.externalTrack.set(track);

            await invoke(
                'play_audio',
                {
                    path
                }
            );

            this.eqPlayback = false;

            this.playerState.update(state => ({
                ...state,
                playing: true,
                currentTrackId: externalTrackId,
                currentTime: 0
            }));

            this.startPositionSync();

        } catch (error) {

            this.externalTrack.set(null);

            console.error(
                'Error al reproducir archivo externo:',
                error
            );

            throw error;
        }
    }

    /**
     * Detiene completamente el audio actual.
     */
    async stopAudio(): Promise<void> {

        try {

            if (this.eqPlayback) {

                await invoke(
                    'stop_eq_audio'
                );

            } else {

                await invoke('stop_audio');

            }

            this.externalTrack.set(null);

            this.eqPlayback = false;

            this.playerState.update(state => ({
                ...state,
                playing: false,
                currentTrackId: null,
                currentTime: 0
            }));

            this.stopPositionSync();

        } catch (error) {

            console.error(
                'No se pudo detener el audio.',
                error
            );
        }
    }

    /**
     * Libera los recursos utilizados por el servicio.
     */
    ngOnDestroy(): void {

        this.stopAudio();

        this.stopPositionSync();

        if (this.continueListeningSaveTimer !== null) {
            clearTimeout(
                this.continueListeningSaveTimer
            );

            this.continueListeningSaveTimer = null;
        }
    }

    /**
     * Devuelve una canción a partir de su identificador.
     */
    getTrack(
        trackId: string
    ): Track | undefined {

        const externalTrack =
            this.externalTrack();

        if (
            externalTrack &&
            externalTrack.id === trackId
        ) {
            return externalTrack;
        }

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

        return this.getTrack(
            currentTrackId
        );
    }

    /**
     * Indica si existe una canción disponible para reproducir
     * hacia atrás dentro de la cola actual.
     */
    get canGoPrevious(): boolean {

        const state =
            this.playerState();

        const currentTrackId =
            state.currentTrackId;

        const queue =
            this.queueService.getQueue();

        if (
            queue.length === 0 ||
            !currentTrackId
        ) {
            return false;
        }

        const currentIndex =
            queue.indexOf(
                currentTrackId
            );

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

        const state =
            this.playerState();

        const currentTrackId =
            state.currentTrackId;

        const queue =
            this.queueService.getQueue();

        if (
            queue.length === 0 ||
            !currentTrackId
        ) {
            return false;
        }

        const currentIndex =
            queue.indexOf(
                currentTrackId
            );

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
            currentIndex <
                queue.length - 1 ||
            state.repeat === 'queue'
        );
    }

    /**
     * Devuelve todas las canciones disponibles.
     */
    getTracks(): Track[] {
        return [
            ...this.tracks()
        ];
    }

    /**
     * Sincroniza la referencia de la cola dentro del estado
     * del reproductor con QueueService.
     */
    syncQueue(): void {

        this.playerState.update(state => ({
            ...state,
            queue:
                this.queueService.getQueue()
        }));
    }

    /**
     * Guarda la posición actual de la canción para poder
     * continuar posteriormente desde el mismo punto.
     */
    private saveContinueListening(): void {

        const state =
            this.playerState();

        if (!state.currentTrackId) {
            return;
        }

        const track =
            this.getCurrentTrack();

        if (!track) {
            return;
        }

        const position =
            Math.max(
                0,
                Math.min(
                    state.currentTime,
                    track.duration
                )
            );

        /**
         * Una canción prácticamente terminada ya no necesita
         * aparecer como "Continuar escuchando".
         */
        if (
            track.duration > 0 &&
            position >= track.duration - 1
        ) {

            this.clearContinueListening();

            return;
        }

        const data = {
            trackId: state.currentTrackId,
            position
        };

        try {

            localStorage.setItem(
                this.continueListeningStorageKey,
                JSON.stringify(data)
            );

            this.continueListening.set(
                data
            );

        } catch (error) {

            console.error(
                'No se pudo guardar el progreso de reproducción:',
                error
            );
        }
    }

    /**
     * Programa el guardado del progreso.
     *
     * Se utiliza un retraso de un segundo para evitar
     * escribir continuamente en localStorage mientras
     * la posición del audio cambia cada 250 ms.
     *
     * Mientras el temporizador está activo,
     * continueListeningSaving permanece en true para
     * que la interfaz pueda informar al usuario.
     */
    private scheduleContinueListeningSave(): void {

        if (
            this.continueListeningSaveTimer !== null
        ) {
            return;
        }

        this.continueListeningSaving.set(true);

        this.continueListeningSaveTimer =
            setTimeout(() => {

                this.continueListeningSaveTimer = null;

                try {

                    this.saveContinueListening();

                } finally {

                    this.continueListeningSaving.set(false);
                }

            }, 1000);
    }

    /**
     * Elimina la canción pendiente de continuar.
     */
    private clearContinueListening(): void {

        try {

            localStorage.removeItem(
                this.continueListeningStorageKey
            );

            this.continueListening.set(null);

            /**
             * Si existía un guardado pendiente, también
             * dejamos de indicar que está procesándose.
             */
            this.continueListeningSaving.set(false);

        } catch (error) {

            console.error(
                'No se pudo eliminar el estado de continuación:',
                error
            );
        }
    }

    /**
     * Carga desde localStorage el estado inicial
     * de "Continuar escuchando".
     */
    private loadContinueListening(): void {

        try {

            const raw =
                localStorage.getItem(
                    this.continueListeningStorageKey
                );

            if (!raw) {

                this.continueListening.set(null);

                return;
            }

            const parsed =
                JSON.parse(raw);

            if (
                typeof parsed?.trackId !== 'string' ||
                typeof parsed?.position !== 'number'
            ) {

                this.clearContinueListening();

                return;
            }

            this.continueListening.set({
                trackId: parsed.trackId,
                position: Math.max(
                    0,
                    parsed.position
                )
            });

        } catch (error) {

            console.error(
                'No se pudo cargar el estado de continuación:',
                error
            );

            this.continueListening.set(null);
        }
    }

    /**
     * Recupera la última canción pendiente de continuar.
     *
     * Se mantiene este método para conservar la API existente
     * de PlayerService.
     */
    getContinueListening(): {
        trackId: string;
        position: number;
    } | null {

        return this.continueListening();
    }

    /**
     * Reanuda la última canción guardada desde
     * la posición en la que fue interrumpida.
     */
    async resumeContinueListening(): Promise<void> {

        const saved =
            this.continueListening();

        if (!saved) {
            return;
        }

        const track =
            this.getTrack(
                saved.trackId
            );

        if (
            !track ||
            !track.path
        ) {

            this.clearContinueListening();

            return;
        }

        const position =
            Math.max(
                0,
                Math.min(
                    saved.position,
                    track.duration
                )
            );

        await this.playTrack(
            saved.trackId
        );

        if (position > 0) {

            await this.seek(
                position
            );
        }
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
    //
    //     let index = currentIndex;
    //
    //     while (index === currentIndex) {
    //         index = Math.floor(
    //             Math.random() * length
    //         );
    //     }
    //
    //     return index;
    // }
}