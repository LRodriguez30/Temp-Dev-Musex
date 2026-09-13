/**
 * Catálogo de íconos disponibles para portadas de playlists
 * y canciones.
 *
 * Se centraliza aquí para que el modal de creación, el sidebar,
 * la tarjeta de playlist y el detalle de playlist dibujen
 * siempre el mismo path para el mismo id — evita que cada
 * componente reimplemente su propio subconjunto de íconos.
 */
export const COVER_ICONS: { id: string; path: string }[] = [
  { id: 'music', path: 'M9 18V5l12-2v13 M9 9l12-2' },
  { id: 'heart', path: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z' },
  { id: 'zap', path: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z' },
  { id: 'moon', path: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z' },
  { id: 'sun', path: 'M12 2v4 M12 18v4 M4.93 4.93l2.83 2.83 M16.24 16.24l2.83 2.83 M2 12h4 M18 12h4 M4.93 19.07l2.83-2.83 M16.24 7.76l2.83-2.83' },
  { id: 'headphones', path: 'M3 18v-6a9 9 0 0 1 18 0v6 M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3ZM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3Z' }
];

export const COVER_COLORS: string[] = [
  'var(--musex-accent)',
  '#a45cff',
  '#ff9d00',
  '#7276ff',
  '#ff3ab7',
  '#44e000'
];

/**
 * Devuelve el path SVG correspondiente a un id de ícono.
 *
 * Si el id no existe o es undefined, cae al ícono de música
 * por defecto en vez de romper el binding.
 */
export function getCoverIconPath(iconId: string | undefined): string {
  return COVER_ICONS.find(icon => icon.id === iconId)?.path
    ?? COVER_ICONS[0].path;
}