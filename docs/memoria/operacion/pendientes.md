# Pendientes

Última revisión: 2026-08-08

Los ítems siguientes son trabajo no resuelto. Cada uno se separa de los cambios ya versionados y requiere una comprobación explícita para cerrarse.

## P1 — Confirmar migraciones y RLS en el proyecto Supabase objetivo

- **Dominio afectado:** seguridad, privacidad, chat, avisos y push.
- **Evidencia:** el repositorio contiene las migraciones 35 a 40 y pruebas SQL asociadas, pero no puede demostrar qué migraciones están aplicadas en un proyecto remoto.
- **Acción:** contrastar el historial de migraciones del entorno objetivo, aplicar de forma controlada las que falten y ejecutar las pruebas SQL en un Supabase de desarrollo equivalente.
- **Verificación necesaria:** las cinco pruebas de `supabase/tests/` pasan contra el esquema objetivo de desarrollo y los contratos de RLS/RPC usados por cliente existen.

## P1 — Validar el envío push de extremo a extremo en dispositivo físico

- **Dominio afectado:** avisos y push.
- **Evidencia:** `send-push` tiene pruebas de lógica y SQL, mientras que el registro de push nativo se omite en web y simuladores; la entrega final depende de permisos, Expo, tokens, webhook y cron remotos.
- **Acción:** configurar el archivo de servicios Android/secretos EAS y los servicios remotos autorizados; probar registro, preferencias, recepción y tratamiento de token inválido en hardware físico.
- **Verificación necesaria:** una matriz Android/iOS en dispositivos físicos confirma permisos, token, una categoría permitida, una bloqueada por preferencia y la recuperación ante token inválido. Las pruebas web no cierran este pendiente.

## P2 — Definir y construir la moderación posterior a un reporte

- **Dominio afectado:** perfil y seguridad de la comunidad.
- **Evidencia:** el flujo permite crear y consultar los propios reportes, pero la documentación y el código no describen moderación, sanción ni apelación.
- **Acción:** decidir roles, revisión, estados, medidas y apelación; después diseñar políticas, persistencia, interfaz y pruebas de autorización.
- **Verificación necesaria:** pruebas de RLS y flujos autenticados demuestran que sólo las personas autorizadas revisan o resuelven reportes y que el usuario ve el estado permitido.

## P2 — Recuperar trazabilidad de las tablas base no creadas en el historial versionado

- **Dominio afectado:** base de datos y recuperación de entornos.
- **Evidencia:** `notifications`, `push_tokens` y `ratings` son consumidas por servicios y migraciones posteriores, pero su creación inicial no aparece en `supabase/schema.sql` ni en las migraciones presentes.
- **Acción:** identificar la fuente de esquema autorizada y añadir una estrategia de aprovisionamiento o migración que preserve los entornos existentes.
- **Verificación necesaria:** una base nueva puede crearse desde las fuentes versionadas y ejecutar las pruebas de avisos, push y calificaciones sin objetos ausentes.

## P3 — Resolver o aceptar explícitamente la ausencia de mapa en web

- **Dominio afectado:** descubrimiento de partidos en web.
- **Evidencia:** `MatchMap.web.js` devuelve `null`; la variante nativa utiliza `react-native-maps` y la lista con filtros se conserva en web.
- **Acción:** decidir si la lista/filtros es el alcance web definitivo o implementar una alternativa de mapa compatible.
- **Verificación necesaria:** prueba manual de búsqueda de partidos en navegador documenta la experiencia acordada y, si se implementa un mapa, cubre selección y cambio de región.

## Notas relacionadas

- [Estado actual](estado-actual.md)
- [Pruebas](pruebas.md)
- [Base de datos](../arquitectura/base-de-datos.md)
- [Avisos y push](../funcionalidades/avisos-y-push.md)
