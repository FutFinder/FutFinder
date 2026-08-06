import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Locate,
} from 'lucide-react-native';

import { partidos as P, partidosRadius as R } from '../theme/colors';
import {
  Callout,
  Card,
  ErrorHint,
  FieldLabel,
  GhostButton,
  IconButton,
  Input,
  Note,
  OptionChip,
  PrimaryButton,
  RadioRow,
  SectionLabel,
  SelectField,
  Stepper,
  Toggle,
} from '../components/partidos/ui';
import PickerSheet from '../components/partidos/PickerSheet';
import Sheet from '../components/partidos/Sheet';
import { DateSheet, TimeSheet, formatFechaLarga, startOfDay } from '../components/partidos/DateTimeSheets';
import { LoadingList, ErrorState } from '../components/partidos/StateViews';
import LocationAutocomplete, { reverseGeocode } from '../components/LocationAutocomplete';
import {
  getMatchAttendees,
  getMatchRequests,
  translateSchemaError,
  updateMatch,
} from '../services/matches';
import { pickImage, uploadMatchCover } from '../services/storage';
import { getCurrentUser } from '../services/auth';
import { getCurrentLocation } from '../services/location';
import { useOnline, isNetworkError } from '../services/connectivity';
import { goBackOrPartidos } from '../utils/navigation';
import { REGIONES, getComunasOfRegion, matchComuna } from '../data/regiones-chile';
import { shorten } from '../components/partidos/FiltersSheet';
import {
  CUPOS,
  DESC_MAX,
  DURACIONES,
  EDAD_PRESETS,
  MODALIDADES,
  NIVELES,
  TRUST_OPTS,
  combineDateTime,
  cuotaLabel,
} from '../services/matchRules';

/**
 * «Editar partido publicado» (punto 12 del brief).
 *
 * A diferencia de publicar, la edición es un formulario único: el organizador
 * ya conoce su partido y viene a cambiar una cosa concreta.
 *
 * Reglas que se respetan acá y no en el resto de la app:
 *   · Los cupos totales no pueden bajar de los jugadores ya confirmados.
 *   · Cambiar fecha, hora o cancha avisa a los confirmados, así que se
 *     advierte antes de guardar.
 *   · Nunca se toca la lista de confirmados ni las solicitudes pendientes.
 */
export default function EditMatchScreen({ route, navigation }) {
  const matchId = route?.params?.matchId;
  const insets = useSafeAreaInsets();
  const online = useOnline();

  const [original, setOriginal] = useState(null);
  const [form, setForm] = useState(null);
  const [confirmedCount, setConfirmedCount] = useState(0);
  // Confirmados que SÍ ocupan un cupo. En este backend `cupos_totales` son las
  // plazas ofrecidas a otros jugadores y el organizador no consume ninguna, así
  // que hay que excluirlo de toda la aritmética de cupos.
  const [ocupadas, setOcupadas] = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  const [isOrganizer, setIsOrganizer] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [coverUrl, setCoverUrl] = useState(null);
  const [uploadingCover, setUploadingCover] = useState(false);

  const load = useCallback(async () => {
    const [attRes, reqRes, user] = await Promise.all([
      getMatchAttendees(matchId).catch((e) => ({ data: [], match: null, error: e })),
      getMatchRequests(matchId).catch(() => ({ data: [] })),
      getCurrentUser(),
    ]);
    const m = attRes.match;
    if (!m) {
      setLoadError(attRes.error || { message: 'No encontramos este partido.' });
      setLoading(false);
      return;
    }
    const confirmados = (attRes.data || []).filter(
      (a) => a.estado !== 'pendiente' && a.estado !== 'cancelado'
    );
    setConfirmedCount(confirmados.length);
    setOcupadas(confirmados.filter((a) => a.user_id !== m.id_organizador).length);
    setRequestCount((reqRes.data || []).length);
    setIsOrganizer(user?.id === m.id_organizador);
    setOriginal(m);
    setForm(toForm(m));
    setCoverUrl(m.foto_url || null);
    setLoading(false);
  }, [matchId]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((prev) => {
      if (!Object.keys(prev).length) return prev;
      const next = { ...prev };
      Object.keys(patch).forEach((k) => {
        delete next[k === 'edadMin' || k === 'edadMax' || k === 'edadPreset' ? 'edad' : k];
      });
      return next;
    });
  };

  const comunas = useMemo(() => (form?.region ? getComunasOfRegion(form.region) : []), [form?.region]);

  // Cupos totales mínimos: los que ya están tomados por otros jugadores.
  const minCupos = Math.max(CUPOS.min, ocupadas);

  const dirty = useMemo(() => {
    if (!form || !original) return false;
    return JSON.stringify(form) !== JSON.stringify(toForm(original));
  }, [form, original]);

  /** Cambios que obligan a avisar a los confirmados. */
  const notifyChanges = useMemo(() => {
    if (!form || !original) return [];
    const out = [];
    const origDt = new Date(original.hora);
    const newDt = combineDateTime(form.fecha, form.hora);
    if (newDt && newDt.getTime() !== origDt.getTime()) {
      out.push('la fecha y la hora');
    }
    if (form.cancha.trim() !== (original.cancha_nombre || '')) out.push('la cancha');
    if (form.comuna !== (original.comuna || '')) out.push('la comuna');
    if (Number(form.cuota || 0) !== Number(original.precio_cuota || 0)) out.push('la cuota');
    return out;
  }, [form, original]);

  const validate = () => {
    const e = {};
    if (!form.titulo.trim()) e.titulo = 'El título no puede quedar vacío';
    if (!MODALIDADES.some((m) => m.value === form.modalidad)) e.modalidad = 'Elige la modalidad';
    if (!form.cancha.trim()) e.cancha = 'Falta el nombre de la cancha';
    if (!form.region) e.region = 'Elige una región';
    if (!form.comuna) e.comuna = 'Elige una comuna';

    const dt = combineDateTime(form.fecha, form.hora);
    if (!dt) e.fecha = 'La fecha o la hora no son válidas';
    else if (dt.getTime() <= Date.now()) e.hora = 'La hora ya pasó. Elige una hora futura.';

    const cupos = Number(form.cupos);
    if (!Number.isFinite(cupos) || cupos < CUPOS.min) e.cupos = 'Necesitas al menos 1 cupo';
    else if (cupos > CUPOS.max) e.cupos = `El máximo es ${CUPOS.max} cupos`;
    else if (cupos < ocupadas) {
      e.cupos = `Ya hay ${ocupadas} ${ocupadas === 1 ? 'cupo tomado' : 'cupos tomados'}: no puedes bajar de ahí sin sacar a alguien del plantel.`;
    }

    const cuota = form.cuota === '' ? 0 : Number(form.cuota);
    if (!Number.isFinite(cuota) || cuota < 0) e.cuota = 'La cuota no puede ser negativa';

    if (form.edadPreset === -1) {
      const min = form.edadMin === '' ? null : Number(form.edadMin);
      const max = form.edadMax === '' ? null : Number(form.edadMax);
      if (min != null && max != null && min >= max) {
        e.edad = 'La edad mínima debe ser menor que la máxima';
      }
    }

    if ((form.descripcion || '').length > DESC_MAX) {
      e.descripcion = `La descripción no puede pasar de ${DESC_MAX} caracteres`;
    }
    return e;
  };

  const attemptSave = () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      setFeedback({
        tone: 'error',
        title:
          Object.keys(e).length === 1
            ? 'Falta 1 campo por corregir'
            : `Faltan ${Object.keys(e).length} campos por corregir`,
        text: 'Revisa los campos marcados. Lo que ya cambiaste se conserva.',
      });
      return;
    }
    if (notifyChanges.length > 0) {
      setSheet('confirmar');
      return;
    }
    save();
  };

  const save = async () => {
    if (saving) return;
    if (!online) {
      setFeedback({
        tone: 'error',
        title: 'Sin conexión',
        text: 'No podemos guardar ahora. Tus cambios siguen en pantalla.',
      });
      return;
    }
    setSaving(true);
    setSheet(null);

    const dt = combineDateTime(form.fecha, form.hora);
    const edad = resolveEdad(form);
    const nuevosTotales = Number(form.cupos);
    // `cupos_disponibles` solo se recalcula si el total cambió, y siempre
    // descontando a los jugadores que realmente ocupan un cupo (sin contar al
    // organizador). Si el total no cambió no se toca: recalcularlo a ciegas
    // hacía desaparecer un cupo cada vez que se guardaba.
    const totalCambio = nuevosTotales !== (original.cupos_totales ?? nuevosTotales);

    const { error } = await updateMatch(matchId, {
      titulo: form.titulo.trim(),
      modalidad: form.modalidad,
      cancha_nombre: form.cancha.trim(),
      direccion: form.direccion.trim() || null,
      latitud: form.coords?.lat ?? original.latitud,
      longitud: form.coords?.lng ?? original.longitud,
      region: form.region,
      comuna: form.comuna,
      hora: dt.toISOString(),
      cupos_totales: nuevosTotales,
      ...(totalCambio ? { cupos_disponibles: Math.max(0, nuevosTotales - ocupadas) } : {}),
      precio_cuota: form.cuota === '' ? 0 : Number(form.cuota),
      nivel: form.nivel,
      duracion_min: Number(form.duracion),
      min_trust_score: Number(form.minTrust),
      aprobacion: form.aprobacion,
      edad_min: edad.min,
      edad_max: edad.max,
      recordatorio_1h: form.recordatorio1h,
      pedir_asistencia: form.pedirAsistencia,
      descripcion: form.descripcion.trim() || null,
    });
    setSaving(false);

    if (error) {
      setFeedback({
        tone: 'error',
        title: 'No pudimos guardar los cambios',
        text: isNetworkError(error)
          ? 'Se cortó la conexión. Vuelve a intentarlo.'
          : translateSchemaError(error) || error.message || 'Intenta de nuevo.',
      });
      return;
    }

    setFeedback({
      tone: 'success',
      title: 'Cambios guardados',
      text:
        notifyChanges.length === 0
          ? 'El partido ya está actualizado.'
          : confirmedCount === 1
          ? 'Avisamos al jugador confirmado del cambio.'
          : `Avisamos a los ${confirmedCount} confirmados del cambio.`,
    });
    setTimeout(() => goBackOrPartidos(navigation), 900);
  };

  const discard = () => {
    if (!dirty) {
      goBackOrPartidos(navigation);
      return;
    }
    setSheet('descartar');
  };

  /**
   * Portada del partido. Se sube al instante (no espera «Guardar») porque
   * `uploadMatchCover` ya escribe `foto_url` con el matchId que tenemos acá.
   */
  const pickCover = async () => {
    if (uploadingCover) return;
    const { ok, asset, reason } = await pickImage({ aspect: [16, 9], quality: 0.7 });
    if (!ok) {
      if (reason && reason !== 'Cancelado') {
        setFeedback({ tone: 'error', title: 'No pudimos abrir tus fotos', text: reason });
      }
      return;
    }
    setUploadingCover(true);
    const { url, error } = await uploadMatchCover(matchId, asset);
    setUploadingCover(false);
    if (error) {
      setFeedback({ tone: 'error', title: 'No pudimos subir la portada', text: error.message || '' });
      return;
    }
    setCoverUrl(url);
    setFeedback({ tone: 'success', title: 'Portada actualizada', text: '' });
  };

  const useMyLocation = async () => {
    const loc = await getCurrentLocation();
    if (!loc?.ok) return;
    const patch = { coords: { lat: loc.latitude, lng: loc.longitude } };
    const rev = await reverseGeocode({ lat: loc.latitude, lng: loc.longitude });
    if (rev?.address) patch.direccion = rev.address;
    const m = matchComuna(rev?.comunaRaw) || matchComuna(rev?.regionRaw);
    if (m) {
      patch.region = m.region;
      patch.comuna = m.comuna;
    }
    set(patch);
  };

  // ------------------------------------------------------------- render

  if (loading) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <TopBar onBack={() => goBackOrPartidos(navigation)} title="Editar partido" />
          <View style={{ paddingHorizontal: 16 }}>
            <LoadingList count={2} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (!form) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <TopBar onBack={() => goBackOrPartidos(navigation)} title="Editar partido" />
          <ErrorState onRetry={load} detail={loadError?.message} />
        </SafeAreaView>
      </View>
    );
  }

  if (!isOrganizer) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <TopBar onBack={() => goBackOrPartidos(navigation)} title="Editar partido" />
          <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
            <Callout
              tone="danger"
              icon={AlertCircle}
              title="Solo el organizador puede editar este partido"
              text="Estos cambios también los valida el backend, así que no basta con abrir esta pantalla."
            />
            <GhostButton label="Volver" onPress={() => goBackOrPartidos(navigation)} height={48} style={{ marginTop: 14 }} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const canceled = original.estado === 'cancelado';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <TopBar
          onBack={discard}
          title="Editar partido"
          subtitle={`${confirmedCount} ${confirmedCount === 1 ? 'confirmado' : 'confirmados'}${requestCount ? ` · ${requestCount} solicitudes` : ''}`}
        />

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {feedback ? (
            <Callout
              tone={feedback.tone === 'success' ? 'green' : 'danger'}
              icon={feedback.tone === 'success' ? CheckCircle2 : AlertCircle}
              title={feedback.title}
              text={feedback.text}
              onPress={() => setFeedback(null)}
              style={{ marginBottom: 14 }}
            />
          ) : null}

          {canceled ? (
            <Callout
              tone="gold"
              icon={AlertCircle}
              title="Este partido está cancelado"
              text="Puedes corregir sus datos, pero seguirá sin aparecer en Partidos."
              style={{ marginBottom: 14 }}
            />
          ) : null}

          {confirmedCount > 0 ? (
            <Callout
              tone="neutral"
              icon={AlertCircle}
              title={`Hay ${confirmedCount} ${confirmedCount === 1 ? 'jugador confirmado' : 'jugadores confirmados'}`}
              text="Editar no saca a nadie ni borra solicitudes. Si cambias fecha, hora, cancha o cuota, les avisamos."
              style={{ marginBottom: 14 }}
            />
          ) : null}

          {/* Portada */}
          <Group label="Portada del partido">
            <Pressable
              onPress={pickCover}
              disabled={uploadingCover}
              accessibilityRole="button"
              accessibilityLabel="Cambiar la portada del partido"
              style={({ pressed }) => [styles.coverBox, pressed && { opacity: 0.85 }]}
            >
              {coverUrl ? (
                <Image source={{ uri: coverUrl }} style={styles.coverImg} />
              ) : (
                <View style={styles.coverEmpty}>
                  <Camera color={P.green} size={24} strokeWidth={2} />
                  <Text style={styles.coverEmptyText}>
                    {uploadingCover ? 'Subiendo la foto…' : 'Toca para subir una foto'}
                  </Text>
                </View>
              )}
              {coverUrl ? (
                <View style={styles.coverBadge}>
                  {uploadingCover ? (
                    <ActivityIndicator color={P.greenInk} size="small" />
                  ) : (
                    <Camera color={P.greenInk} size={14} strokeWidth={2.4} />
                  )}
                </View>
              ) : null}
            </Pressable>
            <Note>Visible para los inscritos y en el chat del partido.</Note>
          </Group>

          {/* Qué se juega */}
          <Group label="Qué se juega">
            <Field label="Título del partido">
              <Input
                value={form.titulo}
                onChangeText={(v) => set({ titulo: v })}
                placeholder="Ej: Pichanga del jueves"
                maxLength={80}
                error={!!errors.titulo}
              />
              <ErrorHint>{errors.titulo}</ErrorHint>
            </Field>

            <Field label="Modalidad">
              <View style={styles.row}>
                {MODALIDADES.map((m) => (
                  <OptionChip
                    key={m.value}
                    label={m.label}
                    flex
                    height={48}
                    active={form.modalidad === m.value}
                    onPress={() => set({ modalidad: m.value })}
                  />
                ))}
              </View>
              <ErrorHint>{errors.modalidad}</ErrorHint>
            </Field>

            <Field label="Nivel">
              <View style={styles.wrap}>
                {NIVELES.map((n) => (
                  <OptionChip
                    key={n.value}
                    label={n.label}
                    active={form.nivel === n.value}
                    onPress={() => set({ nivel: n.value })}
                  />
                ))}
              </View>
            </Field>

            <Field label="Duración">
              <View style={styles.row}>
                {DURACIONES.map((d) => (
                  <OptionChip
                    key={d}
                    label={`${d} min`}
                    flex
                    height={46}
                    active={Number(form.duracion) === d}
                    onPress={() => set({ duracion: d })}
                  />
                ))}
              </View>
            </Field>
          </Group>

          {/* Cupos y cuota */}
          <Group label="Cupos y cuota">
            <Field label="Cupos totales">
              <Card style={{ padding: 12 }}>
                <Stepper
                  value={Number(form.cupos)}
                  onChange={(v) => set({ cupos: v })}
                  min={CUPOS.min}
                  max={CUPOS.max}
                  error={!!errors.cupos}
                />
              </Card>
              <ErrorHint>{errors.cupos}</ErrorHint>
              <Note>
                {ocupadas > 0
                  ? `El mínimo es ${minCupos} porque ya hay ${ocupadas} ${ocupadas === 1 ? 'cupo tomado' : 'cupos tomados'}. Subir el total abre cupos nuevos sin tocar a nadie.`
                  : 'Nadie ha tomado un cupo todavía, así que puedes ajustar el total libremente. Tú, como organizador, no ocupas uno.'}
              </Note>
            </Field>

            <Field label="Cuota por jugador" right={cuotaLabel(form.cuota === '' ? 0 : Number(form.cuota))}>
              <Input
                value={String(form.cuota)}
                onChangeText={(v) => set({ cuota: v.replace(/[^\d]/g, '').slice(0, 7) })}
                placeholder="0"
                keyboardType="number-pad"
                prefix="$"
                suffix="CLP"
                error={!!errors.cuota}
              />
              <ErrorHint>{errors.cuota}</ErrorHint>
            </Field>
          </Group>

          {/* Dónde */}
          <Group label="Dónde se juega">
            <Field label="Nombre de la cancha">
              <Input
                value={form.cancha}
                onChangeText={(v) => set({ cancha: v })}
                placeholder="Ej: Cancha Los Olivos"
                maxLength={80}
                error={!!errors.cancha}
              />
              <ErrorHint>{errors.cancha}</ErrorHint>
            </Field>

            <Field label="Dirección o sector">
              <LocationAutocomplete
                value={form.direccion}
                placeholder="Busca por dirección o sector"
                onChangeText={(v) => set({ direccion: v })}
                onSelect={({ lat, lng, address, comunaRaw, regionRaw }) => {
                  const patch = { direccion: address || form.direccion };
                  if (lat != null && lng != null) patch.coords = { lat, lng };
                  const m = matchComuna(comunaRaw) || matchComuna(regionRaw);
                  if (m) {
                    patch.region = m.region;
                    patch.comuna = m.comuna;
                  }
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
                style={({ pressed }) => [styles.locBtn, pressed && { opacity: 0.8 }]}
              >
                <Locate color={P.green} size={15} strokeWidth={2} />
                <Text style={styles.locBtnText}>Usar mi ubicación</Text>
              </Pressable>
            </Field>

            <Field label="Región">
              <SelectField
                value={form.region ? shorten(form.region) : null}
                placeholder="Elige una región"
                onPress={() => setSheet('region')}
                error={!!errors.region}
              />
              <ErrorHint>{errors.region}</ErrorHint>
            </Field>

            <Field label="Comuna" right={form.region ? `${comunas.length} disponibles` : undefined}>
              <SelectField
                value={form.comuna}
                placeholder="Elige una comuna"
                onPress={() => setSheet('comuna')}
                error={!!errors.comuna}
              />
              <ErrorHint>{errors.comuna}</ErrorHint>
            </Field>
          </Group>

          {/* Cuándo */}
          <Group label="Cuándo se juega">
            <View style={styles.row}>
              <View style={{ flex: 1, gap: 7 }}>
                <FieldLabel>Fecha</FieldLabel>
                <SelectField
                  icon={Calendar}
                  value={capitalize(formatFechaLarga(form.fecha))}
                  placeholder="Elige el día"
                  onPress={() => setSheet('fecha')}
                  error={!!errors.fecha}
                  chevron={false}
                />
              </View>
              <View style={{ flex: 1, gap: 7 }}>
                <FieldLabel>Hora</FieldLabel>
                <SelectField
                  icon={Clock}
                  value={form.hora}
                  placeholder="Elige la hora"
                  onPress={() => setSheet('hora')}
                  error={!!errors.hora}
                  chevron={false}
                />
              </View>
            </View>
            <ErrorHint>{errors.fecha || errors.hora}</ErrorHint>
          </Group>

          {/* Acceso */}
          <Group label="Quién puede entrar">
            <Field label="Aprobación de jugadores">
              <RadioRow
                label="Inmediata"
                desc="Quien cumpla los requisitos queda confirmado al instante."
                selected={form.aprobacion === 'inmediata'}
                onPress={() => set({ aprobacion: 'inmediata' })}
              />
              <RadioRow
                label="Manual"
                desc="Revisas cada solicitud antes de confirmar el cupo."
                selected={form.aprobacion === 'manual'}
                onPress={() => set({ aprobacion: 'manual' })}
              />
              {requestCount > 0 && form.aprobacion === 'inmediata' && original.aprobacion === 'manual' ? (
                <Note>
                  Tienes {requestCount} {requestCount === 1 ? 'solicitud' : 'solicitudes'} pendientes.
                  Cambiar a inmediata no las acepta sola: revísalas en la pestaña Solicitudes.
                </Note>
              ) : null}
            </Field>

            <Field label="Trust Score mínimo">
              <View style={styles.wrap}>
                {TRUST_OPTS.map((t) => (
                  <OptionChip
                    key={t.value}
                    label={t.label}
                    active={Number(form.minTrust) === t.value}
                    onPress={() => set({ minTrust: t.value })}
                  />
                ))}
              </View>
              <Note>
                Subirlo no saca a los jugadores que ya están confirmados: solo afecta a las
                solicitudes nuevas.
              </Note>
            </Field>

            <Field label="Rango de edad">
              <View style={styles.wrap}>
                {EDAD_PRESETS.map((p, i) => (
                  <OptionChip
                    key={p.label}
                    label={p.label}
                    active={form.edadPreset === i}
                    onPress={() => set({ edadPreset: i })}
                  />
                ))}
                <OptionChip
                  label="Personalizado"
                  active={form.edadPreset === -1}
                  onPress={() => set({ edadPreset: -1 })}
                />
              </View>
              {form.edadPreset === -1 ? (
                <View style={styles.edadBox}>
                  <Input
                    value={String(form.edadMin)}
                    onChangeText={(v) => set({ edadMin: v.replace(/\D/g, '').slice(0, 2) })}
                    placeholder="17"
                    keyboardType="number-pad"
                    style={styles.edadInput}
                  />
                  <Text style={styles.edadDash}>–</Text>
                  <Input
                    value={String(form.edadMax)}
                    onChangeText={(v) => set({ edadMax: v.replace(/\D/g, '').slice(0, 2) })}
                    placeholder="26"
                    keyboardType="number-pad"
                    style={styles.edadInput}
                  />
                  <Text style={styles.edadUnit}>años</Text>
                </View>
              ) : null}
              <ErrorHint>{errors.edad}</ErrorHint>
            </Field>
          </Group>

          {/* Avisos y descripción */}
          <Group label="Avisos y descripción">
            <Card style={{ paddingVertical: 4, paddingHorizontal: 13 }} radius={R.input}>
              <ToggleRow
                title="Notificar jugadores 1 h antes"
                value={form.recordatorio1h}
                onChange={(v) => set({ recordatorio1h: v })}
              />
              <ToggleRow
                title="Pedir confirmación de asistencia"
                value={form.pedirAsistencia}
                onChange={(v) => set({ pedirAsistencia: v })}
                last
              />
            </Card>

            <Field label="Descripción" hint="opcional" right={`${form.descripcion.length}/${DESC_MAX}`}>
              <Input
                value={form.descripcion}
                onChangeText={(v) => set({ descripcion: v })}
                placeholder="Información sobre la cancha, el ambiente o lo que deben llevar"
                multiline
                maxLength={DESC_MAX}
                error={!!errors.descripcion}
              />
              <ErrorHint>{errors.descripcion}</ErrorHint>
            </Field>
          </Group>

          <View style={{ height: 10 }} />
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: 14 + Math.max(insets.bottom, 8) }]}>
          <View style={styles.row}>
            <GhostButton label="Descartar" onPress={discard} height={52} style={{ flex: 1 }} />
            <PrimaryButton
              label="Guardar cambios"
              onPress={attemptSave}
              loading={saving}
              disabled={!dirty || !online}
              height={52}
              style={{ flex: 1.6 }}
            />
          </View>
          {!dirty ? <Note>Todavía no has cambiado nada.</Note> : null}
        </View>
      </SafeAreaView>

      <PickerSheet
        visible={sheet === 'region'}
        onClose={() => setSheet(null)}
        title="Región"
        options={REGIONES.map((r) => ({ value: r.nombre, label: r.nombre }))}
        value={form.region}
        searchPlaceholder="Buscar región…"
        onSelect={(v) => set({ region: v, comuna: '' })}
      />
      <PickerSheet
        visible={sheet === 'comuna'}
        onClose={() => setSheet(null)}
        title="Comuna"
        subtitle={form.region ? `${comunas.length} en ${shorten(form.region)}` : ''}
        options={comunas}
        value={form.comuna}
        searchPlaceholder="Buscar comuna…"
        onSelect={(v) => set({ comuna: v })}
      />
      <DateSheet
        visible={sheet === 'fecha'}
        onClose={() => setSheet(null)}
        value={form.fecha}
        onSelect={(v) => set({ fecha: v })}
      />
      <TimeSheet
        visible={sheet === 'hora'}
        onClose={() => setSheet(null)}
        value={form.hora}
        minDate={form.fecha}
        onSelect={(v) => set({ hora: v })}
      />

      {/* Advertencia antes de un cambio importante */}
      <Sheet
        visible={sheet === 'confirmar'}
        onClose={() => setSheet(null)}
        title="Vas a cambiar algo importante"
        subtitle={`${confirmedCount} ${confirmedCount === 1 ? 'jugador ya confirmó' : 'jugadores ya confirmaron'}`}
        footer={
          <View style={{ flex: 1, gap: 9 }}>
            <PrimaryButton label="Guardar y avisar" onPress={save} loading={saving} height={52} />
            <Pressable onPress={() => setSheet(null)} style={{ height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={styles.sheetBack}>Seguir editando</Text>
            </Pressable>
          </View>
        }
      >
        <Card style={{ gap: 10 }} radius={16}>
          <SectionLabel>Qué va a pasar</SectionLabel>
          <Bullet tone="gold" text={`Cambias ${notifyChanges.join(', ')}`} />
          <Bullet
            text={
              confirmedCount === 1
                ? 'Avisamos al jugador confirmado con los datos nuevos'
                : `Avisamos a los ${confirmedCount} confirmados con los datos nuevos`
            }
          />
          <Bullet text="Nadie pierde su cupo y las solicitudes pendientes se mantienen" />
          <Bullet text="Quien ya no pueda ir tendrá que salirse, con las reglas normales de Trust Score" />
        </Card>
      </Sheet>

      {/* Descartar cambios */}
      <Sheet
        visible={sheet === 'descartar'}
        onClose={() => setSheet(null)}
        title="¿Descartar los cambios?"
        footer={
          <View style={{ flex: 1, gap: 9 }}>
            <GhostButton
              label="Descartar y salir"
              tone="danger"
              onPress={() => {
                setSheet(null);
                goBackOrPartidos(navigation);
              }}
              height={52}
            />
            <Pressable onPress={() => setSheet(null)} style={{ height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={styles.sheetBack}>Seguir editando</Text>
            </Pressable>
          </View>
        }
      >
        <Note>Lo que editaste no se guardó. El partido queda como estaba antes.</Note>
      </Sheet>
    </KeyboardAvoidingView>
  );
}

// ------------------------------------------------------------ auxiliares

function toForm(m) {
  const dt = new Date(m.hora);
  const preset = matchEdadPreset(m);
  return {
    titulo: m.titulo || '',
    modalidad: m.modalidad || 'futbol7',
    nivel: m.nivel || 'recreativo',
    duracion: m.duracion_min ?? 90,
    cupos: m.cupos_totales ?? 1,
    cuota: String(m.precio_cuota ?? 0),
    cancha: m.cancha_nombre || '',
    direccion: m.direccion || '',
    coords: m.latitud != null ? { lat: Number(m.latitud), lng: Number(m.longitud) } : null,
    region: m.region || '',
    comuna: m.comuna || '',
    fecha: startOfDay(dt),
    hora: dt.toTimeString().slice(0, 5),
    aprobacion: m.aprobacion || 'inmediata',
    minTrust: m.min_trust_score ?? 0,
    edadPreset: preset.index,
    edadMin: preset.index === -1 ? String(m.edad_min ?? '') : '',
    edadMax: preset.index === -1 ? String(m.edad_max ?? '') : '',
    recordatorio1h: m.recordatorio_1h !== false,
    pedirAsistencia: m.pedir_asistencia !== false,
    descripcion: m.descripcion || '',
  };
}

function matchEdadPreset(m) {
  const min = m.edad_min ?? null;
  const max = m.edad_max ?? null;
  const idx = EDAD_PRESETS.findIndex((p) => p.min === min && p.max === max);
  return { index: idx >= 0 ? idx : -1 };
}

function resolveEdad(form) {
  if (form.edadPreset === -1) {
    return {
      min: form.edadMin === '' ? null : Number(form.edadMin),
      max: form.edadMax === '' ? null : Number(form.edadMax),
    };
  }
  const p = EDAD_PRESETS[form.edadPreset] || EDAD_PRESETS[0];
  return { min: p.min, max: p.max };
}

function TopBar({ onBack, title, subtitle }) {
  return (
    <View style={styles.topBar}>
      <IconButton icon={ArrowLeft} onPress={onBack} tone="surface" accessibilityLabel="Volver" />
      <View style={{ flex: 1 }}>
        <Text style={styles.topTitle}>{title}</Text>
        {subtitle ? (
          <Text style={styles.topSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Group({ label, children }) {
  return (
    <View style={{ gap: 12, marginBottom: 22 }}>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </View>
  );
}

function Field({ label, hint, right, children }) {
  return (
    <View style={{ gap: 7 }}>
      <FieldLabel hint={hint} right={right}>
        {label}
      </FieldLabel>
      {children}
    </View>
  );
}

function ToggleRow({ title, value, onChange, last }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 13,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: P.divider,
      }}
    >
      <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: P.text }}>{title}</Text>
      <Toggle value={value} onValueChange={onChange} accessibilityLabel={title} />
    </View>
  );
}

function Bullet({ text, tone }) {
  const color = tone === 'danger' ? P.coral : tone === 'gold' ? P.gold : P.textMuted;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginTop: 6 }} />
      <Text style={{ flex: 1, fontSize: 12, lineHeight: 18, color: P.textSoft }}>{text}</Text>
    </View>
  );
}

function capitalize(s) {
  return s ? String(s)[0].toUpperCase() + String(s).slice(1) : s;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: P.bg },
  scroll: { paddingHorizontal: 16, paddingBottom: 20 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  topTitle: { fontSize: 15, fontWeight: '700', color: P.text },
  topSub: { fontSize: 11.5, fontWeight: '500', color: P.textFaint, marginTop: 1 },

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
  autoDropdown: { backgroundColor: P.surface, borderColor: P.border, borderRadius: R.input },
  autoOption: { borderTopColor: P.divider, backgroundColor: 'transparent' },
  autoOptionText: { color: P.textStrong, fontSize: 13 },

  coverBox: {
    height: 150,
    borderRadius: R.card,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  coverImg: { width: '100%', height: '100%' },
  coverEmpty: { alignItems: 'center', gap: 8 },
  coverEmptyText: { fontSize: 12.5, fontWeight: '600', color: P.textMuted },
  coverBadge: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: P.green,
    alignItems: 'center',
    justifyContent: 'center',
  },

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
    gap: 8,
    backgroundColor: P.surfaceAlt,
    borderTopWidth: 1,
    borderTopColor: P.hairline,
  },
  sheetBack: { fontSize: 13.5, fontWeight: '700', color: P.textMuted },
});
