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
