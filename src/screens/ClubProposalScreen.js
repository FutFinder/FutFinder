import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, FileText, MapPin, Users, Wallet, Clock } from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  medidas as S,
  fuentes as F,
} from '../theme/colors';
import Banner from '../components/Banner';
import { Card, Button, IconButton, Chip } from '../components/reservas/ui';
import { FieldLabel, TextField, ChoiceCard } from '../components/reservas/recintoUi';
import LocationAutocomplete from '../components/LocationAutocomplete';
import {
  UBICACION_VACIA,
  seleccionarLugar,
  escribirDireccion,
  ubicacionFijada,
  ubicacionDraft,
} from '../utils/ubicacionPropuesta';
import { supabase } from '../services/supabase';
import { getChallenge } from '../services/clubChallenges';
import {
  crearPropuestaOficial,
  aprobarPropuesta,
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
 * Aprobar publica el partido: antes del RPC hay un resumen final y la pregunta
 * voluntaria de si quien aprueba quiere reservar un cupo de su propio club.
 *
 * Usa los tokens de `reservas` y los componentes de `components/reservas`,
 * igual que sus pantallas hermanas `ClubChallengeScreen` y
 * `ClubChallengesScreen`: son pasos del mismo flujo y mezclar dos familias de
 * paleta en la misma secuencia se ve como dos verdes distintos.
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

  /**
   * Vuelve al hilo AVISANDO de que la propuesta cambió.
   *
   * Un `goBack()` pelado no basta: el hilo ya está montado, su efecto de carga
   * sólo corre al montar y el sondeo de respaldo no relee la propuesta. Sin
   * este aviso, quien acababa de mandar la propuesta oficial volvía y seguía
   * viendo el botón «Crear propuesta oficial», como si no hubiera pasado nada.
   * Es el mismo mecanismo que ya usaban «Pedir un cambio» y el resultado.
   */
  const volverAlHilo = useCallback(() => {
    if (!challengeId) {
      if (navigation.canGoBack()) navigation.goBack();
      return;
    }
    navigation.navigate({
      name: 'ChatThread',
      params: { threadKey: `challenge:${challengeId}`, propuestaCambiada: Date.now() },
      merge: true,
    });
  }, [challengeId, navigation]);

  const [loading, setLoading] = useState(true);
  const [challenge, setChallenge] = useState(null);
  const [propuesta, setPropuesta] = useState(null);
  const [misClubIds, setMisClubIds] = useState([]);
  const [misClubIdsTodos, setMisClubIdsTodos] = useState([]);
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
  // Dirección, cancha, comuna, región y el punto en el mapa van juntos en un
  // solo estado, y las dos transiciones viven en `utils/ubicacionPropuesta`.
  // No es preferencia de estilo: `LocationAutocomplete` dispara `onSelect` y
  // acto seguido `onChangeText` con la dirección elegida, así que con estados
  // sueltos y manejadores en línea el segundo callback borraba las
  // coordenadas que acababa de poner el primero. Con la forma funcional de
  // `setUbicacion` el resultado ya no depende del orden.
  const [ubicacion, setUbicacion] = useState(UBICACION_VACIA);
  const { direccion, canchaNombre, comuna, region } = ubicacion;
  const hayUbicacion = ubicacionFijada(ubicacion);
  const [modalidad, setModalidad] = useState('futbol7');
  const [cuposPorClub, setCuposPorClub] = useState(String(CUPOS_POR_CLUB.min + 3));
  const [metodoInscripcion, setMetodoInscripcion] = useState('orden_llegada');
  const [cuotaPorPersona, setCuotaPorPersona] = useState('0');
  const [instrucciones, setInstrucciones] = useState('');
  const [motivo, setMotivo] = useState('');

  // LAS DOS RESERVAS VOLUNTARIAS, con «No» por defecto en las dos.
  // `proponenteJuega` viaja en la propuesta y NO gasta cupo mientras esté
  // pendiente: se materializa al publicarse el partido. `meInscribo` es la de
  // quien aprueba, y se decide en el momento de aprobar. Cada una gasta un
  // cupo de SU club.
  const [proponenteJuega, setProponenteJuega] = useState(false);
  const [meInscribo, setMeInscribo] = useState(false);
  // El resumen final es un paso a propósito: aprobar publica el partido y no
  // se puede deshacer.
  const [confirmando, setConfirmando] = useState(false);

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
          const filas = membresias || [];
          setMisClubIds(filas.filter((m) => m.rol === 'admin').map((m) => m.club_id));
          // Se guardan TODAS las membresías, no solo las de administrador:
          // aprobar y rechazar exigen no pertenecer al club proponente ni
          // siquiera como jugador. Con la lista filtrada por rol, quien
          // administra el club rival y juega en el proponente vería el botón
          // y se estrellaría contra el error del servidor.
          setMisClubIdsTodos(filas.map((m) => m.club_id));
        }
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [challengeId, proposalId]);

  // Espejo exacto de la autorización de `aprobar_propuesta` y
  // `rechazar_propuesta`. La protección real es la del servidor; esto solo
  // evita ofrecer un botón que va a fallar.
  //
  //   A) soy administrador de un club del desafío distinto al proponente, y
  //   B) NO pertenezco al club proponente en ningún rol.
  //
  // `soyProponente` mira TODAS mis membresías, no solo las de administrador:
  // si juego en el club que propuso, ese club es mío aunque no lo administre.
  const soyProponente =
    !!propuesta && misClubIdsTodos.includes(propuesta.club_proponente_id);
  const soyAdminDelRival =
    !!propuesta && misClubIds.some((id) => id !== propuesta.club_proponente_id);
  const puedoResponder =
    !!propuesta && propuesta.estado === 'pendiente' && soyAdminDelRival && !soyProponente;

  // Caso raro pero real: administro el club rival y además pertenezco al que
  // propuso. No puedo responder, y hay que decir por qué en vez de dejar la
  // pantalla muda.
  const conflictoDePertenencia =
    !!propuesta && propuesta.estado === 'pendiente' && soyAdminDelRival && soyProponente;

  const revisando = modo === 'revisar' || (!!propuesta && propuesta.estado === 'pendiente');

  const handleCrear = useCallback(async () => {
    const fecha = parseDateTime(fechaStr, horaStr);
    const draft = {
      fecha,
      duracionMin,
      ...ubicacionDraft(ubicacion),
      modalidad,
      cuposPorClub: parseInt(cuposPorClub, 10),
      metodoInscripcion,
      cuotaPorPersona: parseInt(cuotaPorPersona, 10),
      instrucciones,
      proponenteJuega,
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
    setTimeout(volverAlHilo, 1400);
  }, [
    fechaStr,
    horaStr,
    duracionMin,
    ubicacion,
    modalidad,
    cuposPorClub,
    metodoInscripcion,
    cuotaPorPersona,
    instrucciones,
    proponenteJuega,
    challengeId,
    volverAlHilo,
  ]);

  /**
   * Aprobar publica el partido. Una sola llamada, y la base garantiza que no
   * haya dos partidos aunque se pulse dos veces: `challenge_proposal_id` es
   * único y la RPC devuelve el partido que ya existe. Por eso el botón se
   * bloquea con `enviando` por comodidad, no por seguridad.
   */
  const handleAprobar = useCallback(async () => {
    if (!propuesta?.id) return;
    setEnviando(true);
    const { data, error } = await aprobarPropuesta(propuesta.id, meInscribo);
    setEnviando(false);

    if (error) {
      setBanner({ type: 'error', title: 'No se pudo aprobar', message: error.message });
      return;
    }

    setConfirmando(false);
    setPropuesta((p) => (p ? { ...p, estado: 'aprobada' } : p));
    setBanner({
      type: 'success',
      title: '¡Partido publicado!',
      message: `Ya pueden inscribirse: ${cuposLabel(propuesta.cupos_por_club)}.`,
    });

    // Al partido recién creado, no de vuelta al formulario.
    setTimeout(() => {
      if (data?.id) navigation.replace('MatchDetail', { matchId: data.id });
      else volverAlHilo();
    }, 1200);
  }, [propuesta?.id, propuesta?.cupos_por_club, meInscribo, navigation, volverAlHilo]);

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
    setTimeout(volverAlHilo, 1400);
  }, [propuesta?.id, motivo, volverAlHilo]);

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
        <IconButton icon={X} onPress={() => navigation.goBack()} accessibilityLabel="Cerrar" />
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.green} />
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
                <Card style={styles.resumen}>
                  <Row icon={<Clock color={C.green} size={16} strokeWidth={2} />} label="Cuándo">
                    {`${fechaLarga(propuesta.fecha)} · ${propuesta.duracion_min} min`}
                  </Row>
                  <Row icon={<MapPin color={C.green} size={16} strokeWidth={2} />} label="Dónde">
                    {`${propuesta.cancha_nombre}\n${propuesta.direccion}\n${propuesta.comuna}, ${propuesta.region}`}
                  </Row>
                  <Row icon={<Users color={C.green} size={16} strokeWidth={2} />} label="Cupos">
                    {`${cuposLabel(propuesta.cupos_por_club)} · ${metodoLabel(
                      propuesta.metodo_inscripcion
                    )}`}
                  </Row>
                  <Row icon={<Wallet color={C.green} size={16} strokeWidth={2} />} label="Cuota">
                    {propuesta.cuota_por_persona > 0
                      ? `$${propuesta.cuota_por_persona.toLocaleString('es-CL')} por persona`
                      : 'Sin cuota'}
                  </Row>
                  {!!propuesta.instrucciones && (
                    <Row
                      icon={<FileText color={C.green} size={16} strokeWidth={2} />}
                      label="Instrucciones"
                    >
                      {propuesta.instrucciones}
                    </Row>
                  )}
                </Card>

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

                {propuesta.estado === 'aprobada' && (
                  <Banner
                    type="success"
                    title="El partido ya está publicado"
                    message={`Los dos clubes pueden inscribirse: ${cuposLabel(
                      propuesta.cupos_por_club
                    )}.`}
                  />
                )}

                {conflictoDePertenencia && (
                  <Banner
                    type="info"
                    title="No puedes responder por el club rival"
                    message="Perteneces a los dos clubes, así que la respuesta la tiene que dar otro administrador. Puedes seguir la negociación en el chat."
                  />
                )}

                {puedoResponder && (
                  <>
                    <View style={styles.grupo}>
                      <FieldLabel>¿Quieres incluirte como jugador?</FieldLabel>
                      <SiNo
                        valor={meInscribo}
                        onChange={(v) => {
                          setMeInscribo(v);
                          // Cambiar de opinión reabre el resumen: lo que se
                          // confirmó ya no es lo que se va a hacer.
                          setConfirmando(false);
                        }}
                        siLabel="Sí, resérvame un cupo"
                        noLabel="No, solo apruebo"
                      />
                      <Text style={styles.ayuda}>
                        Ocuparías uno de los {propuesta.cupos_por_club} cupos de TU club. Es la única
                        vez que puedes incluirte sin que te confirme otro administrador.
                      </Text>
                    </View>

                    {confirmando ? (
                      <>
                        <View style={styles.confirmBox}>
                          <Text style={styles.confirmTitulo}>Antes de publicar, revisa</Text>
                          <Text style={styles.confirmLinea}>
                            · {fechaLarga(propuesta.fecha)} · {propuesta.duracion_min} min
                          </Text>
                          <Text style={styles.confirmLinea}>
                            · {propuesta.cancha_nombre}, {propuesta.comuna}
                          </Text>
                          <Text style={styles.confirmLinea}>
                            · {cuposLabel(propuesta.cupos_por_club)} ·{' '}
                            {metodoLabel(propuesta.metodo_inscripcion)}
                          </Text>
                          <Text style={styles.confirmLinea}>
                            ·{' '}
                            {propuesta.cuota_por_persona > 0
                              ? `$${propuesta.cuota_por_persona.toLocaleString('es-CL')} por persona`
                              : 'Sin cuota'}
                          </Text>
                          <Text style={styles.confirmLinea}>
                            · {meInscribo ? 'Te incluyes como jugador' : 'No te incluyes como jugador'}
                          </Text>
                          {propuesta.proponente_juega && (
                            <Text style={styles.confirmLinea}>
                              · Quien propuso pidió un cupo de su club
                            </Text>
                          )}
                          <Text style={styles.confirmAviso}>
                            Al publicar se avisa a los integrantes de los dos clubes. Esto no se
                            puede deshacer: para cambiar algo después hace falta el visto bueno del
                            club rival.
                          </Text>
                        </View>
                        <Button
                          label="Confirmar y publicar el partido"
                          onPress={handleAprobar}
                          loading={enviando}
                          style={styles.submitBtn}
                        />
                        <Button
                          label="Volver a revisar"
                          variant="secondary"
                          onPress={() => setConfirmando(false)}
                          style={styles.submitBtn}
                        />
                      </>
                    ) : (
                      <Button
                        label="Aprobar y publicar el partido"
                        onPress={() => setConfirmando(true)}
                        style={styles.submitBtn}
                      />
                    )}

                    <View style={styles.separador} />

                    <View style={styles.grupo}>
                      <FieldLabel>¿Prefieres pedir cambios? Motivo (opcional)</FieldLabel>
                      <TextField
                        placeholder="Ej: la cancha nos queda muy lejos, ¿probamos otra?"
                        value={motivo}
                        onChangeText={setMotivo}
                        multiline
                        maxLength={INSTRUCCIONES_MAX}
                      />
                    </View>
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
                <View style={styles.grupo}>
                  <View style={styles.row2}>
                    <View style={{ flex: 1 }}>
                      <FieldLabel>Fecha del partido</FieldLabel>
                      <TextField
                        placeholder="DD/MM/AAAA"
                        value={fechaStr}
                        onChangeText={setFechaStr}
                        keyboardType="numbers-and-punctuation"
                        error={!!errores.fecha}
                      />
                    </View>
                    <View style={{ width: 110 }}>
                      <FieldLabel>Hora</FieldLabel>
                      <TextField
                        placeholder="HH:MM"
                        value={horaStr}
                        onChangeText={setHoraStr}
                        keyboardType="numbers-and-punctuation"
                        error={!!errores.fecha}
                      />
                    </View>
                  </View>
                  {!!errores.fecha && <Text style={styles.error}>{errores.fecha}</Text>}
                </View>

                <View style={styles.grupo}>
                  <FieldLabel>Duración</FieldLabel>
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
                </View>

                <View style={styles.grupo}>
                  <FieldLabel>Cancha o recinto</FieldLabel>
                  <TextField
                    placeholder="Ej: Complejo Municipal"
                    value={canchaNombre}
                    onChangeText={(v) => setUbicacion((prev) => ({ ...prev, canchaNombre: v }))}
                    maxLength={120}
                    error={!!errores.canchaNombre}
                  />
                  {!!errores.canchaNombre && (
                    <Text style={styles.error}>{errores.canchaNombre}</Text>
                  )}
                </View>

                <View style={styles.grupo}>
                  <FieldLabel>Dirección exacta</FieldLabel>
                  <LocationAutocomplete
                    value={direccion}
                    placeholder="Busca la cancha por nombre o dirección"
                    proximity={
                      hayUbicacion ? { lat: ubicacion.coords.lat, lng: ubicacion.coords.lng } : null
                    }
                    // Los dos van con la forma funcional a propósito.
                    // `LocationAutocomplete` llama `onSelect` y a continuación
                    // `onChangeText` con la dirección elegida: leyendo el estado
                    // por closure, el segundo vería el valor de antes de la
                    // selección y borraría las coordenadas recién puestas.
                    onChangeText={(v) => setUbicacion((prev) => escribirDireccion(prev, v))}
                    onSelect={(lugar) => setUbicacion((prev) => seleccionarLugar(prev, lugar))}
                    inputRowStyle={[styles.autoRow, errores.ubicacion && styles.autoRowError]}
                    inputStyle={styles.autoInput}
                    placeholderColor={C.textSecondary}
                    accentColor={C.green}
                    spinnerColor={C.green}
                  />
                  {!!errores.direccion && <Text style={styles.error}>{errores.direccion}</Text>}
                  {errores.ubicacion ? (
                    <Text style={styles.error}>{errores.ubicacion}</Text>
                  ) : hayUbicacion ? (
                    <Text style={styles.ayuda}>
                      Ubicación fijada en el mapa. Todos los integrantes de los dos clubes verán esta
                      dirección.
                    </Text>
                  ) : (
                    <Text style={styles.ayuda}>
                      Elige un resultado del buscador: el partido necesita la ubicación en el mapa.
                    </Text>
                  )}
                </View>

                <View style={styles.grupo}>
                  <View style={styles.row2}>
                    <View style={{ flex: 1 }}>
                      <FieldLabel>Comuna</FieldLabel>
                      <TextField
                        placeholder="Ej: Ñuñoa"
                        value={comuna}
                        onChangeText={(v) => setUbicacion((prev) => ({ ...prev, comuna: v }))}
                        maxLength={80}
                        error={!!errores.comuna}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <FieldLabel>Región</FieldLabel>
                      <TextField
                        placeholder="Ej: Metropolitana"
                        value={region}
                        onChangeText={(v) => setUbicacion((prev) => ({ ...prev, region: v }))}
                        maxLength={80}
                        error={!!errores.region}
                      />
                    </View>
                  </View>
                </View>

                <View style={styles.grupo}>
                  <FieldLabel>Modalidad</FieldLabel>
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
                </View>

                <View style={styles.grupo}>
                  <FieldLabel>
                    Cupos por club ({CUPOS_POR_CLUB.min} a {CUPOS_POR_CLUB.max})
                  </FieldLabel>
                  <TextField
                    placeholder="Ej: 7"
                    value={cuposPorClub}
                    onChangeText={setCuposPorClub}
                    keyboardType="number-pad"
                    maxLength={2}
                    error={!!errores.cuposPorClub}
                  />
                  <Text style={styles.ayuda}>
                    Es el cupo de CADA club, no el total del partido.
                  </Text>
                  {!!errores.cuposPorClub && (
                    <Text style={styles.error}>{errores.cuposPorClub}</Text>
                  )}
                </View>

                <View style={styles.grupo}>
                  <FieldLabel>Cómo se llenan los cupos</FieldLabel>
                  <View style={styles.optionsBox}>
                    {METODOS_INSCRIPCION.map((m) => (
                      <ChoiceCard
                        key={m.value}
                        titulo={m.label}
                        descripcion={m.desc}
                        seleccionado={metodoInscripcion === m.value}
                        onPress={() => setMetodoInscripcion(m.value)}
                      />
                    ))}
                  </View>
                </View>

                <View style={styles.grupo}>
                  <FieldLabel>Cuota por persona</FieldLabel>
                  <TextField
                    placeholder="0 si no hay cuota"
                    value={cuotaPorPersona}
                    onChangeText={setCuotaPorPersona}
                    keyboardType="number-pad"
                    maxLength={7}
                    error={!!errores.cuotaPorPersona}
                  />
                  {!!errores.cuotaPorPersona && (
                    <Text style={styles.error}>{errores.cuotaPorPersona}</Text>
                  )}
                </View>

                <View style={styles.grupo}>
                  <FieldLabel marca="opcional">Instrucciones</FieldLabel>
                  <TextField
                    placeholder="Ej: llegar 20 minutos antes, entrada por el portón lateral..."
                    value={instrucciones}
                    onChangeText={setInstrucciones}
                    multiline
                    maxLength={INSTRUCCIONES_MAX}
                  />
                </View>

                <View style={styles.separador} />

                <View style={styles.grupo}>
                  <FieldLabel>¿Quieres incluirte como jugador?</FieldLabel>
                  <SiNo
                    valor={proponenteJuega}
                    onChange={setProponenteJuega}
                    siLabel="Sí, resérvame un cupo"
                    noLabel="No, solo organizo"
                  />
                  <Text style={styles.ayuda}>
                    Si dices que sí, ocuparás uno de los {cuposPorClub || '—'} cupos de TU club en
                    cuanto el partido se publique. Mientras la propuesta esté esperando respuesta no
                    se reserva nada.
                  </Text>
                </View>

                <Button
                  label="Enviar propuesta oficial"
                  icon={FileText}
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

/**
 * Chip de opción única.
 *
 * Es el `Chip` del kit con la altura mínima subida a 44: el kit lo dibuja a
 * 33 porque allá son etiquetas de filtro, y acá son la única forma de elegir
 * duración, modalidad y el sí/no de inscribirse.
 */
function Opcion({ label, activa, onPress }) {
  return <Chip label={label} active={activa} onPress={onPress} style={styles.opcion} />;
}

/**
 * Sí / No con el «No» a la izquierda y activo de entrada.
 *
 * El orden no es decorativo: reservarse un cupo se lo quita a un compañero,
 * así que la opción que no cambia nada tiene que ser la que está puesta si
 * nadie toca nada. Es la misma regla que aplica el servidor por defecto.
 */
function SiNo({ valor, onChange, siLabel, noLabel }) {
  return (
    <View style={styles.chipsRow}>
      <Opcion label={noLabel} activa={valor !== true} onPress={() => onChange(false)} />
      <Opcion label={siLabel} activa={valor === true} onPress={() => onChange(true)} />
    </View>
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
  root: { flex: 1, backgroundColor: C.bg },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: S.screenPadding,
    paddingTop: 6,
    paddingBottom: 12,
  },
  headerCenter: { flex: 1 },
  headerTitle: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 20, letterSpacing: -0.3 },
  headerSubtitle: { fontFamily: F.medium, color: C.textSecondary, fontSize: 12, marginTop: 2 },

  content: {
    paddingHorizontal: S.screenPadding,
    paddingBottom: 40,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },

  // Cada campo es un grupo: etiqueta, control y su ayuda o su error van
  // pegados, y la separación de 16 queda entre grupos y no dentro.
  grupo: { marginTop: 16 },

  ayuda: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16.5, marginTop: 7 },
  error: { fontFamily: F.semiBold, fontSize: 11.5, color: C.red, marginTop: 6 },

  separador: {
    height: 1,
    backgroundColor: C.dividerInner,
    marginTop: 24,
  },

  // El resumen previo a publicar. Borde verde porque es el último punto en
  // que se puede volver atrás.
  confirmBox: {
    backgroundColor: C.selectedBg,
    borderRadius: R.cardSm,
    borderWidth: 1,
    borderColor: C.green,
    padding: 14,
    marginTop: 16,
  },
  confirmTitulo: {
    fontFamily: F.extraBold,
    fontSize: 14.5,
    color: C.textPrimary,
    marginBottom: 9,
  },
  confirmLinea: { fontFamily: F.medium, fontSize: 13, color: C.textSecondary, lineHeight: 20 },
  confirmAviso: {
    fontFamily: F.medium,
    fontSize: 11.5,
    color: C.textMuted,
    lineHeight: 17,
    marginTop: 11,
  },

  // `LocationAutocomplete` trae su propia estructura; acá sólo se le pasa la
  // paleta de esta pantalla para que no se vea como un campo de otro módulo.
  autoRow: {
    backgroundColor: C.surface,
    borderRadius: R.row,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  autoRowError: { borderColor: C.red },
  autoInput: {
    fontFamily: F.medium,
    fontSize: 14.5,
    color: C.textPrimary,
    paddingVertical: 13,
  },

  row2: { flexDirection: 'row', gap: 10 },

  chipsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  opcion: { minHeight: 44, paddingHorizontal: 15 },

  optionsBox: { gap: 9 },

  resumen: { gap: 14, marginTop: 4 },
  resumenRow: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  resumenIcon: { width: 22, paddingTop: 2 },
  resumenLabel: { fontFamily: F.bold, fontSize: 11, color: C.textMuted, letterSpacing: 0.3 },
  resumenValue: { fontFamily: F.semiBold, fontSize: 14, color: C.textPrimary, lineHeight: 20, marginTop: 2 },

  submitBtn: { marginTop: 16 },
});
