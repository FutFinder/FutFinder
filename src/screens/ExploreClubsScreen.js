import React from 'react';

import ClubExplorer from '../components/club/ClubExplorer';

/**
 * Exploración de clubes: buscador + filtros + listado de TODOS los clubes de
 * FutFinder (handoff `Clubes.dc.html`). Se empuja sobre el stack desde el
 * botón «volver al explorador» de un integrante en su propio club, o desde
 * «Buscar rivales» en ClubDetailScreen. Tocar un club abre su
 * ClubDetailScreen (modo visitante o miembro según corresponda).
 *
 * Toda la UI vive en `ClubExplorer`, compartida con el estado sin-club de
 * `ClubsScreen` para no duplicar pantallas.
 */
export default function ExploreClubsScreen({ navigation }) {
  return (
    <ClubExplorer
      navigation={navigation}
      showBackButton
      onBack={() => navigation.goBack()}
      extraBottomClearance={0}
    />
  );
}
