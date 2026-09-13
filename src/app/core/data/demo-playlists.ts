import { Playlist } from '../models/playlist.model';

/**
 * Playlists utilizadas como datos de demostración
 * durante el desarrollo de Musex.
 *
 * Estos datos representan la estructura inicial de playlists
 * que posteriormente será reemplazada o complementada
 * por las playlists reales del usuario.
 */
export const DEMO_PLAYLISTS: Playlist[] = [
  {
    id: 'chill-vibes',
    name: 'Chill Vibes',
    count: 50,
    image:
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=700&q=85',
    custom: false
  },

  {
    id: 'indie-hits',
    name: 'Indie Hits',
    count: 60,
    image:
      'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=700&q=85',
    custom: false
  },

  {
    id: 'lo-fi-beats',
    name: 'Lo-Fi Beats',
    count: 80,
    image:
      'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=700&q=85',
    custom: false
  },

  {
    id: 'rock-clasico',
    name: 'Rock Clásico',
    count: 75,
    image:
      'https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?auto=format&fit=crop&w=700&q=85',
    custom: false
  },

  {
    id: 'exitos-2024',
    name: 'Éxitos 2024',
    count: 100,
    image:
      'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=700&q=85',
    custom: false
  },

  {
    id: 'night-drive',
    name: 'Night Drive',
    count: 42,
    image:
      'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=700&q=85',
    custom: false
  },

  {
    id: 'electronic',
    name: 'Electronic',
    count: 73,
    image:
      'https://images.unsplash.com/photo-1571266028243-d220c9c3b3d2?auto=format&fit=crop&w=700&q=85',
    custom: false
  },

  {
    id: 'gaming',
    name: 'Gaming',
    count: 91,
    image:
      'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=700&q=85',
    custom: false
  }
];