# Pruebas

Última revisión: 2026-08-08

## Comprobaciones locales del proyecto

```bash
npm test
```

Ejecuta las pruebas de Node de `src/**/__tests__/*.test.js`: utilidades de chat, privacidad de amistades, bandeja y preferencias de avisos, destinos de avisos, edición de perfil, rutas y búsqueda.

```bash
npm run build:web
```

Genera la exportación web de Expo y detecta fallos de empaquetado o compatibilidad web. No ejecuta las pruebas SQL ni valida servicios remotos.

## Pruebas SQL de RLS y contratos de base de datos

Los archivos `supabase/tests/35_privacy_test.sql`, `36_chat_security_test.sql`, `38_push_reliability_test.sql`, `39_chat_mention_all_test.sql`, `40_bandeja_chat_rpc_test.sql` y `41_desafio_ciclo_test.sql` verifican privacidad, RLS de chat, fiabilidad de push, `/todos`, la RPC de bandeja y el ciclo de desafíos entre clubes.

Cada archivo se abre con `begin;` y termina en `rollback;`, así que ejecutarlo no deja filas guardadas ni siquiera si se corre contra el proyecto real — que hoy es el único que existe, porque no hay un Supabase de desarrollo separado. Lo que sí exige autorización explícita es **aplicar** una migración, no correr una prueba.

## Pruebas de Edge Function

La lógica pura de la función `send-push` se prueba aparte:

```bash
deno test supabase/functions/send-push/pushLogic.test.ts
```

Esa suite cubre clasificación de tickets y recibos, deduplicación/validez de tokens y preferencias de push. No invoca Expo ni un proyecto Supabase reales.

## Flujos manuales autenticados

Con una instancia de desarrollo configurada y cuentas de prueba, comprobar al menos:

- acceso a rutas privadas sin sesión y retorno al destino después de login;
- privacidad de búsqueda y solicitudes de amistad entre dos usuarios;
- permisos de chat directo, de partido y de club, lectura, silencio y `/todos` grupal;
- publicación/solicitud/gestión de partido, asistencia y estados de error;
- membresía, administración y desafío de club;
- edición de perfil con una imagen válida y una operación que falle para observar la reversión;
- bandeja de avisos: lectura, borrado, reintento y navegación al destino.

## Push sólo en dispositivo físico

La validación de push nativo exige dispositivos físicos Android/iOS, permisos concedidos, configuración de Firebase/EAS y servicios remotos autorizados. Probar registro de token, cada preferencia de categoría, recepción en primer plano y arranque frío, además de un token inválido. Web y simuladores omiten el registro nativo; por tanto, ni `npm test` ni `npm run build:web` validan push nativo.

## Notas relacionadas

- [Estado actual](estado-actual.md)
- [Pendientes](pendientes.md)
- [Despliegue y entornos](../arquitectura/despliegue-y-entornos.md)
