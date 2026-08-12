import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { useAuth } from '../contexts/AuthContext';
import withErrorBoundary from './withErrorBoundary';

/**
 * Envuelve una pantalla privada: si no hay sesión, nunca llega a montarse el
 * componente real (evita el parpadeo de una pantalla privada o un estado de
 * cuenta vacío) y en su lugar se manda a Login guardando el destino pedido
 * para retomarlo después de iniciar sesión.
 *
 * Se asume que el `AppNavigator` ya esperó a que `isReady` sea true antes de
 * montar el stack, así que acá casi siempre `isAuthenticated` ya es un valor
 * definitivo. La excepción es un cierre de sesión mientras se está parado en
 * una ruta privada: el contexto cambia, este componente se vuelve a
 * renderizar, deja de mostrar la pantalla y dispara la redirección.
 */
export default function withAuthGuard(ScreenComponent, routeName) {
  // Toda ruta privada lleva además su propio boundary: se envuelve acá una
  // sola vez en vez de repetirlo en las ~25 pantallas del stack. Va por
  // DENTRO del guard, así una pantalla que revienta no arrastra consigo la
  // redirección a Login ni el resto de la navegación.
  const PantallaProtegida = withErrorBoundary(ScreenComponent, routeName);

  function GuardedScreen(props) {
    const { isAuthenticated, setPendingDestination } = useAuth();
    const { navigation, route } = props;

    useEffect(() => {
      if (isAuthenticated) return;
      setPendingDestination({ name: routeName, params: route?.params });
      const rootNav = navigation.getParent?.() || navigation;
      rootNav.reset({ index: 0, routes: [{ name: 'Login' }] });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated]);

    if (!isAuthenticated) {
      return <View style={styles.fallback} />;
    }

    return <PantallaProtegida {...props} />;
  }

  GuardedScreen.displayName = `withAuthGuard(${routeName})`;
  return GuardedScreen;
}

const styles = StyleSheet.create({
  fallback: { flex: 1, backgroundColor: colors.background },
});
