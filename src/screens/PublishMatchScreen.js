import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  Locate,
  MapPin,
  Share2,
  ShieldCheck,
} from 'lucide-react-native';

import { partidos as P, partidosRadius as R } from '../theme/colors';
import {
  Card,
  DetailRow,
  ErrorHint,
  FieldLabel,
  GhostButton,
  Input,
  Note,
  OptionChip,
  PrimaryButton,
  RadioRow,
  SelectField,
  Stepper,
  SurfaceButton,
  Tag,
  Toggle,
} from '../components/partidos/ui';
import PickerSheet from '../components/partidos/PickerSheet';
import ShareSheet from '../components/partidos/ShareSheet';
import {
  DateSheet,
  TimeSheet,
  formatFechaLarga,
  formatFechaRelativa,
  nextWeekday,
  startOfDay,
} from '../components/partidos/DateTimeSheets';
import LocationAutocomplete, { reverseGeocode } from '../components/LocationAutocomplete';
import { createMatch, translateSchemaError } from '../services/matches';
import { getChallenge, linkChallengeMatch } from '../services/clubChallenges';
import { getCurrentLocation } from '../services/location';
import { isSupabaseConfigured } from '../services/supabase';
import { isNetworkError, useOnline } from '../services/connectivity';
import { goBackOrPartidos } from '../utils/navigation';
import { REGIONES, getComunasOfRegion, matchComuna } from '../data/regiones-chile';
import {
  CUPOS,
  DESC_MAX,
  DURACIONES,
  EDAD_PRESETS,
  FIELD_ORDER,
  MODALIDADES,
  NIVELES,
  TRUST_OPTS,
  combineDateTime,
  cuotaLabel,
  edadLabel,
  nivelLabel,
  trustLabel,
  validateDraft,
} from '../services/matchRules';
import { shorten } from '../components/partidos/FiltersSheet';

const REGION_DEFAULT = 'Región Metropolitana de Santiago';

/** Borrador inicial. Los tres pasos comparten este objeto. */
function initialDraft() {
  const d = startOfDay(new Date());
  return {
    // Paso 1 · formato y cupos
    cupos: 3,
    cuota: '5000',
    nivel: 'intermedio',
    duracion: 90,
    minTrust: 0,
    edadPreset: 0,
    edadMin: '',
    edadMax: '',
    descripcion: '',
    // Paso 2 · dónde y cuándo
    titulo: '',
    modalidad: 'futbol7',
    cancha: '',
    direccion: '',
    coords: null,
    region: REGION_DEFAULT,
    comuna: '',
    fecha: d,
    hora: '20:00',
    // Paso 3 · acceso
    aprobacion: 'inmediata',
    recordatorio1h: true,
    pedirAsistencia: true,
  };
}

/**
 * «Publicar partido abierto» — wizard de tres pasos (sección 3 del handoff).
 *
 * Un solo borrador vive en este componente, así que volver atrás nunca pierde
 * información. La validación es por campo: el banner cuenta los errores, los
 * campos inválidos se marcan en rojo, se hace scroll al primero y cada error
 * desaparece en cuanto se corrige, sin tocar el resto del formulario.
 *
 * Si llega `matchId` por params (llamadas antiguas a la ruta CreateMatch),
 * redirige a la edición: publicar y editar son flujos distintos.
 */
export default function PublishMatchScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const online = useOnline();
  const scrollRef = useRef(null);
  const positions = useRef({});

  const clubChallengeId = route?.params?.clubChallengeId || null;
  const [clubChallenge, setClubChallenge] = useState(null);

  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(initialDraft);
  const [errors, setErrors] = useState({});
  const [touchedStep, setTouchedStep] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [published, setPublished] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [sheet, setSheet] = useState(null); // 'region' | 'comuna' | 'fecha' | 'hora' | 'share'
  const [locBusy, setLocBusy] = useState(false);

  // Token de idempotencia: se crea una vez por borrador, así que dos toques
  // seguidos en «Publicar» no pueden crear dos partidos.
  const clientToken = useRef(makeToken());

  // Ruta antigua CreateMatch con matchId → edición.
  useEffect(() => {
    if (route?.params?.matchId) {
      navigation.replace('EditMatch', { matchId: route.params.matchId });
    }
  }, [route?.params?.matchId]);

  // Modo «partido de clubes»: prefija fecha, zona y título del desafío.
  useEffect(() => {
    if (!clubChallengeId) return;
    (async () => {
      const { data } = await getChallenge(clubChallengeId);
      if (!data) return;
      setClubChallenge(data);
      setDraft((d) => {
        const next = { ...d };
        if (data.fecha_propuesta) {
          const dt = new Date(data.fecha_propuesta);
          if (!Number.isNaN(dt.getTime())) {
            next.fecha = startOfDay(dt);
            next.hora = dt.toTimeString().slice(0, 5);
          }
        }
        if (data.zona && !next.cancha) next.cancha = data.zona;
        if (!next.titulo) next.titulo = 'Partido de Clubes';
        return next;
      });
    })();
  }, [clubChallengeId]);

  // Ubicación aproximada al abrir: solo para sugerir la cancha más cercana.
  useEffect(() => {
    (async () => {
      const loc = await getCurrentLocation();
      if (loc?.ok) {
        setDraft((d) =>
          d.coords ? d : { ...d, coords: { lat: loc.latitude, lng: loc.longitude } }
        );
      }
    })();
  }, []);

  const set = useCallback((patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    // Tocar cualquier campo descarta el error del último intento de publicar:
    // ya no describe el estado del borrador.
    setSubmitError(null);
    // El error del campo desaparece en cuanto se corrige; los demás siguen.
    setErrors((prev) => {
      if (!Object.keys(prev).length) return prev;
      const next = { ...prev };
      Object.keys(patch).forEach((k) => {
        const field = k === 'edadMin' || k === 'edadMax' || k === 'edadPreset' ? 'edad' : k;
        delete next[field];
      });
      return next;
    });
  }, []);

  // Revalida en vivo una vez que el usuario intentó avanzar.
  useEffect(() => {
    if (touchedStep == null) return;
    setErrors(validateDraft(draft, touchedStep));
  }, [draft, touchedStep]);

  const comunas = useMemo(() => (draft.region ? getComunasOfRegion(draft.region) : []), [draft.region]);
  const dt = combineDateTime(draft.fecha, draft.hora);
  const errorCount = Object.keys(errors).length;

  const registerPos = (field) => (e) => {
    positions.current[field] = e.nativeEvent.layout.y;
  };

  const scrollToFirstError = (errs) => {
    const first = FIELD_ORDER.find((f) => errs[f]);
    if (!first) return;
    const y = positions.current[first];
    if (y != null) {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 90), animated: true });
    }
  };

  const goNext = () => {
    const errs = validateDraft(draft, step);
    setTouchedStep(step);
    setErrors(errs);
    if (Object.keys(errs).length) {
      scrollToFirstError(errs);
      return;
    }
    setTouchedStep(null);
    setErrors({});
    setStep(step + 1);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const goBack = () => {
    if (step === 1) {
      goBackOrPartidos(navigation);
      return;
    }
    setTouchedStep(null);
    setErrors({});
    setStep(step - 1);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const useMyLocation = async () => {
    setLocBusy(true);
    try {
      const loc = await getCurrentLocation();
      if (!loc?.ok) {
        setSubmitError('No pudimos leer tu ubicación. Revisa el permiso o escribe la dirección.');
        return;
      }
      const patch = { coords: { lat: loc.latitude, lng: loc.longitude } };
      const rev = await reverseGeocode({ lat: loc.latitude, lng: loc.longitude });
      if (rev?.address) patch.direccion = rev.address;
      const m = matchComuna(rev?.comunaRaw) || matchComuna(rev?.regionRaw);
      if (m) {
        patch.region = m.region;
        patch.comuna = m.comuna;
      }
      set(patch);
      setSubmitError(null);
    } finally {
      setLocBusy(false);
    }
  };

  const publish = async () => {
    if (submitting || published) return; // doble pulsación
    const errs = validateDraft(draft, null);
    if (Object.keys(errs).length) {
      // Si el error está en un paso anterior, volvemos a ese paso.
      const stepOf = (f) =>
        ['titulo', 'modalidad', 'cancha', 'region', 'comuna', 'fecha', 'hora'].includes(f) ? 2 : 1;
      const first = FIELD_ORDER.find((f) => errs[f]);
      const target = first ? stepOf(first) : 1;
      setStep(target);
      setTouchedStep(target);
      setErrors(validateDraft(draft, target));
      setTimeout(() => scrollToFirstError(errs), 60);
      return;
    }

    if (!isSupabaseConfigured) {
      setSubmitError('Modo demo: Supabase no está configurado, el partido no se guardaría.');
      return;
    }
    if (!online) {
      setSubmitError('Necesitas conexión para publicar. Tu borrador se mantiene tal como está.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const edad = resolveEdad(draft);
    const payload = {
      titulo: draft.titulo.trim(),
      region: draft.region,
      comuna: draft.comuna,
      cancha_nombre: draft.cancha.trim(),
      direccion: draft.direccion.trim() || null,
      // Sin coordenadas del buscador caemos al centro aproximado que ya
      // tenemos; nunca publicamos con lat/lng inventadas.
      latitud: draft.coords?.lat ?? null,
      longitud: draft.coords?.lng ?? null,
      hora: dt.toISOString(),
      cupos_totales: Number(draft.cupos),
      precio_cuota: draft.cuota === '' ? 0 : Number(draft.cuota),
      nivel: draft.nivel,
      duracion_min: Number(draft.duracion),
      aprobacion: draft.aprobacion,
      min_trust_score: Number(draft.minTrust),
      modalidad: draft.modalidad,
      edad_min: edad.min,
      edad_max: edad.max,
      recordatorio_1h: draft.recordatorio1h,
      pedir_asistencia: draft.pedirAsistencia,
      descripcion: draft.descripcion.trim() || null,
      client_token: clientToken.current,
    };
    if (clubChallenge) {
      payload.club_local_id = clubChallenge.club_retador_id;
      payload.club_visitante_id = clubChallenge.club_retado_id;
      payload.challenge_id = clubChallenge.id;
    }

    if (payload.latitud == null || payload.longitud == null) {
      setSubmitting(false);
      setStep(2);
      setTouchedStep(2);
      setSubmitError(
        'Falta la ubicación exacta de la cancha. Elige una sugerencia del buscador o toca «Usar mi ubicación».'
      );
      return;
    }

    const { data, error, duplicate } = await createMatch(payload);
    setSubmitting(false);

    if (error) {
      setSubmitError(
        isNetworkError(error)
          ? 'Se cortó la conexión al publicar. Vuelve a intentarlo: no se creó ningún partido duplicado.'
          : translateSchemaError(error) ||
            error.message ||
            'No pudimos publicar el partido. Intenta de nuevo.'
      );
      return;
    }

    if (clubChallenge && data?.id && !duplicate) {
      await linkChallengeMatch(clubChallenge.id, data.id);
    }
    setPublished(data);
  };

  // ------------------------------------------------------------ éxito

  if (published) {
    return (
      <PublishedView
        match={published}
        onOpen={() => navigation.replace('MatchDetail', { matchId: published.id })}
        onShare={() => setSheet('share')}
        onBack={() => navigation.navigate('Main', { screen: 'SearchTab' })}
        shareOpen={sheet === 'share'}
        onCloseShare={() => setSheet(null)}
      />
    );
  }

  // ------------------------------------------------------------ wizard

  const stepTitle = ['Formato y cupos', 'Dónde y cuándo', 'Acceso y publicación'][step - 1];
  const stepSub = [
    'Cuántos faltan, cuánto cuesta y a qué ritmo se juega',
    'La cancha, la comuna y el horario del partido',
    'Cómo entran los jugadores y qué avisos enviamos',
  ][step - 1];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Barra superior */}
        <View style={styles.topBar}>
          <Pressable
            onPress={goBack}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={step === 1 ? 'Cancelar' : 'Volver al paso anterior'}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
          >
            <ArrowLeft color={P.text} size={19} strokeWidth={2} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.topTitle}>Publicar partido abierto</Text>
            <Text style={styles.topSub} numberOfLines={1}>
              {step === 1
                ? 'Encuentra jugadores para completar tu partido'
                : step === 2
                ? `${MODALIDADES.find((m) => m.value === draft.modalidad)?.label} · ${draft.cupos} ${draft.cupos === 1 ? 'cupo' : 'cupos'}`
                : 'Último paso'}
            </Text>
          </View>
        </View>

        {/* Progreso */}
        <View style={styles.progressWrap}>
          <View style={styles.progressRow}>
            {[1, 2, 3].map((i) => (
              <View key={i} style={styles.progressTrack}>
                {i <= step ? (
                  <LinearGradient
                    colors={i === step ? [P.greenDark, P.green] : [P.greenDark, P.greenDark]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                  />
                ) : null}
              </View>
            ))}
          </View>
          <View style={styles.stepHeadRow}>
            <Text style={styles.stepTitle}>{stepTitle}</Text>
            <Text style={styles.stepCount}>PASO {step}/3</Text>
          </View>
          <Text style={styles.stepSub}>{stepSub}</Text>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Banner de errores / éxito de validación */}
          {errorCount > 0 ? (
            <View style={styles.errBanner}>
              <AlertCircle color={P.coral} size={17} strokeWidth={2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.errBannerTitle}>
                  {errorCount === 1 ? 'Falta 1 campo por corregir' : `Faltan ${errorCount} campos por corregir`}
                </Text>
                <Text style={styles.errBannerText}>
                  Revisa los campos marcados. Lo que ya completaste se conserva.
                </Text>
              </View>
            </View>
          ) : touchedStep === step && !submitError ? (
            <View style={styles.okBanner}>
              <CheckCircle2 color={P.green} size={17} strokeWidth={2} />
              <Text style={styles.okBannerText}>Todo listo, puedes continuar</Text>
            </View>
          ) : null}

          {submitError ? (
            <View style={styles.errBanner}>
              <AlertCircle color={P.coral} size={17} strokeWidth={2} />
              <Text style={[styles.errBannerText, { flex: 1, color: P.textSoft }]}>{submitError}</Text>
            </View>
          ) : null}

          {clubChallenge ? (
            <View style={styles.okBanner}>
              <ShieldCheck color={P.green} size={17} strokeWidth={2} />
              <Text style={styles.okBannerText}>
                Partido de Clubes — al publicarlo aparece para ambos equipos.
              </Text>
            </View>
          ) : null}

          {/* =============== PASO 1 =============== */}
          {step === 1 ? (
            <View style={{ gap: 16 }}>
              <View onLayout={registerPos('cupos')}>
                <Card style={{ padding: 14, gap: 11 }}>
                  <View>
                    <Text style={styles.cardTitle}>Jugadores que faltan</Text>
                    <Text style={styles.cardSub}>
                      Indica cuántas personas pueden unirse, no la capacidad total de la cancha.
                    </Text>
                  </View>
                  <Stepper
                    value={draft.cupos}
                    onChange={(v) => set({ cupos: v })}
                    min={CUPOS.min}
                    max={CUPOS.max}
                    error={!!errors.cupos}
                  />
                  <ErrorHint>{errors.cupos}</ErrorHint>
                </Card>
              </View>

              <Field label="Cuota por jugador" right={cuotaLabel(draft.cuota === '' ? 0 : Number(draft.cuota))} onLayout={registerPos('cuota')}>
                <Input
                  value={String(draft.cuota)}
                  onChangeText={(v) => set({ cuota: v.replace(/[^\d]/g, '').slice(0, 7) })}
                  placeholder="0"
                  keyboardType="number-pad"
                  prefix="$"
                  suffix="CLP"
                  error={!!errors.cuota}
                />
                <ErrorHint>{errors.cuota}</ErrorHint>
                <Note>
                  Déjalo en 0 y se publica como Gratis. El pago se acuerda directamente con los
                  jugadores: FutFinder no procesa pagos.
                </Note>
              </Field>

              <Field label="Nivel del encuentro" onLayout={registerPos('nivel')}>
                {NIVELES.map((n) => (
                  <RadioRow
                    key={n.value}
                    label={n.label}
                    desc={n.desc}
                    selected={draft.nivel === n.value}
                    onPress={() => set({ nivel: n.value })}
                    error={!!errors.nivel}
                  />
                ))}
                <ErrorHint>{errors.nivel}</ErrorHint>
              </Field>

              <Field label="Duración del partido" onLayout={registerPos('duracion')}>
                <View style={styles.row}>
                  {DURACIONES.map((d) => (
                    <OptionChip
                      key={d}
                      label={`${d} min`}
                      flex
                      height={46}
                      active={Number(draft.duracion) === d}
                      onPress={() => set({ duracion: d })}
                    />
                  ))}
                </View>
                <ErrorHint>{errors.duracion}</ErrorHint>
              </Field>

              <Field label="Trust Score mínimo para unirse" onLayout={registerPos('minTrust')}>
                {TRUST_OPTS.map((t) => (
                  <RadioRow
                    key={t.value}
                    label={t.label}
                    desc={t.desc}
                    selected={Number(draft.minTrust) === t.value}
                    onPress={() => set({ minTrust: t.value })}
                  />
                ))}
                <Note>
                  Los jugadores bajo este nivel no podrán solicitar un cupo, y el botón les
                  aparecerá bloqueado con el motivo.
                </Note>
              </Field>

              <Field label="Rango de edad" onLayout={registerPos('edad')}>
                <View style={styles.wrap}>
                  {EDAD_PRESETS.map((p, i) => (
                    <OptionChip
                      key={p.label}
                      label={p.label}
                      active={draft.edadPreset === i}
                      onPress={() => set({ edadPreset: i })}
                    />
                  ))}
                  <OptionChip
                    label="Personalizado"
                    active={draft.edadPreset === -1}
                    onPress={() => set({ edadPreset: -1 })}
                  />
                </View>
                {draft.edadPreset === -1 ? (
                  <View style={styles.edadBox}>
                    <Input
                      value={String(draft.edadMin)}
                      onChangeText={(v) => set({ edadMin: v.replace(/\D/g, '').slice(0, 2) })}
                      placeholder="17"
                      keyboardType="number-pad"
                      style={styles.edadInput}
                    />
                    <Text style={styles.edadDash}>–</Text>
                    <Input
                      value={String(draft.edadMax)}
                      onChangeText={(v) => set({ edadMax: v.replace(/\D/g, '').slice(0, 2) })}
                      placeholder="26"
                      keyboardType="number-pad"
                      style={styles.edadInput}
                    />
                    <Text style={styles.edadUnit}>años</Text>
                  </View>
                ) : null}
                <ErrorHint>{errors.edad}</ErrorHint>
                <Note>Los jugadores fuera del rango no podrán solicitar un cupo.</Note>
              </Field>

              <Field
                label="Descripción"
                hint="opcional"
                right={`${draft.descripcion.length}/${DESC_MAX}`}
                onLayout={registerPos('descripcion')}
              >
                <Input
                  value={draft.descripcion}
                  onChangeText={(v) => set({ descripcion: v })}
                  placeholder="Agrega información sobre la cancha, el ambiente o lo que deben llevar"
                  multiline
                  maxLength={DESC_MAX}
                  error={!!errors.descripcion}
                />
                <ErrorHint>{errors.descripcion}</ErrorHint>
              </Field>
            </View>
          ) : null}

          {/* =============== PASO 2 =============== */}
          {step === 2 ? (
            <View style={{ gap: 14 }}>
              <Field label="Título del partido" onLayout={registerPos('titulo')}>
                <Input
                  value={draft.titulo}
                  onChangeText={(v) => set({ titulo: v })}
                  placeholder="Ej: Pichanga del jueves"
                  maxLength={80}
                  error={!!errors.titulo}
                />
                <ErrorHint>{errors.titulo}</ErrorHint>
                {!errors.titulo ? <Note>Un nombre corto que los jugadores reconozcan</Note> : null}
              </Field>

              <Field label="Modalidad" onLayout={registerPos('modalidad')}>
                <View style={styles.row}>
                  {MODALIDADES.map((m) => (
                    <OptionChip
                      key={m.value}
                      label={m.label}
                      flex
                      height={48}
                      active={draft.modalidad === m.value}
                      onPress={() => set({ modalidad: m.value })}
                    />
                  ))}
                </View>
                <ErrorHint>{errors.modalidad}</ErrorHint>
              </Field>

              <Field label="Nombre de la cancha" onLayout={registerPos('cancha')}>
                <Input
                  value={draft.cancha}
                  onChangeText={(v) => set({ cancha: v })}
                  placeholder="Ej: Cancha Los Olivos"
                  maxLength={80}
                  error={!!errors.cancha}
                />
                <ErrorHint>{errors.cancha}</ErrorHint>
              </Field>

              <Field label="Dirección o sector">
                <LocationAutocomplete
                  value={draft.direccion}
                  placeholder="Busca por dirección o sector"
                  proximity={draft.coords ? { lat: draft.coords.lat, lng: draft.coords.lng } : null}
                  onChangeText={(v) => set({ direccion: v })}
                  onSelect={({ lat, lng, address, comunaRaw, regionRaw, canchaName }) => {
                    const patch = { direccion: address || draft.direccion };
                    if (lat != null && lng != null) patch.coords = { lat, lng };
                    const m = matchComuna(comunaRaw) || matchComuna(regionRaw);
                    if (m) {
                      patch.region = m.region;
                      patch.comuna = m.comuna;
                    }
                    if (canchaName && !draft.cancha.trim()) patch.cancha = canchaName;
                    set(patch);
                  }}
                  inputRowStyle={styles.autoRow}
                  inputStyle={styles.autoInput}
                  dropdownStyle={styles.autoDropdown}
                  optionStyle={styles.autoOption}
                  optionTextStyle={styles.autoOptionText}
                  placeholderColor={P.textPlaceholder}
                  accentColor={P.green}
                  spinnerColor={P.green}
                />
                <Pressable
                  onPress={useMyLocation}
                  disabled={locBusy}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.locBtn, pressed && { opacity: 0.8 }]}
                >
                  <Locate color={P.green} size={15} strokeWidth={2} />
                  <Text style={styles.locBtnText}>
                    {locBusy ? 'Leyendo tu ubicación…' : 'Usar mi ubicación'}
                  </Text>
                </Pressable>
                <Note>
                  Solo la usamos para ubicar la cancha. No publicamos tu ubicación personal.
                </Note>
              </Field>

              <Field label="Región" onLayout={registerPos('region')}>
                <SelectField
                  value={draft.region ? shorten(draft.region) : null}
                  placeholder="Elige una región"
                  onPress={() => setSheet('region')}
                  error={!!errors.region}
                />
                <ErrorHint>{errors.region}</ErrorHint>
              </Field>

              <Field
                label="Comuna"
                right={draft.region ? `${comunas.length} disponibles` : undefined}
                onLayout={registerPos('comuna')}
              >
                <SelectField
                  value={draft.comuna}
                  placeholder="Elige una comuna"
                  onPress={() => setSheet('comuna')}
                  error={!!errors.comuna}
                />
                <ErrorHint>{errors.comuna}</ErrorHint>
              </Field>

              <View style={styles.row} onLayout={registerPos('fecha')}>
                <View style={{ flex: 1, gap: 7 }}>
                  <FieldLabel>Fecha</FieldLabel>
                  <SelectField
                    icon={Calendar}
                    value={formatFechaRelativa(draft.fecha)}
                    placeholder="Elige el día"
                    onPress={() => setSheet('fecha')}
                    error={!!errors.fecha}
                    chevron={false}
                  />
                </View>
                <View style={{ flex: 1, gap: 7 }} onLayout={registerPos('hora')}>
                  <FieldLabel>Hora</FieldLabel>
                  <SelectField
                    icon={Clock}
                    value={draft.hora}
                    placeholder="Elige la hora"
                    onPress={() => setSheet('hora')}
                    error={!!errors.hora}
                    chevron={false}
                  />
                </View>
              </View>
              <ErrorHint>{errors.fecha || errors.hora}</ErrorHint>

              <View style={styles.wrap}>
                <OptionChip
                  label="Hoy"
                  height={36}
                  active={sameDay(draft.fecha, startOfDay(new Date()))}
                  onPress={() => set({ fecha: startOfDay(new Date()) })}
                />
                <OptionChip
                  label="Mañana"
                  height={36}
                  active={sameDay(draft.fecha, addDays(startOfDay(new Date()), 1))}
                  onPress={() => set({ fecha: addDays(startOfDay(new Date()), 1) })}
                />
                <OptionChip
                  label="Sábado"
                  height={36}
                  active={sameDay(draft.fecha, nextWeekday(6))}
                  onPress={() => set({ fecha: nextWeekday(6) })}
                />
                {['19:00', '20:00', '21:00'].map((h) => (
                  <OptionChip
                    key={h}
                    label={h}
                    height={36}
                    active={draft.hora === h}
                    onPress={() => set({ hora: h })}
                  />
                ))}
              </View>
              <Note>
                Los accesos rápidos completan fecha y hora; también puedes abrir el selector
                completo. Las fechas y horas pasadas quedan bloqueadas.
              </Note>
            </View>
          ) : null}

          {/* =============== PASO 3 =============== */}
          {step === 3 ? (
            <View style={{ gap: 16 }}>
              <Field label="Aprobación de jugadores" onLayout={registerPos('aprobacion')}>
                <RadioRow
                  label="Inmediata"
                  desc="Los jugadores que cumplan los requisitos quedan confirmados automáticamente."
                  selected={draft.aprobacion === 'inmediata'}
                  onPress={() => set({ aprobacion: 'inmediata' })}
                />
                <RadioRow
                  label="Manual"
                  desc="Revisarás cada solicitud antes de confirmar un cupo."
                  selected={draft.aprobacion === 'manual'}
                  onPress={() => set({ aprobacion: 'manual' })}
                />
                <ErrorHint>{errors.aprobacion}</ErrorHint>
              </Field>

              <Field label="Recordatorios">
                <Card style={{ paddingVertical: 4, paddingHorizontal: 13 }} radius={R.input}>
                  <ToggleRow
                    title="Notificar jugadores 1 h antes"
                    desc="Enviamos un aviso con la cancha y la hora a los confirmados."
                    value={draft.recordatorio1h}
                    onChange={(v) => set({ recordatorio1h: v })}
                  />
                  <ToggleRow
                    title="Pedir confirmación de asistencia"
                    desc="Al terminar te pedimos marcar quién asistió. Afecta el Trust Score del grupo."
                    value={draft.pedirAsistencia}
                    onChange={(v) => set({ pedirAsistencia: v })}
                    last
                  />
                </Card>
              </Field>

              <Field label="Resumen antes de publicar">
                <Card style={{ padding: 14, gap: 11 }}>
                  <Text style={styles.summaryTitle}>{draft.titulo || 'Sin título'}</Text>
                  <View style={styles.wrap}>
                    <Tag label={MODALIDADES.find((m) => m.value === draft.modalidad)?.label} tone="green" />
                    <Tag label={nivelLabel(draft.nivel)} />
                    <Tag label={`${draft.duracion} min`} />
                  </View>
                  <View style={{ height: 1, backgroundColor: P.hairline }} />
                  <DetailRow
                    label="Fecha y hora"
                    value={dt ? `${capitalize(formatFechaLarga(dt))} · ${draft.hora}` : '—'}
                  />
                  <DetailRow
                    label="Cancha"
                    value={[draft.cancha, draft.comuna].filter(Boolean).join(' · ') || '—'}
                  />
                  <DetailRow
                    label="Jugadores que faltan"
                    value={`${draft.cupos} ${draft.cupos === 1 ? 'cupo' : 'cupos'}`}
                  />
                  <DetailRow
                    label="Cuota"
                    value={cuotaLabel(draft.cuota === '' ? 0 : Number(draft.cuota))}
                    tone="green"
                  />
                  <DetailRow label="Trust Score mínimo" value={trustLabel({ min_trust_score: Number(draft.minTrust) })} />
                  <DetailRow label="Rango de edad" value={edadLabel(resolveEdadAsMatch(draft))} />
                  <DetailRow
                    label="Aprobación"
                    value={draft.aprobacion === 'manual' ? 'Manual' : 'Inmediata'}
                  />
                  <DetailRow
                    label="Recordatorio 1 h antes"
                    value={draft.recordatorio1h ? 'Sí' : 'No'}
                  />
                  <DetailRow
                    label="Pedir asistencia"
                    value={draft.pedirAsistencia ? 'Sí' : 'No'}
                    last
                  />
                </Card>
              </Field>
            </View>
          ) : null}

          <View style={{ height: 12 }} />
        </ScrollView>

        {/* CTA sticky */}
        <View style={[styles.footer, { paddingBottom: 16 + Math.max(insets.bottom, 8) }]}>
          {step < 3 ? (
            <View style={styles.row}>
              <GhostButton
                label={step === 1 ? 'Cancelar' : 'Atrás'}
                icon={step === 1 ? undefined : ArrowLeft}
                onPress={goBack}
                height={52}
                style={{ flex: 1 }}
              />
              <PrimaryButton
                label="Continuar"
                icon={ArrowRight}
                iconRight
                onPress={goNext}
                height={52}
                style={{ flex: 1.8 }}
              />
            </View>
          ) : (
            <View style={{ gap: 9 }}>
              <PrimaryButton
                label="Publicar partido"
                onPress={publish}
                loading={submitting}
                disabled={!online}
                height={54}
              />
              <GhostButton label="Volver y editar" onPress={goBack} height={48} />
              {!online ? (
                <Note>Sin conexión no podemos publicar. Tu borrador queda intacto.</Note>
              ) : null}
            </View>
          )}
        </View>
      </SafeAreaView>

      <PickerSheet
        visible={sheet === 'region'}
        onClose={() => setSheet(null)}
        title="Región"
        options={REGIONES.map((r) => ({ value: r.nombre, label: r.nombre }))}
        value={draft.region}
        searchPlaceholder="Buscar región…"
        onSelect={(v) => set({ region: v, comuna: '' })}
      />
      <PickerSheet
        visible={sheet === 'comuna'}
        onClose={() => setSheet(null)}
        title="Comuna"
        subtitle={draft.region ? `${comunas.length} en ${shorten(draft.region)}` : ''}
        options={comunas}
        value={draft.comuna}
        searchPlaceholder="Buscar comuna…"
        emptyText="Elige primero una región"
        onSelect={(v) => set({ comuna: v })}
      />
      <DateSheet
        visible={sheet === 'fecha'}
        onClose={() => setSheet(null)}
        value={draft.fecha}
        onSelect={(v) => set({ fecha: v })}
      />
      <TimeSheet
        visible={sheet === 'hora'}
        onClose={() => setSheet(null)}
        value={draft.hora}
        minDate={draft.fecha}
        onSelect={(v) => set({ hora: v })}
      />
    </KeyboardAvoidingView>
  );
}

// ------------------------------------------------------------- éxito

function PublishedView({ match, onOpen, onShare, onBack, shareOpen, onCloseShare }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.successScroll, { paddingBottom: 24 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ alignItems: 'center', gap: 12 }}>
            <View style={styles.successIcon}>
              <CheckCircle2 color={P.green} size={30} strokeWidth={2} />
            </View>
            <Text style={styles.successTitle}>Partido publicado</Text>
            <Text style={styles.successText}>
              Ya aparece en Partidos para los jugadores cerca de {match?.comuna || 'tu zona'}.
            </Text>
          </View>

          <Card style={{ padding: 16, gap: 12, marginTop: 20 }}>
            <Text style={styles.summaryTitle}>{match?.titulo}</Text>
            <View style={styles.wrap}>
              {match?.modalidad ? (
                <Tag label={match.modalidad === 'futbol11' ? 'Fútbol 11' : 'Fútbol 7'} tone="green" />
              ) : null}
              <Tag label={nivelLabel(match?.nivel)} />
              <Tag label={`${match?.duracion_min} min`} />
            </View>
            <View style={{ height: 1, backgroundColor: P.hairline }} />
            <Row icon={Calendar} tone="green">
              {match?.hora
                ? `${capitalize(formatFechaLarga(match.hora))} · ${new Date(match.hora).toTimeString().slice(0, 5)}`
                : '—'}
            </Row>
            <Row icon={MapPin}>
              {[match?.cancha_nombre, match?.comuna].filter(Boolean).join(' · ')}
            </Row>
            <Row icon={ShieldCheck}>
              {`${match?.cupos_disponibles} ${match?.cupos_disponibles === 1 ? 'cupo' : 'cupos'} · ${cuotaLabel(match?.precio_cuota)} · ${match?.aprobacion === 'manual' ? 'Aprobación manual' : 'Inscripción inmediata'} · ${edadLabel(match)}`}
            </Row>
          </Card>

          <View style={{ gap: 9, marginTop: 20 }}>
            <PrimaryButton label="Ver mi partido" onPress={onOpen} height={52} />
            <SurfaceButton label="Compartir el partido" icon={Share2} onPress={onShare} height={48} />
            <Pressable onPress={onBack} style={({ pressed }) => [{ height: 44, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
              <Text style={{ fontSize: 13.5, fontWeight: '700', color: P.textMuted }}>
                Volver a Partidos
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
      <ShareSheet visible={shareOpen} onClose={onCloseShare} match={match} />
    </View>
  );
}

// ------------------------------------------------------------ helpers

function Field({ label, hint, right, children, onLayout }) {
  return (
    <View style={{ gap: 7 }} onLayout={onLayout}>
      <FieldLabel hint={hint} right={right}>
        {label}
      </FieldLabel>
      {children}
    </View>
  );
}

function ToggleRow({ title, desc, value, onChange, last }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: P.divider,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: P.text }}>{title}</Text>
        <Text style={{ fontSize: 11, lineHeight: 16, color: P.textFaint, marginTop: 2 }}>{desc}</Text>
      </View>
      <Toggle value={value} onValueChange={onChange} accessibilityLabel={title} />
    </View>
  );
}

function Row({ icon: Icon, children, tone }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon color={tone === 'green' ? P.green : P.textMuted} size={15} strokeWidth={2} />
      <Text
        style={{
          flex: 1,
          fontSize: tone === 'green' ? 13 : 12.5,
          fontWeight: tone === 'green' ? '700' : '500',
          color: tone === 'green' ? P.text : P.textDim,
        }}
      >
        {children}
      </Text>
    </View>
  );
}

function resolveEdad(draft) {
  if (draft.edadPreset === -1) {
    return {
      min: draft.edadMin === '' ? null : Number(draft.edadMin),
      max: draft.edadMax === '' ? null : Number(draft.edadMax),
    };
  }
  const p = EDAD_PRESETS[draft.edadPreset] || EDAD_PRESETS[0];
  return { min: p.min, max: p.max };
}

function resolveEdadAsMatch(draft) {
  const e = resolveEdad(draft);
  return { edad_min: e.min, edad_max: e.max };
}

function sameDay(a, b) {
  if (!a || !b) return false;
  return startOfDay(new Date(a)).getTime() === startOfDay(new Date(b)).getTime();
}

function addDays(d, n) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function capitalize(s) {
  return s ? String(s)[0].toUpperCase() + String(s).slice(1) : s;
}

/** Token de idempotencia con formato uuid v4. */
function makeToken() {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[(Math.floor(Math.random() * 4) + 8)];
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: P.bg },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: { fontSize: 15, fontWeight: '700', color: P.text },
  topSub: { fontSize: 11.5, fontWeight: '500', color: P.textFaint, marginTop: 1 },

  progressWrap: { paddingHorizontal: 16, paddingBottom: 14 },
  progressRow: { flexDirection: 'row', gap: 5, marginBottom: 9 },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: P.chip,
    overflow: 'hidden',
  },
  stepHeadRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  stepTitle: { fontSize: 19, fontWeight: '800', color: P.text, letterSpacing: -0.4 },
  stepCount: { fontSize: 11, fontWeight: '700', color: P.textFaint },
  stepSub: { fontSize: 12, fontWeight: '500', color: P.textFaint, marginTop: 3 },

  scroll: { paddingHorizontal: 16, paddingBottom: 20 },

  errBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(232,115,123,0.09)',
    borderWidth: 1,
    borderColor: P.coralBorder,
    borderRadius: R.input,
    padding: 12,
    marginBottom: 12,
  },
  errBannerTitle: { fontSize: 13, fontWeight: '700', color: P.coral },
  errBannerText: { fontSize: 11.5, lineHeight: 17, color: '#8D958D', marginTop: 2 },
  okBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(90,224,106,0.10)',
    borderWidth: 1,
    borderColor: P.greenBorder,
    borderRadius: R.input,
    padding: 12,
    marginBottom: 12,
  },
  okBannerText: { flex: 1, fontSize: 12.5, fontWeight: '700', color: P.green },

  cardTitle: { fontSize: 14, fontWeight: '700', color: P.text },
  cardSub: { fontSize: 11.5, lineHeight: 17, color: P.textFaint, marginTop: 2 },
  summaryTitle: { fontSize: 17, fontWeight: '800', color: P.text, letterSpacing: -0.3 },

  row: { flexDirection: 'row', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  edadBox: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  edadInput: { width: 62, textAlign: 'center' },
  edadDash: { fontSize: 13, fontWeight: '600', color: P.textPlaceholder },
  edadUnit: { fontSize: 11.5, color: P.textGhost },

  autoRow: {
    height: 48,
    borderRadius: R.input,
    backgroundColor: P.surface,
    borderColor: P.border,
    paddingHorizontal: 13,
  },
  autoInput: { fontSize: 14, fontWeight: '600', color: P.text },
  autoDropdown: {
    backgroundColor: P.surface,
    borderColor: P.border,
    borderRadius: R.input,
  },
  autoOption: { borderTopColor: P.divider, backgroundColor: 'transparent' },
  autoOptionText: { color: P.textStrong, fontSize: 13 },

  locBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(90,224,106,0.35)',
  },
  locBtnText: { fontSize: 12.5, fontWeight: '700', color: P.green },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 14,
    backgroundColor: P.surfaceAlt,
    borderTopWidth: 1,
    borderTopColor: P.hairline,
  },

  successScroll: { paddingHorizontal: 22, paddingTop: 40 },
  successIcon: {
    width: 70,
    height: 70,
    borderRadius: 24,
    backgroundColor: 'rgba(90,224,106,0.13)',
    borderWidth: 1,
    borderColor: P.greenBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: { fontSize: 24, fontWeight: '800', color: P.text, letterSpacing: -0.5 },
  successText: { fontSize: 13, lineHeight: 20, color: P.textMuted, textAlign: 'center' },
});
