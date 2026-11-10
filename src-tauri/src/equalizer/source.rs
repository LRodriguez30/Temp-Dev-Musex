// =============================================================
// ECUALIZADOR - SOURCE
// =============================================================

use std::num::{NonZeroU16, NonZeroU32};
use std::sync::Arc;
use std::time::Duration;

use biquad::{
    Biquad,
    Coefficients,
    DirectForm1,
    ToHertz,
    Type as BiquadType,
};

use rodio::{
    source::SeekError,
    Source,
};

use super::band::EqFilterType;
use super::state::EqualizerState;


// =============================================================
// EQUALIZER SOURCE
// =============================================================

/// Envuelve un `Source` de Rodio aplicando la cadena de bandas
/// activa en `EqualizerState`, canal por canal y muestra por
/// muestra.
///
/// También propaga `try_seek` hacia la fuente interna para permitir
/// que `rodio::Player::try_seek()` pueda cambiar correctamente la
/// posición de reproducción.
pub struct EqualizerSource<S>
where
    S: Source<Item = f32>,
{
    inner: S,

    state: Arc<EqualizerState>,

    cached_version: u64,

    channels: usize,

    sample_rate: u32,

    /// filters[canal][banda]
    filters: Vec<Vec<DirectForm1<f32>>>,

    current_channel: usize,

    /// Ganancia de seguridad (≤ 1.0) que compensa los refuerzos
    /// del ecualizador para evitar saturación.
    headroom: f32,
}


// =============================================================
// CONSTRUCTOR
// =============================================================

impl<S> EqualizerSource<S>
where
    S: Source<Item = f32>,
{
    pub fn new(
        inner: S,
        state: Arc<EqualizerState>,
    ) -> Self {

        let channels =
            inner.channels().get() as usize;

        let sample_rate =
            inner.sample_rate().get();


        let mut source = Self {

            inner,

            state,

            cached_version: 0,

            channels,

            sample_rate,

            filters: Vec::new(),

            current_channel: 0,

            headroom: 1.0,
        };


        source.rebuild_filters(false);


        source
    }


    // =========================================================
    // REBUILD FILTERS
    // =========================================================

    /// Reconstruye la cadena de filtros.
    ///
    /// Con `keep_state` se conserva la memoria interna de cada filtro
    /// si la cantidad de bandas no cambió: solo se actualizan los
    /// coeficientes. Así mover una banda no produce chasquidos.
    fn rebuild_filters(&mut self, keep_state: bool) {

        let bands =
            self.state.bands();

        let sample_rate =
            self.sample_rate;


        let coefficients: Vec<Coefficients<f32>> =
            bands
                .iter()
                .filter_map(
                    |band| Self::build_coefficients(
                        band,
                        sample_rate,
                    )
                )
                .collect();


        self.headroom =
            Self::headroom_for(
                &coefficients,
                sample_rate,
            );


        let reusable =
            keep_state
            && self.filters.len() == self.channels
            && self.filters
                .iter()
                .all(|channel| channel.len() == coefficients.len());


        if reusable {

            for channel in self.filters.iter_mut() {

                for (filter, coefficient) in
                    channel.iter_mut().zip(coefficients.iter())
                {
                    filter.update_coefficients(*coefficient);
                }
            }

        } else {

            self.filters =
                (0..self.channels)
                    .map(|_| {

                        coefficients
                            .iter()
                            .map(|coefficient| {
                                DirectForm1::<f32>::new(*coefficient)
                            })
                            .collect()

                    })
                    .collect();
        }


        self.cached_version =
            self.state.version();
    }


    // =========================================================
    // BUILD COEFFICIENTS
    // =========================================================

    fn build_coefficients(
        band: &super::band::EqBand,
        sample_rate: u32,
    ) -> Option<Coefficients<f32>> {

        // -----------------------------------------------------
        // Límites de seguridad
        // -----------------------------------------------------
        //
        // La frecuencia nunca debe acercarse a Nyquist: con
        // archivos de 22.05 kHz o 32 kHz una banda aguda sería
        // rechazada por el cálculo y quedaría sin efecto.

        let max_frequency =
            20_000.0_f32.min(sample_rate as f32 * 0.45);

        let frequency =
            band.frequency.clamp(
                20.0,
                max_frequency.max(20.0),
            );


        let q =
            band.q.clamp(
                0.1,
                20.0,
            );


        let gain_db =
            band.gain_db.clamp(
                -24.0,
                24.0,
            );


        // -----------------------------------------------------
        // Tipo de filtro
        // -----------------------------------------------------

        let biquad_type =
            match band.filter_type {

                EqFilterType::Peaking =>
                    BiquadType::PeakingEQ(
                        gain_db
                    ),

                EqFilterType::LowShelf =>
                    BiquadType::LowShelf(
                        gain_db
                    ),

                EqFilterType::HighShelf =>
                    BiquadType::HighShelf(
                        gain_db
                    ),
            };


        // -----------------------------------------------------
        // Coeficientes
        // -----------------------------------------------------

        Coefficients::<f32>::from_params(
            biquad_type,
            sample_rate.hz(),
            frequency.hz(),
            q,
        )
        .ok()
    }


    // =========================================================
    // HEADROOM
    // =========================================================
    //
    // Calcula el pico de la respuesta combinada de todas las bandas
    // y devuelve la ganancia lineal que lo compensa. Sin ella, un
    // refuerzo de +7 dB puede superar 0 dBFS y saturar el audio.

    fn headroom_for(
        coefficients: &[Coefficients<f32>],
        sample_rate: u32,
    ) -> f32 {

        if coefficients.is_empty() {
            return 1.0;
        }

        const POINTS: usize = 192;

        let sample_rate =
            sample_rate as f64;

        let max_frequency =
            20_000.0_f64.min(sample_rate * 0.45);

        let mut peak_db = 0.0_f64;

        for index in 0..POINTS {

            let t =
                index as f64 / (POINTS - 1) as f64;

            let frequency =
                20.0 * (max_frequency / 20.0).powf(t);

            let w =
                2.0 * std::f64::consts::PI * frequency / sample_rate;

            let (c1, s1) = (w.cos(), w.sin());
            let (c2, s2) = ((2.0 * w).cos(), (2.0 * w).sin());

            let mut total_db = 0.0_f64;

            for c in coefficients {

                let (b0, b1, b2) =
                    (c.b0 as f64, c.b1 as f64, c.b2 as f64);

                let (a1, a2) =
                    (c.a1 as f64, c.a2 as f64);

                // H(z) = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)
                let num_re = b0 + b1 * c1 + b2 * c2;
                let num_im = -(b1 * s1 + b2 * s2);

                let den_re = 1.0 + a1 * c1 + a2 * c2;
                let den_im = -(a1 * s1 + a2 * s2);

                let num = num_re * num_re + num_im * num_im;
                let den = den_re * den_re + den_im * den_im;

                if num > 0.0 && den > 0.0 {
                    total_db += 10.0 * (num / den).log10();
                }
            }

            if total_db > peak_db {
                peak_db = total_db;
            }
        }

        // Por debajo de ~0.05 dB no merece la pena compensar.
        if peak_db < 0.05 {
            return 1.0;
        }

        10.0_f32.powf(-(peak_db.min(24.0) as f32) / 20.0)
    }


    // =========================================================
    // RESET FILTER STATE
    // =========================================================

    /// Reinicia el estado interno de los filtros.
    ///
    /// Es importante después de un seek porque los filtros
    /// IIR mantienen memoria de las muestras anteriores.
    fn reset_filter_state(&mut self) {

        self.current_channel = 0;

        // Tras un salto de posición la memoria de los filtros ya no
        // es válida: se reconstruyen desde cero.
        self.rebuild_filters(false);
    }
}


// =============================================================
// ITERATOR
// =============================================================

impl<S> Iterator for EqualizerSource<S>
where
    S: Source<Item = f32>,
{
    type Item = f32;


    fn next(&mut self) -> Option<f32> {

        // -----------------------------------------------------
        // Detectar cambios en las bandas
        // -----------------------------------------------------

        if self.current_channel == 0
            && self.cached_version
                != self.state.version()
        {
            self.rebuild_filters(true);
        }


        // -----------------------------------------------------
        // Obtener siguiente muestra
        // -----------------------------------------------------

        let sample =
            self.inner.next()?;


        // -----------------------------------------------------
        // Aplicar filtros del canal
        // -----------------------------------------------------

        let filtered =
            match self.filters
                .get_mut(
                    self.current_channel
                )
            {

                Some(channel_filters) => {

                    channel_filters
                        .iter_mut()
                        .fold(
                            sample,
                            |value, filter| {
                                filter.run(value)
                            }
                        )
                }

                None => sample,
            };


        // -----------------------------------------------------
        // Avanzar canal
        // -----------------------------------------------------

        if self.channels > 0 {

            self.current_channel =
                (
                    self.current_channel + 1
                )
                % self.channels;
        }


        // Margen de seguridad + último recurso contra saturación.
        Some(
            (filtered * self.headroom)
                .clamp(-1.0, 1.0)
        )
    }
}


// =============================================================
// RODIO SOURCE
// =============================================================

impl<S> Source for EqualizerSource<S>
where
    S: Source<Item = f32>,
{
    // ---------------------------------------------------------
    // CURRENT SPAN
    // ---------------------------------------------------------

    fn current_span_len(
        &self,
    ) -> Option<usize> {

        self.inner.current_span_len()
    }


    // ---------------------------------------------------------
    // CHANNELS
    // ---------------------------------------------------------

    fn channels(
        &self,
    ) -> NonZeroU16 {

        self.inner.channels()
    }


    // ---------------------------------------------------------
    // SAMPLE RATE
    // ---------------------------------------------------------

    fn sample_rate(
        &self,
    ) -> NonZeroU32 {

        self.inner.sample_rate()
    }


    // ---------------------------------------------------------
    // TOTAL DURATION
    // ---------------------------------------------------------

    fn total_duration(
        &self,
    ) -> Option<Duration> {

        self.inner.total_duration()
    }


    // ---------------------------------------------------------
    // SEEK
    // ---------------------------------------------------------

    /// Propaga el seek al decoder real.
    ///
    /// Rodio 0.22.x utiliza `Source::try_seek()` para realizar
    /// búsquedas dentro de una fuente de audio.
    ///
    /// Después del seek se reinicia el estado de los filtros
    /// porque los filtros IIR conservan memoria de muestras
    /// anteriores.
    fn try_seek(
        &mut self,
        pos: Duration,
    ) -> Result<(), SeekError> {

        // -----------------------------------------------------
        // Delegar el seek al decoder real
        // -----------------------------------------------------

        self.inner.try_seek(pos)?;


        // -----------------------------------------------------
        // Reiniciar estado de los filtros
        // -----------------------------------------------------

        self.reset_filter_state();


        Ok(())
    }
}