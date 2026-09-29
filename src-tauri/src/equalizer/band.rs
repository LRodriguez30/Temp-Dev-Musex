// =============================================================
// ECUALIZADOR - BANDA
// =============================================================

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EqFilterType {
    Peaking,
    LowShelf,
    HighShelf,
}

#[derive(Debug, Clone, Copy)]
pub struct EqBand {
    /// Identificador estable asignado por la interfaz. Permite
    /// actualizar o eliminar una banda concreta sin depender
    /// de su posición dentro de la lista.
    pub id: u32,
    pub filter_type: EqFilterType,
    pub frequency: f32,
    pub gain_db: f32,
    pub q: f32,
}