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
// - Solicitar presets a Sense cuando corresponde.
//
// Sense NO controla directamente este servicio.
// Sense únicamente recomienda un preset.
// EqualizerService mantiene la propiedad del estado real del EQ.
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


interface EqTrackInfo {

    path:
    string;

    file_name:
    string;
}


// =============================================================
// SERVICE
// =============================================================

@Injectable({
    providedIn: 'root'
})
export class EqualizerService implements OnDestroy {

    constructor(
        private readonly senseService:
            SenseService
    ) { }


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
            tracks => [
                ...tracks,
                eqTrack
            ]
        );
    }


    async disableFromEq(
        track: EqTrack
    ): Promise<void> {

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


    /**
     * Sincroniza `eqTracks` con lo que realmente
     * existe en temp/.
     */
    async refreshFromDisk(
        library: Track[]
    ): Promise<void> {

        const infos =
            await invoke<EqTrackInfo[]>(
                'list_eq_tracks'
            );


        const matched =
            infos
                .map(info => {

                    const track =
                        library.find(
                            item =>
                                info.file_name.startsWith(
                                    item.id
                                )
                        );


                    if (!track) {

                        return null;
                    }


                    return {

                        ...track,

                        tempPath:
                            info.path

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


    /**
     * Indica que el usuario está manipulando
     * manualmente la barra de reproducción.
     */
    readonly isSeeking =
        signal(false);


    /**
     * Indica que Sense está esperando la respuesta
     * del proveedor de IA.
     *
     * IMPORTANTE:
     * Este estado solamente se activa mientras
     * `recommendEqPreset()` está esperando el resultado.
     *
     * No se activa:
     * - Si existe un preset en cache.
     * - Si Sense está deshabilitado.
     * - Si Sense no tiene API key.
     * - Si el asistente de EQ está deshabilitado.
     * - Mientras se utiliza el preset local.
     */
    readonly isSenseLoading =
        signal(false);


    /**
     * Error ocurrido al intentar generar el preset
     * mediante Sense.
     *
     * No bloquea el editor.
     */
    readonly senseError =
        signal<string | null>(
            null
        );


    /**
     * Indica si el preset actualmente cargado
     * proviene de Musex Sense.
     */
    readonly isSensePreset =
        signal(false);


    /**
     * Nombre del preset de Sense actualmente cargado.
     */
    readonly activePresetName =
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
    // SENSE PRESETS
    // ===========================================================
    //
    // Se mantienen en memoria durante la sesión.
    //
    // La clave es el ID de la pista.
    //
    // Esto evita volver a consultar Gemini cada vez que el usuario
    // abre y cierra el mismo ecualizador.
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


        // ---------------------------------------------------------
        // PREPARAR ESTADO
        // ---------------------------------------------------------

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


        this.bands.set(
            []
        );


        await invoke(
            'reset_eq'
        );


        // ---------------------------------------------------------
        // OBTENER PRESET
        // ---------------------------------------------------------

        const initialBands =
            await this.getInitialBands(
                track
            );


        // ---------------------------------------------------------
        // CARGAR BANDAS
        // ---------------------------------------------------------

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


        // ---------------------------------------------------------
        // PLAYBACK
        // ---------------------------------------------------------

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
        // 1. COMPROBAR CACHE
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


            return this.convertSensePreset(
                cachedPreset
            );
        }


        // ---------------------------------------------------------
        // 2. COMPROBAR SI SENSE PUEDE USARSE
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

                // -----------------------------------------------------
                // SENSE ESTÁ GENERANDO EL PRESET
                // -----------------------------------------------------
                //
                // El loading empieza JUSTO antes de la petición
                // real a Gemini.
                //
                // Así no mostramos loading mientras:
                // - se revisa el cache;
                // - se carga configuración;
                // - Sense está deshabilitado;
                // - no existe API key.
                // -----------------------------------------------------

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


                    this.isSensePreset.set(
                        true
                    );


                    this.activePresetName.set(
                        sanitizedPreset.name
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


                    return this.createDefaultBands();

                } finally {

                    // ---------------------------------------------------
                    // LA RESPUESTA YA LLEGÓ O LA PETICIÓN FALLÓ.
                    // EN AMBOS CASOS TERMINA LA PANTALLA DE CARGA.
                    // ---------------------------------------------------

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
        // 3. FALLBACK LOCAL
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
    // SANITIZE SENSE PRESET
    // ===========================================================
    //
    // Rust ya valida estos valores.
    //
    // Esta segunda capa evita que un cambio futuro del backend
    // pueda introducir valores problemáticos en el frontend.
    // ===========================================================

    private sanitizeSensePreset(
        preset: SenseEqPreset
    ): SenseEqPreset {

        if (preset.bands.length !== 10) {

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
                        Number(band.frequency);

                    const gainDb =
                        Number(band.gainDb);

                    const q =
                        Number(band.q);


                    if (
                        !Number.isFinite(frequency) ||
                        !Number.isFinite(gainDb) ||
                        !Number.isFinite(q)
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
        }
    }


    // ===========================================================
    // PLAY / PAUSE
    // ===========================================================

    async togglePlayback(): Promise<void> {

        const next =
            !this.isPlaying();


        // ---------------------------------------------------------
        // PLAY
        // ---------------------------------------------------------

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


        // ---------------------------------------------------------
        // PAUSE
        // ---------------------------------------------------------

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


            // -------------------------------------------------------
            // DETECTAR FINAL DE LA PISTA
            // -------------------------------------------------------

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


            // -------------------------------------------------------
            // ACTUALIZAR POSICIÓN
            // -------------------------------------------------------

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
    // SEEK — START
    // ===========================================================

    startSeek(): void {

        this.isSeeking.set(
            true
        );
    }


    // ===========================================================
    // SEEK — UPDATE
    // ===========================================================

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


    // ===========================================================
    // SEEK — FINISH
    // ===========================================================

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


    // ===========================================================
    // SEEK — EXECUTE
    // ===========================================================

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


        this.pushBand(
            band
        );
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

            this.pushBand(
                updated
            );
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

        this.bands.set(
            []
        );


        this.isSensePreset.set(
            false
        );


        this.activePresetName.set(
            null
        );


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

        await invoke(
            'set_eq_band',
            {
                band: {
                    id: band.id,
                    filterType: band.filterType,
                    frequency: band.frequency,
                    gainDb: band.gainDb,
                    q: band.q,
                }
            }
        );
    }


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