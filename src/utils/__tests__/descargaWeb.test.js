/**
 * «Exportar mis datos» en la web descarga un archivo, no copia al
 * portapapeles (que Safari y una ventana inactiva bloquean).
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { nombreArchivoExport, descargarArchivo } = require('../descargaWeb.js');

test('el archivo se llama con la fecha local de hoy', () => {
  assert.equal(nombreArchivoExport(new Date(2026, 10, 19, 23, 50)), 'futfinder-mis-datos-2026-11-19.json');
  assert.equal(nombreArchivoExport(new Date(2027, 0, 5)), 'futfinder-mis-datos-2027-01-05.json');
  assert.match(nombreArchivoExport(new Date('no es fecha')), /^futfinder-mis-datos-\d{4}-\d{2}-\d{2}\.json$/);
});

function navegadorFalso() {
  const hechos = [];
  const enlace = { style: {}, click: () => hechos.push('click') };
  const documento = {
    createElement: (tag) => { hechos.push(`crear:${tag}`); return enlace; },
    body: {
      appendChild: () => hechos.push('agregar'),
      removeChild: () => hechos.push('quitar'),
    },
  };
  const urls = {
    createObjectURL: (blob) => { hechos.push(`url:${blob.tipo}`); return 'blob:prueba'; },
    revokeObjectURL: (u) => hechos.push(`revocar:${u}`),
  };
  class CrearBlob {
    constructor(partes, { type }) { this.texto = partes.join(''); this.tipo = type; }
  }
  return { hechos, enlace, documento, urls, CrearBlob };
}

test('descarga el texto con un enlace temporal y lo limpia', async () => {
  const n = navegadorFalso();
  const ok = descargarArchivo('{"a":1}', 'datos.json', n);
  assert.equal(ok, true);
  assert.equal(n.enlace.download, 'datos.json');
  assert.equal(n.enlace.href, 'blob:prueba');
  assert.deepEqual(n.hechos, ['url:application/json;charset=utf-8', 'crear:a', 'agregar', 'click', 'quitar']);
  await new Promise((r) => setTimeout(r, 1100));
  assert.ok(n.hechos.includes('revocar:blob:prueba'), 'el enlace temporal se libera después');
});

test('sin navegador no hace nada y lo dice', () => {
  assert.equal(descargarArchivo('x', 'x.json', { documento: null, urls: null, CrearBlob: null }), false);
});

test('Ajustes ya no copia los datos al portapapeles en la web', () => {
  const ajustes = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'SettingsScreen.js'), 'utf8');
  const exportar = ajustes.slice(ajustes.indexOf('const handleExportData'), ajustes.indexOf('const handleDeleteAccount'));
  assert.ok(!exportar.includes('clipboard'), 'volvió el portapapeles');
  assert.ok(exportar.includes('descargarArchivo('), 'la web tiene que descargar el archivo');
});
