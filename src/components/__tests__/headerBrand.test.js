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

test('Partidos (función Header de PartidosScreen) usa BrandMark y tiene el bell de avisos', () => {
  const src = readSrc('../../screens/PartidosScreen.js');
  assert.match(src, /<BrandMark\s*\/>/, 'PartidosScreen debe renderizar <BrandMark/> en su header');
  assert.match(src, /<NotificationBell\s*\/>/, 'PartidosScreen debe renderizar <NotificationBell/> en su header');
});

test('Perfil (PlayerProfileTopBar) tiene el bell solo en la rama de perfil propio', () => {
  const src = readSrc('../player/PlayerProfileTopBar.js');
  assert.match(src, /<NotificationBell\s*\/>/, 'PlayerProfileTopBar debe renderizar <NotificationBell/>');
  const afterSettings = src.split('onSettings &&')[1] || '';
  assert.match(
    afterSettings,
    /<NotificationBell\s*\/>/,
    'el bell debe estar después del botón de Configuración, dentro de la rama isOwnProfile'
  );
  const otherProfileBranch = src.split(') : (').pop();
  assert.doesNotMatch(
    otherProfileBranch,
    /<NotificationBell/,
    'el bell nunca debe aparecer en la rama de perfil ajeno'
  );
});

test('Clubes (ClubExplorer) tiene el bell solo cuando actúa como raíz de pestaña (!showBackButton)', () => {
  const src = readSrc('../club/ClubExplorer.js');
  assert.match(src, /<NotificationBell\s*\/>/, 'ClubExplorer debe renderizar <NotificationBell/>');
  assert.match(
    src,
    /!showBackButton\s*&&\s*<NotificationBell\s*\/>/,
    'el bell debe estar condicionado a !showBackButton, para no aparecer cuando se empuja sobre el stack'
  );
});
