import React, { useCallback } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Wallet } from 'lucide-react-native';

import { paleta as C, radios as R, medidas as S, fuentes as F } from '../theme/colors';
import { useSaldo } from '../contexts/SaldoContext';
import { formatCLP } from '../services/reservasRules';

/**
 * Acceso al saldo, arriba a la derecha, a la izquierda de la campana.
 *
 * VIVE EN EL HEADER Y NO EN UNA LISTA porque el saldo no es de un vertical:
 * se gasta reservando canchas, pero el pago entre capitanes también exige
 * Balance, así que en cuanto un desafío de clubes ofrezca reservar, va a
 * importar desde Partidos igual que desde Reservas. Un lugar fijo en las
 * tres pestañas es lo único que no obliga a moverlo después.
 *
 * SÍ MUESTRA EL MONTO — pedido explícito, revirtiendo la decisión anterior
 * de sólo el símbolo. Las dos razones de esa decisión seguían siendo
 * ciertas y están resueltas, no ignoradas: el número sale de `SaldoContext`,
 * UN SOLO proveedor que envuelve las pestañas (ver `MainTabs`), así que
 * cambiar de tab no dispara una consulta nueva — sólo relee lo que ya
 * cargó el proveedor y, si hace falta, lo refresca en segundo plano al
 * enfocar. Y mientras el saldo real no ha llegado (`null`, no `0`), no se
 * dibuja ningún monto junto al ícono — nunca un «$0» mentiroso en la barra
 * superior.
 *
 * Mismo alto, borde y fondo que `NotificationBell`; con el monto crece a
 * pastilla en vez de círculo, y por el mismo motivo de siempre usa los
 * tokens fijos de `reservas` y no los de la pantalla que lo aloja: las dos
 * se leen como un par y tienen que verse igual en toda la app.
 */
export default function WalletButton({ style }) {
  const navigation = useNavigation();
  const { saldo, refresh } = useSaldo();

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  return (
    <Pressable
      onPress={() => navigation.navigate('Saldo')}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={saldo !== null ? `Mi saldo, ${formatCLP(saldo)}` : 'Mi saldo'}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.75 }, style]}
    >
      <Wallet color={C.textPrimary} size={19} strokeWidth={1.8} />
      {saldo !== null && <Text style={styles.saldoText}>{formatCLP(saldo)}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: S.iconBtn,
    height: S.iconBtn,
    paddingHorizontal: 10,
    borderRadius: R.pill,
    backgroundColor: 'rgba(25,29,26,0.8)',
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: 'center',
  },
  saldoText: {
    color: C.textPrimary,
    fontSize: 13,
    fontFamily: F.bold,
  },
});
