
/**
 * Catálogo de íconos disponibles para portadas de playlists
 * y canciones.
 *
 * Se centraliza aquí para mantener la misma representación
 * en el modal, el sidebar, las tarjetas y el detalle.
 */
export const COVER_ICONS: { id: string; path: string }[] = [
  // Identidad de Musex
  {
    id: 'musex',
    path: 'M3 10v4 M7 6v12 M11 3v18 M15 7v10 M19 10v4 M23 11v2'
  },

  // Iconos existentes
  { id: 'music', path: 'M9 18V5l12-2v13 M9 9l12-2' },
  {
    id: 'heart',
    path: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z'
  },
  { id: 'zap', path: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z' },
  { id: 'moon', path: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z' },
  {
    id: 'sun',
    path: 'M12 2v4 M12 18v4 M4.93 4.93l2.83 2.83 M16.24 16.24l2.83 2.83 M2 12h4 M18 12h4 M4.93 19.07l2.83-2.83 M16.24 7.76l2.83-2.83'
  },
  {
    id: 'headphones',
    path: 'M3 18v-6a9 9 0 0 1 18 0v6 M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3ZM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3Z'
  },

  // Nuevos iconos
  {
    id: 'disc',
    path: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0'
  },
  {
    id: 'mic',
    path: 'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z M19 10v1a7 7 0 0 1-14 0v-1 M12 18v4 M8 22h8'
  },
  {
    id: 'radio',
    path: 'M4 6h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z M2 10h20 M6 14h.01 M10 14h.01 M14 14h.01 M18 14h.01 M6 18h.01 M10 18h.01 M14 18h.01 M18 18h.01 M7 6l10-4'
  },
  {
    id: 'list',
    path: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01'
  },
  {
    id: 'flame',
    path: 'M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-1 2-2 3-3 4-1-4-4-6-4-6s1 5-2 8a7 7 0 0 0 6 11Z'
  }
];

/**
 * El primer color es el acento de Musex.
 */
export const COVER_COLORS: string[] = [
  // Color de identidad
  'var(--musex-accent)',

  // Colores existentes
  '#a45cff',
  '#ff9d00',
  '#7276ff',
  '#ff3ab7',
  '#44e000',

  // Nuevos colores
  '#22d3ee', // Cian
  '#3b82f6', // Azul
  '#14b8a6', // Turquesa
  '#f43f5e', // Rosa rojizo
  '#facc15', // Amarillo
  '#fb7185', // Coral rosado
  '#a3e635',  // Lima claro
  '#8b5cf6', // Violeta intenso
  '#6366f1', // Índigo
  '#06b6d4', // Cian
  '#0ea5e9', // Azul cielo
  '#10b981', // Esmeralda
  '#84cc16', // Lima
  '#eab308', // Dorado
  '#f97316', // Naranja intenso
  '#e11d48', // Frambuesa
  '#d946ef', // Magenta
  '#94a3b8'  // Gris azulado
];

/**
 * Devuelve el path SVG de un ícono.
 * Musex es el predeterminado cuando no existe el identificador.
 */
export function getCoverIconPath(iconId: string | undefined): string {
  return COVER_ICONS.find(icon => icon.id === iconId)?.path
    ?? COVER_ICONS[0].path;
}
