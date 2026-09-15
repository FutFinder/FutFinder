import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Wallet, Info } from 'lucide-react-native';

import { reservas as C, reservasFonts as F } from '../theme/colors';
import { IconButton, Card, NoticeCard, Button, SectionLabel } from '../components/reservas/ui';
import { getMiBalance } from '../services/reservas';
import { MOTIVO_SIN_CARGA } from '../utils/saldo';
import { formatCLP } from '../services/reservasRules';

/**
 * Mi saldo: cuánto hay y de dónde salió cada peso.
 *
 * NO VIVE EN RESERVAS AUNQUE HOY SOLO SE USE AHÍ. El pago entre capitanes
 * también exige Balance, así que cuando un desafío de clubes ofrezca
 * reservar la cancha el saldo va a importar fuera del vertical. Por eso la
 * casa es Perfil y Reservas tiene un acceso directo: el saldo es de la
 * persona, no de un flujo.
 *
 * EL NÚMERO SIN LA LISTA NO SIRVE. A quien le cobraron su parte de un
 * partido, «$91.000» no le dice nada; «−$9.000 · Cancha 1 · Baby» sí. Por
 * eso la pantalla es el saldo Y su historial, no un dato suelto.
 *
 * «CARGAR SALDO» SE VE APAGADO, CON EL MOTIVO. Esconderlo dejaría a la
 * persona sin saber cómo se carga ni si algún día se podrá; mostrarlo
 * encendido la llevaría a un botón que no hace nada. Apagado y explicado es
 * lo único honesto mientras `cargar_balance` siga revocada (migración 73).
 * El día que existan las credenciales se enciende y ya.
 *
 * UN SALDO QUE NO SE PUDO LEER NO ES CERO. Decir «$0» cuando en realidad no
 * pudimos preguntar es afirmar algo falso sobre la plata de alguien — y ya
 * pasó una vez, cuando `Number(objeto)` daba NaN y se mostraba cero con la
 * cuenta llena.
 */
export default function SaldoScreen({ navigation }) {
  const [balance, setBalance] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    const { data, error: err } = await getMiBalance();
    setBalance(data);
    setError(data ? null : (err?.message || 'No pudimos leer tu saldo.'));
    setCargando(false);
    setRefrescando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const refrescar = () => { setRefrescando(true); cargar(); };

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <Text style={styles.headerTitle}>Mi saldo</Text>
      </View>

      {cargando ? (
        <View style={styles.center}><ActivityIndicator color={C.green} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={C.green} />
          }
        >
          <Card>
            <View style={styles.montoFila}>
              <Wallet color={C.green} size={20} strokeWidth={2.2} />
              <Text style={styles.montoK}>Disponible</Text>
            </View>
            <Text style={styles.monto}>
              {balance ? formatCLP(balance.saldo) : '—'}
            </Text>
            <Text style={styles.montoNota}>
              Se usa para pagar tu parte cuando dividen la cuenta de una cancha.
            </Text>
          </Card>

          {error ? <NoticeCard tone="warning">{error}</NoticeCard> : null}

          <View>
            <Button label="Cargar saldo" variant="secondary" disabled />
            <Text style={styles.motivo}>{MOTIVO_SIN_CARGA}</Text>
          </View>

          {balance ? (
            <>
              <SectionLabel>Movimientos</SectionLabel>
              {balance.movimientos.length === 0 ? (
                <NoticeCard tone="info" icon={Info}>
                  Todavía no hay movimientos. Acá va a aparecer cada carga y cada parte que pagues.
                </NoticeCard>
              ) : (
                <Card padded={false} style={{ paddingVertical: 4 }}>
                  {balance.movimientos.map((m) => (
                    <View key={m.id} style={styles.fila}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.titulo}>{m.titulo}</Text>
                        {m.detalle ? (
                          <Text style={styles.detalle} numberOfLines={1}>{m.detalle}</Text>
                        ) : null}
                        <Text style={styles.cuando}>{m.cuandoTexto}</Text>
                      </View>
                      <Text style={[styles.movMonto, m.entra ? styles.entra : styles.sale]}>
                        {m.entra ? '+' : '−'}{formatCLP(Math.abs(m.monto))}
                      </Text>
                    </View>
                  ))}
                </Card>
              )}
              {balance.hayMas ? (
                <Text style={styles.motivo}>
                  Mostrando los últimos {balance.movimientos.length} de {balance.totalMovimientos}.
                </Text>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  headerTitle: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 17, letterSpacing: -0.2 },

  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40, gap: 14 },

  montoFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  montoK: { fontFamily: F.bold, fontSize: 12.5, color: C.textSecondary, letterSpacing: 0.3 },
  monto: { fontFamily: F.extraBold, fontSize: 34, color: C.textPrimary, letterSpacing: -0.8, marginTop: 8 },
  montoNota: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, lineHeight: 18, marginTop: 8 },

  motivo: { fontFamily: F.medium, fontSize: 12, color: C.textMuted, lineHeight: 17, marginTop: 8, paddingHorizontal: 2 },

  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  titulo: { fontFamily: F.bold, fontSize: 14, color: C.textPrimary },
  detalle: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 3 },
  cuando: { fontFamily: F.medium, fontSize: 11, color: C.textMuted, marginTop: 3 },
  movMonto: { fontFamily: F.extraBold, fontSize: 15 },
  entra: { color: C.green },
  sale: { color: C.textPrimary },
});
