import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CalendarX,
  Clock,
  MapPin,
  Search,
  Swords,
} from 'lucide-react-native';

import { clubColors, clubRadius, clubSizes } from '../theme/colors';
import { temaDeClub } from '../theme/clubThemes';
import EmptyStateCard from '../components/ds/EmptyStateCard';
import { getClubMatchCalendar } from '../services/clubMatches';
import { getClubById } from '../services/clubs';
import {
  agruparPorFecha,
  diasDelMes,
  nombreMes,
  ETIQUETAS_SEMANA,
  mesDeFundacion,
  esMesAnteriorAFundacion,
} from '../utils/calendarioClub';

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
 *
 * NO SE PUEDE RETROCEDER ANTES DE QUE EL CLUB EXISTIERA: `clubs.created_at`
 * fija el mes más antiguo navegable (`mesDeFundacion()`), porque un club no
 * pudo jugar un partido antes de fundarse.
 *
 * TODO DÍA DEL MES SE PUEDE TOCAR, tenga o no partido: uno sin partido
 * ofrece «Buscar rival» (real, abre el explorador de clubes) y «Publicar un
 * desafío» (todavía no implementado — no existe hoy un desafío "abierto"
 * sin rival elegido, así que el botón avisa «muy pronto» en vez de fingir
 * que hace algo).
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
  const [avisoPublicar, setAvisoPublicar] = useState(false);

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
  const fundacion = useMemo(() => mesDeFundacion(club?.created_at), [club]);
  const agrupadas = useMemo(() => agruparPorFecha(entradas), [entradas]);
  const dias = useMemo(() => diasDelMes(anio, mes), [anio, mes]);
  const hoyISO = fechaISO(hoy);
  const noSePuedeRetroceder = useMemo(() => {
    const anterior = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
    return esMesAnteriorAFundacion(anterior.anio, anterior.mes, fundacion);
  }, [anio, mes, fundacion]);
  // El primer día del mes de fundación, como 'YYYY-MM-DD': cualquier fecha
  // anterior a esa no se puede tocar, aunque caiga dentro del mes que se
  // está mirando (el club se fundó a mitad de mes, por ejemplo).
  const fundacionISO = useMemo(
    () => (fundacion ? `${String(fundacion.anio).padStart(4, '0')}-${String(fundacion.mes).padStart(2, '0')}-01` : null),
    [fundacion]
  );

  const cambiarMes = (delta) => {
    setFechaSeleccionada(null);
    setAvisoPublicar(false);
    let siguienteMes = mes + delta;
    let siguienteAnio = anio;
    if (siguienteMes > 12) { siguienteMes = 1; siguienteAnio += 1; }
    if (siguienteMes < 1) { siguienteMes = 12; siguienteAnio -= 1; }
    if (esMesAnteriorAFundacion(siguienteAnio, siguienteMes, fundacion)) return;
    setMes(siguienteMes);
    setAnio(siguienteAnio);
  };

  const seleccionarDia = (fecha) => {
    setAvisoPublicar(false);
    setFechaSeleccionada((actual) => (actual === fecha ? null : fecha));
  };

  const entradasDelDia = fechaSeleccionada ? agrupadas.get(fechaSeleccionada) || [] : [];
  const diaSinPartidos = fechaSeleccionada != null && entradasDelDia.length === 0;

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
              disabled={noSePuedeRetroceder}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Mes anterior"
              style={({ pressed }) => [
                styles.mesBtn,
                noSePuedeRetroceder && styles.mesBtnApagado,
                pressed && !noSePuedeRetroceder && { opacity: 0.6 },
              ]}
            >
              <ChevronLeft
                color={noSePuedeRetroceder ? clubColors.textFaint : clubColors.textPrimary}
                size={18}
                strokeWidth={2.4}
              />
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
              const esPasado = d.fecha < hoyISO;
              const seleccionado = d.fecha === fechaSeleccionada;
              const fueraDeRango = !d.enMes || (fundacionISO != null && d.fecha < fundacionISO);
              return (
                <Pressable
                  key={d.fecha}
                  disabled={fueraDeRango}
                  onPress={() => seleccionarDia(d.fecha)}
                  style={styles.celda}
                  accessibilityRole={fueraDeRango ? undefined : 'button'}
                  accessibilityLabel={
                    fueraDeRango
                      ? undefined
                      : tieneEntradas
                        ? `Ver partido del ${d.dia}`
                        : `Sin partidos el ${d.dia}`
                  }
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
                        (esPasado || fueraDeRango) && styles.celdaTextoApagado,
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

          {entradasDelDia.length > 0 ? (
            <View style={styles.detalle}>
              {entradasDelDia.map((e) => (
                <EntradaDetalle
                  key={e.id}
                  entrada={e}
                  tema={tema}
                  onVerPartido={
                    e.soyIntegrante === false
                      ? null
                      : () => navigation.navigate('MatchDetail', { matchId: e.id })
                  }
                />
              ))}
            </View>
          ) : diaSinPartidos ? (
            <View style={styles.sinPartidos}>
              <Text style={styles.sinPartidosTitulo}>No tienes partidos para esta fecha</Text>
              <View style={{ gap: 9, marginTop: 14 }}>
                <Pressable
                  onPress={() => navigation.navigate('ExploreClubs', { modoRival: true, retadorClubId: clubId })}
                  accessibilityRole="button"
                  accessibilityLabel="Buscar rival para este día"
                  style={({ pressed }) => [
                    styles.accionBtn,
                    { backgroundColor: tema.soft, borderColor: tema.border },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Search color={tema.main} size={16} strokeWidth={2.2} />
                  <Text style={[styles.accionTexto, { color: tema.main }]}>Buscar rival</Text>
                </Pressable>
                <Pressable
                  onPress={() => setAvisoPublicar(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Publicar un desafío para este día"
                  style={({ pressed }) => [styles.accionBtn, styles.accionBtnGhost, pressed && { opacity: 0.8 }]}
                >
                  <Swords color={clubColors.textSecondary} size={16} strokeWidth={2.2} />
                  <Text style={[styles.accionTexto, { color: clubColors.textSecondary }]}>Publicar un desafío</Text>
                </Pressable>
                {avisoPublicar ? (
                  <Text style={styles.avisoPublicar}>
                    Muy pronto: hoy un desafío siempre se manda a un rival elegido, no se publica abierto.
                  </Text>
                ) : null}
              </View>
            </View>
          ) : entradas.length === 0 ? (
            <EmptyStateCard
              icon={<CalendarX color={clubColors.textSecondary} size={18} strokeWidth={2} />}
              title="Aún no hay partidos que mostrar"
              subtitle="Acá van a aparecer los que ya jugaron y los que se programen cuando un desafío sea aceptado"
              variant="solid"
            />
          ) : (
            <Text style={styles.pista}>Toca cualquier día para ver o buscar un partido</Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function EntradaDetalle({ entrada, tema, onVerPartido }) {
  const estado = entrada.jugado ? entrada.resultadoNombre : 'Programado';
  const colorEstado = !entrada.jugado
    ? tema.main
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
        {entrada.horaLabel || entrada.lugar ? (
          <View style={{ gap: 4, marginTop: 8 }}>
            {entrada.horaLabel ? (
              <View style={styles.tarjetaFila}>
                <Clock color={clubColors.textFaint} size={13} strokeWidth={2.2} />
                <Text style={styles.tarjetaFilaTexto}>{entrada.horaLabel}</Text>
              </View>
            ) : null}
            {entrada.lugar ? (
              <View style={styles.tarjetaFila}>
                <MapPin color={clubColors.textFaint} size={13} strokeWidth={2.2} />
                <Text style={styles.tarjetaFilaTexto} numberOfLines={1}>{entrada.lugar}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
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
  mesBtnApagado: { opacity: 0.4 },
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
  tarjetaFila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tarjetaFilaTexto: { color: clubColors.textMuted, fontSize: 12 },

  sinPartidos: {
    marginTop: 18, backgroundColor: clubColors.surface, borderWidth: 1, borderColor: clubColors.borderSoft,
    borderRadius: clubRadius.md, padding: 16,
  },
  sinPartidosTitulo: { color: clubColors.textPrimary, fontSize: 14.5, fontWeight: '700', textAlign: 'center' },
  accionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 44, borderRadius: clubRadius.md, borderWidth: 1,
  },
  accionBtnGhost: { backgroundColor: clubColors.surfaceAlt, borderColor: clubColors.borderSoft },
  accionTexto: { fontSize: 13.5, fontWeight: '700' },
  avisoPublicar: {
    color: clubColors.textFaint, fontSize: 11.5, lineHeight: 16, textAlign: 'center', marginTop: 2,
  },
});
