# Autenticación

Última revisión: 2026-08-27

## Propósito

Crear o iniciar una sesión por correo, confirmar cuentas y encaminar al usuario a onboarding o a su destino protegido.

## Flujos actuales

Iniciar sesión y registrarse son acciones separadas del mismo formulario, elegidas con el enlace inferior (`mode` en `LoginScreen`). El login solo llama a `signInWithPassword`: nunca cae a registro.

El registro **no usa `signUp`**: usa `signInWithOtp` con `shouldCreateUser: true`, así que crea la cuenta sin contraseña usable y manda un código de 6 dígitos. La contraseña escrita queda en memoria (`pendingSignUp.js`, de un solo uso, nunca en disco ni en parámetros de navegación) y se fija con `updateUser` recién después de verificar el código (`completeSignUpPassword`). Sin acceso al buzón no hay código, no hay sesión y no hay contraseña: la cuenta no sirve ni para registrarse ni para iniciar sesión después.

Una sesión con onboarding completo abre `Main`; una incompleta continúa en ubicación. `AuthProvider` resuelve la sesión antes de montar la navegación y escucha cambios. Una ruta guardada por `withAuthGuard` se consume después del login terminado.

`authPolicy.js` concentra la decisión de acceso y es lógica pura, sin dependencias de React Native, para poder probarla con `node:test`: el cliente de auth se inyecta.

## Reglas y permisos

La sesión de Supabase identifica al usuario. «Autenticado» exige una sesión usable —token, usuario y correo verificado (`isSessionUsable`)—; sin configuración no hay sesión y las rutas privadas mandan a Login.

La creación del perfil depende del trigger `handle_new_user`. La migración 59 lo hizo tolerante al choque de username: `profiles_username_ci_idx` es único sobre `lower(username)` y el trigger solo tenía `on conflict (id)`, así que un username derivado repetido hacía fallar el insert en `auth.users` y el registro moría con un 500 opaco («Database error saving new user»). Ahora busca un sufijo libre (`juan`, `juan1`, `juan2`).

## Pantallas y dependencias

- Pantallas: `SplashScreen`, `WelcomeScreen`, `LoginScreen`, `VerificationScreen`, `LocationPermissionScreen`, `TermsScreen` y `SuccessScreen`.
- Código: `src/services/authPolicy.js` (política pura), `src/services/auth.js`, `src/services/profile.js`, `src/contexts/AuthContext.js`, `src/navigation/withAuthGuard.js` y `src/utils/routing.js`.
- Backend: Supabase Auth, `profiles` y el trigger del esquema.

## Estados, errores y problemas conocidos

Login valida correo/contraseña, traduce los errores de Auth a mensajes propios y ofrece reenvío de OTP. Un correo inexistente y una contraseña incorrecta reciben el mismo mensaje, para no permitir averiguar qué correos están registrados. La guarda cubre `Main` y las pantallas operativas del stack; `LocationPermission`, `Terms` y `Success` quedan públicas a propósito (son el onboarding posterior al registro, no exponen datos y no están en la config de deep links), igual que la galería de QA `ReservasUiGallery`. Las opciones visuales de Google y Apple, y el enlace de contraseña olvidada, no tienen acción implementada.

La confirmación de correo está **desactivada** en el proyecto de Supabase: `signUp` autoconfirma y emite sesión al instante, y una cuenta creada así queda confirmada para siempre, así que después sirve para iniciar sesión con su contraseña. Por eso el registro dejó de usar `signUp`: ninguna validación en el cliente puede tapar eso. El camino OTP no depende de ese ajuste.

Dependencia real de configuración: el **envío de correos**. Con el servicio incorporado de Supabase el envío está muy limitado y puede no llegar a direcciones fuera del equipo, así que el registro no funciona de verdad para usuarios reales hasta que haya un SMTP propio y la plantilla del código incluya `{{ .Token }}`.

Comprobado el 2026-08-27: `signInWithOtp` crea la cuenta **antes** de enviar el correo, y si el destino no existe falla en el envío (`email_address_invalid`) dejando la fila creada. Esas cuentas quedan sin contraseña usable, así que no permiten entrar, pero sí acumulan filas basura.

Regresión que originó `authPolicy.js`: el login usaba `signInOrUp`, que convertía un inicio de sesión fallido en un registro. Con la autoconfirmación activa, cualquier correo inventado con una contraseña de 6+ caracteres creaba una cuenta real y entraba a `Main`. Las pruebas de `src/services/__tests__/authPolicy.test.js`, `src/navigation/__tests__/rutasPrivadas.test.js` y `src/contexts/__tests__/sesionCableado.test.js` fijan que no vuelva.

## Notas relacionadas

- [Navegación](../arquitectura/navegacion.md)
- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
- [Configuración](configuracion.md)
