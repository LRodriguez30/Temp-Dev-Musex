// =============================================================
// MUSEX - EQUALIZER SERVICE
// =============================================================
//
// Estado y control del ecualizador de Musex.
//
// Responsabilidades:
// - Gestionar pistas habilitadas para EQ.
// - Controlar reproducción EQ.
// - Sincronizar posición.
// - Gestionar bandas.
// - Enviar cambios al backend Rust.
// - Persistir presets por pista.
// - Gestionar estado de cambios pendientes.
// - Solicitar presets a Sense cuando corresponde.
//
// Sense NO controla directamente este servicio.
// Sense únicamente recomienda un preset.
// EqualizerService mantiene la propiedad del estado real del EQ.
//
// IMPORTANTE:
// - Los cambios de las bandas son inmediatos en el audio.
// - Los cambios manuales NO se persisten automáticamente.
// - El usuario debe pulsar "Guardar preset".
// - Los presets generados por Sense sí se guardan automáticamente.
// =============================================================

import {
    Injectable,
    signal,
    computed,
    OnDestroy
} from '@angular/core';

import { invoke } from '@tauri-apps/api/core';

import {
    SenseEqPreset,
    SenseService
} from './sense.service';

import { Track } from '../models/track.model';
import { PlayerService } from './player.service';
import { LibraryService } from './library.service';


// =============================================================
// TYPES
// =============================================================

export type EqFilterType =
    | 'peaking'
    | 'lowshelf'
    | 'highshelf';


export interface EqBand {

    id: number;

    filterType:
    EqFilterType;

    frequency:
    number;

    gainDb:
    number;

    q:
    number;
}


export interface EqTrack
    extends Track {

    tempPath:
    string;
}


// =============================================================
// PERSISTENT PRESET
// =============================================================

type EqPresetSource =
    | 'manual'
    | 'sense';


interface StoredEqPreset {

    trackId:
    string;

    source:
    EqPresetSource;

    name:
    string;

    bands:
    Array<{

        id?: number;

        frequency:
        number;

        gainDb:
        number;

        q:
        number;

        filterType:
        EqFilterType;
    }>;
}


// =============================================================
// SERVICE
// =============================================================

@Injectable({
    providedIn: 'root'
})
export class EqualizerService
    implements OnDestroy {


    constructor(
        private readonly senseService:
            SenseService,

        private readonly playerService:
            PlayerService,

        private readonly libraryService:
            LibraryService
    ) { }


    // ===========================================================
    // NORMAL PLAYER STATE
    // ===========================================================

    private normalPlaybackState: {
        trackId: string;
        position: number;
        wasPlaying: boolean;
    } | null = null;


    private async suspendNormalPlayback(): Promise<void> {

        const state =
            this.playerService.state();

        const currentTrack =
            this.playerService.getCurrentTrack();


        if (!currentTrack) {

            this.normalPlaybackState = null;

            return;
        }


        this.normalPlaybackState = {

            trackId:
                currentTrack.id,

            position:
                state.currentTime ?? 0,

            wasPlaying:
                state.playing
        };


        if (state.playing) {

            await this.playerService.togglePlay();
        }
    }


    // ===========================================================
    // EQ PAGE PLAYBACK
    // ===========================================================

    /**
     * Identificador de la pista que actualmente está
     * siendo reproducida desde la página de Ecualizador.
     *
     * Este estado es independiente del editor.
     *
     * El editor continúa utilizando activeTrack(),
     * isPlaying(), currentTime(), etc.
     */
    private eqPagePlaybackTrackId:
        string | null =
        null;


    /**
     * Indica si la reproducción iniciada desde
     * la página de Ecualizador está activa.
     */
    private eqPagePlaybackPlaying =
        false;


    /**
     * Reproduce una pista desde la página de Ecualizador.
     *
     * REGLA:
     *
     * 1. Si la pista no está habilitada para EQ:
     *    -> reproducción normal.
     *
     * 2. Si está habilitada pero NO tiene preset persistente:
     *    -> reproducción normal.
     *
     * 3. Si está habilitada y tiene preset persistente:
     *    -> reproduce tempPath mediante el backend EQ
     *       y carga exactamente el preset guardado.
     *
     * Los presets de Sense cuentan como persistentes porque
     * también se almacenan mediante save_eq_preset.
     */
    async playTrack(
        track: Track
    ): Promise<void> {

        const eqTrack =
            this.eqTracks().find(
                item =>
                    item.id === track.id
            );


        /*
         * Primero comprobamos si existe un preset
         * persistente para esta pista.
         *
         * No generamos uno nuevo con Sense aquí.
         *
         * La página de Ecualizador solamente debe
         * utilizar un preset que ya exista.
         */
        const storedPreset =
            await this.getPersistentPreset(
                track.id
            );


        /*
         * No hay versión EQ utilizable.
         *
         * En este caso detenemos cualquier reproducción
         * EQ de la página y dejamos trabajar al reproductor
         * normal.
         */
        if (
            !eqTrack ||
            !storedPreset
        ) {

            await this.stopEqPagePlayback();


            const current =
                this.playerService.getCurrentTrack();


            if (
                current?.id === track.id
            ) {

                this.playerService.togglePlay();

                return;
            }


            await this.playerService.playTrack(
                track.id
            );

            return;
        }


        /*
         * Si la misma pista ya está siendo reproducida
         * mediante EQ, alternamos pausa/reproducción.
         */
        if (
            this.eqPagePlaybackTrackId ===
                track.id
        ) {

            if (
                this.eqPagePlaybackPlaying
            ) {

                await invoke(
                    'pause_eq_audio'
                );

                this.eqPagePlaybackPlaying =
                    false;

                /*
                 * PlayerService mantiene el mismo
                 * estado global utilizado por Bottom Player.
                 */
                this.playerService.state();

                this.playerService['playerState']?.update?.(
                    state => ({
                        ...state,
                        playing: false
                    })
                );

                return;
            }


            await invoke(
                'resume_eq_audio'
            );

            this.eqPagePlaybackPlaying =
                true;

            this.playerService['playerState']?.update?.(
                state => ({
                    ...state,
                    playing: true
                })
            );

            return;
        }


        /*
         * Cambiamos a una pista EQ diferente.
         */
        await this.stopEqPagePlayback();


        /*
         * El reproductor normal y el reproductor EQ
         * no deben sonar simultáneamente.
         */
        await this.suspendNormalPlayback();


        try {

            /*
             * Limpiamos cualquier estado anterior
             * del ecualizador Rust.
             */
            await invoke(
                'reset_eq'
            );


            /*
             * Aplicamos exactamente las bandas
             * almacenadas en el preset persistente.
             */
            const bands =
                this.convertStoredPreset(
                    storedPreset
                );


            for (
                const band of bands
            ) {

                await this.pushBand(
                    band
                );
            }


            /*
             * Reproducimos la copia temporal habilitada
             * para ecualización.
             */
            await invoke(
                'play_eq_audio',
                {
                    path:
                        eqTrack.tempPath
                }
            );


            this.eqPagePlaybackTrackId =
                track.id;


            this.eqPagePlaybackPlaying =
                true;


            /*
             * PlayerService se convierte en la fuente
             * global del estado de reproducción.
             *
             * Esto permite que Bottom Player aparezca
             * aunque el audio real provenga de EQ.
             */
            this.playerService.startEqPlayback(
                track
            );

        } catch (error) {

            console.error(
                'No se pudo reproducir la versión ecualizada:',
                error
            );


            /*
             * Si el backend EQ falla, dejamos el sistema
             * en un estado limpio y utilizamos el
             * reproductor normal como fallback.
             */
            this.eqPagePlaybackTrackId =
                null;


            this.eqPagePlaybackPlaying =
                false;


            try {

                await invoke(
                    'stop_eq_audio'
                );

            } catch {
                // El backend ya puede estar detenido.
            }


            await this.playerService.playTrack(
                track.id
            );
        }
    }


    /**
     * Obtiene únicamente el preset persistente.
     *
     * Este método NO solicita nada a Sense y NO crea
     * presets nuevos.
     */
    private async getPersistentPreset(
        trackId: string
    ): Promise<StoredEqPreset | null> {

        try {

            return await invoke<
                StoredEqPreset | null
            >(
                'get_eq_preset',
                {
                    trackId
                }
            );

        } catch (error) {

            console.warn(
                'No se pudo consultar el preset persistente del ecualizador:',
                error
            );

            return null;
        }
    }


    /**
     * Detiene exclusivamente la reproducción iniciada
     * desde la página de Ecualizador.
     *
     * No modifica el estado del editor.
     */
    private async stopEqPagePlayback(): Promise<void> {

        if (
            this.eqPagePlaybackTrackId ===
            null
        ) {

            return;
        }


        try {

            await this.playerService.stopEqPlayback();

        } catch (error) {

            console.error(
                'No se pudo detener la reproducción EQ:',
                error
            );

        } finally {

            this.eqPagePlaybackTrackId =
                null;


            this.eqPagePlaybackPlaying =
                false;


            try {

                await invoke(
                    'reset_eq'
                );

            } catch (error) {

                console.error(
                    'No se pudo limpiar el estado del ecualizador:',
                    error
                );
            }
        }
    }


    // ===========================================================
    // TRACKS HABILITADOS
    // ===========================================================

    readonly eqTracks =
        signal<EqTrack[]>([]);


    readonly hasEnabledTracks =
        computed(
            () =>
                this.eqTracks().length > 0
        );


    isEnabled(
        track: Track
    ): boolean {

        return this.eqTracks().some(
            item =>
                item.id === track.id
        );
    }


    async enableForEq(
        track: Track
    ): Promise<void> {

        if (
            this.isEnabled(track)
        ) {

            return;
        }


        const tempPath =
            await invoke<string>(
                'enable_track_for_eq',
                {
                    path:
                        track.path
                }
            );


        const eqTrack:
            EqTrack = {

            ...track,

            tempPath
        };


        this.eqTracks.update(
            tracks => {

                const alreadyExists =
                    tracks.some(
                        item =>
                            item.id === track.id
                    );


                if (alreadyExists) {

                    return tracks;
                }


                return [
                    ...tracks,
                    eqTrack
                ];
            }
        );
    }


    async disableFromEq(
        track: EqTrack
    ): Promise<void> {

        /*
         * Si esta pista está reproduciéndose desde
         * la página de EQ, detenemos primero esa
         * reproducción.
         */
        if (
            this.eqPagePlaybackTrackId ===
            track.id
        ) {

            await this.stopEqPagePlayback();
        }


        await invoke(
            'disable_track_for_eq',
            {
                path:
                    track.tempPath
            }
        );


        this.eqTracks.update(
            tracks =>
                tracks.filter(
                    item =>
                        item.id !== track.id
                )
        );


        this.recommendedPresets.delete(
            track.id
        );


        if (
            this.activeTrack()?.id ===
            track.id
        ) {

            await this.closeEditor();
        }
    }


    // ===========================================================
    // SYNCHRONIZE ENABLED TRACKS
    // ===========================================================

    async refreshFromDisk(
        library: Track[]
    ): Promise<void> {

        const tempTracks =
            this.libraryService.getTempTracks();


        const matched =
            tempTracks
                .map(tempTrack => {

                    // -------------------------------------------------
                    // 1. Intentar por ID
                    // -------------------------------------------------

                    let track =
                        library.find(
                            item =>
                                item.id ===
                                tempTrack.id
                        );


                    // -------------------------------------------------
                    // 2. Fallback por nombre de archivo
                    // -------------------------------------------------

                    if (!track) {

                        const tempFileName =
                            this.getFileName(
                                tempTrack.path
                            );


                        track =
                            library.find(
                                item =>
                                    this.getFileName(
                                        item.path
                                    ) ===
                                    tempFileName
                            );
                    }


                    if (!track) {

                        return null;
                    }


                    return {

                        ...track,

                        tempPath:
                            tempTrack.path

                    } as EqTrack;
                })
                .filter(
                    (
                        item
                    ): item is EqTrack =>
                        item !== null
                );


        this.eqTracks.set(
            matched
        );
    }


    private getFileName(
        path: string
    ): string {

        return path
            .trim()
            .replace(/\\/g, '/')
            .split('/')
            .pop()
            ?.toLocaleLowerCase()
            ?? '';
    }


    // ===========================================================
    // EDITOR STATE
    // ===========================================================

    readonly activeTrack =
        signal<EqTrack | null>(
            null
        );


    readonly isPlaying =
        signal(false);


    readonly currentTime =
        signal(0);


    readonly isSeeking =
        signal(false);


    readonly isSenseLoading =
        signal(false);


    readonly senseError =
        signal<string | null>(
            null
        );


    readonly isSensePreset =
        signal(false);


    readonly activePresetName =
        signal<string | null>(
            null
        );


    // ===========================================================
    // PRESET SAVE STATE
    // ===========================================================

    /**
     * Indica que el preset actual tiene cambios
     * que todavía no han sido guardados.
     */
    readonly isPresetDirty =
        signal(false);


    /**
     * Indica que actualmente se está escribiendo
     * el preset en Rust.
     */
    readonly isSavingPreset =
        signal(false);


    /**
     * Indica que el último guardado terminó
     * correctamente.
     */
    readonly presetSaved =
        signal(false);


    /**
     * Guarda el último error de persistencia.
     */
    readonly presetSaveError =
        signal<string | null>(
            null
        );


    private positionTimer:
        ReturnType<typeof setInterval> | null =
        null;


    private nextBandId =
        1;


    readonly bands =
        signal<EqBand[]>([]);


    readonly hasBands =
        computed(
            () =>
                this.bands().length > 0
        );


    readonly filterTypeLabels:
        Record<
            EqFilterType,
            string
        > = {

            peaking:
                'Campana',

            lowshelf:
                'Graves',

            highshelf:
                'Agudos',
        };


    // ===========================================================
    // PRESET PERSISTENCE
    // ===========================================================

    /**
     * Todas las escrituras de presets pasan
     * por esta cola.
     *
     * Esto evita que dos llamadas simultáneas
     * a save_eq_preset se pisen entre sí.
     *
     * IMPORTANTE:
     *
     * La operación original conserva su error para
     * que "Guardar preset" pueda saber si falló.
     *
     * La cola interna continúa disponible aunque
     * una operación anterior haya fallado.
     */
    private presetSaveQueue:
        Promise<void> =
        Promise.resolve();


    // ===========================================================
    // SENSE PRESETS - SESSION CACHE
    // ===========================================================

    private readonly recommendedPresets =
        new Map<
            string,
            SenseEqPreset
        >();


    // ===========================================================
    // DEFAULT PRESET
    // ===========================================================

    private readonly defaultPreset:
        Omit<EqBand, 'id'>[] = [

            {
                filterType:
                    'lowshelf',

                frequency:
                    45,

                gainDb:
                    7.0,

                q:
                    0.70,
            },

            {
                filterType:
                    'peaking',

                frequency:
                    90,

                gainDb:
                    5.0,

                q:
                    0.90,
            },

            {
                filterType:
                    'peaking',

                frequency:
                    180,

                gainDb:
                    3.5,

                q:
                    1.00,
            },

            {
                filterType:
                    'peaking',

                frequency:
                    400,

                gainDb:
                    -4.0,

                q:
                    1.10,
            },

            {
                filterType:
                    'peaking',

                frequency:
                    1200,

                gainDb:
                    2.5,

                q:
                    0.80,
            },

            {
                filterType:
                    'peaking',

                frequency:
                    2800,

                gainDb:
                    5.0,

                q:
                    1.00,
            },

            {
                filterType:
                    'peaking',

                frequency:
                    5000,

                gainDb:
                    6.0,

                q:
                    0.90,
            },

            {
                filterType:
                    'peaking',

                frequency:
                    9000,

                gainDb:
                    -2.0,

                q:
                    1.00,
            },

            {
                filterType:
                    'highshelf',

                frequency:
                    14000,

                gainDb:
                    4.0,

                q:
                    0.70,
            },
        ];


    // ===========================================================
    // OPEN EDITOR
    // ===========================================================

    async openEditor(
        track: EqTrack
    ): Promise<void> {

        this.stopPositionSync();

        await this.suspendNormalPlayback();


        this.activeTrack.set(
            track
        );


        this.nextBandId =
            1;


        this.isPlaying.set(
            false
        );


        this.isSeeking.set(
            false
        );


        this.currentTime.set(
            0
        );


        this.isSenseLoading.set(
            false
        );


        this.isSensePreset.set(
            false
        );


        this.activePresetName.set(
            null
        );


        this.senseError.set(
            null
        );


        this.isPresetDirty.set(
            false
        );


        this.presetSaved.set(
            false
        );


        this.presetSaveError.set(
            null
        );


        this.isSavingPreset.set(
            false
        );


        this.bands.set(
            []
        );


        await invoke(
            'reset_eq'
        );


        const initialBands =
            await this.getInitialBands(
                track
            );


        this.bands.set(
            initialBands
        );


        for (
            const band of initialBands
        ) {

            await this.pushBand(
                band
            );
        }


        await invoke(
            'play_eq_audio',
            {
                path:
                    track.tempPath
            }
        );


        this.currentTime.set(
            0
        );


        this.isPlaying.set(
            true
        );


        this.startPositionSync();
    }


    // ===========================================================
    // GET INITIAL BANDS
    // ===========================================================

    private async getInitialBands(
        track: EqTrack
    ): Promise<EqBand[]> {

        // ---------------------------------------------------------
        // 1. PRESET PERSISTENTE
        // ---------------------------------------------------------

        try {

            const storedPreset =
                await invoke<StoredEqPreset | null>(
                    'get_eq_preset',
                    {
                        trackId:
                            track.id
                    }
                );


            if (storedPreset) {

                if (
                    storedPreset.source ===
                    'manual'
                ) {

                    this.isSensePreset.set(
                        false
                    );


                    this.activePresetName.set(
                        storedPreset.name
                    );


                    this.presetSaved.set(
                        true
                    );


                    this.isPresetDirty.set(
                        false
                    );


                    return this.convertStoredPreset(
                        storedPreset
                    );
                }


                if (
                    storedPreset.source ===
                    'sense'
                ) {

                    const sensePreset =
                        this.convertStoredPresetToSensePreset(
                            storedPreset
                        );


                    this.recommendedPresets.set(
                        track.id,
                        sensePreset
                    );


                    this.isSensePreset.set(
                        true
                    );


                    this.activePresetName.set(
                        storedPreset.name
                    );


                    this.presetSaved.set(
                        true
                    );


                    this.isPresetDirty.set(
                        false
                    );


                    return this.convertSensePreset(
                        sensePreset
                    );
                }
            }

        } catch (error) {

            console.warn(
                'No se pudo cargar el preset persistente del ecualizador:',
                error
            );
        }


        // ---------------------------------------------------------
        // 2. CACHE DE SESIÓN
        // ---------------------------------------------------------

        const cachedPreset =
            this.recommendedPresets.get(
                track.id
            );


        if (cachedPreset) {

            this.isSensePreset.set(
                true
            );


            this.activePresetName.set(
                cachedPreset.name
            );


            this.presetSaved.set(
                true
            );


            this.isPresetDirty.set(
                false
            );


            return this.convertSensePreset(
                cachedPreset
            );
        }


        // ---------------------------------------------------------
        // 3. COMPROBAR SENSE
        // ---------------------------------------------------------

        try {

            await this.senseService.ensureLoaded();


            const settings =
                this.senseService.settings();


            const senseAvailable =
                settings.enabled &&
                settings.hasApiKey &&
                settings.capabilities.eqAssistant;


            if (senseAvailable) {

                this.isSenseLoading.set(
                    true
                );


                this.senseError.set(
                    null
                );


                try {

                    const preset =
                        await this.senseService.recommendEqPreset(
                            {
                                title:
                                    track.title,

                                artist:
                                    track.artist,

                                album:
                                    track.album,

                                genre:
                                    track.genre,
                            }
                        );


                    const sanitizedPreset =
                        this.sanitizeSensePreset(
                            preset
                        );


                    this.recommendedPresets.set(
                        track.id,
                        sanitizedPreset
                    );


                    /*
                     * Sense generó un preset nuevo.
                     *
                     * A diferencia de los cambios manuales,
                     * este sí se persiste inmediatamente.
                     */
                    await this.savePersistentPreset(
                        track.id,
                        'sense',
                        sanitizedPreset.name,
                        sanitizedPreset.bands
                    );


                    this.isSensePreset.set(
                        true
                    );


                    this.activePresetName.set(
                        sanitizedPreset.name
                    );


                    this.isPresetDirty.set(
                        false
                    );


                    this.presetSaved.set(
                        true
                    );


                    return this.convertSensePreset(
                        sanitizedPreset
                    );

                } catch (error) {

                    console.warn(
                        'Sense no pudo generar un preset de EQ. Se utilizará el preset local:',
                        error
                    );


                    this.senseError.set(
                        'Sense no pudo generar el preset. Se utilizará el preset local.'
                    );


                    this.isSensePreset.set(
                        false
                    );


                    this.activePresetName.set(
                        null
                    );


                    this.isPresetDirty.set(
                        false
                    );


                    this.presetSaved.set(
                        false
                    );


                    return this.createDefaultBands();

                } finally {

                    this.isSenseLoading.set(
                        false
                    );
                }
            }

        } catch (error) {

            console.warn(
                'No se pudo comprobar la configuración de Sense:',
                error
            );
        }


        // ---------------------------------------------------------
        // 4. FALLBACK LOCAL
        // ---------------------------------------------------------

        this.isSenseLoading.set(
            false
        );


        this.isSensePreset.set(
            false
        );


        this.activePresetName.set(
            null
        );


        this.isPresetDirty.set(
            false
        );


        this.presetSaved.set(
            false
        );


        return this.createDefaultBands();
    }


    // ===========================================================
    // CREATE DEFAULT BANDS
    // ===========================================================

    private createDefaultBands(): EqBand[] {

        return this.defaultPreset.map(
            preset => ({

                id:
                    this.nextBandId++,

                ...preset,

            })
        );
    }


    // ===========================================================
    // CONVERT SENSE PRESET
    // ===========================================================

    private convertSensePreset(
        preset: SenseEqPreset
    ): EqBand[] {

        return preset.bands.map(
            band => ({

                id:
                    this.nextBandId++,

                filterType:
                    band.filterType,

                frequency:
                    band.frequency,

                gainDb:
                    band.gainDb,

                q:
                    band.q,
            })
        );
    }


    // ===========================================================
    // CONVERT STORED PRESET
    // ===========================================================

    private convertStoredPreset(
        preset: StoredEqPreset
    ): EqBand[] {

        return preset.bands.map(
            band => ({

                id:
                    this.nextBandId++,

                filterType:
                    band.filterType,

                frequency:
                    band.frequency,

                gainDb:
                    band.gainDb,

                q:
                    band.q,
            })
        );
    }


    // ===========================================================
    // CONVERT STORED -> SENSE
    // ===========================================================

    private convertStoredPresetToSensePreset(
        preset: StoredEqPreset
    ): SenseEqPreset {

        return {

            name:
                preset.name,

            bands:
                preset.bands.map(
                    band => ({

                        filterType:
                            band.filterType,

                        frequency:
                            band.frequency,

                        gainDb:
                            band.gainDb,

                        q:
                            band.q,
                    })
                )
        };
    }


    // ===========================================================
    // SAVE PERSISTENT PRESET
    // ===========================================================

    private savePersistentPreset(
        trackId: string,
        source: EqPresetSource,
        name: string,
        bands: Array<{
            frequency: number;
            gainDb: number;
            q: number;
            filterType: EqFilterType;
        }>
    ): Promise<void> {

        const save =
            async (): Promise<void> => {

                await invoke(
                    'save_eq_preset',
                    {
                        preset: {

                            trackId,

                            source,

                            name,

                            bands: bands.map(
                                (band, index) => ({

                                    id:
                                        index + 1,

                                    frequency:
                                        band.frequency,

                                    gainDb:
                                        band.gainDb,

                                    q:
                                        band.q,

                                    filterType:
                                        band.filterType,
                                })
                            )
                        }
                    }
                );
            };


        /*
         * La operación actual conserva su propio
         * resultado/error.
         *
         * La siguiente operación continúa aunque
         * esta falle.
         */
        const operation =
            this.presetSaveQueue.then(
                save
            );


        this.presetSaveQueue =
            operation.catch(
                error => {

                    console.error(
                        'No se pudo guardar el preset persistente del ecualizador:',
                        error
                    );
                }
            );


        return operation;
    }


    // ===========================================================
    // SAVE CURRENT PRESET
    // ===========================================================

    /**
     * Guarda explícitamente el estado actual
     * del ecualizador como preset manual.
     *
     * Este método es llamado por el botón
     * "Guardar preset" del editor.
     */
    async saveCurrentPreset(): Promise<boolean> {

        const track =
            this.activeTrack();


        if (!track) {

            return false;
        }


        const currentBands =
            this.bands();


        if (
            currentBands.length === 0
        ) {

            return false;
        }


        const bands =
            currentBands.map(
                band => ({

                    frequency:
                        band.frequency,

                    gainDb:
                        band.gainDb,

                    q:
                        band.q,

                    filterType:
                        band.filterType,
                })
            );


        const name =
            this.activePresetName()?.trim() ||
            'Personal';


        this.isSavingPreset.set(
            true
        );


        this.presetSaved.set(
            false
        );


        this.presetSaveError.set(
            null
        );


        try {

            await this.savePersistentPreset(
                track.id,
                'manual',
                name,
                bands
            );


            /*
             * Una vez guardado correctamente,
             * el preset deja de ser considerado
             * un preset de Sense.
             */
            this.isSensePreset.set(
                false
            );


            this.activePresetName.set(
                name
            );


            this.isPresetDirty.set(
                false
            );


            this.presetSaved.set(
                true
            );


            return true;

        } catch (error) {

            console.error(
                'No se pudo guardar el preset actual del ecualizador:',
                error
            );


            this.presetSaveError.set(
                'No se pudo guardar el preset.'
            );


            this.presetSaved.set(
                false
            );


            return false;

        } finally {

            this.isSavingPreset.set(
                false
            );
        }
    }


    // ===========================================================
    // MARK PRESET AS MODIFIED
    // ===========================================================

    private markPresetAsModified(): void {

        /*
         * Una modificación manual transforma
         * conceptualmente el preset actual en
         * una configuración manual.
         */
        this.isSensePreset.set(
            false
        );


        if (
            !this.activePresetName()
        ) {

            this.activePresetName.set(
                'Personal'
            );
        }


        this.isPresetDirty.set(
            true
        );


        this.presetSaved.set(
            false
        );


        this.presetSaveError.set(
            null
        );
    }


    // ===========================================================
    // SANITIZE SENSE PRESET
    // ===========================================================

    private sanitizeSensePreset(
        preset: SenseEqPreset
    ): SenseEqPreset {

        if (
            preset.bands.length !== 10
        ) {

            throw new Error(
                `Sense devolvió ${preset.bands.length} bandas. Se esperaban exactamente 10.`
            );
        }


        const sanitizedBands =
            preset.bands.map(
                band => {

                    if (
                        !this.isValidFilterType(
                            band.filterType
                        )
                    ) {

                        throw new Error(
                            `Sense devolvió un tipo de filtro inválido: ${band.filterType}`
                        );
                    }


                    const frequency =
                        Number(
                            band.frequency
                        );


                    const gainDb =
                        Number(
                            band.gainDb
                        );


                    const q =
                        Number(
                            band.q
                        );


                    if (
                        !Number.isFinite(
                            frequency
                        ) ||
                        !Number.isFinite(
                            gainDb
                        ) ||
                        !Number.isFinite(
                            q
                        )
                    ) {

                        throw new Error(
                            'Sense devolvió una banda con valores inválidos.'
                        );
                    }


                    return {

                        filterType:
                            band.filterType,

                        frequency:
                            this.clamp(
                                frequency,
                                20,
                                20_000
                            ),

                        gainDb:
                            this.clamp(
                                gainDb,
                                -24,
                                24
                            ),

                        q:
                            this.clamp(
                                q,
                                0.1,
                                10
                            ),
                    };
                }
            );


        return {

            name:
                preset.name?.trim() ||
                'Sense EQ',

            bands:
                sanitizedBands,
        };
    }


    // ===========================================================
    // FILTER TYPE VALIDATION
    // ===========================================================

    private isValidFilterType(
        value: string
    ): value is EqFilterType {

        return (
            value === 'peaking' ||
            value === 'lowshelf' ||
            value === 'highshelf'
        );
    }


    // ===========================================================
    // CLAMP
    // ===========================================================

    private clamp(
        value: number,
        min: number,
        max: number
    ): number {

        if (
            !Number.isFinite(
                value
            )
        ) {

            return min;
        }


        return Math.max(
            min,
            Math.min(
                value,
                max
            )
        );
    }


    // ===========================================================
    // CLOSE EDITOR
    // ===========================================================

    async closeEditor(): Promise<void> {

        /*
         * IMPORTANTE:
         *
         * No guardamos automáticamente al cerrar.
         *
         * El usuario debe haber utilizado
         * "Guardar preset".
         *
         * Esto hace que la persistencia sea
         * explícita y predecible.
         */


        this.stopPositionSync();


        try {

            await invoke(
                'stop_eq_audio'
            );

        } finally {

            this.activeTrack.set(
                null
            );


            this.bands.set(
                []
            );


            this.isPlaying.set(
                false
            );


            this.isSeeking.set(
                false
            );


            this.currentTime.set(
                0
            );


            this.isSenseLoading.set(
                false
            );


            this.senseError.set(
                null
            );


            this.isSensePreset.set(
                false
            );


            this.activePresetName.set(
                null
            );


            this.isPresetDirty.set(
                false
            );


            this.presetSaved.set(
                false
            );


            this.presetSaveError.set(
                null
            );


            this.isSavingPreset.set(
                false
            );
        }
    }


    // ===========================================================
    // PLAY / PAUSE
    // ===========================================================

    async togglePlayback(): Promise<void> {

        const next =
            !this.isPlaying();


        if (next) {

            await invoke(
                'resume_eq_audio'
            );


            this.isPlaying.set(
                true
            );


            this.startPositionSync();

            return;
        }


        await invoke(
            'pause_eq_audio'
        );


        this.isPlaying.set(
            false
        );


        this.stopPositionSync();
    }


    // ===========================================================
    // POSITION SYNC
    // ===========================================================

    private startPositionSync(): void {

        this.stopPositionSync();


        this.positionTimer =
            setInterval(
                () => {

                    void this.syncPosition();

                },
                100
            );
    }


    private stopPositionSync(): void {

        if (
            this.positionTimer === null
        ) {

            return;
        }


        clearInterval(
            this.positionTimer
        );


        this.positionTimer =
            null;
    }


    private async syncPosition(): Promise<void> {

        if (
            !this.isPlaying() ||
            this.isSeeking() ||
            !this.activeTrack()
        ) {

            return;
        }


        try {

            const position =
                await invoke<number>(
                    'get_eq_audio_position'
                );


            if (
                !Number.isFinite(
                    position
                )
            ) {

                return;
            }


            const track =
                this.activeTrack();


            const duration =
                track?.duration ?? 0;


            if (
                duration > 0 &&
                position >= duration - 0.15
            ) {

                this.currentTime.set(
                    0
                );


                this.isPlaying.set(
                    false
                );


                this.stopPositionSync();

                return;
            }


            const normalized =
                duration > 0

                    ? Math.max(
                        0,
                        Math.min(
                            position,
                            duration
                        )
                    )

                    : Math.max(
                        0,
                        position
                    );


            this.currentTime.set(
                normalized
            );

        } catch (error) {

            console.error(
                'No se pudo obtener la posición del ecualizador:',
                error
            );
        }
    }


    // ===========================================================
    // SEEK
    // ===========================================================

    startSeek(): void {

        this.isSeeking.set(
            true
        );
    }


    updateSeekPosition(
        seconds: number
    ): void {

        if (
            !Number.isFinite(
                seconds
            )
        ) {

            return;
        }


        const track =
            this.activeTrack();


        if (!track) {

            return;
        }


        const duration =
            track.duration ?? 0;


        const normalized =
            duration > 0

                ? Math.max(
                    0,
                    Math.min(
                        seconds,
                        duration
                    )
                )

                : Math.max(
                    0,
                    seconds
                );


        this.currentTime.set(
            normalized
        );
    }


    async finishSeek(): Promise<void> {

        if (
            !this.isSeeking()
        ) {

            return;
        }


        const position =
            this.currentTime();


        try {

            await this.seek(
                position
            );

        } finally {

            this.isSeeking.set(
                false
            );
        }
    }


    async seek(
        seconds: number
    ): Promise<void> {

        const track =
            this.activeTrack();


        if (!track) {

            return;
        }


        if (
            !Number.isFinite(
                seconds
            )
        ) {

            return;
        }


        const duration =
            track.duration ?? 0;


        const normalized =
            duration > 0

                ? Math.max(
                    0,
                    Math.min(
                        seconds,
                        duration
                    )
                )

                : Math.max(
                    0,
                    seconds
                );


        try {

            await invoke(
                'seek_eq_audio',
                {
                    seconds:
                        normalized
                }
            );


            this.currentTime.set(
                normalized
            );

        } catch (error) {

            console.error(
                'No se pudo cambiar la posición del ecualizador:',
                error
            );
        }
    }


    // ===========================================================
    // BANDS
    // ===========================================================

    addBand(): void {

        const band:
            EqBand = {

            id:
                this.nextBandId++,

            filterType:
                'peaking',

            frequency:
                1000,

            gainDb:
                0,

            q:
                1,
        };


        this.bands.update(
            bands => [
                ...bands,
                band
            ]
        );


        /*
         * El audio cambia inmediatamente.
         */
        void this.pushBand(
            band
        );


        /*
         * Pero todavía no guardamos
         * el preset en disco.
         */
        this.markPresetAsModified();
    }


    removeBand(
        id: number
    ): void {

        this.bands.update(
            bands =>
                bands.filter(
                    band =>
                        band.id !== id
                )
        );


        void invoke(
            'remove_eq_band',
            {
                bandId:
                    id
            }
        );


        /*
         * El cambio es inmediato en Rust,
         * pero la persistencia requiere
         * pulsar Guardar preset.
         */
        this.markPresetAsModified();
    }


    updateBand(
        id: number,
        patch:
            Partial<Omit<EqBand, 'id'>>
    ): void {

        let updated:
            EqBand | undefined;


        this.bands.update(
            bands =>
                bands.map(
                    band => {

                        if (
                            band.id !== id
                        ) {

                            return band;
                        }


                        updated = {

                            ...band,

                            ...patch
                        };


                        return updated;
                    }
                )
        );


        if (updated) {

            /*
             * Actualización inmediata
             * del audio.
             */
            void this.pushBand(
                updated
            );


            /*
             * La modificación queda pendiente
             * de persistencia.
             */
            this.markPresetAsModified();
        }
    }


    onFrequencyInput(
        id: number,
        value: string
    ): void {

        const frequency =
            Number(value);


        if (
            Number.isFinite(
                frequency
            )
        ) {

            this.updateBand(
                id,
                {
                    frequency
                }
            );
        }
    }


    onGainInput(
        id: number,
        value: string
    ): void {

        const gainDb =
            Number(value);


        if (
            Number.isFinite(
                gainDb
            )
        ) {

            this.updateBand(
                id,
                {
                    gainDb
                }
            );
        }
    }


    onQInput(
        id: number,
        value: string
    ): void {

        const q =
            Number(value);


        if (
            Number.isFinite(
                q
            )
        ) {

            this.updateBand(
                id,
                {
                    q
                }
            );
        }
    }


    onFilterTypeChange(
        id: number,
        value: string
    ): void {

        if (
            !this.isValidFilterType(
                value
            )
        ) {

            return;
        }


        this.updateBand(
            id,
            {
                filterType:
                    value
            }
        );
    }


    // ===========================================================
    // RESET EQ
    // ===========================================================

    resetBands(): void {

        const track =
            this.activeTrack();


        this.bands.set(
            []
        );


        this.isSensePreset.set(
            false
        );


        this.activePresetName.set(
            null
        );


        this.isPresetDirty.set(
            false
        );


        this.presetSaved.set(
            false
        );


        this.presetSaveError.set(
            null
        );


        if (track) {

            this.recommendedPresets.delete(
                track.id
            );


            void invoke(
                'remove_eq_preset',
                {
                    trackId:
                        track.id
                }
            ).catch(error => {

                console.error(
                    'No se pudo eliminar el preset persistente del ecualizador:',
                    error
                );

            });
        }


        void invoke(
            'reset_eq'
        );
    }


    // ===========================================================
    // SEND BAND TO RUST
    // ===========================================================

    private async pushBand(
        band: EqBand
    ): Promise<void> {

        try {

            await invoke(
                'set_eq_band',
                {
                    band: {

                        id:
                            band.id,

                        filterType:
                            band.filterType,

                        frequency:
                            band.frequency,

                        gainDb:
                            band.gainDb,

                        q:
                            band.q,
                    }
                }
            );

        } catch (error) {

            console.error(
                'No se pudo actualizar la banda del ecualizador:',
                error
            );
        }
    }


    // ===========================================================
    // DESTROY
    // ===========================================================

    ngOnDestroy(): void {

        this.stopPositionSync();


        void invoke(
            'stop_eq_audio'
        ).catch(error => {

            console.error(
                'No se pudo detener el audio del ecualizador al destruir el servicio:',
                error
            );

        });
    }
}