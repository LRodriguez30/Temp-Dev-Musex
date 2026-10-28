// =============================================================
// MUSEX — MODO SOLO LECTURA EN ANDROID
// =============================================================
//
// Agrega la clase `hide-on-android` a los botones y zonas que
// crean, editan, eliminan o importan cosas. En Android esa clase
// los oculta (ver styles.css); en escritorio no cambia nada.
//
// Uso (desde la raíz del proyecto, donde está package.json):
//
//     node android-solo-lectura.mjs
//
// Es seguro ejecutarlo varias veces: no duplica la clase.
// Revisa el resultado con `git diff` antes de compilar.
// =============================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CLASS_NAME = 'hide-on-android';

/**
 * [archivo, [textos a buscar]]
 *
 * Un texto que empieza con "<" busca esa etiqueta.
 * Cualquier otro texto busca el elemento que lo contiene
 * (normalmente el manejador (click)).
 */
const TARGETS = [

  // Importar música
  ['src/app/pages/library/library.component.html', [
    'selectMusicFiles(',
    '<app-drop-zone'
  ]],

  // Playlists: reordenar y eliminar
  ['src/app/components/playlist-detail/playlist-detail.component.html', [
    'startReorder(',
    'deletePlaylist('
  ]],

  // Tarjetas de canción: favorito y "agregar a playlist"
  ['src/app/components/song-card/song-card.component.html', [
    'toggleFavorite(',
    'openAddToPlaylist('
  ]],

  // Historial: borrar
  ['src/app/pages/history/history.component.html', [
    'clearHistory(',
    'removeEntry('
  ]],

  // Reproductores: favorito
  ['src/app/components/bottom-player/bottom-player.component.html', [
    'toggleFavorite('
  ]],

  ['src/app/components/full-player/full-player.component.html', [
    'toggleFavorite('
  ]],

  ['src/app/components/now-playing/now-playing.component.html', [
    'toggleFavorite(',
    'clearQueue('
  ]],

  // Crear playlists (botón "+" y tarjeta del panel "Más")
  ['src/app/components/sidebar/sidebar.component.html', [
    'openCreatePlaylist('
  ]]
];


// -------------------------------------------------------------
// Utilidades
// -------------------------------------------------------------

/** Posición del ">" que cierra la etiqueta, respetando comillas. */
function findTagEnd(text, start) {
  let quote = null;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (quote) {
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '>') return i;
  }

  return -1;
}

/** Inicio de la etiqueta de apertura que contiene la posición. */
function findTagStart(text, position) {
  for (let i = position; i >= 0; i--) {
    if (text[i] === '<' && /[a-zA-Z]/.test(text[i + 1] ?? '')) {
      return i;
    }
  }

  return -1;
}

/** Devuelve la etiqueta con la clase agregada (o null si ya la tiene). */
function addClass(tag) {
  const classAttr = tag.match(/(\sclass=")([^"]*)(")/);

  if (classAttr) {
    const value = classAttr[2];

    if (value.split(/\s+/).includes(CLASS_NAME)) return null;

    const trimmed = value.trimEnd();
    const trailing = value.slice(trimmed.length);

    return tag.replace(
      classAttr[0],
      `${classAttr[1]}${trimmed} ${CLASS_NAME}${trailing}${classAttr[3]}`
    );
  }

  return tag.replace(
    /^<([a-zA-Z0-9-]+)/,
    `<$1 class="${CLASS_NAME}"`
  );
}


// -------------------------------------------------------------
// Proceso
// -------------------------------------------------------------

let changed = 0;
let alreadyDone = 0;
let notFound = 0;

for (const [file, needles] of TARGETS) {

  if (!existsSync(file)) {
    console.warn(`⚠ No existe: ${file}`);
    notFound++;
    continue;
  }

  let text = readFileSync(file, 'utf8');
  let fileChanged = 0;

  for (const needle of needles) {

    const starts = new Set();

    let index = text.indexOf(needle);

    while (index !== -1) {
      const start = needle.startsWith('<')
        ? index
        : findTagStart(text, index);

      if (start !== -1) starts.add(start);

      index = text.indexOf(needle, index + needle.length);
    }

    if (starts.size === 0) {
      console.warn(`⚠ ${file}: no se encontró "${needle}"`);
      notFound++;
      continue;
    }

    // De atrás hacia adelante para no mover las posiciones.
    for (const start of [...starts].sort((a, b) => b - a)) {

      const end = findTagEnd(text, start);

      if (end === -1) continue;

      const tag = text.slice(start, end + 1);
      const updated = addClass(tag);

      if (updated === null) {
        alreadyDone++;
        continue;
      }

      text = text.slice(0, start) + updated + text.slice(end + 1);
      fileChanged++;
    }
  }

  if (fileChanged > 0) {
    writeFileSync(file, text, 'utf8');
    console.log(`✔ ${file}  (+${fileChanged})`);
    changed += fileChanged;
  }
}

console.log(
  `\nListo: ${changed} elemento(s) marcados, ` +
  `${alreadyDone} ya estaban, ${notFound} aviso(s).`
);
