import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Wallet } from 'lucide-react-native';

import { paleta as C, radios as R, medidas as S } from '../theme/colors';

/**
 * Acceso al saldo, arriba a la derecha, a la izquierda de la campana.
 *
 * VIVE EN EL HEADER Y NO EN UNA LISTA porque el saldo no es de un vertical:
 * se gasta reservando canchas, pero el pago entre capitanes también exige
 * Balance, así que en cuanto un desafío de clubes ofrezca reservar, va a
 * importar desde Partidos igual que desde Reservas. Un lugar fijo en las
 * tres pestañas es lo único que no obliga a moverlo después.
 *
 * NO MUESTRA EL MONTO, solo el símbolo. Traerlo obligaría a una consulta
 * por pestaña cada vez que alguien cambia de tab, para un número que está a
 * un toque de distancia. Y un saldo recién cargado que todavía no llegó se
 * vería como «$0» en la barra superior, que es el peor lugar donde mentir.
 *
 * Mismo tamaño, borde y fondo que `NotificationBell`, y por el mismo motivo
 * usa los tokens fijos de `reservas` y no los de la pantalla que lo aloja:
 * las dos se leen como un par y tienen que verse igual en toda la app.
 */
export default function WalletButton({ style }) {
  const navigation = useNavigation();

  return (
    <Pressable
      onPress={() => navigation.navigate('Saldo')}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Mi saldo"
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.75 }, style]}
    >
      <Wallet color={C.textPrimary} size={19} strokeWidth={1.8} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: S.iconBtn,
    height: S.iconBtn,
    borderRadius: R.iconBtn,
    backgroundColor: 'rgba(25,29,26,0.8)',
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
