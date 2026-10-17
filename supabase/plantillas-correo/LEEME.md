# Plantillas de correo para el stack LOCAL

Estas plantillas son **sólo para el stack local** (`supabase start`). Las de
producción se editan en el panel: Authentication → Email Templates, y no se
pueden leer ni versionar desde acá.

## Por qué existen

`verifyEmailOtp` —y por lo tanto la pantalla de verificación entera— espera
un **código de 6 dígitos**, no un enlace. Está escrito en
`src/services/auth.js`:

> Requiere que en Supabase Dashboard → Auth → Email Templates el template
> "Confirm signup" use `{{ .Token }}` en vez de link.

El stack local trae por omisión la plantilla de Supabase, que manda un
**enlace mágico**. Con esa plantilla el registro local queda a medias de una
forma que parece un fallo de la app y no lo es: la cuenta se crea, el perfil
se crea, y **la contraseña nunca se fija** —se fija al verificar el código,
en `completeSignUpPassword`—, así que el login siguiente contesta «Correo o
contraseña incorrectos».

## Cómo se enganchan

En el `config.toml` del proyecto local:

```toml
[auth.email]
enable_confirmations = true

[auth.email.template.confirmation]
subject = "Tu código de FutFinder"
content_path = "./supabase/plantillas-correo/confirmacion.html"

[auth.email.template.magic_link]
subject = "Tu código de FutFinder"
content_path = "./supabase/plantillas-correo/confirmacion.html"
```

`magic_link` lleva la misma plantilla a propósito: «Reenviar código» va por
`signInWithOtp`, no por `resend`, y Supabase manda esa plantilla. Si sólo se
cambia `confirmation`, el primer correo trae el código y el del reenvío trae
un enlace.

`enable_confirmations = true` también importa: sin eso el stack local
autoconfirma, no manda nada, y la pantalla de verificación queda esperando
un código que nunca llega.

El correo se lee en Mailpit: http://127.0.0.1:54324

## Dos trampas del stack local que costaron una tarde

**1. colima sólo comparte `/Users/...` con su máquina virtual.** El stack
vivía en un directorio temporal bajo `/private/tmp`, y Docker montó la
plantilla dentro del contenedor como un **directorio vacío** sin quejarse:
gotrue mandó un listado de directorio en vez del código. Por eso el proyecto
del stack local vive en `~/.futfinder-local`.

**2. `[api] enabled = false` y `[realtime] enabled = false`.** Para correr
los arneses no hacen falta —se habla con Postgres directo— pero con la app
encima la autenticación funciona (Kong enruta `/auth`) y **cada
`supabase.from(...)` vuelve 503**. La pantalla de Inicio decía «¡Hola,
jugador!» y «No pudimos cargar tu reputación», que parecen fallos de la app
y no lo son. Los dos tienen que estar en `true`.

## Y una diferencia que no es de esquema: los interruptores

Una base construida con `construir-base.mjs` nace con **las cuatro fases de
TrueScore apagadas**; producción las tiene encendidas desde el 2026-09-24.
Mientras estén apagadas, la app local muestra «TRUST SCORE» y las reglas
viejas en vez de «TRUESCORE». Para que el local se comporte como producción:

```sql
select public.truescore_activar_fase1();
select public.truescore_activar_fase2();
select public.truescore_activar_fase3();
select public.truescore_activar_fase4();
```
