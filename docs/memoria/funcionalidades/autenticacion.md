# Autenticación

Última revisión: 2026-08-08

## Propósito

Crear o iniciar una sesión por correo, confirmar cuentas y encaminar al usuario a onboarding o a su destino protegido.

## Flujos actuales

Login intenta contraseña y, si no obtiene usuario, intenta registro; un registro sin sesión pasa a OTP de correo. Una sesión con onboarding completo abre `Main`; una incompleta continúa en ubicación. `AuthProvider` resuelve la sesión antes de montar la navegación y escucha cambios. Una ruta guardada por `withAuthGuard` se consume después del login terminado.

## Reglas y permisos

La sesión de Supabase identifica al usuario. En modo de demostración, sin configuración, el contexto se considera autenticado para que la interfaz renderice; no equivale a acceso al backend. La creación del perfil depende del trigger `handle_new_user`.

## Pantallas y dependencias

- Pantallas: `SplashScreen`, `WelcomeScreen`, `LoginScreen`, `VerificationScreen`, `LocationPermissionScreen`, `TermsScreen` y `SuccessScreen`.
- Código: `src/services/auth.js`, `src/services/profile.js`, `src/contexts/AuthContext.js`, `src/navigation/withAuthGuard.js` y `src/utils/routing.js`.
- Backend: Supabase Auth, `profiles` y el trigger del esquema.

## Estados, errores y problemas conocidos

Login valida correo/contraseña, propaga errores de Auth y ofrece reenvío de OTP. La guarda cubre `Main` y las pantallas operativas del stack; `LocationPermission` no tiene envoltura individual, aunque sólo la ruta el flujo de sesión/onboarding. Las opciones visuales de Google y Apple no tienen acción implementada.

## Notas relacionadas

- [Navegación](../arquitectura/navegacion.md)
- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
- [Configuración](configuracion.md)
