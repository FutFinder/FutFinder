import React, { useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { clubsExplorer as CE } from '../theme/colors';
import { getMyClubs } from '../services/clubs';
import ClubDetailScreen from './ClubDetailScreen';
import ClubExplorer from '../components/club/ClubExplorer';

/**
 * Altura de la tab bar flotante custom (MainTabs.js) + su inset inferior.
 * Cuando el explorador se embebe aquí como raíz de la pestaña «Clubes», esa
 * tab bar real sigue dibujándose encima del contenido, así que el botón
 * «Crear club» necesita despejarla igual que hace ClubDetailScreen — sin
 * este valor queda oculto detrás, aunque exista en el árbol.
 */
const TAB_BAR_HEIGHT = 88;

/**
 * Pestaña «Clubes»: no tiene UI propia, decide a dónde entra el usuario
 * apenas se conoce su membresía real (sin datos ni condiciones de demo):
 *
 *  - Pertenece a un club   → entra directo a ClubDetailScreen de ese club
 *    (el primero, por fecha de ingreso), embebido aquí mismo — no es una
 *    navegación, así que no hay "atrás" que pueda generar un ciclo. Ese
 *    club gana un botón «volver al explorador» (`viaClubesTab`) en vez del
 *    back arrow normal.
 *  - No pertenece a ninguno → entra directo al explorador de clubes
 *    (`ClubExplorer`, handoff `Clubes.dc.html`), compartido con
 *    ExploreClubsScreen para no duplicar pantallas.
 *
 * Mientras se consulta la membresía se muestra un loader estable: nunca se
 * renderiza brevemente el estado equivocado.
 */
export default function ClubsScreen({ navigation, route }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'member' | 'guest'
  const [myClubId, setMyClubId] = useState(null);
  const [pendingBanner, setPendingBanner] = useState(null);

  // Extraída para poder llamarla también apenas se acepta una invitación
  // dentro del explorador embebido: como ahí no hay navegación de por medio,
  // el useFocusEffect de abajo no se vuelve a disparar solo, y sin esto el
  // usuario seguiría viendo el explorador tras unirse a un club.
  const checkMembership = useCallback(async () => {
    const { data } = await getMyClubs();
    if (data && data.length > 0) {
      setMyClubId(data[0].club.id);
      setStatus('member');
    } else {
      setMyClubId(null);
      setStatus('guest');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      checkMembership();
    }, [checkMembership])
  );

  // Banner de éxito que viene de ClubMembersScreen al salir/eliminar un club
  // (navigation.navigate('Main', { screen: 'ClubsTab', params: {...} })).
  // Se consume una sola vez y se limpia para no reaparecer en el próximo foco.
  useEffect(() => {
    if (route?.params?.successTitle) {
      setPendingBanner({
        type: 'success',
        title: route.params.successTitle,
        message: route.params.successMessage || '',
      });
      navigation.setParams({ successTitle: undefined, successMessage: undefined });
    }
  }, [route?.params?.successTitle]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={CE.green} />
      </View>
    );
  }

  if (status === 'member') {
    return (
      <ClubDetailScreen
        navigation={navigation}
        route={{
          params: {
            clubId: myClubId,
            viaClubesTab: true,
            initialBanner: pendingBanner,
          },
        }}
      />
    );
  }

  return (
    <ClubExplorer
      navigation={navigation}
      initialBanner={pendingBanner}
      onMembershipChanged={checkMembership}
      extraBottomClearance={TAB_BAR_HEIGHT}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: CE.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
