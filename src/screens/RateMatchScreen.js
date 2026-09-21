import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Star,
  Clock,
  Shield,
  Zap,
  Check,
  ServerCrash,
} from 'lucide-react-native';

import { paleta as C, radios as R, fuentes as F } from '../theme/colors';
import { getMatchById } from '../services/matches';
import { partidoAdmiteEvaluaciones } from '../services/matchRules';
import {
  getRatableAttendees,
  submitRatings,
} from '../services/ratings';
import { notify } from '../utils/notify';
import { PrimaryButton } from '../components/partidos/ui';

/**
 * Pantalla "Calificar partido".
 *
 * Recibe `matchId` por params.
 * Lista a los compañeros confirmados_gps. Para cada uno tres ratings
 * (puntualidad, fairplay, nivel) de 1-5 ★ y un comentario opcional.
 * Botón Submit al final manda todo de una.
 */

function StarRow({ label, Icon, value, onChange }) {
  return (
    <View style={styles.starBlock}>
      <View style={styles.starHeader}>
        <Icon color={C.textSecondary} size={14} />
        <Text style={styles.starLabel}>{label}</Text>
      </View>
      <View style={styles.starRow}>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value >= n;
          return (
            <Pressable
              key={n}
              onPress={() => onChange(n)}
              hitSlop={4}
              style={styles.starBtn}
            >
              <Star
                color={active ? C.green : C.textMuted}
                fill={active ? C.green : 'transparent'}
                size={26}
                strokeWidth={1.8}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function RateMatchScreen({ route, navigation }) {
  const matchId = route?.params?.matchId;

  const [match, setMatch] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  /**
   * Por qué esta pantalla no tiene nada que mostrar, cuando no lo tiene.
   *
   * `null` es «cargó bien». `'error'` es «no se pudo cargar» y `'cancelado'`
   * es «este partido no se jugó». Antes los tres terminaban en el mismo
   * «Nada por calificar», que además le echaba la culpa a los compañeros
   * («si nadie más confirmó…»): un fallo de red se leía como un hecho del
   * partido, y no quedaba forma de reintentar sin salir y volver a entrar.
   */
  const [bloqueo, setBloqueo] = useState(null);

  // Estado de los ratings por usuario:
  // { [userId]: { puntualidad, fairplay, nivel, comentario } }
  const [ratings, setRatings] = useState({});

  const cargar = useCallback(async () => {
    setLoading(true);
    setBloqueo(null);
    const [partido, compas] = await Promise.all([
      getMatchById(matchId).catch((e) => ({ data: null, error: e })),
      getRatableAttendees(matchId).catch((e) => ({ data: [], error: e })),
    ]);

    // El error se consume junto con los datos: `data: []` con `error` no es
    // una lista vacía, es una lista que no se pudo leer.
    // Un partido que no llega no es un partido cancelado: sin la fila no se
    // sabe nada de él, y eso es un fallo de carga como cualquier otro.
    if (partido.error || compas.error || !partido.data) {
      console.error('[FutFinder] RateMatch:', partido.error || compas.error || 'sin partido');
      setBloqueo('error');
      setLoading(false);
      return;
    }

    setMatch(partido.data || null);

    // La misma regla que decide si el detalle ofrece el botón, por si se llega
    // acá por un enlace profundo o con la pantalla abierta desde antes de la
    // cancelación. El servidor también la exige (migración 124).
    if (!partidoAdmiteEvaluaciones(partido.data)) {
      setBloqueo('cancelado');
      setLoading(false);
      return;
    }

    const peers = compas.data || [];
    setAttendees(peers);

    // Inicializar ratings: si ya califiqué antes a alguien, lo pre-cargo
    const initial = {};
    for (const p of peers) {
      if (p.myRating) {
        initial[p.id] = {
          puntualidad: p.myRating.puntualidad,
          fairplay: p.myRating.fairplay,
          nivel: p.myRating.nivel,
          comentario: p.myRating.comentario || '',
          locked: true, // no puedes recalificar
        };
      } else {
        initial[p.id] = {
          puntualidad: 0,
          fairplay: 0,
          nivel: 0,
          comentario: '',
          locked: false,
        };
      }
    }
    setRatings(initial);
    setLoading(false);
  }, [matchId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const update = (userId, field, value) => {
    setRatings((prev) => {
      const cur = prev[userId] || {};
      if (cur.locked) return prev;
      return { ...prev, [userId]: { ...cur, [field]: value } };
    });
  };

  // Cuántas tarjetas tienen las 3 dimensiones completas y aún no enviadas
  const readyToSubmit = useMemo(() => {
    return Object.entries(ratings).filter(
      ([_, r]) =>
        !r.locked && r.puntualidad > 0 && r.fairplay > 0 && r.nivel > 0
    );
  }, [ratings]);

  const handleSubmit = async () => {
    if (readyToSubmit.length === 0) {
      notify(
        'Faltan estrellas',
        'Marca puntualidad, fairplay y nivel en al menos un compañero.'
      );
      return;
    }
    setSubmitting(true);
    const payload = readyToSubmit.map(([userId, r]) => ({
      rated_id: userId,
      puntualidad: r.puntualidad,
      fairplay: r.fairplay,
      nivel: r.nivel,
      comentario: r.comentario,
    }));
    const res = await submitRatings(matchId, payload);
    setSubmitting(false);

    if (res.inserted > 0) {
      notify(
        '¡Evaluaciones enviadas!',
        `Calificaste a ${res.inserted} compañero${res.inserted === 1 ? '' : 's'}.`
      );
      navigation.goBack();
    } else if (res.errors.length > 0) {
      notify(
        'No se pudo enviar',
        res.errors[0] || 'Intenta de nuevo en un momento.'
      );
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={({ pressed }) => [
              styles.backBtn,
              pressed && { opacity: 0.6 },
            ]}
          >
            <ArrowLeft color={C.textPrimary} size={22} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Calificar partido</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {match?.titulo || 'Partido'}
              {match?.cancha_nombre ? ` · ${match.cancha_nombre}` : ''}
            </Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={C.green} />
          </View>
        ) : bloqueo === 'error' ? (
          <View style={styles.emptyBox}>
            <ServerCrash color={C.textMuted} size={42} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No pudimos cargar las evaluaciones</Text>
            <Text style={styles.emptyText}>
              No es que no haya a quién calificar: no alcanzamos a leer quiénes
              confirmaron. Vuelve a intentarlo.
            </Text>
            <PrimaryButton
              label="Reintentar"
              onPress={cargar}
              height={46}
              style={{ alignSelf: 'stretch', marginTop: 6 }}
            />
          </View>
        ) : bloqueo === 'cancelado' ? (
          <View style={styles.emptyBox}>
            <Star color={C.textMuted} size={42} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>Este partido no se jugó</Text>
            <Text style={styles.emptyText}>
              El organizador lo canceló, así que no hay nada que evaluar.
            </Text>
          </View>
        ) : attendees.length === 0 ? (
          <View style={styles.emptyBox}>
            <Star color={C.textMuted} size={42} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>Nada por calificar</Text>
            <Text style={styles.emptyText}>
              Solo puedes evaluar a compañeros que confirmaron su asistencia
              por GPS. Si nadie más confirmó, no hay a quién calificar.
            </Text>
          </View>
        ) : (
          <>
            <ScrollView
              contentContainerStyle={styles.scroll}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.intro}>
                Evalúa a cada jugador en 3 dimensiones de 1 a 5 estrellas.
                Puedes dejar un comentario opcional.
              </Text>

              {attendees.map((p) => {
                const r = ratings[p.id] || {};
                const locked = !!r.locked;
                return (
                  <View
                    key={p.id}
                    style={[styles.card, locked && styles.cardLocked]}
                  >
                    {/* User row */}
                    <View style={styles.userRow}>
                      {p.foto_url ? (
                        <Image
                          source={{ uri: p.foto_url }}
                          style={styles.avatar}
                        />
                      ) : (
                        <View style={[styles.avatar, styles.avatarFallback]}>
                          <Text style={styles.avatarLetter}>
                            {(p.username || '?')[0]?.toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.username}>
                          @{p.username || 'jugador'}
                        </Text>
                        {p.rating_count > 0 ? (
                          <Text style={styles.meta}>
                            {p.rating_count} evaluación
                            {p.rating_count === 1 ? '' : 'es'} ·{' '}
                            ★ {Number(p.rating_nivel_avg || 0).toFixed(1)}
                          </Text>
                        ) : (
                          <Text style={styles.meta}>Sin evaluaciones aún</Text>
                        )}
                      </View>
                      {locked && (
                        <View style={styles.doneChip}>
                          <Check color={C.green} size={12} />
                          <Text style={styles.doneChipText}>Listo</Text>
                        </View>
                      )}
                    </View>

                    {/* Stars */}
                    <StarRow
                      label="Puntualidad"
                      Icon={Clock}
                      value={r.puntualidad || 0}
                      onChange={(v) => update(p.id, 'puntualidad', v)}
                    />
                    <StarRow
                      label="Fair play"
                      Icon={Shield}
                      value={r.fairplay || 0}
                      onChange={(v) => update(p.id, 'fairplay', v)}
                    />
                    <StarRow
                      label="Nivel"
                      Icon={Zap}
                      value={r.nivel || 0}
                      onChange={(v) => update(p.id, 'nivel', v)}
                    />

                    {/* Comment */}
                    <TextInput
                      style={styles.comment}
                      placeholder={
                        locked
                          ? r.comentario || 'Sin comentario'
                          : 'Comentario opcional (jugó bien, llegó tarde…)'
                      }
                      placeholderTextColor={C.textMuted}
                      value={r.comentario}
                      onChangeText={(t) => update(p.id, 'comentario', t)}
                      multiline
                      maxLength={200}
                      editable={!locked}
                    />
                  </View>
                );
              })}
            </ScrollView>

            {/* Submit bar */}
            <View style={styles.submitBar}>
              <Text style={styles.submitInfo}>
                {readyToSubmit.length === 0
                  ? 'Marca las 3 estrellas en al menos un jugador'
                  : `Listas para enviar: ${readyToSubmit.length}`}
              </Text>
              <Pressable
                onPress={handleSubmit}
                disabled={readyToSubmit.length === 0 || submitting}
                style={({ pressed }) => [
                  styles.submitBtn,
                  readyToSubmit.length === 0 && styles.submitBtnDisabled,
                  pressed && { opacity: 0.85 },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="#0E0E0D" />
                ) : (
                  <Text style={styles.submitBtnText}>Enviar evaluaciones</Text>
                )}
              </Pressable>
            </View>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

const AVATAR = 44;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1 },
  headerTitle: {
    color: C.textPrimary,
    fontSize: 18,
    fontFamily: F.extraBold,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    color: C.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  scroll: { paddingHorizontal: 16, paddingBottom: 24 },
  intro: {
    color: C.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginVertical: 12,
  },
  card: {
    backgroundColor: C.surfaceAlt,
    borderRadius: R.cardSm,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.borderSoft,
    gap: 14,
  },
  cardLocked: {
    opacity: 0.6,
    borderColor: C.green + '55',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: C.surface,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    color: C.textPrimary,
    fontSize: 18,
    fontFamily: F.extraBold,
  },
  username: {
    color: C.textPrimary,
    fontSize: 15,
    fontFamily: F.extraBold,
    letterSpacing: -0.2,
  },
  meta: {
    color: C.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  doneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.greenSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: R.pill,
  },
  doneChipText: {
    color: C.green,
    fontSize: 11,
    fontFamily: F.bold,
  },
  starBlock: {
    gap: 6,
  },
  starHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  starLabel: {
    color: C.textSecondary,
    fontSize: 12,
    fontFamily: F.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  starRow: {
    flexDirection: 'row',
    gap: 6,
  },
  starBtn: {
    padding: 2,
  },
  comment: {
    backgroundColor: C.bg,
    borderRadius: R.row,
    borderWidth: 1,
    borderColor: C.border,
    color: C.textPrimary,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 56,
    textAlignVertical: 'top',
    ...Platform.select({ web: { outlineStyle: 'none' } }),
  },
  submitBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: C.borderSoft,
    backgroundColor: C.bg,
    gap: 8,
  },
  submitInfo: {
    color: C.textMuted,
    fontSize: 11,
    textAlign: 'center',
  },
  submitBtn: {
    backgroundColor: C.green,
    borderRadius: R.pill,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: {
    backgroundColor: C.surface,
  },
  submitBtnText: {
    color: '#0E0E0D',
    fontSize: 15,
    fontFamily: F.extraBold,
    letterSpacing: 0.2,
  },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 12,
  },
  emptyTitle: {
    color: C.textPrimary,
    fontSize: 16,
    fontFamily: F.extraBold,
    marginTop: 6,
  },
  emptyText: {
    color: C.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },
});
