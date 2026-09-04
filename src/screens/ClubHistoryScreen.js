import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Trophy } from 'lucide-react-native';

import { clubColors, clubRadius, clubSizes } from '../theme/colors';
import MatchHistoryCard from '../components/club/MatchHistoryCard';
import EmptyStateCard from '../components/ds/EmptyStateCard';
import { getClubMatchHistory, getClubEstadisticas, ESTADISTICAS_VACIAS } from '../services/clubMatches';
import { getClubById } from '../services/clubs';
import { temaDeClub } from '../theme/clubThemes';
import { resumenEstadisticas, HISTORIAL_LIMITE_MAX } from '../utils/historialClub';

/**
 * Historial completo de encuentros de un club.
 *
 * params: { clubId, clubNombre }
 *
 * POR QUÉ EXISTE. Hasta la Tarea 6.3, «Ver todo» del historial del perfil
 * llevaba a `ClubChallenges` —la bandeja de retos pendientes—, que no es el
 * historial de nada: en cuanto un club pasaba de tres encuentros confirmados,
 * los anteriores no se podían ver desde la aplicación. `historial_club()`
 * (migración 49) ya devolvía hasta 50; lo que faltaba era la pantalla.
 *
 * NO DECIDE NADA NUEVO. Usa el mismo servicio, la misma normalización y la
 * misma tarjeta que el perfil del club: lo único propio es la lista completa y
 * el encabezado. Duplicar acá la inversión del marcador o el cálculo de V/E/D
 * sería garantizar que algún día las dos pantallas muestren cosas distintas del
 * mismo partido.
 *
 * LO QUE SE VE DEPENDE DE QUIÉN MIRA, y eso lo decide el servidor: la hora
 * exacta y la cancha sólo viajan a los integrantes de los dos clubes del
 * encuentro. Acá no hay ningún `if` de permisos — los campos llegan en `null`
 * y la tarjeta no dibuja esa línea.
 */
export default function ClubHistoryScreen({ navigation, route }) {
  const { clubId, clubNombre } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [club, setClub] = useState(null);
  const [partidos, setPartidos] = useState([]);
  const [error, setError] = useState(null);
  const [estadisticas, setEstadisticas] = useState(ESTADISTICAS_VACIAS);

  const load = useCallback(async () => {
    const [{ data: c }, { data, error: err }, { data: stats }] = await Promise.all([
      getClubById(clubId),
      // El tope real de la RPC, no los tres del perfil.
      getClubMatchHistory(clubId, { limit: HISTORIAL_LIMITE_MAX }),
      getClubEstadisticas(clubId),
    ]);
    setClub(c);
    setPartidos(data || []);
    // «No se pudo leer» y «no hay partidos» son cosas distintas: confundirlas
    // le diría a un club con historial que nunca jugó.
    setError(err || null);
    setEstadisticas(stats || ESTADISTICAS_VACIAS);
    setLoading(false);
  }, [clubId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const resumen = resumenEstadisticas(estadisticas);

  // Un club que todavía no cargó —o uno anterior a la migración 53— resuelve
  // a verde, igual que en `ClubDetailScreen`: esta pantalla mira un solo
  // club, así que el acento es directo, sin la regla de «solo si es mío».
  const tema = temaDeClub(club);

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
          <Text style={styles.headerTitle} numberOfLines={1}>
            Historial de partidos
          </Text>
          {clubNombre ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {clubNombre}
            </Text>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={tema.main} />
        </View>
      ) : (
        <FlatList
          data={partidos}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={tema.main}
              colors={[tema.main]}
            />
          }
          ListHeaderComponent={
            resumen && !error ? <Text style={styles.resumen}>{resumen}</Text> : null
          }
          ListEmptyComponent={
            error ? (
              <EmptyStateCard
                icon={<Trophy color={clubColors.textSecondary} size={18} strokeWidth={2} />}
                title="No se pudo cargar el historial"
                subtitle="Revisa tu conexión y vuelve a intentarlo"
                actionLabel="Reintentar"
                onAction={load}
              />
            ) : (
              <EmptyStateCard
                icon={<Trophy color={clubColors.textSecondary} size={18} strokeWidth={2} />}
                title="Aún no hay partidos en el historial"
                subtitle="Los partidos aparecerán acá cuando tengan un resultado confirmado"
                variant="solid"
              />
            )
          }
          renderItem={({ item }) => (
            <View style={styles.fila}>
              <MatchHistoryCard
                miNombre={item.miNombre}
                miLogoUrl={item.miLogoUrl}
                rivalNombre={item.rivalNombre}
                rivalLogoUrl={item.rivalLogoUrl}
                miMarcador={item.miMarcador}
                suMarcador={item.suMarcador}
                resultado={item.resultado}
                resultadoNombre={item.resultadoNombre}
                fechaLabel={item.fechaLabel}
                horaLabel={item.horaLabel}
                localLabel={item.localLabel}
                canchaNombre={item.canchaNombre}
                onPress={
                  item.soyIntegrante
                    ? () => navigation.navigate('MatchDetail', { matchId: item.id })
                    : null
                }
              />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

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
  headerTitle: {
    color: clubColors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitle: { color: clubColors.textMuted, fontSize: 12, marginTop: 2 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 40, paddingTop: 4 },
  fila: { paddingHorizontal: clubSizes.gutter, paddingBottom: 8 },
  resumen: {
    color: clubColors.textFaint,
    fontSize: 11.5,
    textAlign: 'center',
    paddingHorizontal: clubSizes.gutter,
    paddingBottom: 12,
  },
});
