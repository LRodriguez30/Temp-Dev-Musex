import { Track } from '../models/track.model';

/**
 * Canciones utilizadas como datos de demostración
 * durante el desarrollo de Musex.
 *
 * Estos datos permiten construir y probar la interfaz
 * antes de conectar la biblioteca real mediante Tauri.
 */
export const DEMO_TRACKS: Track[] = [
  {
    id: 'after-dark',
    title: 'After Dark',
    artist: 'Mr.Kitty',
    album: 'After Dark',
    duration: 247,
    path: '',
    image:
      'https://images.unsplash.com/photo-1547036967-23d11aacaee0?auto=format&fit=crop&w=800&q=90',
    source: null,
    favorite: false
  },

  {
    id: 'blinding-lights',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    album: 'After Hours',
    duration: 200,
    path: '',
    image:
      'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=800&q=90',
    source: null,
    favorite: true
  },

  {
    id: 'good-4-u',
    title: 'good 4 u',
    artist: 'Olivia Rodrigo',
    album: 'SOUR',
    duration: 178,
    path: '',
    image:
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=90',
    source: null,
    favorite: false
  },

  {
    id: 'another-love',
    title: 'Another Love',
    artist: 'Tom Odell',
    album: 'Long Way Down',
    duration: 244,
    path: '',
    image:
      'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=800&q=90',
    source: null,
    favorite: true
  },

  {
    id: 'sunflower',
    title: 'Sunflower',
    artist: 'Post Malone & Swae Lee',
    album: 'Spider-Man: Into the Spider-Verse',
    duration: 158,
    path: '',
    image:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=800&q=90',
    source: null,
    favorite: false
  },

  {
    id: 'sweater-weather',
    title: 'Sweater Weather',
    artist: 'The Neighbourhood',
    album: 'I Love You.',
    duration: 240,
    path: '',
    image:
      'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=800&q=90',
    source: null,
    favorite: true
  }
];