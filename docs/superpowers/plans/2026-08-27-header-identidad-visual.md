# Unificación del encabezado e identidad visual — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar el logo "fut**finder**" y el botón de notificaciones (`NotificationBell`) en las 6 pantallas raíz de pestaña de FutFinder, eliminando las 3 implementaciones duplicadas del logo y agregando el bell donde falta, sin tocar navegación ni lógica de negocio.

**Architecture:** Un componente nuevo, `BrandMark` (`src/components/BrandMark.js`), sin props de tamaño/color, reemplaza las 3 implementaciones inline del logo (Home, Chat, Partidos). El `NotificationBell` ya existente (`src/components/NotificationBell.js`) se importa sin modificar en los 4 lugares donde falta (Partidos, Chat, Perfil-propio, Clubes-sin-club), respetando en cada caso las condiciones que ya distinguen "soy la raíz de pestaña" de "soy una pantalla empujada" (`isOwnProfile`, `showBackButton`).

**Tech Stack:** React Native / Expo, `lucide-react-native` (ícono `MapPin`), `StyleSheet` de React Native (no NativeWind, para comportamiento idéntico en web y nativo), `node:test` + `node:assert/strict` para las pruebas.

## Global Constraints

- El logo se unifica **solo** en Home, Partidos y Chat (las 3 pantallas que ya lo muestran hoy). El flujo de onboarding/login (`Logo.js`, `SplashScreen.js`, Welcome, Verification, LocationPermission, Terms, Success) **no se toca**.
- El bell se agrega **solo** en las 6 pantallas raíz de pestaña (Home, Partidos, Clubes-sin-club, Reservas, Chat, Perfil-propio). **Nunca** en "Mi club" (`ClubDetailScreen`/`ClubHeaderBar`), ni en perfil ajeno, ni en pantallas empujadas/internas.
- `NotificationBell` (`src/components/NotificationBell.js`) no se modifica — se importa tal cual. Conserva su navegación (`navigate('Notifications')`), su contador (`useUnreadNotifications`) y sus estados.
- Nunca duplicar el bell en una pantalla que ya lo tenga (Home, Reservas quedan sin cambios funcionales).
- `BrandMark` no acepta props de tamaño ni color — solo `style` opcional para posicionamiento del contenedor.
- Cada paso de código termina con `npm run lint` limpio (0 errores) antes de dar el paso por cerrado.
- Commits locales por tarea; el `git push` final va en la Tarea 7, después de la verificación completa.

---

### Task 1: Componente `BrandMark`

**Files:**
- Create: `src/components/BrandMark.js`
- Create: `src/components/__tests__/headerBrand.test.js`

**Interfaces:**
- Produces: `export default function BrandMark({ style })` — componente sin estado, sin lógica, acepta solo `style` (objeto o array de estilos RN, opcional) para el contenedor. Ruta de importación desde `src/components/home/`, `src/components/chat/` y `src/screens/` es `'../BrandMark'` o `'../../BrandMark'` según profundidad.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `src/components/__tests__/headerBrand.test.js`:

```js
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
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `node --test src/components/__tests__/headerBrand.test.js`
Expected: FAIL — `../BrandMark.js` no existe todavía (`ENOENT`).

- [ ] **Step 3: Crear `BrandMark`**

Crear `src/components/BrandMark.js`:

```jsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MapPin } from 'lucide-react-native';

import { tactical } from '../theme/colors';

/**
 * Marca «FutFinder» (pin + wordmark) para el header de cada pestaña.
 *
 * Sin props de tamaño ni color a propósito: las tres implementaciones que
 * reemplaza (Home, Chat, Partidos) habían divergido en tamaño de ícono,
 * tamaño de texto y tono de verde. Fijar los valores acá — en vez de
 * exponerlos como props — es lo que evita que un futuro cambio los separe
 * otra vez. Usa los tokens de `tactical` (el rediseño de Home) siempre,
 * sin adaptarse a la paleta de la pantalla que la aloja — mismo criterio
 * que ya sigue `NotificationBell`.
 */
export default function BrandMark({ style }) {
  return (
    <View style={[styles.row, style]}>
      <MapPin size={26} color={tactical.neon} strokeWidth={2.2} />
      <Text style={styles.word}>
        fut<Text style={styles.wordAccent}>finder</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  word: {
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: tactical.text,
  },
  wordAccent: { color: tactical.neon },
});
```

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `node --test src/components/__tests__/headerBrand.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: 0 errores.

- [ ] **Step 6: Commit**

```bash
git add src/components/BrandMark.js src/components/__tests__/headerBrand.test.js
git commit -m "feat(header): agrega BrandMark, fuente única del logo fut+finder"
```

---

### Task 2: Home usa `BrandMark`

**Files:**
- Modify: `src/components/home/TacticalHeader.js`
- Modify: `src/components/__tests__/headerBrand.test.js`

**Interfaces:**
- Consumes: `BrandMark` de Task 1 (`import BrandMark from '../BrandMark'`).

- [ ] **Step 1: Extender la prueba (roja para este archivo)**

Agregar al final de `src/components/__tests__/headerBrand.test.js`:

```js
test('Home (TacticalHeader) usa BrandMark, no una copia inline del logo', () => {
  const src = readSrc('../home/TacticalHeader.js');
  assert.match(src, /<BrandMark\s*\/>/, 'TacticalHeader debe renderizar <BrandMark/>');
  assert.doesNotMatch(
    src,
    /fut<Text/,
    'TacticalHeader todavía dibuja el wordmark a mano — debería venir de BrandMark'
  );
});
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `node --test src/components/__tests__/headerBrand.test.js`
Expected: FAIL — el segundo test falla (`TacticalHeader.js` todavía tiene `fut<Text` inline y no importa `BrandMark`).

- [ ] **Step 3: Migrar `TacticalHeader.js`**

En `src/components/home/TacticalHeader.js`, agregar el import (después de `import StatusPill from './StatusPill';`):

```jsx
import BrandMark from '../BrandMark';
```

Reemplazar el bloque:

```jsx
      <View className="mt-2 flex-row items-center">
        <View className="flex-row items-center gap-2">
          <MapPin size={26} color={t.neon} strokeWidth={2.2} />
          <Text className="text-[21px] font-extrabold tracking-tight text-white">
            fut<Text className="text-[#00FF66]">finder</Text>
          </Text>
        </View>
        <View className="flex-1" />
        <NotificationBell />
      </View>
```

por:

```jsx
      <View className="mt-2 flex-row items-center">
        <BrandMark />
        <View className="flex-1" />
        <NotificationBell />
      </View>
```

No tocar el resto del archivo (el import de `MapPin` sigue usándose más abajo, en la fila de comuna — no se elimina).

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `node --test src/components/__tests__/headerBrand.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: 0 errores.

- [ ] **Step 6: Commit**

```bash
git add src/components/home/TacticalHeader.js src/components/__tests__/headerBrand.test.js
git commit -m "refactor(home): TacticalHeader usa BrandMark en vez del logo inline"
```

---

### Task 3: Chat usa `BrandMark` y gana el bell

**Files:**
- Modify: `src/components/chat/ChatInboxHeader.js`
- Modify: `src/components/__tests__/headerBrand.test.js`

**Interfaces:**
- Consumes: `BrandMark` de Task 1, `NotificationBell` (`src/components/NotificationBell.js`, sin cambios).

- [ ] **Step 1: Extender la prueba (roja para este archivo)**

Agregar al final de `src/components/__tests__/headerBrand.test.js`:

```js
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
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `node --test src/components/__tests__/headerBrand.test.js`
Expected: FAIL — el tercer test falla.

- [ ] **Step 3: Migrar `ChatInboxHeader.js`**

Reemplazar el archivo completo `src/components/chat/ChatInboxHeader.js` por:

```jsx
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { UserPlus } from 'lucide-react-native';

import { chatColors, dsRadius, dsSizes } from '../../theme/colors';
import BrandMark from '../BrandMark';
import NotificationBell from '../NotificationBell';

/**
 * Cabecera de la bandeja: marca, bell de avisos, acceso a «Amigos y
 * solicitudes» con el contador de solicitudes recibidas, y el título
 * grande.
 *
 * El botón de amigos mide 38 px pero lleva `hitSlop` para llegar a los
 * 44 px táctiles que exige el diseño.
 */
export default function ChatInboxHeader({ pendingRequests = 0, onPressFriends }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <BrandMark />

        <View style={styles.rightGroup}>
          <NotificationBell />

          <Pressable
            onPress={onPressFriends}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              pendingRequests > 0
                ? `Amigos y solicitudes, ${pendingRequests} pendientes`
                : 'Amigos y solicitudes'
            }
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
          >
            <UserPlus color="rgba(255,255,255,0.8)" size={18} strokeWidth={1.8} />
            {pendingRequests > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {pendingRequests > 9 ? '9+' : pendingRequests}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      <Text style={styles.title} accessibilityRole="header">
        Chats y amigos
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: dsSizes.gutter + 4, paddingTop: 4, paddingBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rightGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: dsRadius.sm,
    backgroundColor: chatColors.surface,
    borderWidth: 1,
    borderColor: chatColors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: chatColors.green,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: chatColors.background,
  },
  badgeText: {
    color: chatColors.inkOnGreen,
    fontSize: 9.5,
    fontWeight: '800',
    includeFontPadding: false,
  },

  title: {
    marginTop: 12,
    color: chatColors.textPrimary,
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
});
```

(Se quitan `MapPin` del import de `lucide-react-native` y los estilos `brand`/`brandText`/`brandAccent`, ya sin uso — el logo ahora vive en `BrandMark`.)

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `node --test src/components/__tests__/headerBrand.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: 0 errores (sin warnings nuevos de imports sin usar).

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/ChatInboxHeader.js src/components/__tests__/headerBrand.test.js
git commit -m "feat(chat): ChatInboxHeader usa BrandMark y agrega el bell de avisos"
```

---

### Task 4: Partidos usa `BrandMark` y gana el bell

**Files:**
- Modify: `src/screens/PartidosScreen.js`
- Modify: `src/components/__tests__/headerBrand.test.js`

**Interfaces:**
- Consumes: `BrandMark` de Task 1, `NotificationBell` (sin cambios).

- [ ] **Step 1: Extender la prueba (roja para este archivo)**

Agregar al final de `src/components/__tests__/headerBrand.test.js`:

```js
test('Partidos (función Header de PartidosScreen) usa BrandMark y tiene el bell de avisos', () => {
  const src = readSrc('../../screens/PartidosScreen.js');
  assert.match(src, /<BrandMark\s*\/>/, 'PartidosScreen debe renderizar <BrandMark/> en su header');
  assert.match(src, /<NotificationBell\s*\/>/, 'PartidosScreen debe renderizar <NotificationBell/> en su header');
});
```

(No se afirma la ausencia de `fut<Text` en todo el archivo: `PartidosScreen.js` es grande y esa cadena solo debe desaparecer de la función `Header`, que es justamente lo que este paso cambia — la aserción positiva de `<BrandMark/>` ya cubre la regresión real.)

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `node --test src/components/__tests__/headerBrand.test.js`
Expected: FAIL — el cuarto test falla.

- [ ] **Step 3: Migrar la función `Header` en `PartidosScreen.js`**

Agregar el import (junto a los demás imports de `../components/`, por ejemplo después de `import PickerSheet from '../components/partidos/PickerSheet';`):

```jsx
import BrandMark from '../components/BrandMark';
import NotificationBell from '../components/NotificationBell';
```

Reemplazar la función `Header` completa:

```jsx
function Header({ onFilters, activeCount = 0, showFilters }) {
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <MapPin color={P.green} size={21} strokeWidth={1.9} />
        <Text style={styles.brand}>
          fut<Text style={{ color: P.green }}>finder</Text>
        </Text>
      </View>
      {showFilters ? (
        <Pressable
          onPress={onFilters}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Abrir filtros"
          style={({ pressed }) => [
            styles.headerBtn,
            activeCount > 0 && styles.headerBtnActive,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Filter color={activeCount > 0 ? P.green : P.textDim} size={16} strokeWidth={2} />
          {activeCount > 0 ? (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{activeCount}</Text>
            </View>
          ) : null}
        </Pressable>
      ) : (
        <View style={{ width: 34 }} />
      )}
    </View>
  );
}
```

por:

```jsx
function Header({ onFilters, activeCount = 0, showFilters }) {
  return (
    <View style={styles.header}>
      <BrandMark />
      <View style={styles.headerActions}>
        <NotificationBell />
        {showFilters ? (
          <Pressable
            onPress={onFilters}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Abrir filtros"
            style={({ pressed }) => [
              styles.headerBtn,
              activeCount > 0 && styles.headerBtnActive,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Filter color={activeCount > 0 ? P.green : P.textDim} size={16} strokeWidth={2} />
            {activeCount > 0 ? (
              <View style={styles.headerBadge}>
                <Text style={styles.headerBadgeText}>{activeCount}</Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
```

En el `StyleSheet.create` de `PartidosScreen.js`, reemplazar:

```js
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brand: { fontSize: 18, fontWeight: '700', color: P.text, letterSpacing: -0.4 },
```

por:

```js
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
```

No tocar el import de `MapPin` (sigue usándose en otras partes del archivo, líneas 447, 629 y 680).

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `node --test src/components/__tests__/headerBrand.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: 0 errores.

- [ ] **Step 6: Commit**

```bash
git add src/screens/PartidosScreen.js src/components/__tests__/headerBrand.test.js
git commit -m "feat(partidos): el header usa BrandMark y agrega el bell junto al filtro"
```

---

### Task 5: Perfil (propio) gana el bell

**Files:**
- Modify: `src/components/player/PlayerProfileTopBar.js`
- Modify: `src/components/__tests__/headerBrand.test.js`

**Interfaces:**
- Consumes: `NotificationBell` (sin cambios). No usa `BrandMark` — Perfil mantiene su título de texto (fuera de alcance del logo, ver spec).

- [ ] **Step 1: Extender la prueba (roja para este archivo)**

Agregar al final de `src/components/__tests__/headerBrand.test.js`:

```js
test('Perfil (PlayerProfileTopBar) tiene el bell solo en la rama de perfil propio', () => {
  const src = readSrc('../player/PlayerProfileTopBar.js');
  assert.match(src, /<NotificationBell\s*\/>/, 'PlayerProfileTopBar debe renderizar <NotificationBell/>');
  const ownProfileBranch = src.split('isOwnProfile ?')[1] || '';
  assert.match(
    ownProfileBranch,
    /<NotificationBell\s*\/>/,
    'el bell debe estar dentro de la rama isOwnProfile (perfil propio)'
  );
});
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `node --test src/components/__tests__/headerBrand.test.js`
Expected: FAIL — el quinto test falla (`PlayerProfileTopBar.js` todavía no importa `NotificationBell`).

- [ ] **Step 3: Agregar el bell en `PlayerProfileTopBar.js`**

Agregar el import (después de `import { dsColors, dsRadius, dsSizes } from '../../theme/colors';`):

```jsx
import NotificationBell from '../NotificationBell';
```

Reemplazar:

```jsx
      {isOwnProfile ? (
        <>
          {/* Sin sesión activa no hay nada que editar ni configurar. */}
          {onEdit && (
            <Pressable
              onPress={onEdit}
              accessibilityRole="button"
              accessibilityLabel="Editar mi perfil"
              style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
            >
              <Pencil color={dsColors.textPrimary} size={15} strokeWidth={2} />
              <Text style={styles.editLabel}>Editar</Text>
            </Pressable>
          )}
          {onSettings && (
            <Pressable
              onPress={onSettings}
              accessibilityRole="button"
              accessibilityLabel="Configuración"
              style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            >
              <Settings color={dsColors.textPrimary} size={17} strokeWidth={1.9} />
            </Pressable>
          )}
        </>
      ) : (
```

por:

```jsx
      {isOwnProfile ? (
        <>
          {/* Sin sesión activa no hay nada que editar ni configurar. */}
          {onEdit && (
            <Pressable
              onPress={onEdit}
              accessibilityRole="button"
              accessibilityLabel="Editar mi perfil"
              style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
            >
              <Pencil color={dsColors.textPrimary} size={15} strokeWidth={2} />
              <Text style={styles.editLabel}>Editar</Text>
            </Pressable>
          )}
          {onSettings && (
            <Pressable
              onPress={onSettings}
              accessibilityRole="button"
              accessibilityLabel="Configuración"
              style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            >
              <Settings color={dsColors.textPrimary} size={17} strokeWidth={1.9} />
            </Pressable>
          )}
          <NotificationBell />
        </>
      ) : (
```

No tocar la rama `!isOwnProfile` (perfil ajeno) — el `bar` ya tiene `gap: 8`, así que no hace falta margen manual.

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `node --test src/components/__tests__/headerBrand.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: 0 errores.

- [ ] **Step 6: Commit**

```bash
git add src/components/player/PlayerProfileTopBar.js src/components/__tests__/headerBrand.test.js
git commit -m "feat(perfil): agrega el bell de avisos al perfil propio"
```

---

### Task 6: Clubes (sin club) gana el bell

**Files:**
- Modify: `src/components/club/ClubExplorer.js`
- Modify: `src/components/__tests__/headerBrand.test.js`

**Interfaces:**
- Consumes: `NotificationBell` (sin cambios). Reutiliza la prop existente `showBackButton` (ya distingue "soy la raíz de la pestaña Clubes" de "me empujaron sobre el stack").

- [ ] **Step 1: Extender la prueba (roja para este archivo)**

Agregar al final de `src/components/__tests__/headerBrand.test.js`:

```js
test('Clubes (ClubExplorer) tiene el bell solo cuando actúa como raíz de pestaña (!showBackButton)', () => {
  const src = readSrc('../club/ClubExplorer.js');
  assert.match(src, /<NotificationBell\s*\/>/, 'ClubExplorer debe renderizar <NotificationBell/>');
  assert.match(
    src,
    /!showBackButton\s*&&\s*<NotificationBell\s*\/>/,
    'el bell debe estar condicionado a !showBackButton, para no aparecer cuando se empuja sobre el stack'
  );
});
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `node --test src/components/__tests__/headerBrand.test.js`
Expected: FAIL — el sexto test falla.

- [ ] **Step 3: Agregar el bell en `ClubExplorer.js`**

Agregar el import (después de `import ClubExplorerCard from './ClubExplorerCard';`):

```jsx
import NotificationBell from '../NotificationBell';
```

Reemplazar:

```jsx
              {showBackButton && (
                <Pressable
                  onPress={onBack}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Volver"
                  style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
                >
                  <ArrowLeft color={CE.textPrimary} size={20} strokeWidth={2.2} />
                </Pressable>
              )}

              <Text style={styles.title}>Clubes</Text>
```

por:

```jsx
              <View style={styles.topRow}>
                {showBackButton ? (
                  <Pressable
                    onPress={onBack}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Volver"
                    style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
                  >
                    <ArrowLeft color={CE.textPrimary} size={20} strokeWidth={2.2} />
                  </Pressable>
                ) : (
                  <View style={styles.topRowSpacer} />
                )}
                {!showBackButton && <NotificationBell />}
              </View>

              <Text style={styles.title}>Clubes</Text>
```

En el `StyleSheet.create`, reemplazar:

```js
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CE.surface,
    borderWidth: 1,
    borderColor: CE.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
```

por:

```js
  topRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 8 },
  topRowSpacer: { flex: 1 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CE.surface,
    borderWidth: 1,
    borderColor: CE.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
```

(El margen vertical pasa de `backBtn` a `topRow`, para que quede igual haya o no botón atrás.)

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `node --test src/components/__tests__/headerBrand.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: 0 errores.

- [ ] **Step 6: Commit**

```bash
git add src/components/club/ClubExplorer.js src/components/__tests__/headerBrand.test.js
git commit -m "feat(clubes): agrega el bell de avisos al explorador cuando es raíz de pestaña"
```

---

### Task 7: Verificación completa y chequeo visual

**Files:** ninguno nuevo — solo verificación.

- [ ] **Step 1: Suite completa**

Run: `npm run verify`
Expected: `lint` con 0 errores (los warnings preexistentes no bloquean) y todos los tests en verde, incluidos los 6 de `headerBrand.test.js`.

- [ ] **Step 2: Levantar la app web**

Run: `npm run web` (en background si la sesión lo permite).
Expected: Metro sirve en `http://localhost:8081` sin errores de compilación.

- [ ] **Step 3: Chequeo visual — ancho móvil (~390px)**

Con el skill `run` (o la herramienta de captura disponible), en el navegador redimensionado a ~390px de ancho, recorrer y capturar el header de las 6 pestañas:
- Home: logo (pin+wordmark) idéntico a Chat/Partidos, bell presente.
- Partidos: logo idéntico, bell junto al filtro, ambos íconos usables.
- Clubes, sin club (crear una cuenta sin club o usar una que no tenga): título "Clubes", bell presente arriba a la derecha.
- Clubes, con club ("Mi club"): título "Mi club", **sin** bell.
- Reservas: título "Reservas", bell presente (sin cambios, confirmar que sigue igual).
- Chat: logo idéntico, bell junto al botón de amigos, ambos con su badge si corresponde.
- Perfil (propio): bell presente junto a Configuración.
- Perfil ajeno (abrir el perfil de otro jugador): confirmar que **no** aparece el bell.

Expected: logo pixel-idéntico en Home/Partidos/Chat; bell presente en las 5 pantallas correspondientes + Reservas; ausente en "Mi club" y perfil ajeno; ningún header con el botón duplicado; back button y demás acciones existentes intactos.

- [ ] **Step 4: Chequeo visual — ancho de escritorio (~1280px)**

Repetir el recorrido del Step 3 con el navegador en ~1280px de ancho. Confirmar que el layout no se rompe (los componentes no usan unidades relativas al viewport que puedan reflotar mal) y que los tamaños táctiles/spacing se mantienen (no deben crecer ni encogerse: `BrandMark` y `NotificationBell` no exponen prop de tamaño).

- [ ] **Step 5: Si algo falla en el chequeo visual**

Volver al task correspondiente de este plan, corregir el archivo puntual (no reabrir tasks ya cerradas salvo el archivo con el problema), repetir Steps 4-5 de ese task (test + lint) y commitear la corrección.

- [ ] **Step 6: Push**

```bash
git push
```

Expected: los 6 commits de este plan (Tasks 1-6) quedan en `origin/main`.
