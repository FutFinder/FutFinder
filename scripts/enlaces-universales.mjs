#!/usr/bin/env node
/**
 * Escribe los dos archivos que prueban que www.futfinder.cl es de la app:
 *
 *   public/.well-known/apple-app-site-association   (iOS)
 *   public/.well-known/assetlinks.json              (Android)
 *
 * Uso:
 *   node scripts/enlaces-universales.mjs --team-id ABCDE12345 --sha256 AA:BB:…
 *
 * - `--team-id`: el Team ID de Apple (developer.apple.com → Membership).
 * - `--sha256`: la huella SHA-256 del certificado con que se firma la app de
 *   Android (`eas credentials` → Android → Keystore). Se puede repetir: si la
 *   app se publica en Google Play con «firma de apps de Play», va también la
 *   huella que muestra Play Console (Configuración → Integridad de la app).
 *
 * Ninguno de los dos datos es secreto: los dos archivos son públicos por
 * diseño. Después de correrlo: `npm run verify`, commit y push; Vercel los
 * publica y Apple y Google los leen al instalar la app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generarAppleAppSiteAssociation, generarAssetLinks, DOMINIO } = require('./enlacesUniversales.js');
const { expo } = require('../app.config.js');

function valores(nombre) {
  const out = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === nombre && args[i + 1]) out.push(args[++i]);
    else if (args[i].startsWith(`${nombre}=`)) out.push(args[i].slice(nombre.length + 1));
  }
  return out;
}

const [teamId] = valores('--team-id');
const huellas = valores('--sha256');

if (!teamId && huellas.length === 0) {
  console.error('Uso: node scripts/enlaces-universales.mjs --team-id ABCDE12345 --sha256 AA:BB:…');
  process.exit(1);
}

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', '.well-known');
fs.mkdirSync(dir, { recursive: true });

try {
  if (teamId) {
    const aasa = generarAppleAppSiteAssociation(teamId, expo.ios.bundleIdentifier);
    fs.writeFileSync(path.join(dir, 'apple-app-site-association'), JSON.stringify(aasa, null, 2) + '\n');
    console.log(`✓ apple-app-site-association para ${teamId}.${expo.ios.bundleIdentifier}`);
  }
  if (huellas.length > 0) {
    const links = generarAssetLinks(expo.android.package, huellas);
    fs.writeFileSync(path.join(dir, 'assetlinks.json'), JSON.stringify(links, null, 2) + '\n');
    console.log(`✓ assetlinks.json para ${expo.android.package} (${huellas.length} huella(s))`);
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}

console.log(`Se publican en https://${DOMINIO}/.well-known/ con el próximo despliegue de Vercel.`);
