# Lanzamiento: el orden

Escrita el 2026-11-18, después de cerrar los bloqueos, la seguridad, Flow, tiendas y legal, infraestructura y moderación del informe de lanzamiento. Lo que queda **no es código**: son cuentas, paneles, fichas de tienda y pruebas con teléfonos reales. Va en este orden porque cada paso necesita el anterior.

## 1. Cuentas y paneles (sólo las puede hacer una persona)

El detalle de los cuatro primeros está en [Pendientes](pendientes.md), «Operación».

1. **Supabase Pro**: respaldos restaurables, que el proyecto no se pause y la protección de contraseñas filtradas. Sin esto no hay respaldo para el paso 5.
2. **Sentry**: el DSN en `EXPO_PUBLIC_SENTRY_DSN` (EAS y Vercel) y `SENTRY_AUTH_TOKEN` en EAS.
3. **Expo, seguridad reforzada de push**: `EXPO_ACCESS_TOKEN` en `send-push` y `expo_access_token` en Vault.
4. **Supabase → Authentication**: TOTP habilitado, duración del OTP, JWT y rotación.
5. **Enlaces universales**: el Team ID de Apple y la huella SHA-256 de la firma de Android ([Navegación](../arquitectura/navegacion.md)).
6. **Correo con dominio propio en Resend** y `SOLICITUDES_EMAIL_FROM`: con el remitente de prueba los correos sólo le llegan al dueño de la cuenta de Resend ([Despliegue](../arquitectura/despliegue-y-entornos.md)).
7. **Conciliar pagos**: aplicar la migración 190 y desplegar `conciliar-pagos` con su secreto ([Pendientes](pendientes.md)). Está construida y probada, pero al 2026-11-18 no está en producción.
8. **Flow en producción**, al final y sólo después de probar el sandbox (paso 2): las claves de producción y `FLOW_AMBIENTE=produccion` en las funciones de pago.

## 2. Probar todo

Todo lo de [Por probar](por-probar.md), con un build `preview` en un iPhone y un Android reales y en www.futfinder.cl. Es lo que no se pudo probar desde una sesión: push, pagos en sandbox, borrar la cuenta, recuperar la contraseña, moderación con la sesión real, actualizaciones por aire.

## 3. Fichas de tienda

Los textos para pegar (descripción, palabras clave, notas para quien revisa, privacidad y seguridad de los datos) están en [Fichas de tienda](fichas-de-tienda.md). La cuenta de revisión con contenido se arma con `scripts/cuenta-revision/` **después** de la limpieza del paso 4.2 y antes del envío (4.4).

**Las dos tiendas:**
- Política de privacidad: `https://www.futfinder.cl/privacidad`. Términos: `https://www.futfinder.cl/terminos`.
- **Una cuenta de prueba para quien revisa**, con contenido (un partido, un club, un chat) y sin dos pasos. FutFinder no se puede usar sin iniciar sesión, y sin esta cuenta Apple rechaza por la guía 2.1. El correo y la contraseña van en el formulario de la tienda, nunca en el repositorio.
- No hace falta «Iniciar sesión con Apple»: la app no ofrece ningún inicio con terceros (sólo correo). Los botones «Continuar con Google / Apple» del registro, que sólo decían «Muy pronto», se quitaron el 2026-11-18 (Apple rechaza funciones de relleno, guía 2.1); una prueba en `sesionCableado.test.js` impide que vuelvan. El mismo día se quitó la fila «Ñuñoa, Santiago · cambiar» de Reservas, que además mostraba esa ubicación a todo el mundo, y «Cómo llegar» en la ficha de un recinto pasó a funcionar (Apple Maps o Google Maps). Otra prueba del mismo archivo los vigila.

**App Store Connect:**
- Etiquetas de privacidad: correo, teléfono, ubicación precisa (ver [Fichas de tienda](fichas-de-tienda.md)), fotos y mensajes (contenido del usuario), identificador de usuario y de dispositivo (token de push), compras (reservas) y diagnóstico (Sentry). Nada se usa para rastrear ni para publicidad.
- Clasificación por edad con contenido generado por usuarios. En las notas para la revisión, decir dónde se reporta (perfil, club, foto, partido), dónde se bloquea y que los reportes se resuelven en 24 horas (guía 1.2, migración 194).

**Google Play Console:**
- Seguridad de los datos: lo mismo que arriba, y el enlace para **eliminar la cuenta**: `https://www.futfinder.cl/eliminar-cuenta` (pantalla pública desde el 2026-11-18, explica cómo borrarla desde la app y cómo pedirlo por correo sin la app).
- Público objetivo: 14 años o más, no pensada para niños. Cuestionario de contenido: interacción entre usuarios y contenido que ellos publican.
- Acceso a la app: la misma cuenta de prueba.

## 4. El día antes

1. **Respaldo** (Supabase Pro, o `pg_dump`).
2. **Limpieza de producción** con el sí de Vicente: `scripts/limpieza-prelanzamiento/` (su README dice cómo; primero el ensayo).
   Después, la **cuenta de revisión**: registrarla en www.futfinder.cl y correr `scripts/cuenta-revision/semilla.sql` (su README dice cómo). Si se registró antes, su correo va en la lista de cuentas que la limpieza salva.
3. Si el personal ya registró su segundo factor, encender `mfa_obligatoria_staff` (sección 4 de [Por probar](por-probar.md)).
4. Build `production` con EAS y envío a las dos tiendas.

## 5. La primera semana

[Revisión diaria](revision-diaria.md) todos los días, sobre todo los reportes (24 horas) y la plata por devolver, y mirar Sentry.

## Notas relacionadas

- [Pendientes](pendientes.md)
- [Por probar](por-probar.md)
- [Revisión diaria](revision-diaria.md)
