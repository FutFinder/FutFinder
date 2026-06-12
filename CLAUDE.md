# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Architecture

**Stack:** Expo SDK 54 (React Native + web via Metro), Supabase (Postgres + Auth + Realtime + Edge Functions), React Navigation v7, Lucide icons.

**Deployment:** Web is deployed on Vercel. Native builds use EAS (project ID `254ce906-c402-456b-80df-8e060a10b09b`).

### Navigation structure

```
RootStack (AppNavigator.js)
├── Welcome / Login / Verification / LocationPermission / Terms / Success  ← onboarding
├── Main  ← BottomTabs (HomeTab, SearchTab, CreateTab*, ChatTab, ProfileTab)
├── CreateMatch / EditProfile  ← slide_from_bottom modal-style
├── ChatThread / UserProfile / MatchDetail / Notifications / RateMatch  ← slide_from_right
└── RateMatch  ← slide_from_bottom
```

`CreateTab` is a placeholder — pressing it bypasses tab navigation and pushes `CreateMatch` onto the root stack so the tab bar hides.

`navigationRef` in `AppNavigator.js` is exported for imperative navigation from push notification handlers in `App.js`.

### Services layer (`src/services/`)

Each service file wraps Supabase calls and exports async functions. They all guard against missing config with `if (!isSupabaseConfigured) return ...` so the UI works without a `.env`.

Key services:
- **`supabase.js`** — singleton Supabase client; exports `isSupabaseConfigured` flag
- **`auth.js`** — email/password auth; `signInOrUp` tries login then auto-registers if user doesn't exist; OTP verification flow
- **`matches.js`** — CRUD for matches; `joinMatch` / `leaveMatch` / `swapMatch` call Postgres RPCs for atomic slot management; `applyFilters` does client-side filtering/distance calc
- **`attendance.js`** — `confirmAttendanceWithGPS` reads device GPS and calls `confirm_attendance_gps` RPC (validates 200m radius + time window)
- **`messages.js`** — Realtime chat; thread types: `dm:<userId>` (1-to-1) and `match:<matchId>` (group); `chat_hides` table controls per-user visibility
- **`notifications.js`** — Expo push tokens stored in `push_tokens` table; in-app notification inbox via `notifications` table with Realtime subscription; push notifications only work on physical devices (not simulators or web)
- **`friends.js`**, **`ratings.js`**, **`profile.js`**, **`storage.js`**, **`canchas.js`** — supporting services

### Database (Supabase)

Schema is in `supabase/schema.sql` (idempotent, safe to re-run). Incremental migrations are in `supabase/migrations/`.

Core tables:
- `profiles` — 1:1 with `auth.users`; auto-created by `handle_new_user` trigger; tracks `trust_score` (0–100), `partidos_jugados`, `posicion_preferida[]`
- `matches` — lat/lng stored as plain numerics (no PostGIS); `estado` ∈ {abierto, lleno, en_curso, finalizado, cancelado}; `aprobacion` ∈ {inmediata, manual}; `min_trust_score` gates who can join
- `attendees` — join table `matches↔profiles`; `estado` ∈ {inscrito, confirmado_gps, no_asistio, cancelado}
- `messages` — chat messages with `thread_key` field; Realtime enabled
- `push_tokens` — one row per device per user
- `notifications` — in-app inbox; Realtime subscription used for live badge

Business logic lives in Postgres RPCs (called via `supabase.rpc()`):
- `join_match` / `leave_match` / `leave_match_penalized` / `cancel_match` — atomic slot management with trust-score side-effects
- `swap_match` / `cancel_match_and_join` — compound operations
- `request_join` / `approve_join` / `reject_join` — manual-approval flow
- `confirm_attendance_gps` — validates distance + time window, updates trust score
- `get_schedule_conflict` — checks if user has a time conflict before joining

### Platform-specific components

`MatchMap.native.js` and `MatchMap.web.js` — React Native's platform extension system is used here. `.native.js` uses `react-native-maps` (MapView + custom dark Google Maps style). `.web.js` is a fallback. Import as `./MatchMap` and Metro resolves the right file.

### Theme

`src/theme/colors.js` exports `colors`, `fonts`, `radius`, `spacing`. Always import from this file rather than hardcoding values. Background `#201F1D`, primary green `#71B533`.

### Demo mode

`isSupabaseConfigured` (from `src/services/supabase.js`) is `false` when env vars are missing. Every service function checks this and returns static demo data so screens render without a backend. `getDemoMatches()` in `matches.js` provides sample data.
