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

**Deployment:** Web is deployed on Vercel (`vercel.json` builds via `expo export`, outputs to `dist/`, SPA rewrite rules included). Native builds use EAS (project ID `254ce906-c402-456b-80df-8e060a10b09b`).

### Navigation structure

```
RootStack (AppNavigator.js)
├── Onboarding: Welcome → Login → Verification → LocationPermission → Terms → Success
├── Main ← BottomTabs
│   ├── HomeTab       (nearby matches, upcoming)
│   ├── SearchTab     (advanced search + map)
│   ├── ClubsTab      (club discovery & membership)
│   ├── CreateTab*    (placeholder — triggers CreateMatch modal)
│   ├── NotificationsTab (inbox, realtime badge)
│   ├── ChatTab       (conversation threads)
│   └── ProfileTab    (profile, settings)
└── Modals (slide_from_bottom or slide_from_right):
    CreateMatch, EditMatch, MatchDetail, RateMatch,
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
- **`friends.js`**, **`ratings.js`**, **`profile.js`**, **`storage.js`**, **`gallery.js`**, **`canchas.js`** — supporting services

### Database (Supabase)

Schema is in `supabase/schema.sql` (idempotent, safe to re-run). Incremental migrations are in `supabase/migrations/` (01–24).

Core tables:
- `profiles` — 1:1 with `auth.users`; auto-created by `handle_new_user` trigger; tracks `trust_score` (0–100), `partidos_jugados`, `posicion_preferida[]`, `region`, `comuna`
- `matches` — lat/lng stored as plain numerics (no PostGIS); `estado` ∈ {abierto, lleno, en_curso, finalizado, cancelado}; `aprobacion` ∈ {inmediata, manual}; `min_trust_score` gates who can join
- `attendees` — join table `matches↔profiles`; `estado` ∈ {inscrito, confirmado_gps, no_asistio, cancelado}
- `messages` — chat messages with `thread_key` field; Realtime enabled
- `push_tokens` — one row per device per user
- `notifications` — in-app inbox; Realtime subscription used for live badge count
- `clubs` — club groups; `plan` ∈ {estandar, premium}
- `club_members` / `profiles_clubs` — club membership join tables with `role` ∈ {admin, member}
- `chat_hides` — per-user thread visibility (`user_id`, `thread_key`, `hidden_at`)
- `user_settings` — per-user preferences (`search_radius_km`, notification toggles)

Business logic lives in Postgres RPCs (called via `supabase.rpc()`):
- `join_match` / `leave_match` / `leave_match_penalized` / `cancel_match` — atomic slot management with trust-score side-effects
- `swap_match` / `cancel_match_and_join` — compound operations
- `request_join` / `approve_join` / `reject_join` — manual-approval flow
- `confirm_attendance_gps` — validates distance (200 m) + time window, updates trust score
- `get_schedule_conflict` — checks time conflicts before joining
- `haversine_meters` — Postgres-side distance calculation used by GPS RPCs

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
