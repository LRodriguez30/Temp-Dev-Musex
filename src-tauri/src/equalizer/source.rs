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
        };


        source.rebuild_filters();


        source
    }


    // =========================================================
    // REBUILD FILTERS
    // =========================================================

    fn rebuild_filters(&mut self) {

        let bands =
            self.state.bands();


        self.filters =
            (0..self.channels)
                .map(|_| {

                    bands
                        .iter()
                        .filter_map(
                            |band| {
                                Self::build_filter(
                                    band,
                                    self.sample_rate,
                                )
                            }
                        )
                        .collect()

                })
                .collect();


        self.cached_version =
            self.state.version();
    }


    // =========================================================
    // BUILD FILTER
    // =========================================================

    fn build_filter(
        band: &super::band::EqBand,
        sample_rate: u32,
    ) -> Option<DirectForm1<f32>> {

        // -----------------------------------------------------
        // Límites de seguridad
        // -----------------------------------------------------

        let frequency =
            band.frequency.clamp(
                20.0,
                20_000.0,
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

        let coefficients =
            Coefficients::<f32>::from_params(
                biquad_type,
                sample_rate.hz(),
                frequency.hz(),
                q,
            )
            .ok()?;


        Some(
            DirectForm1::<f32>::new(
                coefficients
            )
        )
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

        self.rebuild_filters();
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
            self.rebuild_filters();
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


        Some(filtered)
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