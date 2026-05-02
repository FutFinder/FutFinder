import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Clock,
  Users,
  DollarSign,
  Trophy,
  AlertCircle,
  Locate,
  CheckCircle2,
  Bell,
} from 'lucide-react-native';

import Logo from '../components/Logo';
import Button from '../components/Button';
import Banner from '../components/Banner';
import { colors, radius } from '../theme/colors';
import { createMatch } from '../services/matches';
import { getCurrentLocation } from '../services/location';
import { isSupabaseConfigured } from '../services/supabase';
import { notify } from '../utils/notify';
import { REGIONES, getComunasOfRegion } from '../data/regiones-chile';

const REGION_DEFAULT = 'Región Metropolitana de Santiago';
const COMUNA_DEFAULT = 'Providencia';

const NIVELES = [
  { value: 'recreativo', label: 'Recreativo' },
  { value: 'intermedio', label: 'Intermedio' },
  { value: 'competitivo', label: 'Competitivo' },
];

// Helper: formatea Date a string DD/MM/YYYY
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

// Parsea "DD/MM/YYYY" + "HH:MM" → Date (o null si inválido)
function parseDateTime(dateStr, timeStr) {
  const dParts = dateStr.split('/');
  const tParts = timeStr.split(':');
  if (dParts.length !== 3 || tParts.length !== 2) return null;
  const [dd, mm, yyyy] = dParts.map((s) => parseInt(s.trim(), 10));
  const [hh, mi] = tParts.map((s) => parseInt(s.trim(), 10));
  if ([dd, mm, yyyy, hh, mi].some(Number.isNaN)) return null;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59) return null;
  const d = new Date(yyyy, mm - 1, dd, hh, mi, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export default function CreateMatchScreen({ navigation }) {
  // Tabs
  const [tab, setTab] = useState('falta_uno'); // 'falta_uno' | 'retos'

  // Cancha
  const [titulo, setTitulo] = useState('');
  const [canchaNombre, setCanchaNombre] = useState('');
  const [region, setRegion] = useState(REGION_DEFAULT);
  const [comuna, setComuna] = useState(COMUNA_DEFAULT);
  const [regionPickerOpen, setRegionPickerOpen] = useState(false);
  const [comunaPickerOpen, setComunaPickerOpen] = useState(false);

  // Comunas filtradas por la región actual
  const comunasOfRegion = getComunasOfRegion(region);

  // GPS
  const [coords, setCoords] = useState(null); // {latitude, longitude}
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState(null);

  // Fecha/hora — defaults: hoy + 2 horas
  const defaultDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const [fechaStr, setFechaStr] = useState(formatDate(defaultDate));
  const [horaStr, setHoraStr] = useState(formatTime(defaultDate));

  // Detalles
  const [cuposTotales, setCuposTotales] = useState('10');
  const [precioCuota, setPrecioCuota] = useState('5000');
  const [nivel, setNivel] = useState('intermedio');
  const [descripcion, setDescripcion] = useState('');

  // Aprobación (placeholder, no se persiste todavía en DB)
  const [aprobacion, setAprobacion] = useState('inmediata'); // | 'manual'

  // Recordatorios (placeholder)
  const [confirmarPost, setConfirmarPost] = useState(false);
  const [notificar1h, setNotificar1h] = useState(true);

  // UI feedback
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState(null);

  // Capturar GPS al montar (no es bloqueante)
  useEffect(() => {
    fetchGPS();
  }, []);

  const fetchGPS = async () => {
    setGpsLoading(true);
    setGpsError(null);
    const r = await getCurrentLocation();
    setGpsLoading(false);
    if (r.ok) {
      setCoords({ latitude: r.latitude, longitude: r.longitude });
    } else {
      setGpsError(r.reason || 'No pude leer tu ubicación');
    }
  };

  const showError = (title, message) => {
    setBanner({ type: 'error', title, message });
    notify(title, message);
  };

  const validate = () => {
    if (!titulo.trim()) return 'Pon un título al partido';
    if (!canchaNombre.trim()) return 'Falta el nombre de la cancha';
    if (!region) return 'Falta la región';
    if (!comuna) return 'Falta la comuna';
    if (!coords) return 'Falta capturar la ubicación GPS de la cancha';
    const dt = parseDateTime(fechaStr, horaStr);
    if (!dt) return 'Fecha u hora con formato inválido (usa DD/MM/YYYY y HH:MM)';
    if (dt.getTime() < Date.now() - 60 * 1000) return 'La fecha/hora ya pasó';
    const cupos = parseInt(cuposTotales, 10);
    if (Number.isNaN(cupos) || cupos < 2 || cupos > 30) return 'Los cupos deben estar entre 2 y 30';
    const precio = parseInt(precioCuota, 10);
    if (Number.isNaN(precio) || precio < 0) return 'La cuota debe ser un número (0 si es gratis)';
    return null;
  };

  const handleSubmit = async () => {
    setBanner(null);
    const err = validate();
    if (err) {
      showError('Revisa el formulario', err);
      return;
    }

    if (!isSupabaseConfigured) {
      showError(
        'Modo demo',
        'Supabase no está configurado, los partidos no se guardarán.'
      );
      return;
    }

    setSubmitting(true);
    const dt = parseDateTime(fechaStr, horaStr);
    const result = await createMatch({
      titulo: titulo.trim(),
      region,
      comuna,
      cancha_nombre: canchaNombre.trim(),
      latitud: coords.latitude,
      longitud: coords.longitude,
      hora: dt.toISOString(),
      cupos_totales: parseInt(cuposTotales, 10),
      precio_cuota: parseInt(precioCuota, 10),
      nivel,
      descripcion: descripcion.trim() || null,
    });
    setSubmitting(false);

    if (result.error) {
      console.error('[FutFinder] createMatch error:', result.error);
      showError(
        'No pudimos publicar el partido',
        result.error.message || 'Intenta de nuevo'
      );
      return;
    }

    setBanner({
      type: 'success',
      title: '¡Partido publicado!',
      message: 'Ya aparece en el feed de partidos cercanos.',
    });
    notify('¡Partido publicado!', 'Aparecerá en el feed de partidos cercanos.');

    // Volver al Home tras un breve delay para que el usuario vea el banner
    setTimeout(() => {
      navigation.navigate('Home');
    }, 900);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Pressable
              onPress={() => navigation.goBack()}
              hitSlop={12}
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            >
              <ArrowLeft color={colors.textPrimary} size={22} />
            </Pressable>
            <View style={styles.logoCenter}>
              <Logo size={28} />
            </View>
            <View style={{ width: 40 }} />
          </View>

          {/* Banner */}
          {banner && (
            <Banner
              type={banner.type}
              title={banner.title}
              message={banner.message}
              onClose={() => setBanner(null)}
            />
          )}

          {/* Tabs Falta Uno / Retos */}
          <View style={styles.tabsRow}>
            <Pressable
              onPress={() => setTab('falta_uno')}
              style={[styles.tab, tab === 'falta_uno' && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabLabel,
                  tab === 'falta_uno' && styles.tabLabelActive,
                ]}
              >
                ⚽ Falta Uno
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setTab('retos')}
              style={[styles.tab, tab === 'retos' && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabLabel,
                  tab === 'retos' && styles.tabLabelActive,
                ]}
              >
                🏆 Retos
              </Text>
            </Pressable>
          </View>

          {tab === 'retos' ? (
            <View style={styles.comingSoon}>
              <Trophy color={colors.textMuted} size={32} />
              <Text style={styles.comingSoonTitle}>Pronto</Text>
              <Text style={styles.comingSoonText}>
                Los retos entre equipos llegan en la próxima fase. Por ahora puedes
                publicar partidos abiertos en "Falta Uno".
              </Text>
            </View>
          ) : (
            <>
              {/* Card: Cancha / Ubicación */}
              <View style={styles.card}>
                <View style={styles.sectionTitle}>
                  <MapPin color={colors.primary} size={18} />
                  <Text style={styles.sectionTitleText}>Cancha / Ubicación</Text>
                </View>

                <Field label="Título del partido">
                  <TextInput
                    style={styles.input}
                    placeholder="Ej: Pichanga del jueves"
                    placeholderTextColor={colors.textMuted}
                    value={titulo}
                    onChangeText={setTitulo}
                  />
                </Field>

                <Field label="Nombre de la cancha">
                  <TextInput
                    style={styles.input}
                    placeholder="Ej: Cancha Los Olivos"
                    placeholderTextColor={colors.textMuted}
                    value={canchaNombre}
                    onChangeText={setCanchaNombre}
                  />
                </Field>

                <Field label="Región">
                  <Pressable
                    onPress={() => {
                      setRegionPickerOpen(!regionPickerOpen);
                      setComunaPickerOpen(false);
                    }}
                    style={styles.input}
                  >
                    <Text style={styles.pickerText} numberOfLines={1}>
                      {region}
                    </Text>
                  </Pressable>
                  {regionPickerOpen && (
                    <View style={styles.picker}>
                      <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
                        {REGIONES.map((r) => (
                          <Pressable
                            key={r.nombre}
                            onPress={() => {
                              setRegion(r.nombre);
                              // Si la comuna actual no pertenece a la nueva región,
                              // la reseteamos a la primera de la región nueva.
                              if (!r.comunas.includes(comuna)) {
                                setComuna(r.comunas[0] || '');
                              }
                              setRegionPickerOpen(false);
                            }}
                            style={[
                              styles.pickerOption,
                              r.nombre === region && styles.pickerOptionActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.pickerOptionText,
                                r.nombre === region && styles.pickerOptionTextActive,
                              ]}
                              numberOfLines={1}
                            >
                              {r.nombre} ({r.codigo})
                            </Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </Field>

                <Field label={`Comuna (${comunasOfRegion.length} disponibles)`}>
                  <Pressable
                    onPress={() => {
                      setComunaPickerOpen(!comunaPickerOpen);
                      setRegionPickerOpen(false);
                    }}
                    style={styles.input}
                  >
                    <Text style={styles.pickerText}>{comuna || 'Selecciona una comuna'}</Text>
                  </Pressable>
                  {comunaPickerOpen && (
                    <View style={styles.picker}>
                      <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
                        {comunasOfRegion.map((c) => (
                          <Pressable
                            key={c}
                            onPress={() => {
                              setComuna(c);
                              setComunaPickerOpen(false);
                            }}
                            style={[
                              styles.pickerOption,
                              c === comuna && styles.pickerOptionActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.pickerOptionText,
                                c === comuna && styles.pickerOptionTextActive,
                              ]}
                            >
                              {c}
                            </Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </Field>

                {/* GPS capture */}
                <View style={styles.gpsBox}>
                  {coords ? (
                    <View style={styles.gpsRow}>
                      <CheckCircle2 color={colors.primary} size={18} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.gpsTitle}>Ubicación capturada ✓</Text>
                        <Text style={styles.gpsCoords}>
                          {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
                        </Text>
                      </View>
                      <Pressable onPress={fetchGPS} hitSlop={8}>
                        <Text style={styles.gpsRefresh}>Refrescar</Text>
                      </Pressable>
                    </View>
                  ) : gpsError ? (
                    <View style={styles.gpsRow}>
                      <AlertCircle color={colors.error} size={18} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.gpsTitle}>No pude leer tu ubicación</Text>
                        <Text style={styles.gpsCoords}>{gpsError}</Text>
                      </View>
                      <Pressable onPress={fetchGPS} hitSlop={8}>
                        <Text style={styles.gpsRefresh}>Reintentar</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      onPress={fetchGPS}
                      style={({ pressed }) => [
                        styles.gpsBtn,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Locate color={colors.primary} size={18} />
                      <Text style={styles.gpsBtnLabel}>
                        {gpsLoading ? 'Capturando…' : 'Usar mi ubicación actual'}
                      </Text>
                    </Pressable>
                  )}
                </View>

                <View style={styles.row2}>
                  <View style={{ flex: 1 }}>
                    <Field label="Fecha" icon={Calendar}>
                      <TextInput
                        style={styles.input}
                        placeholder="DD/MM/YYYY"
                        placeholderTextColor={colors.textMuted}
                        value={fechaStr}
                        onChangeText={setFechaStr}
                      />
                    </Field>
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Field label="Hora" icon={Clock}>
                      <TextInput
                        style={styles.input}
                        placeholder="HH:MM"
                        placeholderTextColor={colors.textMuted}
                        value={horaStr}
                        onChangeText={setHoraStr}
                      />
                    </Field>
                  </View>
                </View>

                <View style={styles.quickRow}>
                  <QuickChip
                    label="Hoy"
                    onPress={() => setFechaStr(formatDate(new Date()))}
                  />
                  <QuickChip
                    label="Mañana"
                    onPress={() => {
                      const t = new Date();
                      t.setDate(t.getDate() + 1);
                      setFechaStr(formatDate(t));
                    }}
                  />
                  <QuickChip label="19:00" onPress={() => setHoraStr('19:00')} />
                  <QuickChip label="20:00" onPress={() => setHoraStr('20:00')} />
                  <QuickChip label="21:00" onPress={() => setHoraStr('21:00')} />
                </View>
              </View>

              {/* Card: Detalles */}
              <View style={styles.card}>
                <View style={styles.sectionTitle}>
                  <Users color={colors.primary} size={18} />
                  <Text style={styles.sectionTitleText}>Detalles del Partido</Text>
                </View>

                <View style={styles.row2}>
                  <View style={{ flex: 1 }}>
                    <Field label="Cupos disponibles">
                      <Stepper
                        value={parseInt(cuposTotales, 10) || 0}
                        onChange={(v) => setCuposTotales(String(v))}
                        min={2}
                        max={30}
                      />
                    </Field>
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Field label="Cuota por jugador" icon={DollarSign}>
                      <TextInput
                        style={styles.input}
                        placeholder="$5.000"
                        placeholderTextColor={colors.textMuted}
                        value={precioCuota}
                        onChangeText={(v) => setPrecioCuota(v.replace(/\D/g, ''))}
                        keyboardType="number-pad"
                      />
                    </Field>
                  </View>
                </View>

                <Field label="Nivel del encuentro">
                  <View style={styles.segmented}>
                    {NIVELES.map((n) => (
                      <Pressable
                        key={n.value}
                        onPress={() => setNivel(n.value)}
                        style={[
                          styles.segmentBtn,
                          nivel === n.value && styles.segmentBtnActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.segmentLabel,
                            nivel === n.value && styles.segmentLabelActive,
                          ]}
                        >
                          {n.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </Field>

                <Field label="Descripción">
                  <TextInput
                    style={[styles.input, styles.textarea]}
                    placeholder="Ej: Partido amistoso de fútbol 7, faltan 3 para completar."
                    placeholderTextColor={colors.textMuted}
                    value={descripcion}
                    onChangeText={setDescripcion}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                  />
                </Field>
              </View>

              {/* Card: Aprobación */}
              <View style={styles.card}>
                <View style={styles.sectionTitle}>
                  <CheckCircle2 color={colors.primary} size={18} />
                  <Text style={styles.sectionTitleText}>Aprobación de jugadores</Text>
                </View>
                <View style={styles.radioRow}>
                  <RadioOption
                    label="Inmediata"
                    selected={aprobacion === 'inmediata'}
                    onPress={() => setAprobacion('inmediata')}
                  />
                  <RadioOption
                    label="Manual"
                    selected={aprobacion === 'manual'}
                    onPress={() => setAprobacion('manual')}
                  />
                </View>
                <Text style={styles.helperText}>
                  * Con aprobación manual revisarás cada solicitud antes de confirmar.
                </Text>
              </View>

              {/* Card: Recordatorios */}
              <View style={styles.card}>
                <View style={styles.sectionTitle}>
                  <Bell color={colors.primary} size={18} />
                  <Text style={styles.sectionTitleText}>Recordatorios</Text>
                </View>
                <ToggleRow
                  label="Confirmar asistencia final post-partido"
                  value={confirmarPost}
                  onToggle={() => setConfirmarPost(!confirmarPost)}
                />
                <ToggleRow
                  label="Notificar jugadores 1h antes"
                  value={notificar1h}
                  onToggle={() => setNotificar1h(!notificar1h)}
                />
              </View>

              {/* Submit */}
              <View style={{ marginTop: 8, marginBottom: 24 }}>
                <Button
                  label={submitting ? 'Publicando…' : 'Publicar Partido'}
                  variant="primary"
                  onPress={handleSubmit}
                  loading={submitting}
                  disabled={submitting}
                />
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

// ----- Subcomponentes -----

function Field({ label, icon: Icon, children }) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        {Icon ? <Icon color={colors.textSecondary} size={13} /> : null}
        <Text style={styles.fieldLabel}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

function QuickChip({ label, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.chipLabel}>{label}</Text>
    </Pressable>
  );
}

function Stepper({ value, onChange, min = 0, max = 99 }) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  return (
    <View style={styles.stepper}>
      <Pressable onPress={dec} style={styles.stepperBtn} hitSlop={8}>
        <Text style={styles.stepperSign}>−</Text>
      </Pressable>
      <Text style={styles.stepperValue}>{value}</Text>
      <Pressable onPress={inc} style={styles.stepperBtn} hitSlop={8}>
        <Text style={styles.stepperSign}>+</Text>
      </Pressable>
    </View>
  );
}

function RadioOption({ label, selected, onPress }) {
  return (
    <Pressable onPress={onPress} style={styles.radioOption}>
      <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
        {selected ? <View style={styles.radioInner} /> : null}
      </View>
      <Text style={styles.radioLabel}>{label}</Text>
    </Pressable>
  );
}

function ToggleRow({ label, value, onToggle }) {
  return (
    <Pressable onPress={onToggle} style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.toggleTrack, value && styles.toggleTrackActive]}>
        <View style={[styles.toggleThumb, value && styles.toggleThumbActive]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoCenter: { flex: 1, alignItems: 'center' },

  tabsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  tabLabelActive: {
    color: '#0E0E0D',
  },

  comingSoon: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginTop: 8,
  },
  comingSoonTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 12,
  },
  comingSoonText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 19,
  },

  card: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginBottom: 14,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionTitleText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  field: { marginBottom: 14 },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },

  input: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    color: colors.textPrimary,
    fontSize: 14,
    justifyContent: 'center',
  },
  textarea: {
    height: 90,
    paddingTop: 12,
    paddingBottom: 12,
  },
  pickerText: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  picker: {
    marginTop: 6,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  pickerOption: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  pickerOptionActive: {
    backgroundColor: colors.primarySoft,
  },
  pickerOptionText: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  pickerOptionTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },

  gpsBox: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 12,
    marginTop: 4,
    marginBottom: 14,
  },
  gpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  gpsBtnLabel: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  gpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  gpsTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  gpsCoords: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  gpsRefresh: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },

  row2: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },

  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipLabel: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },

  segmented: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  segmentLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  segmentLabelActive: {
    color: colors.primary,
    fontWeight: '800',
  },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    height: 48,
    paddingHorizontal: 6,
  },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperSign: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 24,
  },
  stepperValue: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },

  radioRow: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 8,
  },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterActive: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  radioLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  helperText: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  toggleLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    flex: 1,
    marginRight: 12,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.border,
    padding: 3,
    justifyContent: 'center',
  },
  toggleTrackActive: {
    backgroundColor: colors.primary,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  toggleThumbActive: {
    transform: [{ translateX: 18 }],
  },
});
