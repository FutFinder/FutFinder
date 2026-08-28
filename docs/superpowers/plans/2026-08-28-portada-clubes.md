# Portada de Clubes — plan de implementación (pasos 1 y 2)

> **Para agentes:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para ejecutar tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que la pestaña Clubes abra una portada —no el detalle del club— y que todo el acento del módulo salga del tema del club en vez de un verde escrito a mano.

**Arquitectura:** tres capas que no se invaden. `clubsHomeTasks.js` deriva y cuenta sin tocar la red (es lo que se prueba). `useClubsHome.js` consulta los servicios que ya existen y expone un view-model. `ClubsScreen.js` solo compone y pinta; los componentes reciben datos por props y nunca consultan la API.

**Stack:** React Native / Expo, `lucide-react-native`, `@react-navigation`, Supabase, `node --test` (CommonJS `require` sobre módulos ESM), ESLint.

**Spec:** `docs/superpowers/specs/2026-08-28-portada-clubes-design.md`
**Handoff:** `~/Downloads/design_handoff_clubes_portada/README.md`

## Restricciones globales

Valen para **todas** las tareas:

- Todo texto visible va en **español de Chile**.
- `npm run verify` tiene que salir con **cero errores** de lint. Los avisos son deuda conocida y no bloquean.
- `no-undef` es la regla que atrapa el typo que Babel no ve y que deja la pantalla en blanco. Si tocas interfaz, míralo.
- Los cuatro hexes de tema **no se tocan**: `#5AE06A`, `#4DA3FF`, `#FF4B2E`, `#FFBE1A`. Tampoco las tintas. La del handoff para el rojo (`#FFF3EF`) da 3,07:1 y no pasa WCAG AA.
- El plan pagado se llama **«Premium»** en pantalla, nunca «Pro». Límites: estándar 15 integrantes / 1 admin; premium 26 / 3.
- Solo existen dos roles: `'admin'` y `'jugador'`. **No hay capitán** (migración 11, `check (rol in ('admin','jugador'))`).
- Ningún componente de portada consulta la API. Reciben props.
- Nunca mostrar `error.message` crudo del backend al usuario: copy propio en pantalla, mensaje real a `console.error`.
- Todos los servicios del repo devuelven `{ data, error }`. Respetar esa forma.
- Objetivos táctiles ≥ 44px.
- `git pull` antes de empezar. Añadir solo los archivos de la tarea. Commit descriptivo y `git push` de inmediato.

---

## Estructura de archivos

**Crear**

| Archivo | Responsabilidad |
|---|---|
| `src/utils/clubPlanLimits.js` | Los límites por plan, sin dependencias, para que el código probable no arrastre Supabase |
| `src/utils/clubsHomeTasks.js` | Derivación pura: normaliza las 7 fuentes a `Task`, cuenta, reparte, calcula cupos y permisos |
| `src/utils/__tests__/clubsHomeTasks.test.js` | Las reglas de derivación, sin red |
| `src/utils/useClubsHome.js` | View-model: consulta servicios, orquesta, persiste el club activo |
| `src/components/club/VerifiedBadge.js` | Insignia verificada (SVG, forma específica del handoff) |
| `src/components/club/ClubsHeader.js` | Título, subtítulo, buscar, campana |
| `src/components/club/ClubSwitcher.js` | Chips de club activo + «Explorar» |
| `src/components/club/PendingTaskCard.js` | Tarjeta de tarea pendiente |
| `src/components/club/AllClearBanner.js` | «Todo al día» |
| `src/components/club/NextMatchCard.js` | Próximo partido, tarjeta destacada |
| `src/components/club/QuickActionGrid.js` | Grilla de 6 accesos + nota de permisos |
| `src/components/club/ClubSummaryCard.js` | Resumen del club en tres bandas |
| `src/components/club/ActivityList.js` | Actividad reciente (máx. 3) |
| `src/components/club/SkeletonHome.js` | Silueta de carga |

**Modificar**

| Archivo | Qué cambia |
|---|---|
| `src/theme/clubThemes.js` | Bloque `ALFA` |
| `src/theme/__tests__/clubThemes.test.js` | Prueba nueva que fija los alfas |
| `src/theme/colors.js` | Familia `clubTonos` + superficies de portada |
| `src/services/clubs.js` | Re-exporta `CLUB_LIMITS` desde `utils/clubPlanLimits.js` |
| `src/screens/ClubsScreen.js` | Deja de embeber; pasa a ser la portada |
| `src/screens/ClubDetailScreen.js` | Se retira `viaClubesTab` |
| `src/navigation/MainTabs.js` | Badge de pendientes en Clubes |
| `src/screens/ClubChallengesScreen.js` | Verde fijo → tema del club |
| `src/screens/ClubChallengeScreen.js` | ídem |
| `src/screens/ClubHistoryScreen.js` | ídem |
| `src/components/clubes/ChallengeHeader.js` | ídem |
| `src/components/clubes/CambioPartidoCard.js` | ídem |
| `src/components/partidos/ClubMatchCard.js` | ídem, con la regla del club propio |

**No se tocan:** `ClubExplorer.js` y `ClubExplorerCard.js` conservan el verde de la app a propósito — listan clubes ajenos, y teñirlos del color de mi club mentiría sobre ellos.

---

## Tarea 1: Alfas del acento

**Archivos:**
- Modificar: `src/theme/clubThemes.js:82-88` (bloque `ALFA`)
- Prueba: `src/theme/__tests__/clubThemes.test.js`

**Interfaces:**
- Produce: `temaClub(clave).soft` con alfa `.14`, `.border` con `.42`, `.glow` con `.30`. Todas las tareas siguientes pintan con estos tonos.

Ninguna prueba actual fija los alfas —solo comprueban que deriven del color principal y que `softStrong > soft`—, así que el cambio pasaría inadvertido. Por eso la prueba va primero y es nueva.

- [ ] **Paso 1: Escribir la prueba que falla**

Al final del bloque de escala en `src/theme/__tests__/clubThemes.test.js`, después de `test('el fondo suave presionado es más opaco que el de reposo', ...)`:

```js
test('los alfas del acento son los que fija el handoff de la portada', () => {
  // Estos tres números son una decisión, no un detalle: el handoff los pide
  // así y `dsColors.winSoft` ya usa .14. Sin esta prueba, el próximo retoque
  // de color los pierde en silencio y la portada deja de calzar con el resto.
  const alfa = (c) => Number(c.match(/,\s*([\d.]+)\)$/)[1]);
  for (const clave of CLAVES) {
    const escala = T.temaClub(clave);
    assert.equal(alfa(escala.soft), 0.14, `${clave}.soft`);
    assert.equal(alfa(escala.border), 0.42, `${clave}.border`);
    assert.equal(alfa(escala.glow), 0.3, `${clave}.glow`);
  }
});
```

- [ ] **Paso 2: Correrla y verla fallar**

```bash
node --test src/theme/__tests__/clubThemes.test.js
```

Esperado: FALLA con `green.soft` — recibe `0.12`, espera `0.14`.

- [ ] **Paso 3: Cambiar los alfas**

En `src/theme/clubThemes.js`, el objeto `ALFA`:

```js
const ALFA = {
  soft: 0.14,
  softStrong: 0.2,
  border: 0.42,
  glow: 0.3,
  bannerGlow: 0.07,
};
```

`softStrong` y `bannerGlow` no cambian: el handoff no los menciona y tienen uso propio.

- [ ] **Paso 4: Correr toda la suite del tema**

```bash
node --test src/theme/__tests__/clubThemes.test.js
```

Esperado: PASA, incluidas las de contraste y distancia de color. Si alguna de esas falla, **detente**: son la razón por la que no adoptamos los hexes del handoff.

- [ ] **Paso 5: Commit**

```bash
git add src/theme/clubThemes.js src/theme/__tests__/clubThemes.test.js
git commit -m "refactor(tema): los alfas del acento pasan a .14/.42/.30 y quedan fijados por prueba"
git push
```

---

## Tarea 2: Tonos semánticos y superficies

**Archivos:**
- Modificar: `src/theme/colors.js` (agregar al final, junto a las demás familias)
- Prueba: `src/theme/__tests__/clubThemes.test.js`

**Interfaces:**
- Produce: `clubTonos` con `{ warn, danger, info }`, cada uno `{ soft, fg }`; y `clubSuperficies` con `{ card, cardAlta, barra, header, separador, borde }`. Las tareas 5 a 10 los consumen.

El handoff declara estos tonos **no tematizables**: conservan su color en los cuatro temas. Un club rojo no puede hacer que una victoria parezca una derrota.

- [ ] **Paso 1: Escribir la prueba que falla**

En `src/theme/__tests__/clubThemes.test.js`, al final del archivo:

```js
// ── Tonos que NO se tematizan ────────────────────────────────────────

const { clubTonos, clubSuperficies } = require('../colors.js');

test('los tonos semánticos existen y no dependen del tema del club', () => {
  for (const tono of ['warn', 'danger', 'info']) {
    assert.equal(typeof clubTonos[tono].soft, 'string', `${tono}.soft`);
    assert.equal(typeof clubTonos[tono].fg, 'string', `${tono}.fg`);
  }
  // Ninguno deriva de un color principal de tema: son constantes.
  const mains = CLAVES.map((c) => T.temaClub(c).main.toLowerCase());
  for (const tono of ['warn', 'danger', 'info']) {
    assert.ok(!mains.includes(clubTonos[tono].fg.toLowerCase()), tono);
  }
});

test('el peligro no se confunde con el tema rojo', () => {
  // Si fueran el mismo color, un club rojo no podría distinguir «tu acento»
  // de «esto destruye algo».
  assert.notEqual(clubTonos.danger.fg.toLowerCase(), T.temaClub('red').main.toLowerCase());
});

test('las superficies de la portada están definidas', () => {
  for (const clave of ['card', 'cardAlta', 'barra', 'header', 'separador', 'borde']) {
    assert.equal(typeof clubSuperficies[clave], 'string', clave);
  }
});
```

- [ ] **Paso 2: Correrla y verla fallar**

```bash
node --test src/theme/__tests__/clubThemes.test.js
```

Esperado: FALLA con `Cannot read properties of undefined (reading 'soft')` — `clubTonos` no existe.

- [ ] **Paso 3: Agregar las familias a `colors.js`**

Al final de `src/theme/colors.js`:

```js
/**
 * Tonos semánticos del módulo Clubes que NO se tematizan.
 *
 * El tema del club pinta su identidad —escudo, banner, botones—, pero no
 * puede pintar el significado: un club rojo no puede hacer que una victoria
 * parezca una derrota ni que un aviso parezca una sanción. Estos cuatro roles
 * conservan su color en los cuatro temas.
 *
 * El tono `accent` no vive acá: sale de `temaDeClub()`, porque sí depende del
 * club.
 */
export const clubTonos = Object.freeze({
  warn: Object.freeze({ soft: 'rgba(255, 197, 49, 0.14)', fg: '#FFC531' }),
  danger: Object.freeze({ soft: 'rgba(255, 75, 43, 0.15)', fg: '#FF6E4F' }),
  info: Object.freeze({ soft: 'rgba(255, 255, 255, 0.07)', fg: '#D6D6DA' }),
});

/** Superficies de la portada de Clubes. */
export const clubSuperficies = Object.freeze({
  card: '#101012',
  cardAlta: '#0D0E0D',
  barra: 'rgba(9, 9, 10, 0.94)',
  header: 'rgba(0, 0, 0, 0.9)',
  separador: 'rgba(255, 255, 255, 0.05)',
  borde: 'rgba(255, 255, 255, 0.08)',
});
```

- [ ] **Paso 4: Correr las pruebas**

```bash
node --test src/theme/__tests__/clubThemes.test.js
```

Esperado: PASA.

- [ ] **Paso 5: Commit**

```bash
git add src/theme/colors.js src/theme/__tests__/clubThemes.test.js
git commit -m "feat(tema): tonos semánticos y superficies de la portada de Clubes"
git push
```

---

## Tarea 3: Tematizar las pantallas de desafío

**Archivos:**
- Modificar: `src/screens/ClubChallengesScreen.js` (14 usos de verde)
- Modificar: `src/screens/ClubChallengeScreen.js` (5)
- Modificar: `src/components/clubes/ChallengeHeader.js` (2)
- Modificar: `src/components/clubes/CambioPartidoCard.js` (2)

**Interfaces:**
- Consume: `temaDeClub(club)` de la tarea 1, ya con los alfas nuevos.
- Produce: nada que otras tareas usen.

Estos cuatro archivos tienen un club propio claro en contexto —el club del usuario, el que desafía o es desafiado—, así que el acento es el suyo.

- [ ] **Paso 1: Encontrar cada uso de verde**

```bash
grep -n "green\|Green\|#5AE06A\|#71B533\|#55DF69" \
  src/screens/ClubChallengesScreen.js \
  src/screens/ClubChallengeScreen.js \
  src/components/clubes/ChallengeHeader.js \
  src/components/clubes/CambioPartidoCard.js
```

- [ ] **Paso 2: Sustituir por la escala del club**

En cada archivo, resolver el tema una sola vez cerca del inicio del componente:

```js
import { temaDeClub } from '../theme/clubThemes';
// ...
const tema = temaDeClub(club);
```

Y el mapeo, uno a uno:

| Antes | Ahora |
|---|---|
| `dsColors.green` / `CE.green` / `reservas.green` | `tema.main` |
| `greenDark` / `greenActive` | `tema.pressed` |
| `greenSoft` | `tema.soft` |
| `greenSoftStrong` | `tema.softStrong` |
| `greenBorder` | `tema.border` |
| `greenGlow` | `tema.glow` |
| `greenInk` / `inkOnGreen` / `textOnGreen` / `#0E0E0D` | `tema.ink` |

**No** sustituir `dsColors.win` (`#5AE06A`) aunque sea el mismo hex que el verde: es el color de una victoria, no el acento, y el handoff lo declara no tematizable.

Como el tema es dinámico, los estilos que lo usan salen de `StyleSheet.create` y pasan a estilos en línea (`style={[styles.boton, { backgroundColor: tema.main }]}`). Lo que no depende del tema se queda en el `StyleSheet`.

- [ ] **Paso 3: Verificar que no quedó verde suelto**

```bash
grep -n "green\|Green\|#5AE06A\|#71B533\|#55DF69" \
  src/screens/ClubChallengesScreen.js \
  src/screens/ClubChallengeScreen.js \
  src/components/clubes/ChallengeHeader.js \
  src/components/clubes/CambioPartidoCard.js
```

Esperado: solo quedan usos de `win`/`winSoft` (resultado de partido), si los hay.

- [ ] **Paso 4: Verificar**

```bash
npm run verify
```

Esperado: cero errores de lint, 796 pruebas en verde. `no-undef` es el que atrapa un `tema` no declarado en un archivo donde olvidaste resolverlo.

- [ ] **Paso 5: Commit**

```bash
git add src/screens/ClubChallengesScreen.js src/screens/ClubChallengeScreen.js src/components/clubes/ChallengeHeader.js src/components/clubes/CambioPartidoCard.js
git commit -m "refactor(clubes): las pantallas de desafío usan el tema del club en vez del verde fijo"
git push
```

---

## Tarea 4: Tematizar historial y tarjeta de partido

**Archivos:**
- Modificar: `src/screens/ClubHistoryScreen.js` (3 usos)
- Modificar: `src/components/partidos/ClubMatchCard.js` (14 usos)

**Interfaces:**
- Consume: `temaDeClub(club)`; `ClubMatchCard` recibe además `misClubIds`.

`ClubHistoryScreen` mira un club: acento del suyo, directo.

`ClubMatchCard` es distinto y hay que decidirlo explícitamente: aparece en la lista de Partidos y muestra **dos** clubes. La regla es que el acento sale del club del usuario cuando el partido es suyo, y se queda con el verde de la app cuando no lo es. Un partido ajeno pintado con mi color diría que es mío.

- [ ] **Paso 1: `ClubHistoryScreen`**

Mismo mapeo de la tarea 3. `dsColors.win`/`draw`/`loss` de los resultados **no** se tocan.

- [ ] **Paso 2: `ClubMatchCard` — resolver el tema con la regla del club propio**

```js
import { temaDeClub, temaClub } from '../../theme/clubThemes';

// El acento sale de MI club, y solo si el partido es mío. Un partido entre
// dos clubes ajenos pintado con mi color diría que me pertenece.
const miClub = [match.club_local, match.club_visitante].find(
  (c) => c && misClubIds?.includes(c.id)
);
const tema = miClub ? temaDeClub(miClub) : temaClub('green');
```

`misClubIds` ya se obtiene con `getMyClubIds()` en la pantalla que renderiza la lista; pásalo como prop. Si el llamador no lo pasa, `undefined?.includes` no revienta y cae al verde de la app, que es el comportamiento de hoy.

- [ ] **Paso 3: Verificar el resto del mapeo**

```bash
grep -n "green\|Green\|#5AE06A" src/screens/ClubHistoryScreen.js src/components/partidos/ClubMatchCard.js
```

Esperado: solo `win`/`draw`/`loss`.

- [ ] **Paso 4: Verificar**

```bash
npm run verify
```

Esperado: cero errores, todo verde.

- [ ] **Paso 5: Commit**

```bash
git add src/screens/ClubHistoryScreen.js src/components/partidos/ClubMatchCard.js
git commit -m "refactor(clubes): historial y tarjeta de partido toman el tema del club propio"
git push
```

---

## Tarea 5: `clubsHomeTasks.js` — la derivación pura

**Archivos:**
- Crear: `src/utils/clubPlanLimits.js`
- Crear: `src/utils/clubsHomeTasks.js`
- Crear: `src/utils/__tests__/clubsHomeTasks.test.js`
- Modificar: `src/services/clubs.js:29-33` (re-exportar `CLUB_LIMITS`)

**Interfaces:**
- Consume: `CLUB_LIMITS` de `./clubPlanLimits.js`. Nada más. Es puro: sin red, sin React, sin `Date.now()` implícito (la hora entra por parámetro).

> **Por qué los límites se mudan de archivo.** `clubsHomeTasks.js` necesita `CLUB_LIMITS`, pero **no puede importarlo de `services/clubs.js`**: ese archivo importa `./supabase`, sin extensión, y eso solo lo resuelve Metro. Bajo `node --test` revienta con `Cannot find module .../services/supabase`, y la prueba pura ni siquiera cargaría. Compruébalo antes de dudarlo:
>
> ```bash
> node -e "require('./src/services/clubs.js')"   # Cannot find module .../services/supabase
> ```
>
> Por eso los límites bajan a un módulo sin dependencias y `services/clubs.js` los re-exporta, para no tocar a ninguno de sus llamadores actuales. Y por eso los imports entre módulos puros van **con extensión `.js`**, como ya hacen `clubEdit.js` y `revisionSancion.js`.
- Produce:
  - `normalizarTareas(fuentes, { rol, ahora }) → Task[]`
  - `contarConAccion(tareas) → number`
  - `repartirTareas(tareas, { tope = 4 }) → { visibles, ocultas, ocultasConAccion, etiquetaVerMas }`
  - `cuposDelPlan({ plan, miembrosActivos, admins }) → { members: {used,max}, admins: {used,max} }`
  - `permisosDeClub(rol) → { responderDesafios, gestionarMiembros, editarClub, eliminarClub, cederAdmin, invitar }`
  - `Task = { id, type, tone, title, subtitle, cta, target, status }`, con `status ∈ 'abierta' | 'resuelta' | 'vencida'`

Esta es la tarea que más importa: el handoff avisa que **justo acá se equivocó el prototipo**. Va entera con TDD.

- [ ] **Paso 1: Escribir las pruebas que fallan**

Crear `src/utils/__tests__/clubsHomeTasks.test.js`:

```js
/**
 * Pruebas de la derivación de la portada de Clubes.
 *
 * LO QUE ESTAS PRUEBAS CUIDAN, en orden de importancia:
 *
 *   1. QUE EL BADGE NO MIENTA. El número de la sección «Pendiente para ti» y
 *      el de la barra inferior son EL MISMO, y cuentan solo tareas que el
 *      usuario puede accionar. Una tarea resuelta o vencida que siga sumando
 *      manda al usuario a buscar algo que ya no está.
 *   2. QUE EL «VER N MÁS» CUENTE TAREAS, NO TARJETAS. Con el tope de 4, lo
 *      oculto puede incluir cosas sin acción; prometer «4 pendientes más» y
 *      mostrar cuatro avisos muertos es el mismo error que el anterior.
 *   3. QUE UNA SOLICITUD PENDIENTE NO OCUPE CUPO. Contarla como integrante
 *      hace que un club con cupo diga que está lleno.
 *   4. QUE EL JUGADOR VEA TODO Y NO PUEDA NADA. Ve la información, su CTA es
 *      «Ver», y las solicitudes de ingreso no le aparecen.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const D = require('../clubsHomeTasks.js');

const AHORA = new Date('2026-08-28T12:00:00Z');

/** Fuentes vacías: cada prueba llena solo lo que le importa. */
function fuentes(extra = {}) {
  return {
    desafiosRecibidos: [],
    propuestas: [],
    cambiosDePartido: [],
    nomina: null,
    solicitudes: [],
    sancion: null,
    proximoPartido: null,
    ...extra,
  };
}

const DESAFIO = {
  id: 'des-1',
  estado: 'pendiente',
  otroClub: { id: 'c9', nombre: 'lagardere fcv' },
  created_at: '2026-08-27T12:00:00Z',
};

// ── El badge ────────────────────────────────────────────────────────

test('el badge cuenta solo las tareas que se pueden accionar', () => {
  const tareas = [
    { id: 'a', status: 'abierta' },
    { id: 'b', status: 'resuelta' },
    { id: 'c', status: 'vencida' },
    { id: 'd', status: 'abierta' },
  ];
  assert.equal(D.contarConAccion(tareas), 2);
});

test('una tarea resuelta deja de contar de inmediato', () => {
  const antes = [{ id: 'a', status: 'abierta' }];
  const despues = [{ id: 'a', status: 'resuelta' }];
  assert.equal(D.contarConAccion(antes), 1);
  assert.equal(D.contarConAccion(despues), 0);
});

test('sin tareas el badge es cero, no undefined', () => {
  assert.equal(D.contarConAccion([]), 0);
  assert.equal(D.contarConAccion(undefined), 0);
});

// ── El tope de 4 y el «ver más» ─────────────────────────────────────

test('se muestran cuatro tarjetas como máximo', () => {
  const tareas = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, status: 'abierta' }));
  const { visibles, ocultas } = D.repartirTareas(tareas);
  assert.equal(visibles.length, 4);
  assert.equal(ocultas.length, 3);
});

test('el «ver más» cuenta tareas con acción ocultas, no tarjetas ocultas', () => {
  // Cuatro visibles + tres ocultas, de las cuales solo una tiene acción.
  const tareas = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: `v${i}`, status: 'abierta' })),
    { id: 'o1', status: 'abierta' },
    { id: 'o2', status: 'vencida' },
    { id: 'o3', status: 'resuelta' },
  ];
  const r = D.repartirTareas(tareas);
  assert.equal(r.ocultas.length, 3);
  assert.equal(r.ocultasConAccion, 1);
  assert.equal(r.etiquetaVerMas, 'Ver 1 pendiente más');
});

test('si lo oculto no tiene acción, el texto habla de avisos', () => {
  const tareas = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: `v${i}`, status: 'abierta' })),
    { id: 'o1', status: 'vencida' },
    { id: 'o2', status: 'resuelta' },
  ];
  const r = D.repartirTareas(tareas);
  assert.equal(r.ocultasConAccion, 0);
  assert.equal(r.etiquetaVerMas, 'Ver 2 avisos más');
});

test('con cuatro o menos no hay botón de «ver más»', () => {
  const tareas = Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, status: 'abierta' }));
  assert.equal(D.repartirTareas(tareas).etiquetaVerMas, null);
});

test('el plural se respeta: una sola pendiente no dice «pendientes»', () => {
  const tareas = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: `v${i}`, status: 'abierta' })),
    { id: 'o1', status: 'abierta' },
  ];
  assert.equal(D.repartirTareas(tareas).etiquetaVerMas, 'Ver 1 pendiente más');
});

// ── Cupos del plan ──────────────────────────────────────────────────

test('las solicitudes pendientes NO ocupan cupo de integrante', () => {
  const cupos = D.cuposDelPlan({ plan: 'estandar', miembrosActivos: 11, admins: 1 });
  assert.equal(cupos.members.used, 11);
  assert.equal(cupos.members.max, 15);
});

test('el plan premium sube los dos límites', () => {
  const cupos = D.cuposDelPlan({ plan: 'premium', miembrosActivos: 20, admins: 2 });
  assert.equal(cupos.members.max, 26);
  assert.equal(cupos.admins.max, 3);
});

test('un plan desconocido cae en estándar, nunca deja sin límite', () => {
  const cupos = D.cuposDelPlan({ plan: 'inventado', miembrosActivos: 3, admins: 1 });
  assert.equal(cupos.members.max, 15);
  assert.equal(cupos.admins.max, 1);
});

// ── Permisos ────────────────────────────────────────────────────────

test('el jugador no puede resolver nada', () => {
  const can = D.permisosDeClub('jugador');
  for (const clave of Object.keys(can)) assert.equal(can[clave], false, clave);
});

test('el admin puede todo lo del club', () => {
  const can = D.permisosDeClub('admin');
  for (const clave of Object.keys(can)) assert.equal(can[clave], true, clave);
});

test('un rol desconocido se trata como jugador, no como admin', () => {
  assert.equal(D.permisosDeClub('capitan').editarClub, false);
  assert.equal(D.permisosDeClub(undefined).editarClub, false);
});

// ── Normalización de las siete fuentes ──────────────────────────────

test('un desafío recibido se vuelve la tarea principal, en tono acento', () => {
  const [t] = D.normalizarTareas(fuentes({ desafiosRecibidos: [DESAFIO] }), {
    rol: 'admin',
    ahora: AHORA,
  });
  assert.equal(t.type, 'desafio');
  assert.equal(t.tone, 'accent');
  assert.equal(t.cta, 'Responder');
  assert.equal(t.target, 'ClubChallenges');
  assert.equal(t.status, 'abierta');
});

test('al jugador el mismo desafío le llega como «Ver» y dice quién responde', () => {
  const [t] = D.normalizarTareas(fuentes({ desafiosRecibidos: [DESAFIO] }), {
    rol: 'jugador',
    ahora: AHORA,
  });
  assert.equal(t.cta, 'Ver');
  assert.match(t.subtitle, /responde un admin/);
});

test('el jugador NO ve las solicitudes de ingreso', () => {
  const f = fuentes({ solicitudes: [{ request_id: 'r1', username: 'pedro' }] });
  const comoAdmin = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA });
  const comoJugador = D.normalizarTareas(f, { rol: 'jugador', ahora: AHORA });
  assert.equal(comoAdmin.length, 1);
  assert.equal(comoAdmin[0].type, 'solicitud');
  assert.equal(comoJugador.length, 0);
});

test('un desafío ya expirado entra como vencido y no suma al badge', () => {
  const f = fuentes({ desafiosRecibidos: [{ ...DESAFIO, estado: 'expirado' }] });
  const tareas = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA });
  assert.equal(tareas[0].status, 'vencida');
  assert.equal(D.contarConAccion(tareas), 0);
});

test('las siete fuentes producen sus siete tipos, en el orden del handoff', () => {
  const f = fuentes({
    desafiosRecibidos: [DESAFIO],
    propuestas: [{ id: 'p1', challenge_id: 'des-1' }],
    cambiosDePartido: [{ id: 'cb1', match_id: 'm1' }],
    nomina: { matchId: 'm1', confirmados: 9, cupos: 11 },
    solicitudes: [{ request_id: 'r1', username: 'pedro' }],
    sancion: { id: 's1', motivo: 'incomparecencia' },
    proximoPartido: { id: 'm1', hora: '2026-08-30T23:00:00Z' },
  });
  const tipos = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA }).map((t) => t.type);
  assert.deepEqual(tipos, [
    'desafio', 'propuesta', 'cambio', 'nomina', 'solicitud', 'sancion', 'partido',
  ]);
});

test('cada tarea trae un id único, para que la lista no se mezcle', () => {
  const f = fuentes({
    desafiosRecibidos: [DESAFIO, { ...DESAFIO, id: 'des-2' }],
    solicitudes: [{ request_id: 'r1' }, { request_id: 'r2' }],
  });
  const ids = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA }).map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('sin nada pendiente la lista es vacía, no null', () => {
  assert.deepEqual(D.normalizarTareas(fuentes(), { rol: 'admin', ahora: AHORA }), []);
});

test('no revienta con fuentes ausentes', () => {
  assert.deepEqual(D.normalizarTareas(undefined, { rol: 'admin', ahora: AHORA }), []);
  assert.deepEqual(D.normalizarTareas({}, {}), []);
});
```

- [ ] **Paso 2: Correr y ver fallar**

```bash
node --test src/utils/__tests__/clubsHomeTasks.test.js
```

Esperado: FALLA con `Cannot find module '../clubsHomeTasks.js'`.

- [ ] **Paso 3: Bajar los límites a un módulo puro**

Crear `src/utils/clubPlanLimits.js`:

```js
/**
 * Límites de integrantes y administradores por plan.
 *
 * Viven acá y no en `services/clubs.js` porque los necesita código que se
 * prueba sin red: ese servicio importa `./supabase` sin extensión, que solo
 * resuelve Metro, así que requerirlo bajo `node --test` falla. El servicio los
 * re-exporta para que sus llamadores no cambien.
 *
 * El servidor manda: el trigger `check_user_club_limit` de la migración 11
 * valida lo mismo. Estos números son para AVISAR antes, no para autorizar.
 */
export const CLUB_LIMITS = Object.freeze({
  estandar: Object.freeze({ miembros: 15, admins: 1 }),
  premium: Object.freeze({ miembros: 26, admins: 3 }),
});
```

Y en `src/services/clubs.js`, reemplazar la definición literal por el re-export, dejando el comentario que ya explica el trigger:

```js
export { CLUB_LIMITS } from '../utils/clubPlanLimits.js';
```

Comprobar que nadie se quedó sin el símbolo:

```bash
grep -rn "CLUB_LIMITS" src
```

- [ ] **Paso 4: Escribir el módulo de derivación**

Crear `src/utils/clubsHomeTasks.js`:

```js
/**
 * Derivación de la portada de Clubes: convierte lo que devuelven siete
 * servicios en la lista de tareas que ve el usuario, y calcula los números
 * que la acompañan.
 *
 * POR QUÉ ESTÁ SEPARADO DEL HOOK. Acá no hay red ni React: entra un objeto de
 * fuentes y sale una lista. Eso permite probar las reglas que de verdad se
 * rompen —el badge, el «ver más», los cupos y los permisos— sin levantar
 * Supabase ni montar una pantalla.
 *
 * LA REGLA QUE MÁS SE EQUIVOCA: el badge cuenta tareas CON ACCIÓN. Una tarea
 * resuelta o vencida sigue en pantalla un rato, pero no suma. El badge de la
 * sección y el de la barra inferior usan este mismo número.
 */

import { CLUB_LIMITS } from './clubPlanLimits.js';

/** Prioridad de la lista: es el orden del handoff, no alfabético. */
const ORDEN = ['desafio', 'propuesta', 'cambio', 'nomina', 'solicitud', 'sancion', 'partido'];

const TOPE_VISIBLE = 4;

/** Estados de la base que ya no admiten acción. */
const ESTADOS_MUERTOS = new Set(['expirado', 'cancelado', 'rechazado', 'aceptado']);

function estadoDeTarea(estado) {
  return ESTADOS_MUERTOS.has(estado) ? 'vencida' : 'abierta';
}

/** El CTA depende del rol: el jugador ve, el admin resuelve. */
function accion(esAdmin, etiquetaAdmin) {
  return esAdmin ? etiquetaAdmin : 'Ver';
}

/** El jugador necesita saber por qué no puede accionar. */
function coletilla(esAdmin, subtitulo) {
  return esAdmin ? subtitulo : `${subtitulo} · responde un admin`;
}

function diasHasta(iso, ahora) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - ahora.getTime()) / 86400000);
}

/**
 * Normaliza las siete fuentes a una lista de tareas ordenada por prioridad.
 *
 * `rol` decide dos cosas: la etiqueta del botón y si la tarea se muestra —las
 * solicitudes de ingreso solo existen para un admin, porque un jugador no
 * tiene nada que hacer con ellas.
 */
export function normalizarTareas(fuentes, { rol, ahora = new Date() } = {}) {
  const f = fuentes || {};
  const esAdmin = rol === 'admin';
  const tareas = [];

  for (const d of f.desafiosRecibidos || []) {
    tareas.push({
      id: `desafio:${d.id}`,
      type: 'desafio',
      tone: 'accent',
      title: 'Desafío recibido',
      subtitle: coletilla(esAdmin, d.otroClub?.nombre || 'Un club te desafió'),
      cta: accion(esAdmin, 'Responder'),
      target: 'ClubChallenges',
      status: estadoDeTarea(d.estado),
    });
  }

  for (const p of f.propuestas || []) {
    tareas.push({
      id: `propuesta:${p.id}`,
      type: 'propuesta',
      tone: 'info',
      title: 'Propuesta pendiente',
      subtitle: coletilla(esAdmin, 'Fecha, lugar y modalidad por confirmar'),
      cta: accion(esAdmin, 'Revisar'),
      target: 'ClubChallenges',
      status: estadoDeTarea(p.estado),
    });
  }

  for (const c of f.cambiosDePartido || []) {
    tareas.push({
      id: `cambio:${c.id}`,
      type: 'cambio',
      tone: 'warn',
      title: 'Cambio de partido',
      subtitle: coletilla(esAdmin, 'El rival propuso mover el encuentro'),
      cta: accion(esAdmin, 'Responder'),
      target: 'ClubMatchChange',
      status: estadoDeTarea(c.estado),
    });
  }

  if (f.nomina && f.nomina.confirmados < f.nomina.cupos) {
    tareas.push({
      id: `nomina:${f.nomina.matchId}`,
      type: 'nomina',
      tone: 'info',
      title: 'Jugadores por confirmar',
      // Esta la ven igual los dos: cualquiera confirma su propia asistencia.
      subtitle: `${f.nomina.confirmados} de ${f.nomina.cupos} cupos confirmados`,
      cta: 'Ver nómina',
      target: 'ClubMatchRoster',
      status: 'abierta',
    });
  }

  if (esAdmin) {
    for (const s of f.solicitudes || []) {
      tareas.push({
        id: `solicitud:${s.request_id}`,
        type: 'solicitud',
        tone: 'warn',
        title: 'Solicitud de ingreso',
        subtitle: `${s.username || 'Un jugador'} quiere entrar al club`,
        cta: 'Revisar',
        target: 'ClubMembers',
        status: 'abierta',
      });
    }
  }

  if (f.sancion) {
    tareas.push({
      id: `sancion:${f.sancion.id}`,
      type: 'sancion',
      tone: 'danger',
      title: 'Sanción en revisión',
      subtitle: coletilla(esAdmin, 'Afecta a los próximos desafíos del club'),
      cta: accion(esAdmin, 'Revisar'),
      target: 'ClubDetail',
      status: 'abierta',
    });
  }

  if (f.proximoPartido) {
    const dias = diasHasta(f.proximoPartido.hora, ahora);
    tareas.push({
      id: `partido:${f.proximoPartido.id}`,
      type: 'partido',
      tone: 'accent',
      title: dias === null ? 'Próximo partido' : `Próximo partido en ${dias} días`,
      subtitle: 'Revisa la nómina y confirma tu asistencia',
      cta: 'Ir ahora',
      target: 'ClubMatchRoster',
      status: 'abierta',
    });
  }

  return tareas.sort((a, b) => ORDEN.indexOf(a.type) - ORDEN.indexOf(b.type));
}

/**
 * Cuántas tareas puede accionar el usuario ahora mismo.
 * Es EL número del badge de la sección y el de la barra inferior: si se
 * calcularan por separado, tarde o temprano dirían cosas distintas.
 */
export function contarConAccion(tareas) {
  return (tareas || []).filter((t) => t.status === 'abierta').length;
}

/**
 * Reparte la lista entre lo que se ve y lo que queda tras el botón.
 *
 * El contador del botón cuenta TAREAS CON ACCIÓN ocultas, no tarjetas
 * ocultas: prometer «3 pendientes más» y mostrar tres avisos vencidos es
 * exactamente el error que el handoff pide no repetir.
 */
export function repartirTareas(tareas, { tope = TOPE_VISIBLE } = {}) {
  const lista = tareas || [];
  const visibles = lista.slice(0, tope);
  const ocultas = lista.slice(tope);
  const ocultasConAccion = contarConAccion(ocultas);

  let etiquetaVerMas = null;
  if (ocultas.length > 0) {
    etiquetaVerMas =
      ocultasConAccion > 0
        ? `Ver ${ocultasConAccion} ${ocultasConAccion === 1 ? 'pendiente' : 'pendientes'} más`
        : `Ver ${ocultas.length} ${ocultas.length === 1 ? 'aviso' : 'avisos'} más`;
  }

  return { visibles, ocultas, ocultasConAccion, etiquetaVerMas };
}

/**
 * Cupos del plan. `miembrosActivos` son integrantes de verdad: una solicitud
 * pendiente no ocupa cupo, o un club con espacio diría que está lleno.
 */
export function cuposDelPlan({ plan, miembrosActivos = 0, admins = 0 } = {}) {
  const limites = CLUB_LIMITS[plan] || CLUB_LIMITS.estandar;
  return {
    members: { used: miembrosActivos, max: limites.miembros },
    admins: { used: admins, max: limites.admins },
  };
}

/**
 * Qué puede hacer el usuario en este club. Un solo lugar decide.
 *
 * No hay rol de capitán: la migración 11 solo admite 'admin' y 'jugador'.
 * Cualquier otra cosa se trata como jugador — errar hacia «no puede» es el
 * lado seguro.
 */
export function permisosDeClub(rol) {
  const admin = rol === 'admin';
  return Object.freeze({
    responderDesafios: admin,
    gestionarMiembros: admin,
    editarClub: admin,
    eliminarClub: admin,
    cederAdmin: admin,
    invitar: admin,
  });
}
```

- [ ] **Paso 5: Correr y ver pasar**

```bash
node --test src/utils/__tests__/clubsHomeTasks.test.js
```

Esperado: PASA, 22 pruebas.

- [ ] **Paso 6: Verificar y commitear**

```bash
npm run verify
git add src/utils/clubPlanLimits.js src/utils/clubsHomeTasks.js src/utils/__tests__/clubsHomeTasks.test.js src/services/clubs.js
git commit -m "feat(clubes): derivación de la portada — tareas, badge, cupos y permisos"
git push
```

---

## Tarea 6: `useClubsHome` — el view-model

**Archivos:**
- Crear: `src/utils/useClubsHome.js`

**Interfaces:**
- Consume: todo lo de la tarea 5, más los servicios existentes.
- Produce: `useClubsHome()` devuelve
  `{ loading, error, retry, membership, clubs, activeClubId, setActiveClub, club, role, can, limits, tasks, reparto, badgeCount, nextMatch, activity, suggestedRivals, invitations, pendingRequests }`.
  Las tareas 7 a 10 consumen exactamente estos nombres.

Vive en `src/utils/` porque ahí están los hooks del repo (`useConnection.js`, `useUnreadNotifications.js`).

- [ ] **Paso 1: Escribir el hook**

Crear `src/utils/useClubsHome.js`. Puntos que no se pueden improvisar:

**Membresía.** `getMyClubs()` devuelve `{ data: [{ club, miRol, totalMiembros }], error }`, ordenado por `joined_at`. Si viene vacío, consultar `listMyInvitations()` y `getMyRequestTo()` para distinguir `'none'` de `'pending'`.

**Club activo.** Persistir en `AsyncStorage` bajo `'futfinder:clubActivo'`. Al cargar, si el id guardado no está entre los clubes del usuario, caer al primero. `setActiveClub(id)` escribe y recarga.

**Las siete fuentes**, en paralelo con `Promise.all`, todas ya con `{ data, error }`:

```js
const [desafios, solicitudes, sancion, estadisticas, miembros, rivales] = await Promise.all([
  listChallengesForClub(clubId),
  can.gestionarMiembros ? listPendingRequests(clubId) : Promise.resolve({ data: [] }),
  getSancionVigente([clubId]),
  getClubEstadisticas(clubId),
  listMembers(clubId),
  listRivalCandidates({ clubId }),
]);
```

`propuestas` y `cambiosDePartido` dependen del desafío y del partido, así que van en una segunda ronda: `getPropuestaVigente(challengeId)` sobre los desafíos aceptados, y `getCambioPendiente(matchId)` + `getNominaPartido(matchId)` sobre el próximo partido.

**Próximo partido.** `proximoPartidoDeClub(matches, [clubId], { ahora })` de `services/clubMatchRules`.

**Derivar.** Con las fuentes en mano:

```js
const can = permisosDeClub(miRol);
const tasks = normalizarTareas(fuentes, { rol: miRol, ahora: new Date() });
const reparto = repartirTareas(tasks);
const badgeCount = contarConAccion(tasks);
const limits = cuposDelPlan({
  plan: club.plan,
  miembrosActivos: miembros.data.length,   // las solicitudes NO entran acá
  admins: miembros.data.filter((m) => m.rol === 'admin').length,
});
```

**Actividad.** `listNotifications({ limit: 50 })` y filtrar por las que refieren al club activo; quedarse con 3.

**Errores.** Si `getMyClubs` falla, `error` pasa a `true` y `retry()` reintenta. El mensaje del backend va a `console.error`, nunca a pantalla. Un fallo de una fuente secundaria no tumba la portada: esa sección se muestra vacía.

**Cancelación.** Guardar un flag `vivo` y no llamar a `setState` después de desmontar.

- [ ] **Paso 2: Verificar que compila y lintea**

```bash
npm run verify
```

Esperado: cero errores. `no-undef` atrapa cualquier servicio que hayas usado sin importar.

- [ ] **Paso 3: Commit**

```bash
git add src/utils/useClubsHome.js
git commit -m "feat(clubes): useClubsHome, el view-model único de la portada"
git push
```

---

## Tarea 7: `VerifiedBadge` y los componentes de cabecera

**Archivos:**
- Crear: `src/components/club/VerifiedBadge.js`
- Crear: `src/components/club/ClubsHeader.js`
- Crear: `src/components/club/ClubSwitcher.js`

**Interfaces:**
- Consume: `temaDeClub`, `clubSuperficies`.
- Produce:
  - `<VerifiedBadge size tema />`
  - `<ClubsHeader titulo subtitulo tema hayPendientes onBuscar onAvisos />`
  - `<ClubSwitcher clubs activeClubId tema onSelect onExplorar />`

`VerifiedBadge` es el único componente que se dibuja desde cero: el handoff pide un escudo festoneado de 12 puntas en `tema.main` con el check en `tema.ink`. Se usa en cuatro tamaños: 17 (resumen), 21 (header de Mi club), 13 (chip de club activo) y en el chip «Premium».

- [ ] **Paso 1: `VerifiedBadge`**

SVG con `react-native-svg`. Recibe `size` y `tema`; sin `tema` cae a `temaClub('green')`. Un solo `<Path>` para el escudo festoneado y otro para el check. Nada de imágenes.

- [ ] **Paso 2: `ClubsHeader`**

Sticky, fondo `clubSuperficies.header`. Título «Clubes» 27/800/-0.7. Subtítulo 12px: nombre del club, o `Club activo · <nombre>` con varios, o «Solicitud en revisión», o «Aún sin club». A la derecha dos botones de 40×40 radio 14, fondo `#141416`, borde `rgba(255,255,255,.09)`: lupa (`Search` de lucide) y campana (`Bell`). Con pendientes, punto de 8px en `tema.main` con borde 2px `#141416`.

- [ ] **Paso 3: `ClubSwitcher`**

Solo se renderiza si `clubs.length > 1` — esa decisión la toma el llamador, el componente no la esconde. `ScrollView` horizontal de chips radio 14, alto 42. Activo: fondo `tema.soft`, borde `tema.border`, texto blanco, escudo en `tema.main`, `<VerifiedBadge size={13} />` si `club.verificado`. Inactivo: `#141416`, texto `rgba(255,255,255,.6)`. Último chip «Explorar» con borde `1px dashed rgba(255,255,255,.16)`.

- [ ] **Paso 4: Verificar y commitear**

```bash
npm run verify
git add src/components/club/VerifiedBadge.js src/components/club/ClubsHeader.js src/components/club/ClubSwitcher.js
git commit -m "feat(clubes): insignia verificada, cabecera y selector de club de la portada"
git push
```

---

## Tarea 8: Los componentes de contenido

**Archivos:**
- Crear: `src/components/club/PendingTaskCard.js`
- Crear: `src/components/club/AllClearBanner.js`
- Crear: `src/components/club/NextMatchCard.js`
- Crear: `src/components/club/QuickActionGrid.js`
- Crear: `src/components/club/ClubSummaryCard.js`
- Crear: `src/components/club/ActivityList.js`
- Crear: `src/components/club/SkeletonHome.js`

**Interfaces:**
- Consume: `Task` de la tarea 5; `temaDeClub`, `clubTonos`, `clubSuperficies`.
- Produce:
  - `<PendingTaskCard tarea tema esPrimaria onPress />`
  - `<AllClearBanner tema />`
  - `<NextMatchCard partido tema cupos onVerPartido onNomina />`
  - `<QuickActionGrid tema can badges onPress />`
  - `<ClubSummaryCard club tema rol stats totalMiembros onVerClub />`
  - `<ActivityList items tema onVerToda />`
  - `<SkeletonHome />`

Ninguno consulta la API. El tono de cada tarjeta sale de `clubTonos[tarea.tone]`, salvo `accent`, que sale del tema del club.

- [ ] **Paso 1: `PendingTaskCard` y `AllClearBanner`**

Tarjeta: alto ~64, radio 17, fondo `clubSuperficies.card`. Fila de `[icono 38×38 radio 12, fondo tono.soft, color tono.fg] [título 14/700 + subtítulo 12 truncado] [botón 9px 13px radio 12]`.

`esPrimaria` (la primera tarea): borde `tema.border` y botón sólido `tema.main` con texto `tema.ink`. Las demás: borde `clubSuperficies.borde` y botón `rgba(255,255,255,.06)` / borde `rgba(255,255,255,.12)` / texto blanco.

Micro-estados por `tarea.status`:
- `'resuelta'`: icono `Check`, tono accent, subtítulo «Resuelto hace un momento» en `tema.main`, botón reemplazado por chip «Listo ✓», opacidad .55.
- `'vencida'`: opacidad .55, sin botón, chip neutro «Expiró».

`AllClearBanner`: alto ~56, radio 16, fondo `#0E0F0E`, borde `tema.border`, icono `Check` en `tema.main`, «Todo al día» + «Sin desafíos ni cambios por responder».

- [ ] **Paso 2: `NextMatchCard`**

Radio 22, padding 17, fondo degradado destacado sobre `clubSuperficies.cardAlta`, borde `tema.border`, sombra `0 14px 34px rgba(0,0,0,.45)`.

Pill sólida `tema.main` «EN N DÍAS» (10.5/800) + modalidad a la derecha. Enfrentamiento: dos columnas con escudo 52×52 radio 17 —el propio en `tema.soft`, el rival en neutro— y «VS» al medio 15/800 `rgba(255,255,255,.35)`. Dos tiles `rgba(255,255,255,.045)` radio 13: FECHA y LUGAR. Cupos: label + «9 / 11» + barra de 6px radio 99, pista `rgba(255,255,255,.09)`, relleno `tema.main`. Acciones: «Ver partido» sólido (flex 1, alto 48, radio 15) + «Nómina» secundario.

- [ ] **Paso 3: `QuickActionGrid`**

Grilla de 3 columnas, gap 9. Tile radio 17, fondo `clubSuperficies.card`, padding 12/11, icono 34×34 radio 11 en `tema.soft`/`tema.main`, label 12.5/700 en dos líneas.

Orden fijo: **Mi club · Desafíos (badge) · Buscar rivales · Próximo partido · Integrantes · Ajustes del club**.

«Ajustes» solo si `can.editarClub`. **Integrantes lo ven todos.** Si el usuario es jugador, bajo la grilla una nota 11.5px `rgba(255,255,255,.32)`: «Ves los integrantes y todo lo pendiente; responder desafíos, cambios y ajustes queda en manos de un administrador.»

- [ ] **Paso 4: `ClubSummaryCard` y `ActivityList`**

Resumen, radio 20, tres bandas:
1. Escudo 56×56 radio 18 en `tema.soft` + nombre 17/800 + `<VerifiedBadge size={17} />` si `club.verificado` + comuna con `MapPin` + chips: rol («Administrador» o «Jugador», en `tema.main`), modalidad, «11 / 15» integrantes, y chip «Premium» con insignia si corresponde.
2. Cuatro tiles radio 13: **V** en `tema.main`, **E** neutro, **D** en `clubTonos.danger.fg`, **RATING** neutro. Con datos ausentes, «N.A.» — es el caso normal, no el excepcional.
3. Botón de ancho completo «Ver club» con `ChevronRight`, fondo `rgba(255,255,255,.03)`, borde superior `rgba(255,255,255,.07)`.

`ActivityList`: máximo 3 filas, radio 18 en el contenedor, separador `clubSuperficies.separador`. Icono 30×30 con tono semántico, título 13/600 truncado, tiempo relativo 11px a la derecha. Encabezado con «Ver toda» en `tema.main`.

- [ ] **Paso 5: `SkeletonHome`**

Reproduce la silueta real: título, 3 barras de tarea, tarjeta destacada, grilla de 3. Animación de opacidad .35 → .75 → .35, 1,4 s en bucle, con 100 ms de desfase por bloque (`Animated.loop` + `useNativeDriver: true`). Reemplaza el `ActivityIndicator` centrado de hoy.

- [ ] **Paso 6: Verificar y commitear**

```bash
npm run verify
git add src/components/club/
git commit -m "feat(clubes): componentes de contenido de la portada"
git push
```

---

## Tarea 9: La portada

**Archivos:**
- Modificar: `src/screens/ClubsScreen.js` (reescritura: hoy son 115 líneas sin UI propia)
- Modificar: `src/screens/ClubDetailScreen.js` (retirar `viaClubesTab`)

**Interfaces:**
- Consume: `useClubsHome()` de la tarea 6 y todos los componentes de las tareas 7 y 8.
- Produce: la pestaña Clubes abre la portada.

Este es el cambio de fondo: `ClubsScreen` deja de **embeber** `ClubDetailScreen`. El detalle queda alcanzable solo por navegación explícita, desde el tile «Mi club» y el botón «Ver club».

- [ ] **Paso 1: Componer la portada**

Orden vertical exacto —la jerarquía es el corazón del rediseño—: `ClubsHeader` (sticky) → `ClubSwitcher` (solo con más de un club) → **Pendiente para ti** → `NextMatchCard` → `QuickActionGrid` → `ClubSummaryCard` → `ActivityList` → **Rivales sugeridos** (carrusel de `RivalClubCard`, bleed -16px).

Padding lateral 16, gap entre tarjetas 9–10, separación entre secciones 22–24, y **padding inferior 110** para dejar pasar la barra y el FAB.

Encabezado de «Pendiente para ti»: título + badge en `tema.main` con `badgeCount` (mínimo 21×21, radio 8, texto `tema.ink` 12/800) + «Ver todo». Con `tasks` vacío, se muestra `AllClearBanner` y **desaparecen el badge y el «Ver todo»**.

La lista pinta `reparto.visibles` con `PendingTaskCard` —la primera con `esPrimaria`— y, si `reparto.etiquetaVerMas` no es `null`, un botón con borde dashed que muestra esa etiqueta tal cual. No la recalcules en la pantalla: el texto y su plural ya vienen resueltos y probados desde `repartirTareas()`.

Entrada de pantalla: opacidad 0→1 y `translateY` 12→0 en 280 ms.

- [ ] **Paso 2: Los seis estados**

| Estado | Qué se pinta |
|---|---|
| `loading` | `SkeletonHome` |
| `error` | Círculo de 62 con `AlertTriangle` en `clubTonos.danger.fg`, «No pudimos cargar tus clubes», «Revisa tu conexión. Tus pendientes y partidos siguen guardados.», botón «Reintentar» → `retry()` |
| `membership === 'none'` | «Aún no tienes club»: «Crear club» primario + «Explorar clubes» secundario, invitaciones pendientes (Aceptar / Rechazar) y clubes sugeridos (Unirse) |
| `membership === 'pending'` | Tarjeta ámbar «Solicitud en revisión» + club y antigüedad + «Ver el club» / «Cancelar» + qué queda bloqueado + sugeridos |
| un club | Portada directa, sin selector |
| varios clubes | Con `ClubSwitcher` |

**«Ver estado del servicio» no se implementa**: no tiene respaldo en la app y el handoff prohíbe construir pantalla nueva sin confirmarlo. El estado de error queda solo con «Reintentar».

- [ ] **Paso 3: Conservar el banner de éxito**

Hoy `ClubMembersScreen` navega con `route.params.successTitle` al salir o eliminar un club, y `ClubsScreen` lo consume una sola vez y lo limpia con `navigation.setParams`. Ese comportamiento se conserva tal cual: ahora el banner se muestra sobre la portada.

- [ ] **Paso 4: Retirar `viaClubesTab`**

Existía solo para darle a `ClubDetailScreen` un «volver al explorador» en vez del back normal, porque estaba embebido y no había pantalla a la que volver. Ahora sí la hay.

```bash
grep -rn "viaClubesTab" src
```

Quitar la prop y la rama de UI que dependía de ella; el back vuelve a ser el normal y lleva a la portada.

- [ ] **Paso 5: Verificar**

```bash
npm run verify
```

Esperado: cero errores de lint. Aquí `no-undef` importa más que en ninguna otra tarea: es una pantalla nueva entera y un componente mal importado la deja en blanco sin avisar.

- [ ] **Paso 6: Probar en la app**

```bash
npm run web
```

Recorrer: pestaña Clubes → la portada abre (no el detalle) → «Ver club» lleva al detalle → el back vuelve a la portada.

- [ ] **Paso 7: Commit**

```bash
git add src/screens/ClubsScreen.js src/screens/ClubDetailScreen.js
git commit -m "feat(clubes): la pestaña Clubes abre una portada en vez del detalle del club"
git push
```

---

## Tarea 10: Badge de pendientes en la barra

**Archivos:**
- Modificar: `src/navigation/MainTabs.js:92` (cálculo del badge) y `:120` (el comentario)

**Interfaces:**
- Consume: `badgeCount` de `useClubsHome()`.

`MainTabs.js:120` afirma hoy: «Único badge que queda en la barra: mensajes sin leer del Chat». Fue una decisión deliberada y la estamos revirtiendo para Clubes, así que el comentario se corrige — dejarlo contradiciendo al código es peor que no tenerlo.

- [ ] **Paso 1: Alimentar el contador**

Hoy la línea 92 es `const badge = route.name === 'ChatTab' ? chatUnread : 0;`. Pasa a contemplar los dos:

```js
const badge =
  route.name === 'ChatTab' ? chatUnread : route.name === 'ClubsTab' ? clubPendientes : 0;
```

`clubPendientes` sale de `useClubsHome()` en `MainTabs`. Es el **mismo número** que muestra la sección «Pendiente para ti»: si se calcularan por separado, tarde o temprano dirían cosas distintas.

- [ ] **Paso 2: Corregir el comentario de la línea 120**

```js
// Dos badges en la barra: mensajes sin leer del Chat y pendientes con
// acción del club activo. El de Clubes usa el mismo número que la sección
// «Pendiente para ti» de la portada, no un conteo aparte.
```

- [ ] **Paso 3: Verificar**

```bash
npm run verify
```

- [ ] **Paso 4: Probar que los dos números coinciden**

```bash
npm run web
```

Con al menos un desafío recibido pendiente: el badge de la barra y el de la sección tienen que mostrar lo mismo. Resolver el desafío baja los dos.

- [ ] **Paso 5: Commit**

```bash
git add src/navigation/MainTabs.js
git commit -m "feat(clubes): badge de pendientes sobre el icono de Clubes en la barra"
git push
```

---

## Al terminar

- [ ] `npm run verify` con cero errores de lint y toda la suite en verde.
- [ ] `git status` limpio, salvo `docs/Rediseno-Clubes-FutFinder.md`, que estaba sin seguir desde antes y **no se toca**.
- [ ] Actualizar `docs/memoria/funcionalidades/clubes.md` con el cambio de entrada de la pestaña (portada en vez de detalle) y `docs/memoria/diseno/sistema-visual.md` con los tonos nuevos. Solo esas dos notas: el cambio es material y las afecta.

## Lo que este plan NO hace

- **Pasos 3 a 9 del handoff.** Se abordan después, sobre esta base.
- **«Transferir capitanía» (paso 7).** No es funcionalidad nueva: es el rediseño de «¿Ceder la administración a X?» que ya existe en `ClubMembersScreen.js:253` sobre la RPC `transfer_club_admin`. Su copy en el handoff está mal para este modelo — al ceder **no** pasas a admin, pasas a jugador.
- **«Privacidad y solicitudes» y «Notificaciones del club».** Sin respaldo en la app; punto de entrada a un stub.
- **Renombrar Premium a «Pro».**
- **Unificar las seis familias de tokens** que documenta `docs/Rediseno-Clubes-FutFinder.md`. Es trabajo real, pero es otro proyecto.
