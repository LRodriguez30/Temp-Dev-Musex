import { Injectable } from '@angular/core';

import { DEMO_PLAYLISTS } from '../data/demo-playlists';
import { DEMO_TRACKS } from '../data/demo-tracks';
import { Playlist } from '../models/playlist.model';
import { Track } from '../models/track.model';

/**
 * Tipos de resultados que puede devolver el buscador.
 */
export type SearchResultType =
  | 'track'
  | 'artist'
  | 'album'
  | 'playlist';

/**
 * Resultado individual producido por una búsqueda.
 *
 * Este modelo mantiene una estructura sencilla para que la interfaz
 * pueda representar distintos tipos de resultados sin acoplarse
 * directamente a Track o Playlist.
 */
export interface SearchResult {
  /**
   * Tipo de resultado encontrado.
   */
  type: SearchResultType;

  /**
   * Identificador del elemento relacionado.
   */
  id: string;

  /**
   * Texto principal mostrado en el resultado.
   */
  title: string;

  /**
   * Texto secundario mostrado debajo del título.
   */
  subtitle: string;

  /**
   * Imagen asociada al resultado, cuando existe.
   */
  image: string;
}

/**
 * Gestiona las búsquedas dentro de Musex.
 *
 * Durante esta etapa utiliza los datos de demostración.
 * Posteriormente podrá trabajar con la biblioteca real
 * proporcionada por LibraryService y PlaylistService.
 */
@Injectable({
  providedIn: 'root'
})
export class SearchService {

  /**
   * Datos utilizados temporalmente para realizar búsquedas.
   */
  private readonly tracks = DEMO_TRACKS;
  private readonly playlists = DEMO_PLAYLISTS;

  /**
   * Ejecuta una búsqueda general.
   *
   * La búsqueda compara el texto introducido con títulos,
   * artistas, álbumes y nombres de playlists.
   */
  search(query: string): SearchResult[] {
    const normalizedQuery = this.normalize(query);

    if (!normalizedQuery) {
      return [];
    }

    const results: SearchResult[] = [];

    this.searchTracks(normalizedQuery, results);
    this.searchArtists(normalizedQuery, results);
    this.searchAlbums(normalizedQuery, results);
    this.searchPlaylists(normalizedQuery, results);

    return results;
  }

  /**
   * Busca canciones cuyo título, artista o álbum coincida
   * con el texto proporcionado.
   */
  private searchTracks(
    query: string,
    results: SearchResult[]
  ): void {
    this.tracks
      .filter(track =>
        this.matches(query, [
          track.title,
          track.artist,
          track.album
        ])
      )
      .forEach(track => {
        results.push({
          type: 'track',
          id: track.id,
          title: track.title,
          subtitle: track.artist,
          image: track.image
        });
      });
  }

  /**
   * Busca artistas presentes en las canciones demo.
   *
   * Los artistas se agrupan para evitar mostrar el mismo
   * artista varias veces cuando tiene más de una canción.
   */
  private searchArtists(
    query: string,
    results: SearchResult[]
  ): void {
    const artists = new Map<string, Track>();

    this.tracks.forEach(track => {
      if (
        this.matches(query, [track.artist]) &&
        !artists.has(track.artist)
      ) {
        artists.set(track.artist, track);
      }
    });

    artists.forEach((track, artist) => {
      results.push({
        type: 'artist',
        id: `artist-${this.slugify(artist)}`,
        title: artist,
        subtitle: 'Artista',
        image: track.image
      });
    });
  }

  /**
   * Busca álbumes presentes en las canciones demo.
   *
   * Los álbumes se agrupan para evitar duplicados.
   */
  private searchAlbums(
    query: string,
    results: SearchResult[]
  ): void {
    const albums = new Map<string, Track>();

    this.tracks.forEach(track => {
      if (
        this.matches(query, [track.album]) &&
        !albums.has(track.album)
      ) {
        albums.set(track.album, track);
      }
    });

    albums.forEach((track, album) => {
      results.push({
        type: 'album',
        id: `album-${this.slugify(album)}`,
        title: album,
        subtitle: track.artist,
        image: track.image
      });
    });
  }

  /**
   * Busca playlists cuyo nombre coincida con la consulta.
   */
  private searchPlaylists(
    query: string,
    results: SearchResult[]
  ): void {
    this.playlists
      .filter(playlist =>
        this.matches(query, [playlist.name])
      )
      .forEach(playlist => {
        results.push({
          type: 'playlist',
          id: playlist.id,
          title: playlist.name,
          subtitle: `${playlist.count} canciones`,
          image: playlist.image
        });
      });
  }

  /**
   * Comprueba si una consulta coincide con alguno
   * de los valores proporcionados.
   */
  private matches(
    query: string,
    values: string[]
  ): boolean {
    return values.some(value =>
      this.normalize(value).includes(query)
    );
  }

  /**
   * Normaliza texto para realizar búsquedas sin distinguir
   * mayúsculas, minúsculas ni algunos signos diacríticos.
   */
  private normalize(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * Genera un identificador legible a partir de un texto.
   */
  private slugify(value: string): string {
    return this.normalize(value)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}