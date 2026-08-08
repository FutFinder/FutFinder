# FutFinder Obsidian Project Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert FutFinder's oversized automatic context into a complete modular Markdown memory that is readable in Obsidian and selectively loaded by Claude Code and Codex.

**Architecture:** `docs/memoria/00-inicio.md` is the only routing index. It maps each task domain to one primary note and only the direct dependency notes it may need. `CLAUDE.md` and `AGENTS.md` retain essential Git, safety, language, command, and routing rules but no longer embed the whole architecture.

**Tech Stack:** Markdown, Obsidian-compatible standard Markdown links, Git, Expo/React Native project metadata, Supabase migrations and services as documentation sources.

## Global Constraints

- The memory lives at `docs/memoria/` and contains text Markdown only; do not add images or videos.
- Use standard Markdown links, not Obsidian-only `[[wikilinks]]`.
- Do not add Obsidian plugins or commit `docs/memoria/.obsidian/`.
- Do not copy `.env`, tokens, API keys, private credentials, or user data into documentation.
- Verify time-sensitive claims against current code, migrations, configuration, and tests; do not blindly copy stale statements from `CLAUDE.md` or `README.md`.
- The authority order is deployed state when safely verified, then versioned code/configuration, then modular memory, then historical diagnostics.
- Agents must not read the whole vault by default.
- Update memory only for material behavior, architecture, database, shared design, deployment, or project-state changes.
- Preserve the mandatory two-Mac Git workflow: `git pull` before edits, descriptive commit, and immediate `git push` when complete.
- Keep all user-facing UI guidance in Spanish (Chile locale).

---

## File Structure

### Files to create

- `docs/memoria/00-inicio.md` — routing index and selective-reading contract.
- `docs/memoria/producto/vision-y-alcance.md` — product purpose, actors, and scope.
- `docs/memoria/producto/reglas-de-negocio.md` — cross-domain rules and trust score.
- `docs/memoria/arquitectura/stack-y-estructura.md` — current stack and repository map.
- `docs/memoria/arquitectura/navegacion.md` — route hierarchy, auth guard, and deep-link behavior.
- `docs/memoria/arquitectura/base-de-datos.md` — tables, RPCs, migrations, and Realtime.
- `docs/memoria/arquitectura/seguridad-y-privacidad.md` — authentication, RLS, privacy, and secrets.
- `docs/memoria/arquitectura/despliegue-y-entornos.md` — web, EAS, Firebase, Supabase, and demo mode.
- `docs/memoria/funcionalidades/autenticacion.md` — onboarding, login, session, and protected routes.
- `docs/memoria/funcionalidades/partidos.md` — discovery, creation, joining, attendance, and rules.
- `docs/memoria/funcionalidades/clubes.md` — membership, club discovery, plans, challenges, and permissions.
- `docs/memoria/funcionalidades/chat.md` — thread types, permissions, inbox, Realtime, and commands.
- `docs/memoria/funcionalidades/perfil-y-amigos.md` — profiles, media, gallery, reputation, ratings, and friendships.
- `docs/memoria/funcionalidades/avisos-y-push.md` — in-app inbox, preference gating, push delivery, and targets.
- `docs/memoria/funcionalidades/configuracion.md` — privacy and notification settings.
- `docs/memoria/diseno/sistema-visual.md` — theme tokens, design systems, copy, accessibility, and platform rules.
- `docs/memoria/operacion/estado-actual.md` — verified project state and current capabilities.
- `docs/memoria/operacion/pendientes.md` — unresolved, actionable work only.
- `docs/memoria/operacion/pruebas.md` — automated, SQL, build, and physical-device verification.
- `docs/memoria/decisiones/README.md` — decision-record format and index.

### Files to modify

- `CLAUDE.md` — replace the long encyclopedia with concise automatic rules and routing.
- `AGENTS.md` — remove the instruction to read all of `CLAUDE.md`; provide equivalent concise rules and routing for Codex.
- `.gitignore` — add `docs/memoria/.obsidian/`.
- `README.md` — add a short notice pointing to `docs/memoria/00-inicio.md` as current technical/product documentation.

### Interfaces between files

- `CLAUDE.md` and `AGENTS.md` consume only `docs/memoria/00-inicio.md` as the first documentation hop.
- `00-inicio.md` produces a routing table with exact relative Markdown links to every domain note.
- Domain notes consume architecture notes only through explicit related-document links.
- `operacion/estado-actual.md` records verified facts; `operacion/pendientes.md` records only unresolved work and never duplicates completed history.
- New decision records consume the template defined by `decisiones/README.md`: date, context, decision, consequences, and related notes.

---

### Task 1: Audit the current repository and build the memory foundation

**Files:**
- Create: `docs/memoria/00-inicio.md`
- Create: `docs/memoria/producto/vision-y-alcance.md`
- Create: `docs/memoria/producto/reglas-de-negocio.md`
- Create: `docs/memoria/arquitectura/stack-y-estructura.md`
- Create: `docs/memoria/arquitectura/despliegue-y-entornos.md`

**Interfaces:**
- Consumes: current `CLAUDE.md`, `package.json`, `app.config.js`, `.env.example`, `eas.json`, `vercel.json`, `src/`, `supabase/`, and recent Git history.
- Produces: the routing contract and verified product/stack/deployment facts used by every later task.

- [ ] **Step 1: Synchronize and capture a factual baseline**

Run:

```bash
git pull
git status --short
node -e "const p=require('./package.json'); console.log({version:p.version,scripts:p.scripts,expo:p.dependencies?.expo})"
find src/screens src/components src/services -maxdepth 2 -type f | sort
find supabase/migrations -maxdepth 1 -type f | sort
git log -20 --oneline
```

Expected: `git pull` reports current state, `git status --short` is empty, and the remaining commands expose the current repository rather than the stale counts in `CLAUDE.md`.

- [ ] **Step 2: Create the routing index with exact reading rules**

Create `docs/memoria/00-inicio.md` with these sections:

```markdown
# Memoria de FutFinder

Última revisión: 2026-08-08

## Cómo usar esta memoria
- Clasifica la tarea antes de leer documentación.
- Lee la nota principal del dominio y solo las dependencias directas indicadas.
- No leas toda la bóveda por defecto.
- Verifica datos sensibles al tiempo contra el código y las migraciones.

## Enrutamiento por tarea
| Tarea | Leer primero | Dependencias solo si aplican |
|---|---|---|
| Sesión, login, rutas privadas | [Autenticación](funcionalidades/autenticacion.md) | [Navegación](arquitectura/navegacion.md), [Seguridad](arquitectura/seguridad-y-privacidad.md) |
| Partidos | [Partidos](funcionalidades/partidos.md) | [Reglas de negocio](producto/reglas-de-negocio.md), [Base de datos](arquitectura/base-de-datos.md), [Sistema visual](diseno/sistema-visual.md) |
| Clubes | [Clubes](funcionalidades/clubes.md) | [Base de datos](arquitectura/base-de-datos.md), [Sistema visual](diseno/sistema-visual.md) |
| Chat | [Chat](funcionalidades/chat.md) | [Seguridad](arquitectura/seguridad-y-privacidad.md), [Base de datos](arquitectura/base-de-datos.md) |
| Perfil o amigos | [Perfil y amigos](funcionalidades/perfil-y-amigos.md) | [Seguridad](arquitectura/seguridad-y-privacidad.md), [Sistema visual](diseno/sistema-visual.md) |
| Avisos o push | [Avisos y push](funcionalidades/avisos-y-push.md) | [Configuración](funcionalidades/configuracion.md), [Despliegue](arquitectura/despliegue-y-entornos.md) |
| Privacidad o ajustes | [Configuración](funcionalidades/configuracion.md) | [Seguridad](arquitectura/seguridad-y-privacidad.md) |
| Arquitectura general | [Stack y estructura](arquitectura/stack-y-estructura.md) | La nota específica afectada |
| Estado, pendientes o pruebas | [Estado actual](operacion/estado-actual.md) | [Pendientes](operacion/pendientes.md), [Pruebas](operacion/pruebas.md) |

## Política de actualización
Actualiza la nota afectada cuando cambie comportamiento visible, una regla de negocio, navegación, arquitectura, base de datos, RLS, una Edge Function, la interfaz pública de un servicio o componente compartido, una convención visual global, dependencias, entorno, despliegue o el estado de un problema importante. No actualices la memoria por ortografía, formato, refactorizaciones internas sin cambio de comportamiento ni resultados temporales de una sesión.

## Fuente de verdad
1. Estado real desplegado, cuando pueda comprobarse de forma segura.
2. Código, migraciones y configuración versionados.
3. Memoria modular.
4. Diagnósticos e historiales antiguos.
```

- [ ] **Step 3: Write product notes without implementation duplication**

Create:

```text
docs/memoria/producto/vision-y-alcance.md
docs/memoria/producto/reglas-de-negocio.md
```

`vision-y-alcance.md` must state the amateur-football purpose, Chilean Spanish UI, players/organizers/club members/admin roles, core modules, and explicit non-goals only when verified. `reglas-de-negocio.md` must cover one-club-per-user, club plan limits, trust score, match states, attendance states, GPS attendance radius/time source, and waitlist behavior. Link detailed implementation to the relevant feature/architecture note instead of repeating it.

- [ ] **Step 4: Write verified stack and deployment notes**

`stack-y-estructura.md` must document Expo SDK and libraries from `package.json`, current source directories, platform-specific module resolution, and service boundaries. `despliegue-y-entornos.md` must document Vercel, EAS, Supabase configuration, demo mode, and the real `GOOGLE_SERVICES_JSON` workflow without embedding credentials.

Every note must include `Última revisión: 2026-08-08`, purpose, verified state, related code paths, known limitations, and related Markdown links.

- [ ] **Step 5: Verify Task 1 documentation**

Run:

```bash
find docs/memoria -type f | sort
rg -n 'Expo SDK 52|There are no automated tests|migrations/ \(01–24\)|TBD|TODO' docs/memoria
git diff --check
```

Expected: the five Task 1 files exist; the stale claims and placeholders produce no matches; `git diff --check` exits successfully.

- [ ] **Step 6: Commit the foundation**

```bash
git add docs/memoria/00-inicio.md docs/memoria/producto docs/memoria/arquitectura/stack-y-estructura.md docs/memoria/arquitectura/despliegue-y-entornos.md
git commit -m "docs: crea base modular de memoria FutFinder"
git push
```

---

### Task 2: Document architecture and domain behavior

**Files:**
- Create: `docs/memoria/arquitectura/navegacion.md`
- Create: `docs/memoria/arquitectura/base-de-datos.md`
- Create: `docs/memoria/arquitectura/seguridad-y-privacidad.md`
- Create: all seven files under `docs/memoria/funcionalidades/`

**Interfaces:**
- Consumes: Task 1 routing links and current navigation, services, migrations, Edge Functions, tests, and recent commits.
- Produces: one authoritative note per functional domain plus shared navigation/data/security references.

- [ ] **Step 1: Audit navigation, data, security, and domain entry points**

Run:

```bash
rg -n 'createNativeStackNavigator|createBottomTabNavigator|linking|withAuthGuard|SessionProvider|navigationRef' App.js src/navigation src/contexts
rg -n 'create table|create or replace function|create policy|alter table.*enable row level security' supabase/schema.sql supabase/migrations
find src/services supabase/functions -maxdepth 2 -type f | sort
find src/utils/__tests__ supabase/tests -type f | sort
```

Expected: each documented route, table, RPC, policy, service, and Edge Function has a current source path.

- [ ] **Step 2: Write shared architecture notes**

Create `navegacion.md`, `base-de-datos.md`, and `seguridad-y-privacidad.md` with focused responsibilities:

- `navegacion.md`: root stack/tabs, modal routes, auth guard, session-resolution state, deep links, push targets, and navigation source files.
- `base-de-datos.md`: current tables, RPCs, triggers, Realtime, migration convention, and warning not to edit already-applied migrations.
- `seguridad-y-privacidad.md`: auth boundary, RLS expectations, friend/chat restrictions, privacy settings enforcement, secret handling, and verified limitations.

Do not paste complete schemas or duplicate feature flows.

- [ ] **Step 3: Write authentication, Partidos, and Clubes notes**

Create:

```text
docs/memoria/funcionalidades/autenticacion.md
docs/memoria/funcionalidades/partidos.md
docs/memoria/funcionalidades/clubes.md
```

Each note must contain: purpose, current user flows, business rules, primary screens/components/services, backend dependencies, states/errors, permissions, known issues, related notes, and last-review date. Document the current protected-route implementation and current Clubes entry behavior from code, not from old screenshots or prompts.

- [ ] **Step 4: Write Chat, Perfil/Amigos, Avisos/Push, and Configuración notes**

Create:

```text
docs/memoria/funcionalidades/chat.md
docs/memoria/funcionalidades/perfil-y-amigos.md
docs/memoria/funcionalidades/avisos-y-push.md
docs/memoria/funcionalidades/configuracion.md
```

Document the post-fix state visible in migrations/tests and recent commits: chat RLS, mention-all behavior if present, inbox query path, staged/rollback profile media behavior, friend privacy, notification categories, preference-gated external push versus retained in-app notices, delivery state/receipts, and settings enforcement. Mark only genuinely unresolved items as known issues.

- [ ] **Step 5: Verify domain isolation and link targets**

Run:

```bash
for f in \
  docs/memoria/arquitectura/navegacion.md \
  docs/memoria/arquitectura/base-de-datos.md \
  docs/memoria/arquitectura/seguridad-y-privacidad.md \
  docs/memoria/funcionalidades/autenticacion.md \
  docs/memoria/funcionalidades/partidos.md \
  docs/memoria/funcionalidades/clubes.md \
  docs/memoria/funcionalidades/chat.md \
  docs/memoria/funcionalidades/perfil-y-amigos.md \
  docs/memoria/funcionalidades/avisos-y-push.md \
  docs/memoria/funcionalidades/configuracion.md; do test -f "$f" || exit 1; done
rg -n 'TBD|TODO|por definir|\.env=|service_role_key|sk-' docs/memoria
git diff --check
```

Expected: all files exist; placeholder/secret-pattern search produces no matches; diff check passes.

- [ ] **Step 6: Commit architecture and domain notes**

```bash
git add docs/memoria/arquitectura docs/memoria/funcionalidades
git commit -m "docs: documenta arquitectura y dominios de FutFinder"
git push
```

---

### Task 3: Add design, operations, and decision memory

**Files:**
- Create: `docs/memoria/diseno/sistema-visual.md`
- Create: `docs/memoria/operacion/estado-actual.md`
- Create: `docs/memoria/operacion/pendientes.md`
- Create: `docs/memoria/operacion/pruebas.md`
- Create: `docs/memoria/decisiones/README.md`

**Interfaces:**
- Consumes: theme/components, package scripts, tests, diagnostics only when verified, and the Task 1/2 notes.
- Produces: human-facing project status, verification commands, visual conventions, and the durable-decision format.

- [ ] **Step 1: Audit visual systems and verification surfaces**

Run:

```bash
sed -n '1,280p' src/theme/colors.js
find src/components/ds src/components/partidos src/components/club src/components/player -maxdepth 2 -type f | sort
node -e "const p=require('./package.json'); console.log(JSON.stringify(p.scripts,null,2))"
find src/utils/__tests__ supabase/tests supabase/functions -type f \( -name '*.test.js' -o -name '*.test.ts' -o -name '*_test.sql' \) | sort
git log -30 --oneline
```

Expected: visual and verification documentation is derived from current files and recent completed work.

- [ ] **Step 2: Write the text-only visual system note**

`sistema-visual.md` must document global tokens, the separate Partidos tokens, reusable component families, Spanish copy, minimum touch targets when defined, mobile/web differences, and the rule that task-specific screenshots remain external. Do not invent colors or dimensions absent from code.

- [ ] **Step 3: Write current state and pending work without historical noise**

`estado-actual.md` must summarize only verified capabilities and recently completed security/reliability work. `pendientes.md` must contain actionable unresolved items with priority, evidence, affected domain, and verification needed. Do not copy completed findings from the old diagnosis into pending work.

- [ ] **Step 4: Write the verification guide**

`pruebas.md` must include these exact project commands and their purpose:

```bash
npm test
npm run build:web
```

It must separately list SQL RLS tests, Edge Function tests, authenticated manual flows, and physical-device-only push validation. Never claim native push is validated by web tests.

- [ ] **Step 5: Write the durable decision format**

Create `decisiones/README.md` defining this exact record shape:

```markdown
# AAAA-MM-DD — Título de la decisión

## Contexto
Explica los hechos verificados que motivaron la decisión y las restricciones relevantes.

## Decisión
Describe la alternativa elegida de manera concreta y vigente.

## Consecuencias
Enumera beneficios, costos, riesgos y restricciones que deberán respetar tareas posteriores.

## Documentos relacionados
Incluye enlaces Markdown relativos a las notas de memoria afectadas.
```

The README must say to create a record only for durable decisions. A new record copies these headings and replaces the explanatory sentences with the facts of that decision.

- [ ] **Step 6: Verify and commit operational memory**

Run:

```bash
find docs/memoria/diseno docs/memoria/operacion docs/memoria/decisiones -type f | sort
find docs/memoria -type f ! -name '*.md' -print
rg -n 'TBD|TODO|por definir|Expo SDK 52|There are no automated tests' docs/memoria
git diff --check
```

Expected: only Markdown files are listed, stale/placeholder search has no matches, and diff check passes.

Commit:

```bash
git add docs/memoria/diseno docs/memoria/operacion docs/memoria/decisiones
git commit -m "docs: agrega memoria visual y operativa"
git push
```

---

### Task 4: Switch Claude and Codex to selective memory routing

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- Consumes: complete and verified `docs/memoria/` from Tasks 1–3.
- Produces: small automatic contexts that route both agents without forcing full-vault reads.

- [ ] **Step 1: Replace `CLAUDE.md` with concise automatic guidance**

Replace `CLAUDE.md` with this complete concise content, preserving accents and code blocks:

````markdown
# FutFinder — instrucciones para Claude Code

## Proyecto
FutFinder es una aplicación de fútbol amateur construida con React Native/Expo y Supabase. Incluye partidos, clubes, chat, perfiles, amistades, reputación y avisos. Todo texto visible para usuarios debe escribirse en español de Chile.

## Antes de editar
Este repositorio se trabaja desde dos Macs. Ejecuta `git pull` antes de tocar archivos. Si aparecen conflictos o cambios ajenos, detente y comunícalos; no los resuelvas automáticamente, no descartes trabajo y nunca uses push forzado sin autorización explícita.

## Memoria selectiva
Consulta `docs/memoria/00-inicio.md`, clasifica la tarea y lee únicamente la nota principal del dominio y las dependencias directas indicadas. No leas toda la bóveda por defecto. Verifica contra el código y las migraciones cualquier dato sensible al tiempo.

## Al terminar
Ejecuta las comprobaciones pertinentes y revisa `git status`. Conserva cambios ajenos. Añade solo los archivos de la tarea, crea un commit descriptivo y ejecuta `git push` de inmediato. Si el cambio fue material, actualiza en el mismo commit únicamente las notas de memoria afectadas.

## Comandos esenciales
```bash
npm install
npm run web
npm run ios
npm run android
npm test
npm run build:web
```

## Seguridad y documentación
No guardes `.env`, tokens, claves, credenciales ni datos personales en documentación o commits. Si una nota contradice el código vigente, comprueba el comportamiento y corrige solo la nota afectada. No actualices la memoria por formato, ortografía o refactorizaciones sin cambio de comportamiento.
````

- [ ] **Step 2: Replace `AGENTS.md` with equivalent Codex guidance**

Replace `AGENTS.md` with this complete content; do not instruct Codex to read `CLAUDE.md`:

````markdown
# FutFinder — instrucciones para Codex

## Proyecto
FutFinder es una aplicación de fútbol amateur construida con React Native/Expo y Supabase. Incluye partidos, clubes, chat, perfiles, amistades, reputación y avisos. Todo texto visible para usuarios debe escribirse en español de Chile.

## Antes de editar
Este repositorio se trabaja desde dos Macs. Ejecuta `git pull` antes de tocar archivos. Si aparecen conflictos o cambios ajenos, detente y comunícalos; no los resuelvas automáticamente, no descartes trabajo y nunca uses push forzado sin autorización explícita.

## Memoria selectiva
Consulta `docs/memoria/00-inicio.md`, clasifica la tarea y lee únicamente la nota principal del dominio y las dependencias directas indicadas. No leas toda la bóveda por defecto. Verifica contra el código y las migraciones cualquier dato sensible al tiempo.

## Al terminar
Ejecuta las comprobaciones pertinentes y revisa `git status`. Conserva cambios ajenos. Añade solo los archivos de la tarea, crea un commit descriptivo y ejecuta `git push` de inmediato. Si el cambio fue material, actualiza en el mismo commit únicamente las notas de memoria afectadas.

## Comandos esenciales
```bash
npm install
npm run web
npm run ios
npm run android
npm test
npm run build:web
```

## Seguridad y documentación
No guardes `.env`, tokens, claves, credenciales ni datos personales en documentación o commits. Si una nota contradice el código vigente, comprueba el comportamiento y corrige solo la nota afectada. No actualices la memoria por formato, ortografía o refactorizaciones sin cambio de comportamiento.
````

- [ ] **Step 3: Exclude local Obsidian state and point README to current docs**

Add exactly this line to `.gitignore` under editor tooling:

```gitignore
docs/memoria/.obsidian/
```

Add a concise notice near the top of `README.md` linking to `docs/memoria/00-inicio.md` as the current product and technical memory. Do not rewrite unrelated README sections in this task.

- [ ] **Step 4: Check automatic-context size and routing language**

Run:

```bash
wc -l CLAUDE.md AGENTS.md
rg -n '00-inicio\.md|No leas toda|no leas toda|git pull|git push|npm test|build:web' CLAUDE.md AGENTS.md
rg -n 'lee completamente `CLAUDE\.md`|Services layer|Navigation structure|Core tables' CLAUDE.md AGENTS.md
```

Expected: both files contain routing/Git/verification rules; the old full-read instruction and embedded architecture headings produce no matches. Prefer each automatic file to remain below 100 lines without removing required rules.

- [ ] **Step 5: Validate every Markdown link in the memory**

Run this repository-local check:

```bash
node <<'NODE'
const fs = require('fs');
const path = require('path');
const root = path.resolve('docs/memoria');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.md')) files.push(full);
  }
}
walk(root);
const missing = [];
const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(linkRe)) {
    const target = match[1].split('#')[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), decodeURI(target));
    if (!fs.existsSync(resolved)) missing.push(`${path.relative('.', file)} -> ${target}`);
  }
}
if (missing.length) {
  console.error(missing.join('\n'));
  process.exit(1);
}
console.log(`OK: ${files.length} Markdown files, no missing local links`);
NODE
```

Expected: `OK` with the Markdown file count and no missing links.

- [ ] **Step 6: Run project verification**

```bash
npm test
npm run build:web
git diff --check
git status --short
```

Expected: the current automated tests pass, the production web export completes, diff check passes, and status lists only the planned documentation/configuration changes.

- [ ] **Step 7: Commit and push selective routing**

```bash
git add CLAUDE.md AGENTS.md .gitignore README.md
git commit -m "docs: enruta agentes a memoria selectiva"
git push
```

---

### Task 5: Final acceptance audit and Obsidian handoff

**Files:**
- Verify: all files under `docs/memoria/`
- Verify: `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `README.md`

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: evidence that the memory is complete, portable, secret-free, and ready to open as an Obsidian vault.

- [ ] **Step 1: Verify the required file set**

Run:

```bash
required=(
  docs/memoria/00-inicio.md
  docs/memoria/producto/vision-y-alcance.md
  docs/memoria/producto/reglas-de-negocio.md
  docs/memoria/arquitectura/stack-y-estructura.md
  docs/memoria/arquitectura/navegacion.md
  docs/memoria/arquitectura/base-de-datos.md
  docs/memoria/arquitectura/seguridad-y-privacidad.md
  docs/memoria/arquitectura/despliegue-y-entornos.md
  docs/memoria/funcionalidades/autenticacion.md
  docs/memoria/funcionalidades/partidos.md
  docs/memoria/funcionalidades/clubes.md
  docs/memoria/funcionalidades/chat.md
  docs/memoria/funcionalidades/perfil-y-amigos.md
  docs/memoria/funcionalidades/avisos-y-push.md
  docs/memoria/funcionalidades/configuracion.md
  docs/memoria/diseno/sistema-visual.md
  docs/memoria/operacion/estado-actual.md
  docs/memoria/operacion/pendientes.md
  docs/memoria/operacion/pruebas.md
  docs/memoria/decisiones/README.md
)
for file in "${required[@]}"; do test -f "$file" || { echo "Missing: $file"; exit 1; }; done
echo "OK: ${#required[@]} required memory files"
```

Expected: `OK: 20 required memory files`.

- [ ] **Step 2: Verify no media, local Obsidian state, placeholders, or obvious secrets are tracked**

Run:

```bash
find docs/memoria -type f ! -name '*.md' ! -path '*/.obsidian/*' -print
git ls-files 'docs/memoria/.obsidian/**'
rg -n 'TBD|TODO|implement later|fill in details|EXPO_PUBLIC_SUPABASE_ANON_KEY=.+|service_role.+=' docs/memoria CLAUDE.md AGENTS.md
```

Expected: all three commands produce no findings.

- [ ] **Step 3: Simulate selective routing for three tasks**

From `00-inicio.md`, record the expected read set:

```text
Chat permission task:
- funcionalidades/chat.md
- arquitectura/seguridad-y-privacidad.md
- arquitectura/base-de-datos.md

Club visual task:
- funcionalidades/clubes.md
- diseno/sistema-visual.md

Profile navigation task:
- funcionalidades/perfil-y-amigos.md
- arquitectura/navegacion.md
```

Expected: each task is understandable from its primary note and direct dependencies without reading the entire vault.

- [ ] **Step 4: Confirm clean synchronized delivery**

Run:

```bash
git status --short
git log -5 --oneline
git push
```

Expected: clean status and `Everything up-to-date` after all prior commits.

- [ ] **Step 5: Provide the user handoff**

Give these exact Obsidian steps:

```text
1. Abre Obsidian.
2. Selecciona “Open folder as vault”.
3. Elige /Users/vicentebastias/Desktop/FutFinder/docs/memoria.
4. Abre 00-inicio.md como portada.
5. No instales plugins para esta primera versión.
```

Also report the automatic-context line counts, number of memory files, test/build results, and final commit hashes.
