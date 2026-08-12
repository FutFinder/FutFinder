import React from 'react';

import ErrorBoundary from '../components/ErrorBoundary';

/**
 * Envuelve una pantalla en su propio `ErrorBoundary`.
 *
 * Por pantalla y no solo en la raíz a propósito: un boundary único arriba
 * atrapa el error, sí, pero reemplaza la app entera —incluida la
 * navegación—, así que el usuario queda encerrado. Con uno por pantalla se
 * cae únicamente la que falló, la barra de pestañas sigue viva y se puede
 * volver atrás.
 *
 * Se compone con `withAuthGuard`, que es donde se aplica a todas las rutas
 * privadas de una sola vez.
 */
export default function withErrorBoundary(ScreenComponent, routeName) {
  function ScreenConBoundary(props) {
    const { navigation } = props;
    return (
      <ErrorBoundary
        nombre={routeName ? `la pantalla ${routeName}` : 'la pantalla'}
        onVolver={navigation?.canGoBack?.() ? () => navigation.goBack() : null}
      >
        <ScreenComponent {...props} />
      </ErrorBoundary>
    );
  }

  ScreenConBoundary.displayName = `withErrorBoundary(${routeName || 'Screen'})`;
  return ScreenConBoundary;
}
