# Autenticación

Última revisión: 2026-08-27

## Propósito

Crear o iniciar una sesión por correo, confirmar cuentas y encaminar al usuario a onboarding o a su destino protegido.

## Flujos actuales

Iniciar sesión y registrarse son acciones separadas del mismo formulario, elegidas con el enlace inferior (`mode` en `LoginScreen`). El login solo llama a `signInWithPassword`: nunca cae a registro. Un registro sin sesión pasa a OTP de correo. Una sesión con onboarding completo abre `Main`; una incompleta continúa en ubicación. `AuthProvider` resuelve la sesión antes de montar la navegación y escucha cambios. Una ruta guardada por `withAuthGuard` se consume después del login terminado.

`authPolicy.js` concentra la decisión de acceso y es lógica pura, sin dependencias de React Native, para poder probarla con `node:test`: el cliente de auth se inyecta.

## Reglas y permisos

La sesión de Supabase identifica al usuario. «Autenticado» exige una sesión usable —token, usuario y correo verificado (`isSessionUsable`)—; sin configuración no hay sesión y las rutas privadas mandan a Login. La creación del perfil depende del trigger `handle_new_user`.

## Pantallas y dependencias

- Pantallas: `SplashScreen`, `WelcomeScreen`, `LoginScreen`, `VerificationScreen`, `LocationPermissionScreen`, `TermsScreen` y `SuccessScreen`.
- Código: `src/services/authPolicy.js` (política pura), `src/services/auth.js`, `src/services/profile.js`, `src/contexts/AuthContext.js`, `src/navigation/withAuthGuard.js` y `src/utils/routing.js`.
- Backend: Supabase Auth, `profiles` y el trigger del esquema.

## Estados, errores y problemas conocidos

Login valida correo/contraseña, traduce los errores de Auth a mensajes propios y ofrece reenvío de OTP. Un correo inexistente y una contraseña incorrecta reciben el mismo mensaje, para no permitir averiguar qué correos están registrados. La guarda cubre `Main` y las pantallas operativas del stack; `LocationPermission`, `Terms` y `Success` quedan públicas a propósito (son el onboarding posterior al registro, no exponen datos y no están en la config de deep links), igual que la galería de QA `ReservasUiGallery`. Las opciones visuales de Google y Apple, y el enlace de contraseña olvidada, no tienen acción implementada.

Pendiente de configuración, no de código: la confirmación de correo está **desactivada** en el proyecto de Supabase, así que `signUp` autoconfirma y emite sesión al instante. Mientras siga así, la verificación de correo no se exige de verdad; el código ya encamina a `Verification` en cuanto se active.

Regresión que originó `authPolicy.js`: el login usaba `signInOrUp`, que convertía un inicio de sesión fallido en un registro. Con la autoconfirmación activa, cualquier correo inventado con una contraseña de 6+ caracteres creaba una cuenta real y entraba a `Main`. Las pruebas de `src/services/__tests__/authPolicy.test.js`, `src/navigation/__tests__/rutasPrivadas.test.js` y `src/contexts/__tests__/sesionCableado.test.js` fijan que no vuelva.

## Notas relacionadas

- [Navegación](../arquitectura/navegacion.md)
- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
- [Configuración](configuracion.md)
