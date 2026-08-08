# Memoria de FutFinder

Última revisión: 2026-08-08

## Propósito

Enrutar cambios hacia la mínima documentación necesaria y mantener esta memoria como una guía verificable del repositorio.

## Estado verificado

Esta bóveda parte del repositorio sincronizado en la rama `docs/obsidian-project-memory`. Sus notas describen configuración, código y migraciones versionados; no sustituyen la comprobación segura de un entorno desplegado.

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
| Perfil o amigos | [Perfil y amigos](funcionalidades/perfil-y-amigos.md) | [Navegación](arquitectura/navegacion.md), [Seguridad](arquitectura/seguridad-y-privacidad.md), [Sistema visual](diseno/sistema-visual.md) |
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

## Rutas relacionadas

- [Visión y alcance](producto/vision-y-alcance.md)
- [Reglas de negocio](producto/reglas-de-negocio.md)
- [Stack y estructura](arquitectura/stack-y-estructura.md)
- [Despliegue y entornos](arquitectura/despliegue-y-entornos.md)

## Rutas de código relacionadas

- `CLAUDE.md` y `package.json` para el alcance actual, comandos y dependencias.
- `src/navigation/` y `src/services/` para clasificar tareas de experiencia, sesión y dominios funcionales.
- `supabase/migrations/` y `supabase/functions/` para cambios de base de datos, RLS y Edge Functions.
- `app.config.js`, `.env.example`, `eas.json` y `vercel.json` para entorno y despliegue.

## Limitaciones conocidas

Las notas enlazadas en la tabla de enrutamiento se incorporan por tareas posteriores; hasta entonces, sigue esta base y verifica el código afectado.
