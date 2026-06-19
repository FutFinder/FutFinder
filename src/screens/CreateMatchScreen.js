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
  Image,
  ActivityIndicator,
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
  Camera,
  ImageIcon,
} from 'lucide-react-native';

import Logo from '../components/Logo';
import Button from '../components/Button';
import Banner from '../components/Banner';
import { colors, radius } from '../theme/colors';
import { createMatch, getMatchById, updateMatch } from '../services/matches';
import { getChallenge, linkChallengeMatch } from '../services/clubChallenges';
import { getCurrentLocation } from '../services/location';
import { pickImage, uploadMatchCover } from '../services/storage';
import { isSupabaseConfigured } from '../services/supabase';
import { notify } from '../utils/notify';
import { REGIONES, getComunasOfRegion, matchComuna } from '../data/regiones-chile';
import LocationAutocomplete, { reverseGeocode } from '../components/LocationAutocomplete';

const REGION_DEFAULT = 'Región Metropolitana de Santiago';
const COMUNA_DEFAULT = 'Providencia';

const NIVELES = [
  { value: 'recreativo', label: 'Recreativo' },
  { value: 'intermedio', label: 'Intermedio' },
  { value: 'competitivo', label: 'Competitivo' },
];

const DURACIONES = [
  { value: 60, label: '60 min' },
  { value: 90, label: '90 min' },
  { value: 120, label: '120 min' },
];

const TRUST_MINIMOS = [
  { value: 0, label: 'Cualquiera' },
  { value: 50, label: '50+' },
  { value: 70, label: '70+' },
  { value: 85, label: '85+' },
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

export default function CreateMatchScreen({ navigation, route }) {
  // Si llega matchId, estamos editando un partido existente
  const editingId = route?.params?.matchId || null;
  const isEditing = Boolean(editingId);
  // Modo "partido de club": viene de un desafío aceptado (challengeId).
  const clubChallengeId = route?.params?.clubChallengeId || null;
  const [clubChallenge, setClubChallenge] = useState(null);
  // Tabs
  const [tab, setTab] = useState('falta_uno'); // 'falta_uno' | 'retos'

  // Cancha
  const [titulo, setTitulo] = useState('');
  const [canchaNombre, setCanchaNombre] = useState('');
  const [ubicacionText, setUbicacionText] = useState(''); // texto del buscador
  const [direccion, setDireccion] = useState(null); // dirección exacta elegida
  const [region, setRegion] = useState(REGION_DEFAULT);
  const [comuna, setComuna] = useState(COMUNA_DEFAULT);
  const [regionPickerOpen, setRegionPickerOpen] = useState(false);
  const [comunaPickerOpen, setComunaPickerOpen] = useState(false);

  // Comunas filtradas por la región actual
  const comunasOfRegion = getComunasOfRegion(region);

  // GPS
  const [coords, setCoords] = useState(null); // {latitude, longitude}
  const [gpsLoading, setGpsLoading] = useState(false); // solo para el auto-fetch inicial
  const [iAmHereLoading, setIAmHereLoading] = useState(false); // solo para el botón
  const [gpsError, setGpsError] = useState(null);

  // Fecha/hora — defaults: hoy + 2 horas
  const defaultDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const [fechaStr, setFechaStr] = useState(formatDate(defaultDate));
  const [horaStr, setHoraStr] = useState(formatTime(defaultDate));

  // Detalles
  const [cuposTotales, setCuposTotales] = useState('10');
  const [precioCuota, setPrecioCuota] = useState('5000');
  const [nivel, setNivel] = useState('intermedio');
  const [duracionMin, setDuracionMin] = useState(90); // duración en minutos
  const [minTrust, setMinTrust] = useState(0); // trust score mínimo para unirse
  const [descripcion, setDescripcion] = useState('');

  // Aprobación (placeholder, no se persiste todavía en DB)
  const [aprobacion, setAprobacion] = useState('inmediata'); // | 'manual'

  // Portada del partido (solo edición permite cambiarla porque necesita matchId)
  const [fotoUrl, setFotoUrl] = useState(null);
  const [uploadingCover, setUploadingCover] = useState(false);

  // Recordatorios (placeholder)
  const [confirmarPost, setConfirmarPost] = useState(false);
  const [notificar1h, setNotificar1h] = useState(true);

  // UI feedback
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState(null);

  // Capturar GPS al montar (no es bloqueante)
  useEffect(() => {
    if (!isEditing) fetchGPS();
  }, [isEditing]);

  // Modo club: cargar el desafío y prefijar fecha/zona acordadas.
  useEffect(() => {
    if (!clubChallengeId) return;
    (async () => {
      const { data } = await getChallenge(clubChallengeId);
      if (!data) return;
      setClubChallenge(data);
      if (data.fecha_propuesta) {
        const d = new Date(data.fecha_propuesta);
        if (!Number.isNaN(d.getTime())) {
          setFechaStr(formatDate(d));
          setHoraStr(formatTime(d));
        }
      }
      if (data.zona) {
        setCanchaNombre((prev) => prev || data.zona);
        setUbicacionText((prev) => prev || data.zona);
      }
      setTitulo((prev) => prev || 'Partido de Clubes');
      setBanner({
        type: 'info',
        title: 'Partido de Clubes',
        message: 'Completa la cancha, hora y cupos acordados. Al publicarlo aparecerá en el feed con ambos clubes.',
      });
    })();
  }, [clubChallengeId]);

  // Si estamos editando, precargar los datos del partido
  useEffect(() => {
    if (!editingId) return;
    (async () => {
      const { data, error } = await getMatchById(editingId);
      if (error || !data) return;
      setTitulo(data.titulo || '');
      setCanchaNombre(data.cancha_nombre || '');
      if (data.direccion) {
        setDireccion(data.direccion);
        setUbicacionText(data.direccion);
      }
      if (data.region) setRegion(data.region);
      if (data.comuna) setComuna(data.comuna);
      if (data.latitud != null && data.longitud != null) {
        setCoords({ latitude: data.latitud, longitude: data.longitud });
      }
      if (data.hora) {
        const d = new Date(data.hora);
        setFechaStr(formatDate(d));
        setHoraStr(formatTime(d));
      }
      if (data.cupos_totales != null) setCuposTotales(String(data.cupos_totales));
      if (data.precio_cuota != null) setPrecioCuota(String(data.precio_cuota));
      if (data.nivel) setNivel(data.nivel);
      if (data.duracion_min != null) setDuracionMin(data.duracion_min);
      if (data.aprobacion) setAprobacion(data.aprobacion);
      if (data.min_trust_score != null) setMinTrust(data.min_trust_score);
      if (data.descripcion) setDescripcion(data.descripcion);
      if (data.foto_url) setFotoUrl(data.foto_url);
    })();
  }, [editingId]);

  const handlePickCover = async () => {
    if (uploadingCover) return;
    if (!editingId) {
      setBanner({
        type: 'info',
        title: 'Crea el partido primero',
        message: 'La portada se puede subir después de publicar el partido (entras a "Editar partido").',
      });
      return;
    }
    const { ok, asset, reason } = await pickImage({ aspect: [16, 9], quality: 0.7 });
    if (!ok) {
      if (reason && reason !== 'Cancelado') {
        setBanner({ type: 'error', title: 'No pude abrir tus fotos', message: reason });
      }
      return;
    }
    setUploadingCover(true);
    const { url, error } = await uploadMatchCover(editingId, asset);
    setUploadingCover(false);
    if (error) {
      setBanner({ type: 'error', title: 'No pude subir la portada', message: error.message || '' });
      return;
    }
    setFotoUrl(url);
    setBanner({ type: 'success', title: 'Portada actualizada', message: '' });
    setTimeout(() => setBanner(null), 2500);
  };

  // Al elegir un lugar del buscador: captura coords, dirección y autocompleta región/comuna.
  // Si la opción elegida es una cancha del directorio de FutFinder, también
  // autocompleta el "Nombre de la cancha".
  const handlePickLocation = ({
    lat,
    lng,
    address,
    comunaRaw,
    regionRaw,
    canchaName,
  }) => {
    if (lat != null && lng != null) {
      setCoords({ latitude: lat, longitude: lng });
    }
    setDireccion(address || null);
    setGpsError(null);

    const match = matchComuna(comunaRaw) || matchComuna(regionRaw);
    if (match) {
      setRegion(match.region);
      setComuna(match.comuna);
    }

    // Cancha del directorio FutFinder → autollena el nombre si está vacío
    if (canchaName && !canchaNombre.trim()) {
      setCanchaNombre(canchaName);
    }
  };

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

  // "Estoy en la cancha" → captura GPS y autocompleta ubicación, dirección,
  // región y comuna usando geocoding inverso.
  // Usa iAmHereLoading (no gpsLoading) para no quedar disabled durante el auto-fetch inicial.
  const handleIAmHere = async () => {
    setIAmHereLoading(true);
    setGpsError(null);
    try {
      const r = await getCurrentLocation();
      if (!r?.ok) {
        setGpsError(r?.reason || 'No pude leer tu ubicación');
        return;
      }
      setCoords({ latitude: r.latitude, longitude: r.longitude });

      const rev = await reverseGeocode({ lat: r.latitude, lng: r.longitude });
      if (rev?.address) {
        setDireccion(rev.address);
        setUbicacionText(rev.address);
      }
      const m = matchComuna(rev?.comunaRaw) || matchComuna(rev?.regionRaw);
      if (m) {
        setRegion(m.region);
        setComuna(m.comuna);
      }
    } finally {
      setIAmHereLoading(false);
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
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dtDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    if (dtDay < startToday) return 'La fecha ya pasó. Elige hoy o un día futuro.';
    if (dt.getTime() <= now.getTime()) return 'La hora ya pasó. Elige una hora futura.';
    const cupos = parseInt(cuposTotales, 10);
    if (Number.isNaN(cupos) || cupos < 1 || cupos > 30) return 'Los cupos disponibles deben estar entre 1 y 30';
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
    const payload = {
      titulo: titulo.trim(),
      region,
      comuna,
      cancha_nombre: canchaNombre.trim(),
      direccion: direccion || null,
      latitud: coords.latitude,
      longitud: coords.longitude,
      hora: dt.toISOString(),
      cupos_totales: parseInt(cuposTotales, 10),
      precio_cuota: parseInt(precioCuota, 10),
      nivel,
      duracion_min: duracionMin,
      aprobacion,
      min_trust_score: minTrust,
      descripcion: descripcion.trim() || null,
    };
    // Modo club: asignar ambos clubes (retador = local) y el desafío origen.
    if (clubChallenge) {
      payload.club_local_id = clubChallenge.club_retador_id;
      payload.club_visitante_id = clubChallenge.club_retado_id;
      payload.challenge_id = clubChallenge.id;
    }
    const result = isEditing
      ? await updateMatch(editingId, payload)
      : await createMatch(payload);
    setSubmitting(false);

    if (result.error) {
      console.error('[FutFinder] save match error:', result.error);
      showError(
        isEditing ? 'No pudimos guardar los cambios' : 'No pudimos publicar el partido',
        result.error.message || 'Intenta de nuevo'
      );
      return;
    }

    // Modo club: vincular el desafío con el partido recién creado.
    if (clubChallenge && !isEditing && result.data?.id) {
      await linkChallengeMatch(clubChallenge.id, result.data.id);
    }

    const okTitle = isEditing ? '¡Partido actualizado!' : '¡Partido publicado!';
    const okMsg = isEditing
      ? 'Los cambios ya están visibles para los inscritos.'
      : clubChallenge
        ? 'El Partido de Clubes ya aparece en el feed para ambos equipos.'
        : 'Aparecerá en el feed de partidos cercanos.';
    setBanner({ type: 'success', title: okTitle, message: okMsg });
    notify(okTitle, okMsg);

    // Volver al feed Home tras un breve delay para que se vea el banner
    setTimeout(() => {
      navigation.navigate('Main', { screen: 'HomeTab' });
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
              {/* Card: Portada del partido (solo en modo edición) */}
              {isEditing && (
                <View style={styles.card}>
                  <View style={styles.sectionTitle}>
                    <ImageIcon color={colors.primary} size={18} />
                    <Text style={styles.sectionTitleText}>Portada del partido</Text>
                  </View>
                  <Pressable
                    onPress={handlePickCover}
                    disabled={uploadingCover}
                    style={({ pressed }) => [
                      styles.coverBox,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    {fotoUrl ? (
                      <Image source={{ uri: fotoUrl }} style={styles.coverImage} />
                    ) : (
                      <View style={styles.coverPlaceholder}>
                        <Camera color={colors.primary} size={26} />
                        <Text style={styles.coverPlaceholderText}>
                          Toca para subir una foto
                        </Text>
                      </View>
                    )}
                    <View style={styles.coverEditBtn}>
                      {uploadingCover ? (
                        <ActivityIndicator color="#0E0E0D" size="small" />
                      ) : (
                        <Camera color="#0E0E0D" size={14} strokeWidth={2.2} />
                      )}
                    </View>
                  </Pressable>
                  <Text style={styles.coverHint}>
                    Visible para los inscritos y en el chat del partido.
                  </Text>
                </View>
              )}

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

                <Field label="Ubicación de la cancha">
                  <LocationAutocomplete
                    value={ubicacionText}
                    onChangeText={(t) => {
                      setUbicacionText(t);
                      // Si limpias el campo, volvemos al estado inicial para que
                      // reaparezca el link "Estoy en la cancha".
                      if (!t || !t.trim()) {
                        setDireccion(null);
                      }
                    }}
                    onSelect={handlePickLocation}
                    placeholder="Busca por dirección o sector (ej. Av. Las Condes 12000)"
                    proximity={coords ? { lat: coords.latitude, lng: coords.longitude } : null}
                  />
                  {direccion ? (
                    <Text style={styles.locationHint}>📍 {direccion}</Text>
                  ) : (
                    <View style={styles.locationHintRow}>
                      <Text style={styles.locationHint}>
                        Escribe la dirección o el sector cercano.
                      </Text>
                      <Pressable
                        onPress={handleIAmHere}
                        disabled={iAmHereLoading}
                        hitSlop={6}
                      >
                        <Text style={styles.locationLink}>
                          {iAmHereLoading ? '📍 Capturando…' : '📍 Estoy en la cancha'}
                        </Text>
                      </Pressable>
                    </View>
                  )}
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
                        min={1}
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

                <Field label="Duración del partido" icon={Clock}>
                  <View style={styles.segmented}>
                    {DURACIONES.map((d) => (
                      <Pressable
                        key={d.value}
                        onPress={() => setDuracionMin(d.value)}
                        style={[
                          styles.segmentBtn,
                          duracionMin === d.value && styles.segmentBtnActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.segmentLabel,
                            duracionMin === d.value && styles.segmentLabelActive,
                          ]}
                        >
                          {d.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </Field>

                <Field label="Trust Score mínimo para unirse">
                  <View style={styles.segmented}>
                    {TRUST_MINIMOS.map((t) => (
                      <Pressable
                        key={t.value}
                        onPress={() => setMinTrust(t.value)}
                        style={[
                          styles.segmentBtn,
                          minTrust === t.value && styles.segmentBtnActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.segmentLabel,
                            minTrust === t.value && styles.segmentLabelActive,
                          ]}
                        >
                          {t.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.helperText}>
                    * Los jugadores con Trust Score menor no podrán reservar cupo.
                  </Text>
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
                  label={
                    submitting
                      ? (isEditing ? 'Guardando…' : 'Publicando…')
                      : (isEditing ? 'Guardar cambios' : 'Publicar Partido')
                  }
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

  coverBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.background,
    overflow: 'hidden',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverImage: { width: '100%', height: '100%' },
  coverPlaceholder: { alignItems: 'center', gap: 6 },
  coverPlaceholderText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  coverEditBtn: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverHint: {
    marginTop: 8,
    color: colors.textMuted,
    fontSize: 11,
  },
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
  locationHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 6,
    lineHeight: 15,
  },
  locationHintRow: {
    marginTop: 6,
    gap: 6,
  },
  locationLink: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
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
