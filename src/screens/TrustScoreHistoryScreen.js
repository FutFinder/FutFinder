import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Minus, ShieldCheck, TrendingUp, TrendingDown } from 'lucide-react-native';

import { paleta as C, radios as R, fuentes as F, alfa } from '../theme/colors';
import { getTrustScoreHistory } from '../services/settings';
import { getMyProfile } from '../services/profile';
import {
  getTrueScoreAjustes,
  listMisEventosTrueScore,
  misReclamos,
  reclamarMarca,
} from '../services/trueScore';
import {
  describirEvento,
  fusionarHistorial,
  nivelTrueScore,
  puedeReclamar,
  textoEstadoReclamo,
} from '../utils/trueScore';

// Cuántos movimientos trae cada página. El historial de TrueScore es
// inmutable y crece para siempre: la pantalla pedía 100 y ahí se acababa,
// aunque el cambio prometía acceso a CADA movimiento.
const POR_PAGINA = 50;

// Con TrueScore el historial sale del registro de eventos (migración 134);
// sin él, de `trust_score_history`. Las dos se muestran con la misma fila.
function filaVieja(item) {
  const n = Number(item.change_amount) || 0;
  return {
    id: item.id,
    titulo: item.reason,
    detalle: '',
    cambio: n > 0 ? `+${n}` : `${n}`,
    tono: n > 0 ? 'positivo' : n < 0 ? 'negativo' : 'neutro',
    fecha: item.created_at,
  };
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-CL', {
      day: '2-digit', month: 'short', year: 'numeric',
    }) + ' · ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function HistoryItem({ item, reclamo, reclamable, reclamando, onReclamar }) {
  const color =
    item.tono === 'positivo' ? C.green : item.tono === 'negativo' ? C.red : C.textSecondary;
  const Icon =
    item.tono === 'positivo' ? TrendingUp : item.tono === 'negativo' ? TrendingDown : Minus;

  return (
    <View style={styles.item}>
      <View style={[styles.iconBubble, { backgroundColor: alfa(color, 0.12) }]}>
        <Icon color={color} size={16} />
      </View>
      <View style={styles.itemInfo}>
        <Text style={styles.itemReason}>{item.titulo}</Text>
        {item.detalle ? <Text style={styles.itemDetail}>{item.detalle}</Text> : null}
        <Text style={styles.itemDate}>{formatDate(item.fecha)}</Text>
        {reclamo ? <Text style={styles.claimText}>{textoEstadoReclamo(reclamo)}</Text> : null}
        {reclamable ? (
          <Pressable
            onPress={onReclamar}
            disabled={reclamando}
            accessibilityRole="button"
            accessibilityLabel="Reclamar esta marca"
            style={({ pressed }) => [styles.claimBtn, (pressed || reclamando) && { opacity: 0.7 }]}
          >
            {reclamando ? (
              <ActivityIndicator color={C.green} size="small" />
            ) : (
              <Text style={styles.claimBtnText}>Reclamar: sí estuve a tiempo</Text>
            )}
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.itemChange, { color }]}>{item.cambio}</Text>
    </View>
  );
}

export default function TrustScoreHistoryScreen({ navigation }) {
  const [history, setHistory] = useState([]);
  const [trustScore, setTrustScore] = useState(null);
  const [racha, setRacha] = useState(null);
  const [ajustes, setAjustes] = useState(null);
  const [loading, setLoading] = useState(true);
  // Paginación: si quedan páginas, si una está en vuelo, y si la última falló.
  const [hayMas, setHayMas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [errorMas, setErrorMas] = useState(null);
  // Fase 2: reclamos por evento y el que se está enviando.
  const [reclamos, setReclamos] = useState({});
  const [reclamando, setReclamando] = useState(null);
  const [aviso, setAviso] = useState(null);
  const ts = !!ajustes?.fase1;
  const nivel = ts ? nivelTrueScore(trustScore, ajustes.niveles) : null;
  const colorNivel =
    nivel?.color === 'amarillo' ? C.amber : nivel?.color === 'rojo' ? C.red : C.green;

  const load = useCallback(async () => {
    const [a, profile] = await Promise.all([getTrueScoreAjustes(), getMyProfile()]);
    setAjustes(a);
    setErrorMas(null);
    if (a.fase1) {
      const [pagina, rec] = await Promise.all([
        listMisEventosTrueScore({ limite: POR_PAGINA }),
        a.fase2 ? misReclamos() : Promise.resolve({}),
      ]);
      setHistory(pagina.data.map((e) => ({ ...describirEvento(e), raw: e })));
      setHayMas(pagina.hayMas);
      setReclamos(rec);
    } else {
      const pagina = await getTrustScoreHistory(POR_PAGINA);
      setHistory((pagina.data || []).map(filaVieja));
      setHayMas(pagina.hayMas);
    }
    setTrustScore(profile?.trust_score ?? null);
    setRacha(profile?.truescore_racha ?? null);
    setLoading(false);
  }, []);

  /**
   * La página siguiente, desde la última fila cargada hacia atrás.
   *
   * El cursor es el final de lo que ya está en pantalla, no un `offset`: si
   * llega un evento nuevo mientras el jugador baja, la ventana no se corre y
   * no se repite ni se salta ninguna fila. `fusionarHistorial` descarta
   * además las repetidas del borde que devuelve el historial antiguo.
   */
  const cargarMas = useCallback(async () => {
    if (cargandoMas || !hayMas || loading) return;
    const ultima = history[history.length - 1];
    if (!ultima) return;
    setCargandoMas(true);
    setErrorMas(null);
    const pagina = ajustes?.fase1
      ? await listMisEventosTrueScore({ limite: POR_PAGINA, antesDe: ultima.raw?.id })
      : await getTrustScoreHistory(POR_PAGINA, { antesDe: ultima.fecha });
    setCargandoMas(false);
    if (pagina.error) {
      setErrorMas('No pudimos cargar más movimientos. Inténtalo de nuevo.');
      return;
    }
    const filas = ajustes?.fase1
      ? pagina.data.map((e) => ({ ...describirEvento(e), raw: e }))
      : (pagina.data || []).map(filaVieja);
    // La fusión se calcula aquí, no dentro del actualizador: `history` ya está
    // en las dependencias y así `agregadas` se lee sin depender de cuándo
    // React ejecute la función de actualización.
    const { filas: fusionadas, agregadas } = fusionarHistorial(history, filas);
    setHistory(fusionadas);
    // Una página entera de repetidas —todas del mismo segundo en el historial
    // antiguo— no avanza: sin esto el cursor se quedaría pegado pidiendo lo
    // mismo para siempre.
    setHayMas(pagina.hayMas && agregadas > 0);
  }, [ajustes, cargandoMas, hayMas, history, loading]);

  useEffect(() => { load(); }, [load]);

  const reclamar = async (evento) => {
    if (reclamando) return;
    setReclamando(evento.id);
    setAviso(null);
    const res = await reclamarMarca(evento.match_id);
    setReclamando(null);
    if (!res?.ok) {
      setAviso({ tono: 'error', texto: res?.reason || 'No pudimos enviar el reclamo.' });
      return;
    }
    setAviso({
      tono: 'ok',
      texto: `Reclamo enviado. Avisamos a tus compañeros: si ${ajustes?.reclamo_confirmaciones ?? 2} confirman que estuviste, se corrige tu TrueScore.`,
    });
    await load();
  };

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <ArrowLeft color={C.textPrimary} size={20} />
        </Pressable>
        <Text style={styles.headerTitle}>{ts ? 'TrueScore' : 'Trust Score'}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Score actual */}
      <View style={styles.scoreCard}>
        <ShieldCheck color={colorNivel} size={28} />
        <Text style={[styles.scoreValue, { color: colorNivel }]}>{trustScore ?? '—'}</Text>
        <Text style={styles.scoreLabel}>
          {nivel ? nivel.nombre : 'Puntuación actual'}
          {ts && racha > 0 ? ` · racha de ${racha} ${racha === 1 ? 'partido' : 'partidos'}` : ''}
        </Text>
        <Text style={styles.scoreHint}>
          {ts
            ? 'Tu TrueScore sube cada vez que asistes a tiempo, y más con cada partido seguido. Baja si te sales, llegas tarde o no vas sin avisar.'
            : 'El Trust Score refleja tu confiabilidad como jugador. Aumenta al confirmar asistencia por GPS.'}
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.green} />
        </View>
      ) : history.length === 0 ? (
        <View style={styles.empty}>
          <ShieldCheck color={C.textMuted} size={40} />
          <Text style={styles.emptyTitle}>Sin historial aún</Text>
          <Text style={styles.emptyText}>
            {ts
              ? 'Cuando juegues tu primer partido verás aquí cada cambio de tu TrueScore.'
              : 'Confirma tu asistencia a partidos por GPS para ver los cambios aquí.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(item) => String(item.id)}
          ListHeaderComponent={
            aviso ? (
              <Text style={[styles.aviso, aviso.tono === 'error' && { color: C.red }]}>{aviso.texto}</Text>
            ) : null
          }
          renderItem={({ item }) => {
            const reclamo = item.raw ? reclamos[item.raw.id] : null;
            return (
              <HistoryItem
                item={item}
                reclamo={reclamo}
                reclamable={
                  !!item.raw &&
                  puedeReclamar(item.raw, {
                    fase2: !!ajustes?.fase2,
                    plazoHoras: ajustes?.reclamo_plazo_horas ?? 48,
                    reclamo,
                  })
                }
                reclamando={reclamando === item.id}
                onReclamar={() => reclamar(item.raw)}
              />
            );
          }}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          onEndReached={cargarMas}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            cargandoMas ? (
              <ActivityIndicator color={C.green} style={{ marginTop: 16 }} />
            ) : errorMas ? (
              <Pressable
                onPress={cargarMas}
                accessibilityRole="button"
                style={({ pressed }) => [styles.masBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.masError}>{errorMas}</Text>
                <Text style={styles.masBtnText}>Reintentar</Text>
              </Pressable>
            ) : hayMas ? (
              <Pressable
                onPress={cargarMas}
                accessibilityRole="button"
                style={({ pressed }) => [styles.masBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.masBtnText}>Ver más movimientos</Text>
              </Pressable>
            ) : history.length > POR_PAGINA ? (
              <Text style={styles.finLista}>Ese es tu historial completo.</Text>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    color: C.textPrimary,
    fontSize: 18, fontFamily: F.extraBold, letterSpacing: -0.3,
  },

  scoreCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: C.surfaceAlt,
    borderRadius: R.cardSm,
    borderWidth: 1,
    borderColor: C.borderSoft,
    alignItems: 'center',
    padding: 24,
    gap: 6,
  },
  scoreValue: {
    color: C.green,
    fontSize: 52, fontFamily: F.extraBold, letterSpacing: -1,
    marginTop: 4,
  },
  scoreLabel: {
    color: C.textSecondary,
    fontSize: 13, fontFamily: F.semiBold,
  },
  scoreHint: {
    color: C.textMuted,
    fontSize: 12, lineHeight: 17, textAlign: 'center',
    marginTop: 8, paddingHorizontal: 8,
  },

  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 40, gap: 12,
  },
  emptyTitle: {
    color: C.textPrimary,
    fontSize: 17, fontFamily: F.bold,
  },
  emptyText: {
    color: C.textSecondary,
    fontSize: 14, lineHeight: 20, textAlign: 'center',
  },

  list: { paddingHorizontal: 16, paddingBottom: 32 },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceAlt,
    borderRadius: R.row,
    padding: 14,
    gap: 12,
  },
  iconBubble: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  itemInfo: { flex: 1 },
  itemReason: {
    color: C.textPrimary,
    fontSize: 14, fontFamily: F.semiBold, marginBottom: 2,
  },
  itemDetail: { color: C.textSecondary, fontSize: 12.5, lineHeight: 17, marginBottom: 2 },
  itemDate: { color: C.textMuted, fontSize: 12 },
  claimText: { color: C.textSecondary, fontSize: 12, marginTop: 6 },
  claimBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: C.greenBorder,
    backgroundColor: alfa(C.green, 0.1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  claimBtnText: { color: C.green, fontSize: 12.5, fontFamily: F.bold },
  aviso: { color: C.green, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  masBtn: { alignItems: 'center', gap: 6, paddingVertical: 16 },
  masBtnText: { color: C.green, fontSize: 13, fontFamily: F.bold },
  masError: { color: C.red, fontSize: 12.5, textAlign: 'center' },
  finLista: {
    color: C.textMuted,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 16,
  },
  itemChange: {
    fontSize: 18, fontFamily: F.extraBold,
    flexShrink: 0,
  },

  separator: { height: 8 },
});
