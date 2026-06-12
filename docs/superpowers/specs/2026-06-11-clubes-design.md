# Diseño: Pestaña Clubes — FutFinder

**Fecha:** 2026-06-11
**Estado:** Aprobado
**Fase actual:** 1 de 3

## Decisiones tomadas

| Decisión | Resolución |
|---|---|
| Membresía | Un jugador pertenece a **un solo club** (UNIQUE en user_id) |
| Ingreso al club | **Ambos flujos**: el admin invita Y el jugador solicita (admin aprueba) |
| Premium sin pasarela | Campo `plan` en BD ('estandar'/'premium'), activación manual desde Supabase. La pasarela se integra después sin cambiar el esquema |
| Tab bar | 6 tabs: Inicio, Buscar, Crear (flotante), Clubes, Chat, Perfil |

## Fases

- **Fase 1 (esta):** Tab Clubes + crear club + unirse (solicitud/invitación) + miembros + chat interno + pantalla de planes con candados Premium.
- **Fase 2:** Encuentros contra clubes rivales (máx 4/mes en Estándar) + historial manual de partidos (V/D/E, goles).
- **Fase 3:** Features Premium: página pública, fotos, arte del club, vitrina de trofeos, rivales históricos, resumen de temporada, premiaciones semestrales.

## Esquema de BD (migración 09_clubes.sql)

### clubs
- id, nombre (unique CI), slug (unique, futura página pública), descripcion, foto_url, region, comuna
- plan: 'estandar' | 'premium' (default estandar)
- verificado: boolean (insignia Premium)
- created_by → profiles, created_at

### club_members
- id, club_id → clubs, user_id → profiles (UNIQUE: un club por jugador)
- rol: 'admin' | 'jugador'
- joined_at
- **Trigger** valida límites por plan al insertar: Estándar máx 15 miembros / 1 admin; Premium máx 26 / 3 admins

### club_join_requests
- id, club_id, user_id, tipo ('solicitud' | 'invitacion'), status ('pending' | 'approved' | 'rejected')
- created_at, responded_at
- Índice único parcial: sin duplicados pending por (club_id, user_id)

### messages (modificación)
- Nueva columna club_id → clubs
- Constraint `messages_target_exactly_one` se recrea: receiver XOR match XOR club
- RLS: solo miembros del club leen/escriben en su thread
- Thread key: `club:<clubId>` (paralelo a `match:<matchId>` y `dm:<userId>`)

## Pantallas (Fase 1)

- **ClubsScreen.js** (tab): sin club → buscador + crear + invitaciones pendientes; con club → vista de mi club
- **CreateClubScreen.js** (modal): nombre, descripción, región/comuna; creador queda admin
- **ClubDetailScreen.js**: header, miembros con trust score, solicitar unirse; admin: gestionar solicitudes, invitar, expulsar
- **ClubPlansScreen.js**: comparativa Estándar vs Premium con candados

## Componentes nuevos

- ClubCard.js — tarjeta de club en listas
- PremiumBadge.js — indicador de función Premium bloqueada (reutilizable fases 2-3)

## Servicio nuevo

`src/services/clubs.js` con patrón { data, error } + guard isSupabaseConfigured:
createClub, getMyClub, getClubById, searchClubs, requestToJoin, inviteToClub,
respondToRequest, listPendingRequests, listMembers, leaveClub, removeMember, listMyInvitations

## Navegación

- MainTabs: ClubsTab con ícono Shield, orden Inicio/Buscar/Crear/Clubes/Chat/Perfil
- AppNavigator: CreateClub (slide_from_bottom), ClubDetail y ClubPlans (slide_from_right)

## Riesgos identificados

1. Recrear constraint de messages: va en una sola transacción, mensajes viejos siguen válidos (club_id NULL)
2. ChatScreen/ChatThreadScreen: se agregan ramas nuevas sin tocar lógica DM/match existente
3. Tab bar con 6 slots: labels de 10px, debería verse bien en pantallas chicas
