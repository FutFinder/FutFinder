import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Check, FileText, MapPin, Users, Wallet, Clock } from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import Banner from '../components/Banner';
import Button from '../components/Button';
import { supabase } from '../services/supabase';
import { getChallenge } from '../services/clubChallenges';
import {
  crearPropuestaOficial,
  rechazarPropuesta,
  getPropuestaVigente,
  nuevoClientToken,
} from '../services/clubProposals';
import {
  DURACIONES,
  MODALIDADES,
  METODOS_INSCRIPCION,
  CUPOS_POR_CLUB,
  INSTRUCCIONES_MAX,
  validarPropuestaOficial,
  metodoLabel,
  cuposLabel,
} from '../services/clubChallengeRules';

/**
 * Propuesta oficial de un desafío: crearla o revisar la que mandó el rival.
 *
 * params: { challengeId, modo: 'crear' | 'revisar', proposalId? }
 *
 * Es el paso donde la propuesta deja de ser tentativa. Por eso acá se piden
 * dirección exacta, hora y cuota, y no la zona aproximada del asistente de
 * desafío: esto es lo que van a leer TODOS los integrantes de los dos clubes
 * para decidir si van, y la RLS de `club_challenge_proposals` se lo permite
 * aunque no sean administradores.
 *
 * APROBAR NO ESTÁ ACÁ TODAVÍA. Aprobar es lo que publica el partido, y eso
 * llega con la migración 44 junto con los cupos por club. Hasta entonces el
 * club que recibe la propuesta puede leerla entera y pedir cambios, que sí
 * existe. Un botón «Aprobar» que no publicara nada sería peor que no tenerlo.
 *
 * Usa `colors`/`radius` como su pantalla hermana `ClubChallengeScreen`, no
 * `dsColors`: son los dos pasos del mismo flujo y mezclar las dos familias
 * en la misma secuencia se vería como dos verdes distintos.
 */
function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}
function formatTime(d) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}

/** "DD/MM/AAAA" + "HH:MM" → Date, o null si no es válida. */
function parseDateTime(dateStr, timeStr) {
  const dParts = (dateStr || '').split('/');
  const tParts = (timeStr || '').split(':');
  if (dParts.length !== 3 || tParts.length !== 2) return null;
  const [dd, mm, yyyy] = dParts.map((s) => parseInt(s.trim(), 10));
  const [hh, mi] = tParts.map((s) => parseInt(s.trim(), 10));
  if ([dd, mm, yyyy, hh, mi].some(Number.isNaN)) return null;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59) return null;
  const d = new Date(yyyy, mm - 1, dd, hh, mi, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Fecha legible de una propuesta ya creada. */
function fechaLarga(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return 'Fecha por confirmar';
  return `${d.toLocaleDateString('es-CL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  })} · ${formatTime(d)}`;
}

export default function ClubProposalScreen({ navigation, route }) {
  const { challengeId, modo = 'crear', proposalId = null } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [challenge, setChallenge] = useState(null);
  const [propuesta, setPropuesta] = useState(null);
  const [misClubIds, setMisClubIds] = useState([]);
  const [banner, setBanner] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [errores, setErrores] = useState({});

  // El token se genera UNA vez por pantalla y se conserva entre reintentos:
  // si se regenerara en cada toque, un reintento tras un timeout de red
  // crearía una segunda propuesta en vez de recuperar la primera.
  const tokenRef = useRef(nuevoClientToken());

  const manana = useMemo(() => {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    d.setHours(20, 0, 0, 0);
    return d;
  }, []);

  const [fechaStr, setFechaStr] = useState(formatDate(manana));
  const [horaStr, setHoraStr] = useState(formatTime(manana));
  const [duracionMin, setDuracionMin] = useState(90);
  const [direccion, setDireccion] = useState('');
  const [canchaNombre, setCanchaNombre] = useState('');
  const [comuna, setComuna] = useState('');
  const [region, setRegion] = useState('');
  const [modalidad, setModalidad] = useState('futbol7');
  const [cuposPorClub, setCuposPorClub] = useState(String(CUPOS_POR_CLUB.min + 3));
  const [metodoInscripcion, setMetodoInscripcion] = useState('orden_llegada');
  const [cuotaPorPersona, setCuotaPorPersona] = useState('0');
  const [instrucciones, setInstrucciones] = useState('');
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ data: ch }, { data: prop }, { data: { user } = {} }] = await Promise.all([
        getChallenge(challengeId),
        getPropuestaVigente(challengeId),
        supabase.auth.getUser(),
      ]);
      if (!alive) return;
      setChallenge(ch || null);
      setPropuesta(prop || null);

      if (ch && user?.id) {
        const { data: membresias } = await supabase
          .from('club_members')
          .select('club_id, rol')
          .eq('user_id', user.id)
          .in('club_id', [ch.club_retador_id, ch.club_retado_id]);
        if (alive) {
          setMisClubIds((membresias || []).filter((m) => m.rol === 'admin').map((m) => m.club_id));
        }
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [challengeId, proposalId]);

  // Si la propuesta la hizo mi club, esta pantalla solo informa: quien
  // responde es el otro.
  const soyProponente =
    !!propuesta && misClubIds.includes(propuesta.club_proponente_id);
  const puedoResponder =
    !!propuesta && propuesta.estado === 'pendiente' && misClubIds.length > 0 && !soyProponente;

  const revisando = modo === 'revisar' || (!!propuesta && propuesta.estado === 'pendiente');

  const handleCrear = useCallback(async () => {
    const fecha = parseDateTime(fechaStr, horaStr);
    const draft = {
      fecha,
      duracionMin,
      direccion,
      canchaNombre,
      comuna,
      region,
      modalidad,
      cuposPorClub: parseInt(cuposPorClub, 10),
      metodoInscripcion,
      cuotaPorPersona: parseInt(cuotaPorPersona, 10),
      instrucciones,
    };

    const { ok, errors } = validarPropuestaOficial(draft);
    setErrores(errors);
    if (!ok) {
      setBanner({
        type: 'error',
        title: 'Falta información',
        message: 'Revisa los campos marcados antes de enviar la propuesta.',
      });
      return;
    }

    setEnviando(true);
    const { data, error } = await crearPropuestaOficial(challengeId, draft, tokenRef.current);
    setEnviando(false);

    if (error) {
      setBanner({ type: 'error', title: 'No se pudo enviar', message: error.message });
      return;
    }
    setPropuesta(data);
    setBanner({
      type: 'success',
      title: 'Propuesta enviada',
      message: 'El club rival tiene que aprobarla para que el partido se publique.',
    });
    setTimeout(() => {
      if (navigation.canGoBack()) navigation.goBack();
    }, 1400);
  }, [
    fechaStr,
    horaStr,
    duracionMin,
    direccion,
    canchaNombre,
    comuna,
    region,
    modalidad,
    cuposPorClub,
    metodoInscripcion,
    cuotaPorPersona,
    instrucciones,
    challengeId,
    navigation,
  ]);

  const handleRechazar = useCallback(async () => {
    if (!propuesta?.id) return;
    setEnviando(true);
    const { error } = await rechazarPropuesta(propuesta.id, motivo);
    setEnviando(false);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo responder', message: error.message });
      return;
    }
    setBanner({
      type: 'success',
      title: 'Pediste cambios',
      message: 'El desafío vuelve a la negociación y el club rival ya lo sabe.',
    });
    setTimeout(() => {
      if (navigation.canGoBack()) navigation.goBack();
    }, 1400);
  }, [propuesta?.id, motivo, navigation]);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {revisando ? 'Propuesta oficial' : 'Crear propuesta oficial'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {revisando
              ? 'Los datos definitivos del partido'
              : 'Cancha, hora y cupos definitivos del partido'}
          </Text>
        </View>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
        >
          <X color={colors.textPrimary} size={20} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !challenge ? (
        <View style={styles.content}>
          <Banner
            type="info"
            title="Este desafío ya no existe"
            message="Puede que se haya cerrado mientras tenías la pantalla abierta."
          />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

            {revisando && propuesta ? (
              <>
                <View style={styles.resumen}>
                  <Row icon={<Clock color={colors.primary} size={16} />} label="Cuándo">
                    {`${fechaLarga(propuesta.fecha)} · ${propuesta.duracion_min} min`}
                  </Row>
                  <Row icon={<MapPin color={colors.primary} size={16} />} label="Dónde">
                    {`${propuesta.cancha_nombre}\n${propuesta.direccion}\n${propuesta.comuna}, ${propuesta.region}`}
                  </Row>
                  <Row icon={<Users color={colors.primary} size={16} />} label="Cupos">
                    {`${cuposLabel(propuesta.cupos_por_club)} · ${metodoLabel(
                      propuesta.metodo_inscripcion
                    )}`}
                  </Row>
                  <Row icon={<Wallet color={colors.primary} size={16} />} label="Cuota">
                    {propuesta.cuota_por_persona > 0
                      ? `$${propuesta.cuota_por_persona.toLocaleString('es-CL')} por persona`
                      : 'Sin cuota'}
                  </Row>
                  {!!propuesta.instrucciones && (
                    <Row icon={<FileText color={colors.primary} size={16} />} label="Instrucciones">
                      {propuesta.instrucciones}
                    </Row>
                  )}
                </View>

                {propuesta.estado === 'rechazada' && (
                  <Banner
                    type="info"
                    title="Esta propuesta quedó descartada"
                    message={
                      propuesta.motivo_rechazo ||
                      'El club rival pidió cambios y el desafío volvió a la negociación.'
                    }
                  />
                )}

                {soyProponente && propuesta.estado === 'pendiente' && (
                  <Banner
                    type="info"
                    title="Esperando al club rival"
                    message="La propuesta la responde el otro club. Te avisamos apenas lo haga."
                  />
                )}

                {puedoResponder && (
                  <>
                    <Banner
                      type="info"
                      title="Aprobar llega en la próxima entrega"
                      message="Aprobar publica el partido con los cupos por club, y eso todavía no está disponible. Mientras tanto puedes pedir cambios y seguir en el chat."
                    />

                    <Text style={styles.label}>Motivo (opcional)</Text>
                    <TextInput
                      style={[styles.input, styles.inputMultiline]}
                      placeholder="Ej: la cancha nos queda muy lejos, ¿probamos otra?"
                      placeholderTextColor={colors.textMuted}
                      value={motivo}
                      onChangeText={setMotivo}
                      multiline
                      maxLength={INSTRUCCIONES_MAX}
                    />
                    <Button
                      label="Pedir cambios"
                      variant="secondary"
                      onPress={handleRechazar}
                      loading={enviando}
                      style={styles.submitBtn}
                    />
                  </>
                )}
              </>
            ) : (
              <>
                {/* Fecha y hora */}
                <View style={styles.row2}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Fecha del partido</Text>
                    <TextInput
                      style={[styles.input, errores.fecha && styles.inputError]}
                      placeholder="DD/MM/AAAA"
                      placeholderTextColor={colors.textMuted}
                      value={fechaStr}
                      onChangeText={setFechaStr}
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                  <View style={{ width: 110 }}>
                    <Text style={styles.label}>Hora</Text>
                    <TextInput
                      style={[styles.input, errores.fecha && styles.inputError]}
                      placeholder="HH:MM"
                      placeholderTextColor={colors.textMuted}
                      value={horaStr}
                      onChangeText={setHoraStr}
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                </View>
                {!!errores.fecha && <Text style={styles.error}>{errores.fecha}</Text>}

                <Text style={styles.label}>Duración</Text>
                <View style={styles.chipsRow}>
                  {DURACIONES.map((d) => (
                    <Opcion
                      key={d}
                      label={`${d} min`}
                      activa={duracionMin === d}
                      onPress={() => setDuracionMin(d)}
                    />
                  ))}
                </View>

                <Text style={styles.label}>Cancha o recinto</Text>
                <TextInput
                  style={[styles.input, errores.canchaNombre && styles.inputError]}
                  placeholder="Ej: Complejo Municipal"
                  placeholderTextColor={colors.textMuted}
                  value={canchaNombre}
                  onChangeText={setCanchaNombre}
                  maxLength={120}
                />
                {!!errores.canchaNombre && <Text style={styles.error}>{errores.canchaNombre}</Text>}

                <Text style={styles.label}>Dirección exacta</Text>
                <TextInput
                  style={[styles.input, errores.direccion && styles.inputError]}
                  placeholder="Calle y número"
                  placeholderTextColor={colors.textMuted}
                  value={direccion}
                  onChangeText={setDireccion}
                  maxLength={160}
                />
                {!!errores.direccion && <Text style={styles.error}>{errores.direccion}</Text>}

                <View style={styles.row2}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Comuna</Text>
                    <TextInput
                      style={[styles.input, errores.comuna && styles.inputError]}
                      placeholder="Ej: Ñuñoa"
                      placeholderTextColor={colors.textMuted}
                      value={comuna}
                      onChangeText={setComuna}
                      maxLength={80}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Región</Text>
                    <TextInput
                      style={[styles.input, errores.region && styles.inputError]}
                      placeholder="Ej: Metropolitana"
                      placeholderTextColor={colors.textMuted}
                      value={region}
                      onChangeText={setRegion}
                      maxLength={80}
                    />
                  </View>
                </View>

                <Text style={styles.label}>Modalidad</Text>
                <View style={styles.chipsRow}>
                  {MODALIDADES.map((m) => (
                    <Opcion
                      key={m.value}
                      label={m.label}
                      activa={modalidad === m.value}
                      onPress={() => setModalidad(m.value)}
                    />
                  ))}
                </View>

                <Text style={styles.label}>
                  Cupos por club ({CUPOS_POR_CLUB.min} a {CUPOS_POR_CLUB.max})
                </Text>
                <TextInput
                  style={[styles.input, errores.cuposPorClub && styles.inputError]}
                  placeholder="Ej: 7"
                  placeholderTextColor={colors.textMuted}
                  value={cuposPorClub}
                  onChangeText={setCuposPorClub}
                  keyboardType="number-pad"
                  maxLength={2}
                />
                <Text style={styles.ayuda}>
                  Es el cupo de CADA club, no el total del partido.
                </Text>
                {!!errores.cuposPorClub && <Text style={styles.error}>{errores.cuposPorClub}</Text>}

                <Text style={styles.label}>Cómo se llenan los cupos</Text>
                <View style={styles.optionsBox}>
                  {METODOS_INSCRIPCION.map((m) => (
                    <Pressable
                      key={m.value}
                      onPress={() => setMetodoInscripcion(m.value)}
                      style={({ pressed }) => [
                        styles.option,
                        metodoInscripcion === m.value && styles.optionActive,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.optionText,
                            metodoInscripcion === m.value && styles.optionTextActive,
                          ]}
                        >
                          {m.label}
                        </Text>
                        <Text style={styles.optionDesc}>{m.desc}</Text>
                      </View>
                      {metodoInscripcion === m.value && <Check color={colors.primary} size={16} />}
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>Cuota por persona</Text>
                <TextInput
                  style={[styles.input, errores.cuotaPorPersona && styles.inputError]}
                  placeholder="0 si no hay cuota"
                  placeholderTextColor={colors.textMuted}
                  value={cuotaPorPersona}
                  onChangeText={setCuotaPorPersona}
                  keyboardType="number-pad"
                  maxLength={7}
                />
                {!!errores.cuotaPorPersona && (
                  <Text style={styles.error}>{errores.cuotaPorPersona}</Text>
                )}

                <Text style={styles.label}>Instrucciones (opcional)</Text>
                <TextInput
                  style={[styles.input, styles.inputMultiline]}
                  placeholder="Ej: llegar 20 minutos antes, entrada por el portón lateral..."
                  placeholderTextColor={colors.textMuted}
                  value={instrucciones}
                  onChangeText={setInstrucciones}
                  multiline
                  maxLength={INSTRUCCIONES_MAX}
                />

                <Button
                  label="Enviar propuesta oficial"
                  icon={<FileText color="#0E0E0D" size={18} strokeWidth={2.4} />}
                  onPress={handleCrear}
                  loading={enviando}
                  style={styles.submitBtn}
                />
                <Text style={styles.ayuda}>
                  El partido se publica recién cuando el club rival la apruebe.
                </Text>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function Opcion({ label, activa, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, activa && styles.chipActive, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.chipText, activa && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Row({ icon, label, children }) {
  return (
    <View style={styles.resumenRow}>
      <View style={styles.resumenIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.resumenLabel}>{label}</Text>
        <Text style={styles.resumenValue}>{children}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerCenter: { flex: 1 },
  headerTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  headerSubtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 8 },

  label: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
  },
  ayuda: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  error: { color: colors.error, fontSize: 12, marginTop: 4, fontWeight: '600' },

  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inputError: { borderColor: colors.error },
  inputMultiline: { minHeight: 88, textAlignVertical: 'top' },

  row2: { flexDirection: 'row', gap: 10 },

  chipsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  chipTextActive: { color: '#0E0E0D' },

  optionsBox: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionActive: { borderColor: colors.primary },
  optionText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  optionTextActive: { color: colors.primary },
  optionDesc: { color: colors.textMuted, fontSize: 11, marginTop: 2 },

  resumen: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 14,
    gap: 14,
    marginTop: 4,
  },
  resumenRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  resumenIcon: { width: 22, paddingTop: 2 },
  resumenLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  resumenValue: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', lineHeight: 20 },

  submitBtn: { marginTop: 16 },
});
