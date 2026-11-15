/**
 * Decide la ruta inicial de la app según el estado de sesión/onboarding,
 * exactamente como lo hacía `SplashScreen` (antes inline en su callback de
 * animación) — extraído a una función pura para poder probar las tres
 * rutas privadas/públicas sin montar React Navigation.
 *
 * `onboardingState` viene de `getOnboardingState()` (services/profile.js):
 *   - true   → hay sesión Y el onboarding ya se completó   → ruta privada
 *   - false  → hay sesión pero el onboarding quedó a medias → ruta privada
 *              (continúa el onboarding, no es la app completa)
 *   - null/undefined → no hay sesión (o no se pudo resolver a tiempo)
 *              → ruta pública, nunca se cae en Main sin sesión confirmada.
 */
export function getInitialRouteName(onboardingState) {
  if (onboardingState === true) return 'Main';
  if (onboardingState === false) return 'LocationPermission';
  return 'Welcome';
}

/** `true` si la ruta resuelta por `getInitialRouteName` requiere sesión. */
export function isPrivateRoute(routeName) {
  return routeName === 'Main' || routeName === 'LocationPermission';
}

/**
 * A dónde se entra después de iniciar sesión o de terminar el registro.
 *
 * Si alguien abrió un link privado sin sesión —el de invitación a un partido,
 * por ejemplo— el guard guardó ese destino; se vuelve a él con Main debajo
 * para que «atrás» no saque de la app. Lo usan Login y el final del registro:
 * antes sólo Login lo miraba, y quien se registraba desde un link de
 * invitación terminaba en el Home sin su asiento.
 */
export function rutasTrasEntrar(pending) {
  if (pending && pending.name && pending.name !== 'Main') {
    return { index: 1, routes: [{ name: 'Main' }, { name: pending.name, params: pending.params }] };
  }
  return { index: 0, routes: [{ name: 'Main', params: pending?.params }] };
}
