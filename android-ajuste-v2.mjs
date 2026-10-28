// =============================================================
// MUSEX — AJUSTE DEL MODO ANDROID (v2)
// =============================================================
//
// La versión anterior dejaba el teléfono en "solo lectura". Ahora el
// teléfono tiene sus propios favoritos y playlists, así que este
// script devuelve esas acciones y deja ocultas solo las que no
// aplican:
//
//   VUELVEN:  favoritos, crear playlist, agregar a playlist.
//   CONDICIONAL: borrar / reordenar playlist (solo las del teléfono,
//                no las que vienen del escritorio).
//   SIGUEN OCULTAS: importar con el selector de archivos, soltar
//                archivos, borrar historial, vaciar la cola y el
//                menú «más opciones» de la tabla (editar datos).
//
// Uso (desde la raíz del proyecto):
//
//     node android-ajuste-v2.mjs
//
// Se puede ejecutar varias veces. Revisa con `git diff`.
// =============================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CLASS_NAME = 'hide-on-android';

/** [archivo, texto, acción] */
const TARGETS = [

  // ---- Vuelven a mostrarse ----
  ['src/app/components/song-card/song-card.component.html', 'toggleFavorite(', 'remove'],
  ['src/app/components/song-card/song-card.component.html', 'openAddToPlaylist(', 'remove'],
  ['src/app/components/bottom-player/bottom-player.component.html', 'toggleFavorite(', 'remove'],
  ['src/app/components/full-player/full-player.component.html', 'toggleFavorite(', 'remove'],
  ['src/app/components/now-playing/now-playing.component.html', 'toggleFavorite(', 'remove'],
  ['src/app/components/sidebar/sidebar.component.html', 'openCreatePlaylist(', 'remove'],

  // ---- Solo en playlists del teléfono ----
  ['src/app/components/playlist-detail/playlist-detail.component.html', 'startReorder(', 'conditional'],
  ['src/app/components/playlist-detail/playlist-detail.component.html', 'deletePlaylist(', 'conditional'],

  // ---- Ocultas ----
  ['src/app/components/music-table/music-table.component.html', 'openMore(', 'add']
];

const CONDITION = '[class.hide-on-android]="playlist()?.remote"';


// -------------------------------------------------------------
// Utilidades
// -------------------------------------------------------------

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

function findTagStart(text, position) {

  for (let i = position; i >= 0; i--) {
    if (text[i] === '<' && /[a-zA-Z]/.test(text[i + 1] ?? '')) return i;
  }

  return -1;
}

function stripClass(tag) {

  const match = tag.match(/(\sclass=")([^"]*)(")/);

  if (!match) return tag;

  const kept = match[2]
    .split(/\s+/)
    .filter(item => item && item !== CLASS_NAME);

  // Se conserva el formato original si quedaron otras clases.
  const original = match[2];

  const value = original.includes('\n')
    ? original.replace(new RegExp(`\\s*${CLASS_NAME}`), '')
    : kept.join(' ');

  return tag.replace(match[0], `${match[1]}${value}${match[3]}`);
}

function addClass(tag) {

  const match = tag.match(/(\sclass=")([^"]*)(")/);

  if (match) {

    if (match[2].split(/\s+/).includes(CLASS_NAME)) return tag;

    const trimmed = match[2].trimEnd();
    const trailing = match[2].slice(trimmed.length);

    return tag.replace(
      match[0],
      `${match[1]}${trimmed} ${CLASS_NAME}${trailing}${match[3]}`
    );
  }

  return tag.replace(/^<([a-zA-Z0-9-]+)/, `<$1 class="${CLASS_NAME}"`);
}

function setConditional(tag) {

  const clean = stripClass(tag);

  if (clean.includes('[class.hide-on-android]')) return clean;

  return clean.replace(/^<([a-zA-Z0-9-]+)/, `<$1 ${CONDITION}`);
}

const ACTIONS = {
  remove: stripClass,
  add: addClass,
  conditional: setConditional
};


// -------------------------------------------------------------
// Proceso
// -------------------------------------------------------------

const byFile = new Map();

for (const [file, needle, action] of TARGETS) {
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push([needle, action]);
}

let changed = 0;
let warnings = 0;

for (const [file, rules] of byFile) {

  if (!existsSync(file)) {
    console.warn(`⚠ No existe: ${file}`);
    warnings++;
    continue;
  }

  let text = readFileSync(file, 'utf8');
  let fileChanged = 0;

  for (const [needle, action] of rules) {

    const starts = new Set();

    let index = text.indexOf(needle);

    while (index !== -1) {

      const start = findTagStart(text, index);

      if (start !== -1) starts.add(start);

      index = text.indexOf(needle, index + needle.length);
    }

    if (starts.size === 0) {
      console.warn(`⚠ ${file}: no se encontró "${needle}"`);
      warnings++;
      continue;
    }

    for (const start of [...starts].sort((a, b) => b - a)) {

      const end = findTagEnd(text, start);

      if (end === -1) continue;

      const tag = text.slice(start, end + 1);
      const updated = ACTIONS[action](tag);

      if (updated === tag) continue;

      text = text.slice(0, start) + updated + text.slice(end + 1);
      fileChanged++;
    }
  }

  if (fileChanged > 0) {
    writeFileSync(file, text, 'utf8');
    console.log(`✔ ${file}  (${fileChanged})`);
    changed += fileChanged;
  }
}

console.log(`\nListo: ${changed} cambio(s), ${warnings} aviso(s).`);
