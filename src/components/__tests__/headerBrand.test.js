const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * REGRESIÓN — el logo "fut...finder" y el bell de avisos estaban
 * duplicados/ausentes de forma inconsistente entre pantallas (Home,
 * Partidos, Chat, Perfil, Clubes). Cada test de este archivo se activa en
 * la tarea del plan que migra su pantalla; hasta entonces se espera que
 * falle — es la prueba roja de esa tarea.
 */

function readSrc(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

test('BrandMark.js es la fuente única del wordmark "fut...finder"', () => {
  const src = readSrc('../BrandMark.js');
  assert.match(src, /fut<Text/, 'BrandMark debe dibujar el wordmark "fut...finder"');
  assert.match(src, /export default function BrandMark/);
});

test('Home (TacticalHeader) usa BrandMark, no una copia inline del logo', () => {
  const src = readSrc('../home/TacticalHeader.js');
  assert.match(src, /<BrandMark\s*\/>/, 'TacticalHeader debe renderizar <BrandMark/>');
  assert.doesNotMatch(
    src,
    /fut<Text/,
    'TacticalHeader todavía dibuja el wordmark a mano — debería venir de BrandMark'
  );
});

test('Chat (ChatInboxHeader) usa BrandMark y tiene el bell de avisos', () => {
  const src = readSrc('../chat/ChatInboxHeader.js');
  assert.match(src, /<BrandMark\s*\/>/, 'ChatInboxHeader debe renderizar <BrandMark/>');
  assert.doesNotMatch(
    src,
    /fut<Text/,
    'ChatInboxHeader todavía dibuja el wordmark a mano — debería venir de BrandMark'
  );
  assert.match(src, /<NotificationBell\s*\/>/, 'ChatInboxHeader debe renderizar <NotificationBell/>');
});
