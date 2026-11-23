/**
 * El plugin que importa cada ícono de Lucide desde su archivo.
 * Se ejecutan con: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');

const plugin = require('../babel/lucidePorIcono.js');

const RAIZ = path.join(__dirname, '..', '..');
const tabla = plugin.leerTabla(plugin.raizPorOmision());

function transformar(codigo, opciones) {
  return babel.transformSync(codigo, {
    babelrc: false,
    configFile: false,
    plugins: [[plugin, opciones || {}]],
  }).code;
}

test('la tabla sale del índice de Lucide y conoce nombres y alias', () => {
  assert.ok(Object.keys(tabla).length > 3000, `sólo ${Object.keys(tabla).length} nombres`);
  assert.equal(tabla.ArrowLeft, 'lucide-react-native/dist/esm/icons/arrow-left.js');
  // Un alias vive en el archivo de su nombre canónico.
  assert.equal(tabla.CheckCircle2, 'lucide-react-native/dist/esm/icons/circle-check.js');
  assert.equal(tabla.CheckCircle2, tabla.CircleCheck);
});

test('cada destino de la tabla existe en el paquete instalado', () => {
  for (const destino of new Set(Object.values(tabla))) {
    assert.ok(fs.existsSync(path.join(RAIZ, 'node_modules', destino)), destino);
  }
});

test('reescribe la importación por ícono, respetando el alias local', () => {
  const salida = transformar("import { ArrowLeft, Check as Tick } from 'lucide-react-native';\nexport const x = [ArrowLeft, Tick];");
  assert.match(salida, /import ArrowLeft from "lucide-react-native\/dist\/esm\/icons\/arrow-left\.js";/);
  assert.match(salida, /import Tick from "lucide-react-native\/dist\/esm\/icons\/check\.js";/);
  assert.doesNotMatch(salida, /from ['"]lucide-react-native['"]/);
});

test('lo que no conoce lo deja importado desde la raíz', () => {
  const salida = transformar("import { ArrowLeft, icons, NoExisteEsteIcono } from 'lucide-react-native';\nexport const x = [ArrowLeft, icons, NoExisteEsteIcono];");
  assert.match(salida, /import \{ icons, NoExisteEsteIcono \} from ['"]lucide-react-native['"];/);
  assert.match(salida, /import ArrowLeft from "lucide-react-native\/dist\/esm\/icons\/arrow-left\.js";/);
});

test('no toca un import * ni otros paquetes', () => {
  const codigo = "import * as L from 'lucide-react-native';\nimport { View } from 'react-native';\nexport const x = [L, View];";
  const salida = transformar(codigo);
  assert.match(salida, /import \* as L from ['"]lucide-react-native['"];/);
  assert.match(salida, /import \{ View \} from ['"]react-native['"];/);
});

test('sin tabla (no se pudo leer el índice) no hace nada', () => {
  const codigo = "import { ArrowLeft } from 'lucide-react-native';\nexport const x = ArrowLeft;";
  assert.match(transformar(codigo, { raiz: path.join(RAIZ, 'no-existe') }), /import \{ ArrowLeft \} from ['"]lucide-react-native['"];/);
});

test('todo lo que la app importa de Lucide se puede reescribir', () => {
  const faltan = [];
  const revisar = (archivo) => {
    const src = fs.readFileSync(archivo, 'utf8');
    for (const m of src.matchAll(/import\s+([^;]*?)\s+from\s+'lucide-react-native'/g)) {
      const llaves = /^\{([\s\S]*)\}$/.exec(m[1].trim());
      if (!llaves) { faltan.push(`${archivo}: importación que no es por nombre`); continue; }
      for (const parte of llaves[1].split(',')) {
        const nombre = parte.trim().split(/\s+as\s+/)[0];
        if (nombre && !tabla[nombre]) faltan.push(`${path.relative(RAIZ, archivo)}: ${nombre}`);
      }
    }
    assert.doesNotMatch(src, /require\(\s*'lucide-react-native'\s*\)/, `${archivo}: require de Lucide entero`);
  };
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') recorrer(p); } else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) revisar(p);
    }
  };
  recorrer(path.join(RAIZ, 'src'));
  for (const f of ['App.js', 'index.js']) if (fs.existsSync(path.join(RAIZ, f))) revisar(path.join(RAIZ, f));
  assert.deepEqual(faltan, []);
});

test('babel.config.js usa el plugin, antes del de worklets', () => {
  const cfg = fs.readFileSync(path.join(RAIZ, 'babel.config.js'), 'utf8');
  assert.match(cfg, /plugins: \[require\('\.\/scripts\/babel\/lucidePorIcono'\), 'react-native-worklets\/plugin'\]/);
});
