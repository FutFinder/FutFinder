import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, ChevronLeft, ChevronRight, CalendarX } from 'lucide-react-native';

import { clubColors, clubRadius, clubSizes } from '../theme/colors';
import { temaDeClub } from '../theme/clubThemes';
import EmptyStateCard from '../components/ds/EmptyStateCard';
import { getClubMatchCalendar } from '../services/clubMatches';
import { getClubById } from '../services/clubs';
import { agruparPorFecha, diasDelMes, nombreMes, ETIQUETAS_SEMANA } from '../utils/calendarioClub';

/**
 * Calendario de partidos del club: pasados (con resultado confirmado) y
 * programados desde un desafío que la otra parte ya aceptó, en una sola
 * grilla mensual.
 *
 * params: { clubId, clubNombre }
 *
 * NO ES UNA CONSULTA NUEVA: combina las dos que ya existían —el historial
 * confirmado de `getClubMatchHistory()` y lo programado de
 * `listPartidosDeClub()`— en `getClubMatchCalendar()`. Ver
 * `utils/calendarioClub.js` para qué entra y qué se deja afuera a propósito.
 */
export default function ClubMatchCalendarScreen({ navigation, route }) {
  const { clubId, clubNombre } = route.params || {};
  const hoy = new Date();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [entradas, setEntradas] = useState([]);
  const [club, setClub] = useState(null);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [fechaSeleccionada, setFechaSeleccionada] = useState(null);

  const load = useCallback(async () => {
    const [{ data: c }, { data: calendario, error: err }] = await Promise.all([
      getClubById(clubId),
      getClubMatchCalendar(clubId),
    ]);
    setClub(c);
    setEntradas(calendario || []);
    setError(err || null);
    setLoading(false);
  }, [clubId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const tema = temaDeClub(club);
  const agrupadas = useMemo(() => agruparPorFecha(entradas), [entradas]);
  const dias = useMemo(() => diasDelMes(anio, mes), [anio, mes]);
  const hoyISO = fechaISO(hoy);

  const cambiarMes = (delta) => {
    setFechaSeleccionada(null);
    let siguienteMes = mes + delta;
    let siguienteAnio = anio;
    if (siguienteMes > 12) { siguienteMes = 1; siguienteAnio += 1; }
    if (siguienteMes < 1) { siguienteMes = 12; siguienteAnio -= 1; }
    setMes(siguienteMes);
    setAnio(siguienteAnio);
  };

  const entradasDelDia = fechaSeleccionada ? agrupadas.get(fechaSeleccionada) || [] : [];

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Volver"
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <ArrowLeft color={clubColors.textPrimary} size={20} strokeWidth={2.2} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>Calendario de partidos</Text>
          {clubNombre ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>{clubNombre}</Text>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={tema.main} />
        </View>
      ) : error ? (
        <View style={styles.listContent}>
          <EmptyStateCard
            icon={<CalendarX color={clubColors.textSecondary} size={18} strokeWidth={2} />}
            title="No se pudo cargar el calendario"
            subtitle="Revisa tu conexión y vuelve a intentarlo"
            actionLabel="Reintentar"
            onAction={load}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          <View style={styles.mesRow}>
            <Pressable
              onPress={() => cambiarMes(-1)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Mes anterior"
              style={({ pressed }) => [styles.mesBtn, pressed && { opacity: 0.6 }]}
            >
              <ChevronLeft color={clubColors.textPrimary} size={18} strokeWidth={2.4} />
            </Pressable>
            <Text style={styles.mesTexto}>{nombreMes(anio, mes)} {anio}</Text>
            <Pressable
              onPress={() => cambiarMes(1)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Mes siguiente"
              style={({ pressed }) => [styles.mesBtn, pressed && { opacity: 0.6 }]}
            >
              <ChevronRight color={clubColors.textPrimary} size={18} strokeWidth={2.4} />
            </Pressable>
          </View>

          <View style={styles.semanaRow}>
            {ETIQUETAS_SEMANA.map((letra, i) => (
              <Text key={i} style={styles.semanaLetra}>{letra}</Text>
            ))}
          </View>

          <View style={styles.grilla}>
            {dias.map((d) => {
              const tieneEntradas = agrupadas.has(d.fecha);
              const esHoy = d.fecha === hoyISO;
              const seleccionado = d.fecha === fechaSeleccionada;
              return (
                <Pressable
                  key={d.fecha}
                  disabled={!tieneEntradas}
                  onPress={() => setFechaSeleccionada(seleccionado ? null : d.fecha)}
                  style={styles.celda}
                  accessibilityRole={tieneEntradas ? 'button' : undefined}
                  accessibilityLabel={tieneEntradas ? `Partido el ${d.dia}` : undefined}
                >
                  <View
                    style={[
                      styles.celdaCirculo,
                      seleccionado && { backgroundColor: tema.main },
                      !seleccionado && esHoy && { borderWidth: 1.5, borderColor: tema.main },
                    ]}
                  >
                    <Text
                      style={[
                        styles.celdaTexto,
                        !d.enMes && styles.celdaTextoApagado,
                        seleccionado && { color: tema.ink, fontWeight: '800' },
                      ]}
                    >
                      {d.dia}
                    </Text>
                  </View>
                  {tieneEntradas ? (
                    <View style={[styles.punto, { backgroundColor: tema.main }]} />
                  ) : (
                    <View style={styles.puntoHueco} />
                  )}
                </Pressable>
              );
            })}
          </View>

          {fechaSeleccionada ? (
            <View style={styles.detalle}>
              {entradasDelDia.map((e) => (
                <EntradaDetalle
                  key={e.id}
                  entrada={e}
                  tema={tema}
                  onVerPartido={
                    e.jugado && e.soyIntegrante === false
                      ? null
                      : () => navigation.navigate('MatchDetail', { matchId: e.id })
                  }
                />
              ))}
            </View>
          ) : entradas.length === 0 ? (
            <EmptyStateCard
              icon={<CalendarX color={clubColors.textSecondary} size={18} strokeWidth={2} />}
              title="Aún no hay partidos que mostrar"
              subtitle="Acá van a aparecer los que ya jugaron y los que se programen cuando un desafío sea aceptado"
              variant="solid"
            />
          ) : (
            <Text style={styles.pista}>Toca un día marcado para ver el partido</Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function EntradaDetalle({ entrada, tema, onVerPartido }) {
  const estado = entrada.jugado ? entrada.resultadoNombre : 'Programado';
  const colorEstado = !entrada.jugado
    ? clubColors.textSecondary
    : entrada.resultado === 'V'
      ? tema.main
      : entrada.resultado === 'D'
        ? clubColors.loss
        : clubColors.textSecondary;

  return (
    <Pressable
      onPress={onVerPartido || undefined}
      disabled={!onVerPartido}
      style={({ pressed }) => [styles.tarjeta, pressed && onVerPartido && { opacity: 0.85 }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.tarjetaRival} numberOfLines={1}>vs {entrada.rivalNombre}</Text>
        <Text style={[styles.tarjetaEstado, { color: colorEstado }]}>
          {estado}
          {entrada.jugado ? ` · ${entrada.esLocal ? entrada.miMarcador : entrada.suMarcador}-${entrada.esLocal ? entrada.suMarcador : entrada.miMarcador}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

/** 'YYYY-MM-DD' en hora local, para comparar contra `diasDelMes()`. */
function fechaISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const CELDA = `${100 / 7}%`;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: clubColors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: clubSizes.gutter,
    paddingVertical: 10,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: clubRadius.md,
    backgroundColor: clubColors.surface,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, minWidth: 0 },
  headerTitle: { color: clubColors.textPrimary, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  headerSubtitle: { color: clubColors.textMuted, fontSize: 12, marginTop: 2 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: clubSizes.gutter, paddingBottom: 40, paddingTop: 4 },

  mesRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14,
  },
  mesBtn: {
    width: 34, height: 34, borderRadius: clubRadius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: clubColors.surface, borderWidth: 1, borderColor: clubColors.borderSoft,
  },
  mesTexto: { color: clubColors.textPrimary, fontSize: 15.5, fontWeight: '800', letterSpacing: -0.2 },

  semanaRow: { flexDirection: 'row', marginBottom: 6 },
  semanaLetra: {
    width: CELDA, textAlign: 'center', color: clubColors.textFaint, fontSize: 11, fontWeight: '700',
  },

  grilla: { flexDirection: 'row', flexWrap: 'wrap' },
  celda: { width: CELDA, alignItems: 'center', paddingVertical: 5, gap: 4 },
  celdaCirculo: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
  },
  celdaTexto: { color: clubColors.textSecondary, fontSize: 13, fontWeight: '600' },
  celdaTextoApagado: { color: clubColors.textFaint },
  punto: { width: 5, height: 5, borderRadius: 999 },
  puntoHueco: { width: 5, height: 5 },

  detalle: { marginTop: 18, gap: 8 },
  pista: {
    marginTop: 18, textAlign: 'center', color: clubColors.textFaint, fontSize: 12,
  },
  tarjeta: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: clubColors.surface, borderWidth: 1, borderColor: clubColors.borderSoft,
    borderRadius: clubRadius.md, padding: 14,
  },
  tarjetaRival: { color: clubColors.textPrimary, fontSize: 14, fontWeight: '700' },
  tarjetaEstado: { fontSize: 12.5, fontWeight: '600', marginTop: 3 },
});
