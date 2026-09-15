import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ScrollView,
  ActivityIndicator,
  PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Shield } from 'lucide-react-native';

import { clubColors, clubRadius, clubSizes } from '../theme/colors';
import { etiquetaPosiciones } from '../utils/playerMeta';
import { haceCuanto } from '../utils/tiempoRelativo.js';
import {
  F7,
  F11,
  layoutSlots,
  fitsForMember,
  autocompletarAsignaciones,
  zoneLabel,
} from '../utils/formacionClub';
import { getCurrentUser } from '../services/auth';
import { getClubById, listMembers } from '../services/clubs';
import { getClubLineup, saveClubLineup } from '../services/clubLineup';

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Alineación del club (migraciones 92/93): un tablero por club, no por
 * partido. Admin y capitán arman la formación tocando un integrante de la
 * banca y después el puesto (o tocando un puesto ocupado para devolverlo a
 * la banca), y además pueden ARRASTRAR un puesto por la cancha para
 * reubicarlo a mano — eso vuelve la alineación «personalizada» y recalcula
 * la etiqueta del puesto según la zona donde queda (un mediocampista
 * arrastrado al fondo pasa a ser DFC de verdad, no un MC mal puesto). El
 * resto del club sólo la ve.
 *
 * «Personalizada» se avisa una sola vez, al momento en que deja de ser una
 * formación establecida — no en cada arrastre siguiente — porque lo que
 * importa comunicar es el cambio de estado, no cada micro-ajuste.
 */
export default function ClubLineupScreen({ navigation, route }) {
  const { clubId } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [club, setClub] = useState(null);
  const [members, setMembers] = useState([]);
  const [me, setMe] = useState(null);
  const [lineup, setLineup] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);

  // Estado editable, sólo lo usa quien puede guardar.
  const [modo, setModo] = useState(7);
  const [formacion, setFormacion] = useState(F7[0]);
  const [asignaciones, setAsignaciones] = useState({});
  const [picked, setPicked] = useState(null);
  const [custom, setCustom] = useState({}); // puesto → {left, top, label} arrastrado a mano
  const [personalizado, setPersonalizado] = useState(false);

  const flash = useCallback((msg) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    const myId = user?.id || null;
    setMe(myId);

    const [{ data: c }, { data: ms }, { data: lu }] = await Promise.all([
      getClubById(clubId),
      listMembers(clubId),
      getClubLineup(clubId),
    ]);
    setClub(c);
    setMembers(ms || []);
    setLineup(lu);

    if (lu) {
      setModo(lu.modo);
      setFormacion(lu.formacion);
      setAsignaciones(lu.asignaciones || {});
      setCustom(lu.puestos_personalizados || {});
      setPersonalizado(!!lu.personalizado);
    } else {
      const modoInicial = c?.modalidad === 'futbol11' ? 11 : 7;
      setModo(modoInicial);
      setFormacion(modoInicial === 11 ? F11[0] : F7[0]);
      setAsignaciones({});
      setCustom({});
      setPersonalizado(false);
    }
    setPicked(null);
    setLoading(false);
  }, [clubId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const miMembresia = members.find((m) => m.user_id === me);
  const canEdit = miMembresia?.rol === 'admin' || miMembresia?.rol === 'capitan';

  const membersById = useMemo(() => new Map(members.map((m) => [m.member_id, m])), [members]);
  const baseSlots = useMemo(() => layoutSlots(formacion), [formacion]);
  const slots = useMemo(
    () => baseSlots.map((s) => (custom[s.key] ? { ...s, ...custom[s.key] } : s)),
    [baseSlots, custom]
  );
  const assignedIds = useMemo(() => new Set(Object.values(asignaciones)), [asignaciones]);
  const bench = useMemo(
    () => members.filter((m) => !assignedIds.has(m.member_id)),
    [members, assignedIds]
  );
  const placedCount = Object.keys(asignaciones).length;
  const pickedMember = picked ? membersById.get(picked) : null;
  const fits = pickedMember ? fitsForMember(pickedMember) : [];

  // Refs "instantánea" para que los gestos de arrastre (creados una sola
  // vez por puesto) lean siempre el valor más reciente sin quedar pegados
  // al closure del render en que nacieron.
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const customizadoRef = useRef(personalizado);
  customizadoRef.current = personalizado;
  const pitchSizeRef = useRef({ width: 0, height: 0 });
  const slotPosRef = useRef({});
  slotPosRef.current = Object.fromEntries(slots.map((s) => [s.key, { left: s.left, top: s.top }]));
  const tapActionRef = useRef(() => {});
  const respondersRef = useRef(new Map());

  const place = (slotKey, memberId) => {
    setAsignaciones((prev) => {
      const next = {};
      Object.keys(prev).forEach((k) => {
        if (prev[k] !== memberId) next[k] = prev[k];
      });
      next[slotKey] = memberId;
      return next;
    });
    setPicked(null);
  };

  const onSlotPress = (slot, occupant) => {
    if (!canEdit) return;
    if (occupant) {
      setAsignaciones((prev) => {
        const next = { ...prev };
        delete next[slot.key];
        return next;
      });
      if (picked === occupant.member_id) setPicked(null);
      return;
    }
    if (picked) place(slot.key, picked);
  };

  tapActionRef.current = (slotKey) => {
    const slot = slots.find((s) => s.key === slotKey);
    if (!slot) return;
    const occupant = asignaciones[slotKey] ? membersById.get(asignaciones[slotKey]) || null : null;
    onSlotPress(slot, occupant);
  };

  /** Un `PanResponder` por puesto, creado una sola vez y cacheado por clave. */
  const getResponder = (slotKey) => {
    if (respondersRef.current.has(slotKey)) return respondersRef.current.get(slotKey);
    let drag = null;
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => canEditRef.current,
      onMoveShouldSetPanResponder: (evt, g) =>
        canEditRef.current && (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const cur = slotPosRef.current[slotKey] || { left: 50, top: 50 };
        drag = { startLeft: cur.left, startTop: cur.top, wasCustomized: customizadoRef.current, moved: false };
      },
      onPanResponderMove: (evt, g) => {
        if (!drag) return;
        const { width, height } = pitchSizeRef.current;
        if (!width || !height) return;
        if (!drag.moved && (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4)) drag.moved = true;
        if (!drag.moved) return;
        const left = clamp(drag.startLeft + (g.dx / width) * 100, 6, 94);
        const top = clamp(drag.startTop + (g.dy / height) * 100, 5, 95);
        const label = zoneLabel(left, top);
        setCustom((prev) => ({ ...prev, [slotKey]: { left, top, label } }));
        setPersonalizado(true);
      },
      onPanResponderRelease: () => {
        if (!drag) return;
        const { moved, wasCustomized } = drag;
        drag = null;
        if (!moved) {
          tapActionRef.current(slotKey);
          return;
        }
        // Sólo se avisa la PRIMERA vez que una formación establecida pasa a
        // ser personalizada — no en cada arrastre siguiente.
        if (!wasCustomized) flash('Alineación personalizada');
      },
      onPanResponderTerminate: () => {
        drag = null;
      },
    });
    respondersRef.current.set(slotKey, responder);
    return responder;
  };

  const onBenchPress = (member) => {
    if (!canEdit) return;
    setPicked((prev) => (prev === member.member_id ? null : member.member_id));
  };

  const cambiarModo = (nuevoModo) => {
    if (!canEdit || nuevoModo === modo) return;
    const f = nuevoModo === 7 ? F7[0] : F11[0];
    setModo(nuevoModo);
    setFormacion(f);
    setAsignaciones({});
    setCustom({});
    setPersonalizado(false);
    setPicked(null);
    respondersRef.current.clear();
  };

  const cambiarFormacion = (f) => {
    if (!canEdit || (f === formacion && !personalizado)) return;
    setFormacion(f);
    setAsignaciones({});
    setCustom({});
    setPersonalizado(false);
    setPicked(null);
    respondersRef.current.clear();
  };

  const quitarPersonalizacion = () => {
    setCustom({});
    setPersonalizado(false);
    respondersRef.current.clear();
  };

  const onAutocompletar = () => {
    const libres = slots.filter((s) => !asignaciones[s.key]);
    if (libres.length === 0 || bench.length === 0) {
      flash('No queda banca disponible');
      return;
    }
    const nuevas = autocompletarAsignaciones(libres, bench);
    setAsignaciones((prev) => ({ ...prev, ...nuevas }));
    setPicked(null);
    flash('Alineación completada');
  };

  const onLimpiar = () => {
    setAsignaciones({});
    setPicked(null);
  };

  const onGuardar = async () => {
    setSaving(true);
    const { data, error } = await saveClubLineup(clubId, {
      modo,
      formacion,
      personalizado,
      asignaciones,
      puestosPersonalizados: custom,
    });
    setSaving(false);
    if (error) {
      flash(error.message || 'No se pudo guardar');
      return;
    }
    setLineup(data);
    flash(`Alineación ${personalizado ? 'personalizada' : formacion} guardada`);
  };

  if (loading || !club) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <ArrowLeft color={clubColors.textPrimary} size={18} strokeWidth={2.2} />
          </Pressable>
        </View>
        <View style={styles.loadingBox}>
          <ActivityIndicator color={clubColors.green} />
        </View>
      </SafeAreaView>
    );
  }

  const soyIntegrante = Boolean(miMembresia);
  const formacionMostrada = (esPersonalizado, base) =>
    esPersonalizado ? `Personalizado · base ${base}` : base;

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
        >
          <ArrowLeft color={clubColors.textPrimary} size={18} strokeWidth={2.2} />
        </Pressable>
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Alineación
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {canEdit
              ? `${formacionMostrada(personalizado, formacion)} · ${placedCount}/${slots.length} puestos`
              : lineup
                ? `${formacionMostrada(lineup.personalizado, lineup.formacion)} · Fútbol ${lineup.modo}`
                : club.nombre}
          </Text>
        </View>
        {canEdit && (
          <Pressable
            onPress={onGuardar}
            disabled={saving}
            style={({ pressed }) => [
              styles.saveBtn,
              pressed && !saving && { opacity: 0.85 },
              saving && { opacity: 0.6 },
            ]}
          >
            {saving ? (
              <ActivityIndicator color={clubColors.greenInk} size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Guardar</Text>
            )}
          </Pressable>
        )}
      </View>

      {!soyIntegrante ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>Sólo para integrantes</Text>
          <Text style={styles.emptyText}>Únete al club para ver su alineación.</Text>
        </View>
      ) : (
        <>
          {canEdit && (
            <>
              <View style={styles.modeRow}>
                {[7, 11].map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => cambiarModo(m)}
                    style={[styles.modeBtn, modo === m && styles.modeBtnActive]}
                  >
                    <Text style={[styles.modeLabel, modo === m && styles.modeLabelActive]}>
                      Fútbol {m}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.formationRow}
                contentContainerStyle={styles.formationRowContent}
              >
                {personalizado && (
                  <Pressable
                    onPress={quitarPersonalizacion}
                    style={[styles.formationChip, styles.formationChipActive]}
                  >
                    <Text style={[styles.formationChipText, styles.formationChipTextActive]}>
                      Personalizado
                    </Text>
                  </Pressable>
                )}
                {(modo === 7 ? F7 : F11).map((f) => {
                  const activa = !personalizado && f === formacion;
                  return (
                    <Pressable
                      key={f}
                      onPress={() => cambiarFormacion(f)}
                      style={[styles.formationChip, activa && styles.formationChipActive]}
                    >
                      <Text style={[styles.formationChipText, activa && styles.formationChipTextActive]}>
                        {f}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}

          <View style={styles.pitchWrap}>
            {!canEdit && !lineup ? (
              <View style={styles.emptyBox}>
                <Shield color={clubColors.textMuted} size={32} strokeWidth={1.6} />
                <Text style={styles.emptyTitle}>Aún no hay alineación</Text>
                <Text style={styles.emptyText}>
                  Un administrador o capitán del club puede armarla.
                </Text>
              </View>
            ) : (
              <LinearGradient
                colors={['#0C1A0E', '#08130A']}
                style={styles.pitch}
                onLayout={(e) => {
                  pitchSizeRef.current = {
                    width: e.nativeEvent.layout.width,
                    height: e.nativeEvent.layout.height,
                  };
                }}
              >
                <View style={styles.pitchBorder} pointerEvents="none" />
                <View style={styles.pitchHalfway} pointerEvents="none" />
                <View style={styles.pitchCircle} pointerEvents="none" />
                <View style={styles.pitchBoxBottom} pointerEvents="none" />
                <View style={styles.pitchBoxTop} pointerEvents="none" />

                {slots.map((slot) => {
                  const occupant = asignaciones[slot.key]
                    ? membersById.get(asignaciones[slot.key]) || null
                    : null;
                  const isFit = Boolean(pickedMember) && !occupant && fits.includes(slot.label);
                  const isCaptain = occupant?.rol === 'capitan';
                  const responder = canEdit ? getResponder(slot.key) : null;

                  return (
                    <View
                      key={slot.key}
                      {...(responder ? responder.panHandlers : {})}
                      style={[styles.slot, { left: `${slot.left}%`, top: `${slot.top}%` }]}
                    >
                      <View
                        style={[
                          styles.slotCircle,
                          occupant
                            ? [styles.slotCircleFilled, isCaptain && styles.slotCircleCaptain]
                            : isFit
                              ? styles.slotCircleFit
                              : styles.slotCircleEmpty,
                        ]}
                      >
                        {occupant?.foto_url ? (
                          <Image source={{ uri: occupant.foto_url }} style={styles.slotAvatar} />
                        ) : (
                          <Text style={[styles.slotFace, !occupant && isFit && { color: clubColors.green }]}>
                            {occupant ? (occupant.username || '?')[0]?.toUpperCase() : slot.label[0]}
                          </Text>
                        )}
                        {isCaptain && (
                          <View style={styles.captainBadge}>
                            <Text style={styles.captainBadgeText}>C</Text>
                          </View>
                        )}
                      </View>
                      <Text
                        style={[styles.slotLabel, isCaptain && styles.slotLabelCaptain]}
                        numberOfLines={1}
                      >
                        {occupant ? occupant.username : slot.label}
                      </Text>
                    </View>
                  );
                })}
              </LinearGradient>
            )}
          </View>
          {canEdit && (
            <Text style={styles.dragHint}>
              Arrastra un puesto por la cancha para reubicarlo a mano.
            </Text>
          )}

          {canEdit && (
            <View style={styles.benchWrap}>
              <View style={styles.benchHeader}>
                <Text style={styles.benchTitle}>BANCA ({bench.length})</Text>
                <View style={styles.benchActions}>
                  <Pressable onPress={onAutocompletar} style={styles.benchActionBtn}>
                    <Text style={styles.benchActionText}>Autocompletar</Text>
                  </Pressable>
                  <Pressable onPress={onLimpiar} style={styles.benchActionBtnMuted}>
                    <Text style={styles.benchActionTextMuted}>Limpiar</Text>
                  </Pressable>
                </View>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.benchList}
              >
                {bench.length === 0 ? (
                  <View style={styles.benchEmpty}>
                    <Text style={styles.benchEmptyText}>Todos en cancha</Text>
                  </View>
                ) : (
                  bench.map((m) => {
                    const seleccionado = picked === m.member_id;
                    const esCapitan = m.rol === 'capitan';
                    return (
                      <Pressable
                        key={m.member_id}
                        onPress={() => onBenchPress(m)}
                        style={[styles.benchCard, seleccionado && styles.benchCardSelected]}
                      >
                        <View style={styles.benchAvatarWrap}>
                          {m.foto_url ? (
                            <Image
                              source={{ uri: m.foto_url }}
                              style={[styles.benchAvatar, esCapitan && styles.benchAvatarCaptain]}
                            />
                          ) : (
                            <View
                              style={[
                                styles.benchAvatar,
                                styles.benchAvatarFallback,
                                esCapitan && styles.benchAvatarCaptain,
                              ]}
                            >
                              <Text style={styles.benchAvatarInitial}>
                                {(m.username || '?')[0]?.toUpperCase()}
                              </Text>
                            </View>
                          )}
                          {esCapitan && (
                            <View style={styles.captainBadgeSmall}>
                              <Text style={styles.captainBadgeText}>C</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.benchName} numberOfLines={1}>
                          {m.username}
                        </Text>
                        <Text style={styles.benchPos} numberOfLines={1}>
                          {etiquetaPosiciones(m.posicion_preferida) || 'Sin posición'}
                        </Text>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            </View>
          )}

          {!canEdit && lineup && (
            <Text style={styles.savedCaption}>
              Guardada por{' '}
              {members.find((m) => m.user_id === lineup.updated_by)?.username || 'un administrador'}
              {haceCuanto(lineup.updated_at) ? ` · hace ${haceCuanto(lineup.updated_at)}` : ''}
            </Text>
          )}
        </>
      )}

      {!!toast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: clubColors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: clubSizes.gutter,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 8,
  },
  iconBtn: {
    width: clubSizes.iconBtn,
    height: clubSizes.iconBtn,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    borderColor: clubColors.border,
    backgroundColor: clubColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPressed: { backgroundColor: clubColors.chipStrong },
  headerTitles: { flex: 1, minWidth: 0 },
  headerTitle: {
    color: clubColors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerSubtitle: { color: clubColors.textSecondary, fontSize: 12.5, marginTop: 1 },
  saveBtn: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: clubRadius.md,
    backgroundColor: clubColors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { color: clubColors.greenInk, fontSize: 13, fontWeight: '800' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  modeRow: { flexDirection: 'row', gap: 8, paddingHorizontal: clubSizes.gutter, paddingBottom: 10 },
  modeBtn: {
    flex: 1,
    height: 42,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    borderColor: clubColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeBtnActive: { backgroundColor: clubColors.greenSoft, borderColor: clubColors.greenBorder },
  modeLabel: { color: clubColors.textSecondary, fontSize: 13, fontWeight: '800' },
  modeLabelActive: { color: clubColors.green },

  formationRow: { flexGrow: 0, marginBottom: 11 },
  formationRowContent: { paddingHorizontal: clubSizes.gutter, gap: 8 },
  formationChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: clubColors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  formationChipActive: { backgroundColor: clubColors.green, borderColor: clubColors.green },
  formationChipText: { color: clubColors.textSecondary, fontSize: 12.5, fontWeight: '700' },
  formationChipTextActive: { color: clubColors.greenInk },

  pitchWrap: { flex: 1, paddingHorizontal: clubSizes.gutter, paddingTop: 2 },
  pitch: {
    flex: 1,
    borderRadius: clubRadius.xl,
    borderWidth: 1,
    borderColor: clubColors.greenBorder,
    overflow: 'hidden',
  },
  pitchBorder: {
    position: 'absolute',
    left: '8%',
    right: '8%',
    top: 5,
    bottom: 5,
    borderWidth: 1.5,
    borderColor: 'rgba(90,224,106,.16)',
    borderRadius: 10,
  },
  pitchHalfway: {
    position: 'absolute',
    left: '8%',
    right: '8%',
    top: '50%',
    height: 1.5,
    backgroundColor: 'rgba(90,224,106,.16)',
  },
  pitchCircle: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 74,
    height: 74,
    marginLeft: -37,
    marginTop: -37,
    borderWidth: 1.5,
    borderColor: 'rgba(90,224,106,.16)',
    borderRadius: 37,
  },
  pitchBoxBottom: {
    position: 'absolute',
    left: '28%',
    right: '28%',
    bottom: 5,
    height: 52,
    borderWidth: 1.5,
    borderColor: 'rgba(90,224,106,.16)',
    borderBottomWidth: 0,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  pitchBoxTop: {
    position: 'absolute',
    left: '28%',
    right: '28%',
    top: 5,
    height: 52,
    borderWidth: 1.5,
    borderColor: 'rgba(90,224,106,.16)',
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },

  dragHint: {
    color: clubColors.textFaint,
    fontSize: 11,
    textAlign: 'center',
    paddingTop: 8,
  },

  slot: {
    position: 'absolute',
    width: 62,
    marginLeft: -31,
    marginTop: -31,
    alignItems: 'center',
    gap: 5,
  },
  slotCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotCircleFilled: { backgroundColor: '#1E231E', borderWidth: 2, borderColor: clubColors.green },
  slotCircleCaptain: { borderColor: clubColors.gold },
  slotCircleEmpty: {
    backgroundColor: 'rgba(5,6,5,.55)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,.2)',
    borderStyle: 'dashed',
  },
  slotCircleFit: { backgroundColor: 'rgba(90,224,106,.3)', borderWidth: 2.5, borderColor: clubColors.green },
  slotAvatar: { width: 44, height: 44, borderRadius: 22 },
  slotFace: { color: 'rgba(255,255,255,.4)', fontSize: 14, fontWeight: '800' },
  slotLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,.5)',
    backgroundColor: 'rgba(5,6,5,.6)',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    maxWidth: 62,
  },
  slotLabelCaptain: { color: clubColors.gold, backgroundColor: 'rgba(240,200,90,.16)' },
  captainBadge: {
    position: 'absolute',
    top: -3,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: clubColors.gold,
    borderWidth: 2,
    borderColor: '#0A140B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captainBadgeSmall: {
    position: 'absolute',
    top: -3,
    right: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: clubColors.gold,
    borderWidth: 2,
    borderColor: clubColors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captainBadgeText: { color: clubColors.background, fontSize: 9, fontWeight: '800' },

  benchWrap: { paddingHorizontal: clubSizes.gutter, paddingVertical: 12 },
  benchHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  benchTitle: {
    fontSize: 10.5,
    letterSpacing: 1.4,
    color: clubColors.textMuted,
    fontWeight: '700',
  },
  benchActions: { flexDirection: 'row', gap: 8 },
  benchActionBtn: {
    borderRadius: clubRadius.chip,
    borderWidth: 1,
    borderColor: clubColors.greenBorder,
    backgroundColor: clubColors.greenSoft,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  benchActionText: { color: clubColors.green, fontSize: 11.5, fontWeight: '700' },
  benchActionBtnMuted: {
    borderRadius: clubRadius.chip,
    borderWidth: 1,
    borderColor: clubColors.border,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  benchActionTextMuted: { color: clubColors.textSecondary, fontSize: 11.5, fontWeight: '700' },
  benchList: { gap: 9, paddingTop: 10, paddingBottom: 2, minHeight: 84 },
  benchEmpty: {
    flex: 1,
    minWidth: 260,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: clubColors.border,
    borderRadius: clubRadius.md,
  },
  benchEmptyText: { color: clubColors.textMuted, fontSize: 12, fontWeight: '600' },
  benchCard: {
    width: 74,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    backgroundColor: clubColors.surfaceAlt,
    paddingVertical: 9,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 5,
  },
  benchCardSelected: { borderColor: clubColors.green, backgroundColor: clubColors.greenSoft },
  benchAvatarWrap: { position: 'relative' },
  benchAvatar: { width: 36, height: 36, borderRadius: 18 },
  benchAvatarCaptain: { borderWidth: 2, borderColor: clubColors.gold },
  benchAvatarFallback: { backgroundColor: clubColors.chip, alignItems: 'center', justifyContent: 'center' },
  benchAvatarInitial: { color: clubColors.textPrimary, fontSize: 13, fontWeight: '800' },
  benchName: { color: clubColors.textPrimary, fontSize: 11, fontWeight: '700', maxWidth: 64 },
  benchPos: { color: clubColors.textMuted, fontSize: 9.5, maxWidth: 64 },

  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  emptyTitle: { color: clubColors.textPrimary, fontSize: 15, fontWeight: '800' },
  emptyText: { color: clubColors.textMuted, fontSize: 13, textAlign: 'center' },

  savedCaption: {
    textAlign: 'center',
    color: clubColors.textMuted,
    fontSize: 12,
    paddingBottom: 16,
  },

  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 30,
    backgroundColor: clubColors.surface,
    borderWidth: 1,
    borderColor: clubColors.greenBorder,
    borderRadius: clubRadius.md,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  toastText: { color: clubColors.textPrimary, fontSize: 13, fontWeight: '700', textAlign: 'center' },
});
