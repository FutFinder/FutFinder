# Memoria de FutFinder

Última revisión: 2026-08-08

## Propósito

Enrutar cambios hacia la mínima documentación necesaria y mantener esta memoria como una guía verificable del repositorio.

## Estado verificado

Esta bóveda documenta la configuración, el código y las migraciones versionados del repositorio actual; no sustituyen la comprobación segura de un entorno desplegado.

## Cómo usar esta memoria

- Clasifica la tarea antes de leer documentación.
- Lee la nota principal del dominio y solo las dependencias directas indicadas.
- No leas toda la bóveda por defecto.
- Verifica datos sensibles al tiempo contra el código y las migraciones.

## Enrutamiento por tarea

| Tarea | Leer primero | Dependencias solo si aplican |
|---|---|---|
| Decisión duradera | [Decisiones duraderas](decisiones/README.md) | Las notas de memoria afectadas por la decisión |
| Visión, alcance o cambio de producto | [Visión y alcance](producto/vision-y-alcance.md) | [Reglas de negocio](producto/reglas-de-negocio.md) |
| Sesión, login, rutas privadas | [Autenticación](funcionalidades/autenticacion.md) | [Navegación](arquitectura/navegacion.md), [Seguridad](arquitectura/seguridad-y-privacidad.md) |
| Navegación, rutas o enlaces profundos | [Navegación](arquitectura/navegacion.md) | [Autenticación](funcionalidades/autenticacion.md) |
| Partidos | [Partidos](funcionalidades/partidos.md) | [Reglas de negocio](producto/reglas-de-negocio.md), [Base de datos](arquitectura/base-de-datos.md), [Sistema visual](diseno/sistema-visual.md) |
| Clubes | [Clubes](funcionalidades/clubes.md) | [Base de datos](arquitectura/base-de-datos.md), [Sistema visual](diseno/sistema-visual.md) |
| Chat | [Chat](funcionalidades/chat.md) | [Seguridad](arquitectura/seguridad-y-privacidad.md), [Base de datos](arquitectura/base-de-datos.md) |
| Perfil o amigos | [Perfil y amigos](funcionalidades/perfil-y-amigos.md) | [Navegación](arquitectura/navegacion.md), [Seguridad](arquitectura/seguridad-y-privacidad.md), [Sistema visual](diseno/sistema-visual.md) |
| Avisos o push | [Avisos y push](funcionalidades/avisos-y-push.md) | [Configuración](funcionalidades/configuracion.md), [Despliegue](arquitectura/despliegue-y-entornos.md) |
| Reservas de canchas | [Reservas](funcionalidades/reservas.md) | [Sistema visual](diseno/sistema-visual.md), [Navegación](arquitectura/navegacion.md) |
| Privacidad o ajustes | [Configuración](funcionalidades/configuracion.md) | [Seguridad](arquitectura/seguridad-y-privacidad.md) |
| Datos, migraciones, RLS o RPC | [Base de datos](arquitectura/base-de-datos.md) | [Seguridad y privacidad](arquitectura/seguridad-y-privacidad.md) |
| Seguridad, privacidad o autorización | [Seguridad y privacidad](arquitectura/seguridad-y-privacidad.md) | [Base de datos](arquitectura/base-de-datos.md) |
| Despliegue, entornos o secretos | [Despliegue y entornos](arquitectura/despliegue-y-entornos.md) | [Stack y estructura](arquitectura/stack-y-estructura.md) |
| Sistema visual o componentes compartidos | [Sistema visual](diseno/sistema-visual.md) | Ninguna |
| Arquitectura general | [Stack y estructura](arquitectura/stack-y-estructura.md) | [Navegación](arquitectura/navegacion.md), [Base de datos](arquitectura/base-de-datos.md), [Seguridad y privacidad](arquitectura/seguridad-y-privacidad.md) |
| Estado, pendientes o pruebas | [Estado actual](operacion/estado-actual.md) | [Pendientes](operacion/pendientes.md), [Pruebas](operacion/pruebas.md) |
| Lint, calidad o errores de render | [Calidad y lint](operacion/calidad-y-lint.md) | [Pruebas](operacion/pruebas.md) |

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
