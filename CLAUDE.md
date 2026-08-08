# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Resumen del proyecto

FutFinder es una app para buscar, crear y completar partidos de fútbol amateur, con foco en Santiago/Chile (toda la interfaz está en español chileno — ver "UI language" más abajo). Además de partidos, incluye un sistema de clubes (membresías, planes, desafíos entre clubes), chat en tiempo real, perfiles de jugador con reputación (trust score), amigos y calificaciones post-partido.

Nota: el `README.md` de la raíz está desactualizado (dice "Expo SDK 52" y solo documenta la estructura inicial del proyecto). La versión real es Expo SDK 54 (ver `package.json`) y la arquitectura actual es mucho más amplia que lo que describe el README — usar este `CLAUDE.md` como fuente de verdad, no el README.

## ⚠️ Regla esencial: sincronización Git (trabajo desde 2 Macs)

Este proyecto se trabaja desde dos computadoras distintas (2 Macs), por lo que es **obligatorio** mantener el repositorio sincronizado en todo momento para evitar conflictos y sobrescribir trabajo del otro. Aplica esta regla en cada tarea que involucre tocar archivos del repo, no solo cuando se te pida explícitamente.

### Antes de empezar a trabajar

1. Ejecutar siempre `git pull` antes de tocar cualquier archivo.

   ```bash
   git pull
   ```

2. Nunca empezar a editar código sin haber sincronizado primero.

### Al terminar los cambios

1. Revisar qué archivos cambiaron:

   ```bash
   git status
   ```

2. Agregar los cambios:

   ```bash
   git add .
   ```

3. Commit con mensaje descriptivo (qué se hizo y por qué, no solo "cambios"):

   ```bash
   git commit -m "mensaje descriptivo del cambio"
   ```

4. Subir los cambios de inmediato, no dejar commits sin subir al final de la sesión:

   ```bash
   git push
   ```

### Si hay conflictos

- Si `git pull` genera conflictos, no resolverlos automáticamente sin avisar.
- Detenerse y comunicar al otro desarrollador antes de decidir cómo resolver el conflicto.
- Preferir hablarlo (mensaje/llamada) antes de hacer `git push --force` o similar — nunca forzar un push sin confirmación explícita.

### Flujo resumido

```bash
git pull                      # 1. Sincronizar antes de trabajar
# ... hacer cambios ...
git add .                     # 2. Agregar cambios
git commit -m "mensaje"       # 3. Commitear
git push                      # 4. Subir de inmediato
```

### Notas adicionales

- Si vas a trabajar en algo que puede tardar varias horas o días, considera crear una rama (`git checkout -b nombre-rama`) para evitar bloquear al otro en `main`.
- Antes de cambiar de Mac, asegúrate de haber hecho `push` de todo tu trabajo.
- Al llegar a la otra Mac, lo primero siempre es `git pull`.

## Commands

```bash
npm install          # install deps (first time)
npm run web          # dev server in browser (primary dev workflow)
npm run ios          # run on iOS simulator
npm run android      # run on Android emulator
npm run build:web    # production web build (used by Vercel)
```

There are no automated tests in this project.

## Environment setup

Copy `.env.example` to `.env` and fill in both values:
```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

All env vars must have the `EXPO_PUBLIC_` prefix for Expo to inject them into the client bundle. If these are missing, the app runs in "demo mode" — most service functions return mock data instead of hitting Supabase.

### Firebase / push notifications en Android (`google-services.json`)

`android.googleServicesFile` en `app.config.js` (antes `app.json`) apunta a
`process.env.GOOGLE_SERVICES_JSON`, con fallback a `./google-services.json`
en el root del proyecto. **Ese archivo nunca se sube a Git** (está en
`.gitignore` junto con `GoogleService-Info.plist`) porque contiene
credenciales reales del proyecto de Firebase — no existe un archivo de
ejemplo ni ficticio en el repo a propósito.

⚠️ **Pendiente, fuera del repo — hay que hacerlo una vez, manualmente:**

1. En la [Firebase Console](https://console.firebase.google.com/), dentro
   del proyecto de FutFinder, registrar (o ubicar) la app Android con
   package `com.futfinder.app` y descargar su `google-services.json`.
2. Para desarrollo/build local: guardar ese archivo como
   `./google-services.json` en la raíz del repo (queda ignorado por Git).
3. Para EAS Build (donde no hay filesystem local persistente): subirlo como
   secreto de tipo **file** del proyecto EAS —
   ```bash
   eas secret:create --scope project --type file \
     --name GOOGLE_SERVICES_JSON --value ./google-services.json
   ```
   EAS inyecta este secreto como la variable de entorno
   `GOOGLE_SERVICES_JSON` durante el build, con el valor apuntando a la
   ruta local (en el worker de EAS) del archivo ya descifrado — por eso
   `app.config.js` lo lee como una ruta de archivo, no como contenido.

Sin este paso, cualquier intento de build nativo de Android (`eas build
--platform android`, o un `expo prebuild` local) fallará al no encontrar el
archivo en la ruta configurada — es el comportamiento esperado: no se creó
un `google-services.json` ficticio para evitarlo. Esto no afecta ni al
bundle web ni a Expo Go, donde este campo no se usa.

## Architecture

**Stack:** Expo SDK 54 (React Native + web via Metro), Supabase (Postgres + Auth + Realtime + Edge Functions), React Navigation v7, Lucide icons.

**Deployment:** Web is deployed on Vercel (`vercel.json` builds via `expo export`, outputs to `dist/`, SPA rewrite rules included). Native builds use EAS (project ID `254ce906-c402-456b-80df-8e060a10b09b`).

### Navigation structure

```
RootStack (AppNavigator.js)
├── Onboarding: Welcome → Login → Verification → LocationPermission → Terms → Success
├── Main ← BottomTabs
│   ├── HomeTab       (nearby matches, upcoming)
│   ├── SearchTab     (PartidosScreen — descubrir partidos + buscar jugadores)
│   ├── ClubsTab      (club discovery & membership)
│   ├── CreateTab*    (placeholder — triggers CreateMatch modal)
│   ├── NotificationsTab (inbox, realtime badge)
│   ├── ChatTab       (conversation threads)
│   └── ProfileTab    (profile, settings)
└── Modals (slide_from_bottom or slide_from_right):
    CreateMatch (wizard de 3 pasos), EditMatch, ManageMatch,
    MatchDetail, MatchSpot, MatchRequestStatus, RateMatch,
    ChatThread, UserProfile, Notifications, Settings, TrustScoreHistory,
    ClubDetail, ExploreClubs, CreateClub, EditClub, ClubInvite
```

`CreateTab` is a placeholder — pressing it bypasses tab navigation and pushes `CreateMatch` onto the root stack so the tab bar hides.

`navigationRef` in `AppNavigator.js` is exported for imperative navigation from push notification handlers in `App.js`.

### Services layer (`src/services/`)

Each service file wraps Supabase calls and exports async functions. They all guard against missing config with `if (!isSupabaseConfigured) return ...` so the UI works without a `.env`.

Key services:
- **`supabase.js`** — singleton Supabase client; exports `isSupabaseConfigured` flag
- **`auth.js`** — email/password auth; `signInOrUp` tries login then auto-registers if user doesn't exist; OTP verification flow; `registerForPushNotifications` / `unregisterPushToken` called on login/logout
- **`matches.js`** — CRUD for matches; `joinMatch` / `leaveMatch` / `swapMatch` call Postgres RPCs for atomic slot management; `applyFilters` does client-side filtering/distance calc using `haversineKm()`
- **`attendance.js`** — `confirmAttendanceWithGPS` reads device GPS and calls `confirm_attendance_gps` RPC (validates 200 m radius + time window, updates trust score)
- **`messages.js`** — Realtime chat; three thread types: `dm:<userId>` (1-to-1), `match:<matchId>` (group), `club:<clubId>` (club group); `chat_hides` table controls per-user visibility
- **`notifications.js`** — Expo push tokens stored in `push_tokens` table; in-app inbox via `notifications` table with Realtime subscription; push notifications only work on physical devices (not simulators or web)
- **`clubs.js`** — Club CRUD, membership management; plans: `estandar` (15 members, 1 admin) / `premium` (26 members, 3 admins); users belong to at most 1 club; club logo uploads via `storage.js`
- **`settings.js`** — User preferences (`search_radius_km`, email notification flags) stored in `user_settings` table
- **`friends.js`** — friend requests/list management
- **`ratings.js`** — post-match player ratings
- **`profile.js`** — profile read/update, position preferences
- **`storage.js`** — Supabase Storage uploads (avatars, club logos, gallery images)
- **`gallery.js`** — user photo gallery
- **`canchas.js`** — venue/field lookup helpers
- **`clubMatches.js`** — matches organized under a club context
- **`clubChallenges.js`** — challenge (desafío) flow between clubs
- **`reports.js`** — player/content reporting
- **`location.js`** — geolocation helpers used alongside `data/comunas-coords.js` and `data/regiones-chile.js` (static Chile region/comuna data)
- **`playerDemo.js`** — demo-mode sample player data

### Screens y componentes

`src/screens/` tiene ~30 pantallas cubriendo onboarding/auth, partidos (crear, buscar, detalle, calificar), clubes (crear, editar, explorar, detalle, miembros, galería, desafíos), chat (inbox, hilo, detalles) y perfil (editar, historial de trust score, amigos, ajustes).

`src/components/` está organizado por dominio en subcarpetas: `chat/` (composer, burbujas de mensaje, avatares, pills de filtro), `club/` (hero card, galería, badges de plan, historial, tarjetas de club rival), `player/` (hero card, estadísticas, reputación, galería, reporte de jugador), `home/` (tarjetas de partido, club propio, trust score) y `ds/` (mini design system: section header, empty state, tag badge). Componentes de nivel superior (`Button.js`, `Logo.js`, `LocationAutocomplete.js`, `MatchPreviewSheet.js`, etc.) son de uso general.

### Módulo Partidos (rediseño, handoff `Partidos.dc.html`)

El módulo completo vive separado del resto para no arrastrar la estética antigua:

- **`services/matchRules.js`** — única fuente de verdad de las reglas: ventana sin penalización, penalizaciones de Trust Score, minutos para confirmar desde la lista de espera, radio GPS, plazo de asistencia, límites de cupos, presets de edad/nivel/duración/Trust. También expone `getBlockReason()` y `getCtaState()`, que deciden qué CTA se muestra y por qué un jugador está bloqueado. **Ningún componente debe volver a escribir uno de estos números.** Su espejo en Postgres es la función `partido_reglas()` (migración 33).
- **`services/connectivity.js`** — estado de red (heurística: `navigator.onLine` + fallos de fetch, porque el proyecto no trae NetInfo) y caché de lectura en AsyncStorage para el modo sin conexión.
- **`components/partidos/`** — sistema visual del módulo: `ui.js` (botones ≥48 px, pills, celdas, radios, stepper, toggles, notas), `Sheet.js` (bottom sheet base), `PickerSheet.js`, `FiltersSheet.js`, `DateTimeSheets.js` (selectores propios de fecha/hora, sin dependencias nuevas), `ShareSheet.js`, `PartidoCard.js` y `StateViews.js` (loading, error, offline, sin ubicación y dos vacíos distintos).
- **Pantallas** — `PartidosScreen` (descubrir), `MatchDetailScreen` (detalle + CTA sticky), `PublishMatchScreen` (wizard 3 pasos + éxito), `EditMatchScreen` (formulario único), `ManageMatchScreen` (solicitudes / confirmados / asistencia + cancelación), `MatchRequestStatusScreen` y `MatchSpotScreen`.
- **Tokens** — `partidos` y `partidosRadius` en `theme/colors.js`. No usar `colors` (paleta global) en este módulo.

Deep links: `NavigationContainer` tiene `linking` configurado, así que los enlaces que genera «Compartir» (`futfinder.cl/p/<id>`) abren el detalle del partido.

### Database (Supabase)

Schema is in `supabase/schema.sql` (idempotent, safe to re-run). Incremental migrations are in `supabase/migrations/` (01–24).

Core tables:
- `profiles` — 1:1 with `auth.users`; auto-created by `handle_new_user` trigger; tracks `trust_score` (0–100), `partidos_jugados`, `posicion_preferida[]`, `region`, `comuna`
- `matches` — lat/lng stored as plain numerics (no PostGIS); `estado` ∈ {abierto, lleno, en_curso, finalizado, cancelado}; `aprobacion` ∈ {inmediata, manual}; `min_trust_score` gates who can join. Migración 33 agrega `modalidad` ∈ {futbol7, futbol11}, `edad_min`/`edad_max`, `recordatorio_1h`, `pedir_asistencia`, `motivo_cancelacion` y `client_token` (publicación idempotente)
- `attendees` — join table `matches↔profiles`; `estado` ∈ {pendiente, inscrito, confirmado_gps, no_asistio, cancelado} (`pendiente` = solicitud de aprobación manual, no reserva cupo)
- `messages` — chat messages with `thread_key` field; Realtime enabled
- `push_tokens` — one row per device per user
- `notifications` — in-app inbox; Realtime subscription used for live badge count
- `clubs` — club groups; `plan` ∈ {estandar, premium}
- `club_members` / `profiles_clubs` — club membership join tables with `role` ∈ {admin, member}
- `match_waitlist` — lista de espera de un partido lleno, en orden de llegada; salir nunca afecta el Trust Score (migración 33)
- `chat_hides` — per-user thread visibility (`user_id`, `thread_key`, `hidden_at`)
- `user_settings` — per-user preferences (`search_radius_km`, notification toggles)

Business logic lives in Postgres RPCs (called via `supabase.rpc()`):
- `join_match` / `leave_match` / `leave_match_penalized` / `cancel_match` — atomic slot management with trust-score side-effects
- `swap_match` / `cancel_match_and_join` — compound operations
- `request_join` / `approve_join` / `reject_join` — manual-approval flow
- `confirm_attendance_gps` — validates distance (200 m) + time window, updates trust score
- `get_schedule_conflict` — checks time conflicts before joining
- `haversine_meters` — Postgres-side distance calculation used by GPS RPCs
- `join_waitlist` / `leave_waitlist` — lista de espera; un trigger avisa al primero de la cola cuando se libera un cupo
- `save_match_attendance` — el organizador registra presentes/ausentes; aplica el efecto en el Trust Score una sola vez por jugador
- `partido_reglas()` — reglas del módulo Partidos en JSON (espejo de `services/matchRules.js`)

⚠️ Las RPC `request_join`, `approve_join`, `reject_join`, `leave_match_penalized`, `cancel_match`, `swap_match`, `cancel_match_and_join` y `get_schedule_conflict` se habían aplicado a mano en Supabase sin quedar versionadas. La migración 33 las versiona, pero **solo las crea si no existen** (`to_regprocedure(...) is null`), para no pisar la versión que ya esté corriendo.

### Trust score system

Trust score (0–100) is the central reputation mechanism. It changes on:
- Joining/leaving matches (slot RPCs apply penalties for last-minute cancellations)
- GPS attendance confirmation (`confirm_attendance_gps` rewards verified presence)
- No-shows and repeated cancellations (penalties)

`min_trust_score` on a match gates which players can join. Score history is tracked in its own table and visible via `TrustScoreHistory` screen.

### Platform-specific components

`MatchMap.native.js` and `MatchMap.web.js` — Metro's platform extension system resolves the right file when imported as `./MatchMap`. The `.native.js` version uses `react-native-maps` with a dark Google Maps style; `.web.js` is a fallback.

### Theme

`src/theme/colors.js` exports `colors`, `fonts`, `radius`, `spacing`. Always import from this file rather than hardcoding values. Background `#201F1D`, primary green `#71B533`.

### Demo mode

`isSupabaseConfigured` (from `src/services/supabase.js`) is `false` when env vars are missing. Every service function checks this and returns static demo data so screens render without a backend. `getDemoMatches()` in `matches.js` provides sample data.

### UI language

All user-facing text, labels, and error messages are in Spanish (Chile locale).
