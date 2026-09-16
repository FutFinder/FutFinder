import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Clock, MapPin, Wallet, ArrowRight } from 'lucide-react-native';

import {
  reservas as C,
  reservasRadius as R,
  reservasSizes as S,
  reservasFonts as F,
} from '../theme/colors';
import Banner from '../components/Banner';
import { Card, Button, IconButton } from '../components/reservas/ui';
import { FieldLabel, TextField } from '../components/reservas/recintoUi';
import LocationAutocomplete from '../components/LocationAutocomplete';
import { supabase } from '../services/supabase';
import { getMatchById, getClubMatchLocation } from '../services/matches';
import { nuevoClientToken } from '../services/clubProposals';
import { getCambioPendiente, proponerCambioPartido } from '../services/clubMatchChanges';
import { accionesDeCambio, construirCampos, filasDeComparacion } from '../utils/cambioPartido';
import {
  UBICACION_VACIA,
  seleccionarLugar,
  escribirDireccion,
  ubicacionFijada,
} from '../utils/ubicacionPropuesta';

/**
 * Pedir un cambio de un partido de clubes ya publicado.
 *
 * params: { matchId, challengeId }
 *
 * PIDE, NO APLICA. Al enviar no cambia nada del partido: queda una solicitud
 * esperando a que un administrador del club contrario la acepte. Toda la
 * pantalla está escrita alrededor de esa idea —cada campo muestra el valor
 * VIGENTE al lado del que se propone, y el resumen final vuelve a mostrar el
 * «actual → propuesto» antes de enviar—, porque el error caro acá sería creer
 * que el partido ya se movió y avisarle a la gente.
 *
 * SÓLO VIAJA LO QUE CAMBIA. Los campos nacen con el valor actual: lo que no
 * se toque no viaja, y `construirCampos()` es quien lo decide. Mandar el
 * formulario entero convertiría cada solicitud en «cambiar la hora de 17:00 a
 * 17:00», y el club contrario tendría que adivinar qué se le pide.
 *
 * LA PANTALLA NO AUTORIZA NADA. Qué se puede hacer sale de `accionesDeCambio`,
 * que es puro y está probado, pero quien decide es `proponer_cambio_partido`
 * con el reloj y las membresías de PostgreSQL. Si el servidor dice que no, se
 * muestra su mensaje tal cual: nunca se traduce un rechazo a una pantalla en
 * blanco.
 */
function dosDigitos(n) {
  return String(n).padStart(2, '0');
}

function formatDate(d) {
  return `${dosDigitos(d.getDate())}/${dosDigitos(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatTime(d) {
  return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;
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

/** Un número de PostgREST puede llegar como texto; comparar texto con número siempre difiere. */
function aNumero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function ClubMatchChangeScreen({ navigation, route }) {
  const { matchId, challengeId = null } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [partido, setPartido] = useState(null);
  const [exacta, setExacta] = useState(null);
  const [pendiente, setPendiente] = useState(null);
  const [userId, setUserId] = useState(null);
  const [clubesAdmin, setClubesAdmin] = useState([]);
  const [clubesTodos, setClubesTodos] = useState([]);
  const [banner, setBanner] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const [fechaStr, setFechaStr] = useState('');
  const [horaStr, setHoraStr] = useState('');
  const [cuotaStr, setCuotaStr] = useState('');
  const [canchaNombre, setCanchaNombre] = useState('');
  const [ubicacion, setUbicacion] = useState(UBICACION_VACIA);
  const [tocoCancha, setTocoCancha] = useState(false);

  // El token se genera UNA vez por pantalla y se conserva entre reintentos: si
  // se regenerara en cada toque, un reintento tras un timeout de red abriría
  // una segunda solicitud en vez de recuperar la primera.
  const tokenRef = useRef(nuevoClientToken());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cargar = useCallback(async () => {
    if (!matchId) {
      setLoading(false);
      setBanner({ type: 'error', title: 'Falta el partido', message: 'No se indicó cuál.' });
      return;
    }
    setLoading(true);

    const [{ data: m, error: eM }, { data: loc }, { data: pend, error: ePend }, { data: auth }] =
      await Promise.all([
        getMatchById(matchId),
        getClubMatchLocation(matchId),
        getCambioPendiente(matchId),
        supabase.auth.getUser(),
      ]);

    if (!mountedRef.current) return;

    if (eM || !m) {
      setLoading(false);
      setBanner({
        type: 'error',
        title: 'No se pudo cargar el partido',
        message: eM?.message || 'Vuelve a intentarlo en un momento.',
      });
      return;
    }

    // Un fallo al leer la solicitud pendiente NO se disfraza de «no hay
    // ninguna»: si se ocultara, la pantalla ofrecería pedir un cambio que el
    // servidor va a rechazar por duplicado, y el mensaje llegaría al final.
    if (ePend) {
      setBanner({
        type: 'error',
        title: 'No se pudo revisar si ya hay una solicitud',
        message: ePend.message,
      });
    }

    setPartido(m);
    setExacta(loc || null);
    setPendiente(pend || null);

    const uid = auth?.user?.id || null;
    setUserId(uid);

    if (uid && (m.club_local_id || m.club_visitante_id)) {
      const { data: membresias } = await supabase
        .from('club_members')
        .select('club_id, rol')
        .eq('user_id', uid)
        .in('club_id', [m.club_local_id, m.club_visitante_id].filter(Boolean));
      if (mountedRef.current) {
        const filas = membresias || [];
        setClubesAdmin(filas.filter((f) => f.rol === 'admin').map((f) => f.club_id));
        setClubesTodos(filas.map((f) => f.club_id));
      }
    }

    // Los campos nacen con el valor vigente: lo que no se toque no viaja.
    const d = m.hora ? new Date(m.hora) : null;
    if (d && !Number.isNaN(d.getTime())) {
      setFechaStr(formatDate(d));
      setHoraStr(formatTime(d));
    }
    setCuotaStr(String(m.precio_cuota ?? 0));
    setCanchaNombre(m.cancha_nombre || '');
    if (loc?.direccion) {
      setUbicacion({
        direccion: loc.direccion,
        canchaNombre: m.cancha_nombre || '',
        comuna: m.comuna || '',
        region: m.region || '',
        coords: { lat: aNumero(loc.latitud), lng: aNumero(loc.longitud) },
      });
    }

    setLoading(false);
  }, [matchId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /** El partido vigente, en la forma que espera `construirCampos`. */
  const vigente = useMemo(() => {
    if (!partido) return null;
    return {
      hora: partido.hora,
      precio_cuota: partido.precio_cuota,
      cancha: {
        cancha_nombre: partido.cancha_nombre || '',
        direccion: exacta?.direccion || '',
        comuna: partido.comuna || '',
        region: partido.region || '',
        latitud: aNumero(exacta?.latitud),
        longitud: aNumero(exacta?.longitud),
      },
    };
  }, [partido, exacta]);

  const acciones = useMemo(
    () =>
      accionesDeCambio({
        partido,
        cambio: pendiente,
        userId,
        clubesAdmin,
        clubesTodos,
      }),
    [partido, pendiente, userId, clubesAdmin, clubesTodos]
  );

  /**
   * Lo que se va a enviar, recalculado en cada tecla.
   *
   * Sirve para dos cosas a la vez: pintar el resumen «actual → propuesto» y
   * saber si el botón tiene algo que mandar. Que sea la MISMA función que
   * arma el payload es lo que evita que el resumen diga una cosa y viaje otra.
   */
  const propuesta = useMemo(() => {
    if (!vigente) return { campos: null, error: null };

    const cancha = tocoCancha
      ? {
          cancha_nombre: canchaNombre,
          direccion: ubicacion.direccion,
          comuna: ubicacion.comuna,
          region: ubicacion.region,
          latitud: ubicacion.coords?.lat ?? null,
          longitud: ubicacion.coords?.lng ?? null,
        }
      : null;

    const cuotaLimpia = cuotaStr.trim();
    const cuota = cuotaLimpia === '' ? null : Number(cuotaLimpia);

    return construirCampos({
      partido: vigente,
      hora: parseDateTime(fechaStr, horaStr),
      cancha,
      cuota,
    });
  }, [vigente, fechaStr, horaStr, cuotaStr, canchaNombre, ubicacion, tocoCancha]);

  const filas = useMemo(
    () =>
      propuesta.campos
        ? filasDeComparacion({
            campos: propuesta.campos,
            valores_anteriores: {
              hora: vigente?.hora,
              cuota: vigente?.precio_cuota,
              cancha: vigente?.cancha,
            },
          })
        : [],
    [propuesta.campos, vigente]
  );

  const enviar = useCallback(async () => {
    if (enviando) return;
    if (!propuesta.campos) {
      setBanner({
        type: 'error',
        title: 'Revisa lo que quieres cambiar',
        message: propuesta.error || 'Elige al menos un dato que quieras cambiar.',
      });
      return;
    }

    setEnviando(true);
    setBanner(null);
    const { data, error } = await proponerCambioPartido(
      matchId,
      propuesta.campos,
      tokenRef.current
    );
    if (!mountedRef.current) return;
    setEnviando(false);

    if (error) {
      // El mensaje del servidor se muestra tal cual: es el que explica el
      // plazo, el permiso o la solicitud duplicada.
      setBanner({ type: 'error', title: 'No se pudo pedir el cambio', message: error.message });
      return;
    }

    // Se vuelve al hilo con la marca de que hay algo nuevo, para que la
    // solicitud aparezca sin tener que reabrir la conversación. Sin desafío
    // conocido no se inventa una clave de hilo: se vuelve y ya.
    const idDesafio = challengeId || partido?.challenge_id;
    if (!idDesafio) {
      navigation.goBack();
      return;
    }
    navigation.navigate({
      name: 'ChatThread',
      params: {
        threadKey: `challenge:${idDesafio}`,
        cambioPedido: data?.changeId || Date.now(),
      },
      merge: true,
    });
  }, [enviando, propuesta, matchId, navigation, challengeId, partido?.challenge_id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={C.green} />
        </View>
      </SafeAreaView>
    );
  }

  const hayUbicacion = ubicacionFijada(ubicacion);
  const bloqueado = acciones.bloqueoPedir;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Pedir un cambio</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {partido?.titulo || 'Partido de clubes'}
          </Text>
        </View>
        <IconButton icon={X} onPress={() => navigation.goBack()} accessibilityLabel="Cerrar" />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!!banner && (
            <Banner
              type={banner.type}
              title={banner.title}
              message={banner.message}
              onClose={() => setBanner(null)}
            />
          )}

          {bloqueado ? (
            <View style={styles.bloqueo}>
              <Text style={styles.bloqueoTxt}>{bloqueado}</Text>
              <Button label="Volver" variant="secondary" onPress={() => navigation.goBack()} />
            </View>
          ) : (
            <>
              <Text style={styles.intro}>
                El partido NO cambia al enviar esto. Queda una solicitud, y un administrador del
                club contrario la acepta o la rechaza. Lo que no toques, no viaja.
              </Text>

              {/* ── Fecha y hora ─────────────────────────────── */}
              <Card style={styles.bloque}>
                <View style={styles.bloqueHead}>
                  <Clock color={C.green} size={16} strokeWidth={2.2} />
                  <Text style={styles.bloqueTitulo}>Fecha y hora</Text>
                </View>
                <Text style={styles.actual}>
                  Actual: {fechaVigente(partido?.hora)}
                </Text>
                <View style={styles.row2}>
                  <View style={{ flex: 1 }}>
                    <FieldLabel>Fecha</FieldLabel>
                    <TextField
                      placeholder="DD/MM/AAAA"
                      value={fechaStr}
                      onChangeText={setFechaStr}
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                  <View style={{ width: 110 }}>
                    <FieldLabel>Hora</FieldLabel>
                    <TextField
                      placeholder="HH:MM"
                      value={horaStr}
                      onChangeText={setHoraStr}
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                </View>
              </Card>

              {/* ── Cancha ───────────────────────────────────── */}
              <Card style={styles.bloque}>
                <View style={styles.bloqueHead}>
                  <MapPin color={C.green} size={16} strokeWidth={2.2} />
                  <Text style={styles.bloqueTitulo}>Cancha</Text>
                </View>
                <Text style={styles.actual}>
                  Actual: {partido?.cancha_nombre || 'sin registro'}
                  {partido?.comuna ? ` · ${partido.comuna}` : ''}
                </Text>

                {tocoCancha ? (
                  <>
                    <FieldLabel>Cancha o recinto</FieldLabel>
                    <TextField
                      placeholder="Ej: Complejo Municipal"
                      value={canchaNombre}
                      onChangeText={setCanchaNombre}
                      maxLength={120}
                    />

                    <FieldLabel>Dirección exacta</FieldLabel>
                    <LocationAutocomplete
                      value={ubicacion.direccion}
                      placeholder="Busca la cancha por nombre o dirección"
                      proximity={
                        hayUbicacion
                          ? { lat: ubicacion.coords.lat, lng: ubicacion.coords.lng }
                          : null
                      }
                      // Los dos con la forma funcional: `LocationAutocomplete`
                      // dispara `onSelect` y a continuación `onChangeText`, y
                      // leyendo el estado por closure el segundo borraría las
                      // coordenadas que acaba de poner el primero.
                      onChangeText={(v) => setUbicacion((prev) => escribirDireccion(prev, v))}
                      onSelect={(lugar) => setUbicacion((prev) => seleccionarLugar(prev, lugar))}
                      inputRowStyle={styles.autoRow}
                      inputStyle={styles.autoInput}
                      placeholderColor={C.textSecondary}
                      accentColor={C.green}
                      spinnerColor={C.green}
                    />
                    <Text style={styles.hint}>
                      {hayUbicacion
                        ? 'Ubicación fijada en el mapa. Sólo la ven los integrantes de los dos clubes.'
                        : 'Elige una sugerencia del buscador: sin el punto en el mapa la cancha no se puede proponer.'}
                    </Text>
                    <Pressable
                      onPress={() => {
                        setTocoCancha(false);
                        setCanchaNombre(partido?.cancha_nombre || '');
                        setUbicacion(
                          exacta?.direccion
                            ? {
                                direccion: exacta.direccion,
                                canchaNombre: partido?.cancha_nombre || '',
                                comuna: partido?.comuna || '',
                                region: partido?.region || '',
                                coords: {
                                  lat: aNumero(exacta.latitud),
                                  lng: aNumero(exacta.longitud),
                                },
                              }
                            : UBICACION_VACIA
                        );
                      }}
                      accessibilityRole="button"
                      style={styles.linkBtn}
                    >
                      <Text style={styles.link}>Dejar la cancha como está</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    onPress={() => setTocoCancha(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Proponer otra cancha"
                    style={styles.linkBtn}
                  >
                    <Text style={styles.link}>Proponer otra cancha</Text>
                  </Pressable>
                )}
              </Card>

              {/* ── Cuota ────────────────────────────────────── */}
              <Card style={styles.bloque}>
                <View style={styles.bloqueHead}>
                  <Wallet color={C.green} size={16} strokeWidth={2.2} />
                  <Text style={styles.bloqueTitulo}>Cuota por persona</Text>
                </View>
                <Text style={styles.actual}>
                  Actual: {partido?.precio_cuota ? `$${partido.precio_cuota}` : 'gratis'}
                </Text>
                <TextField
                  placeholder="0"
                  value={cuotaStr}
                  onChangeText={(v) => setCuotaStr(v.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                />
              </Card>

              {/* ── Resumen ──────────────────────────────────── */}
              <View style={styles.resumen}>
                <Text style={styles.resumenTitulo}>Lo que se le pedirá al club contrario</Text>
                {filas.length === 0 ? (
                  <Text style={styles.hint}>
                    {propuesta.error || 'Todavía no cambiaste nada.'}
                  </Text>
                ) : (
                  filas.map((f) => (
                    <View key={f.campo} style={styles.filaResumen}>
                      <Text style={styles.filaEtiqueta}>{f.etiqueta}</Text>
                      <View style={styles.filaValores}>
                        <Text style={styles.filaAntes}>{f.antes}</Text>
                        <ArrowRight color={C.textMuted} size={13} strokeWidth={2.4} />
                        <Text style={styles.filaDespues}>{f.despues}</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>

              <Button
                label="Enviar solicitud"
                onPress={enviar}
                loading={enviando}
                disabled={enviando || filas.length === 0}
                style={styles.submit}
              />
              <Text style={styles.hint}>
                Se avisa a los administradores del club contrario. Hasta que respondan, el partido
                se juega con los datos actuales.
              </Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** «sáb 15 ago · 17:00», o un texto honesto si la fecha no se pudo leer. */
function fechaVigente(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return 'sin registro';
  return `${formatDate(d)} · ${formatTime(d)}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: S.screenPadding,
    paddingTop: 6,
    paddingBottom: 12,
    width: '100%',
    maxWidth: 932,
    alignSelf: 'center',
  },
  headerCenter: { flex: 1 },
  headerTitle: { fontFamily: F.extraBold, fontSize: 20, color: C.textPrimary, letterSpacing: -0.3 },
  headerSubtitle: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 2 },

  content: {
    paddingHorizontal: S.screenPadding,
    paddingBottom: 48,
    gap: S.cardGap,
    width: '100%',
    // El tope es lo que evita que en un monitor ancho el «actual → propuesto»
    // quede separado por medio metro de vacío.
    maxWidth: 640,
    alignSelf: 'center',
  },
  intro: { fontFamily: F.medium, fontSize: 13, color: C.textSecondary, lineHeight: 19 },

  bloqueo: { gap: 12, paddingVertical: 8 },
  bloqueoTxt: { fontFamily: F.medium, fontSize: 14, color: C.textSecondary, lineHeight: 20 },

  bloque: { gap: 9 },
  bloqueHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bloqueTitulo: { fontFamily: F.extraBold, fontSize: 15, color: C.textPrimary },
  actual: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, lineHeight: 17 },

  row2: { flexDirection: 'row', gap: 10 },
  hint: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16.5 },
  linkBtn: { minHeight: 44, justifyContent: 'center' },
  link: { fontFamily: F.bold, fontSize: 13, color: C.green },

  autoRow: {
    minHeight: 48,
    borderRadius: R.row,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
  },
  autoInput: { fontFamily: F.medium, fontSize: 14.5, color: C.textPrimary, paddingVertical: 12 },

  // Borde verde: es el bloque que dice qué se va a mandar de verdad, y tiene
  // que distinguirse de los campos que lo alimentan.
  resumen: {
    backgroundColor: C.selectedBg,
    borderRadius: R.cardSm,
    borderWidth: 1,
    borderColor: C.green,
    padding: 14,
    gap: 9,
  },
  resumenTitulo: { fontFamily: F.extraBold, fontSize: 14.5, color: C.textPrimary },
  filaResumen: { gap: 3 },
  filaEtiqueta: {
    fontFamily: F.bold,
    fontSize: 10.5,
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  filaValores: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  filaAntes: {
    fontFamily: F.semiBold,
    fontSize: 13,
    color: C.textSecondary,
    textDecorationLine: 'line-through',
    flexShrink: 1,
  },
  filaDespues: { fontFamily: F.extraBold, fontSize: 14, color: C.textPrimary, flexShrink: 1 },

  submit: { marginTop: 4 },
});
