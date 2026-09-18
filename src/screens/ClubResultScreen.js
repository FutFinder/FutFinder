import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Check } from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  medidas as S,
  fuentes as F,
} from '../theme/colors';
import Banner from '../components/Banner';
import { Card, Button, IconButton, SectionLabel } from '../components/reservas/ui';
import { supabase } from '../services/supabase';
import { getMatchById, withClubs } from '../services/matches';
import { getMisClubesConPermiso } from '../services/clubPermissions';
import { getNominaPartido } from '../services/clubRoster';
import { clubesDelPartido, iniciales } from '../services/clubMatchRules';
import { refreshChallenge } from '../services/clubChallenges';
import { proponerResultado, confirmarResultado, getResultadoActivo } from '../services/clubResults';
import { accionesDeResultado } from '../utils/resultadoRpc';

/**
 * Proponer o confirmar el resultado de un partido entre clubes (migración 48).
 *
 * params: { challengeId, matchId }
 *
 * LA PANTALLA NO AUTORIZA NADA. Qué se puede hacer sale de
 * `accionesDeResultado`, puro y probado, pero quien decide es
 * `proponer_resultado()`/`confirmar_resultado()` con la membresía y el
 * estado del desafío en el servidor. Si el servidor dice que no, se muestra
 * su mensaje tal cual.
 *
 * UN RESULTADO EN DISPUTA ES UN CALLEJÓN SIN SALIDA PARA EL CLUB (48b): ni el
 * proponente ni el contrario pueden proponer uno nuevo por su cuenta — sólo
 * la moderación reabre una disputa. Acá se dice sin ofrecer ningún botón.
 *
 * LA ASISTENCIA SE MARCA JUNTO CON LA PROPUESTA. Cada inscrito parte
 * marcado como que asistió — es el caso más común — y el administrador
 * destilda a quien no llegó. `proponer_resultado()` traduce eso a
 * `confirmado_gps` / `no_asistio` sobre `attendees`, y sólo la primera
 * propuesta la toca: no hay una segunda oportunidad de corregirla desde
 * acá, porque en disputa ya no se puede volver a proponer.
 */
export default function ClubResultScreen({ navigation, route }) {
  const { challengeId, matchId } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState(null);
  const [challenge, setChallenge] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [nomina, setNomina] = useState([]);
  const [misClubIdsAdmin, setMisClubIdsAdmin] = useState([]);
  const [me, setMe] = useState(null);
  const [banner, setBanner] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const [golLocal, setGolLocal] = useState('');
  const [golVisitante, setGolVisitante] = useState('');
  const [asistieron, setAsistieron] = useState({});
  const asistenciaInicializada = useRef(false);

  const vivo = useRef(true);

  const cargar = useCallback(async () => {
    const [{ data: m }, { data: ch }, { data: res }, { data: filas }, { data: clubesConResults }, { data: sesion }] =
      await Promise.all([
        getMatchById(matchId),
        refreshChallenge(challengeId),
        getResultadoActivo(challengeId),
        getNominaPartido(matchId),
        // Admin del club, o capitán/jugador con `results` concedido
        // (migración 119): cualquiera de las dos alcanza para proponer o
        // confirmar el marcador. `accionesDeResultado` es puro y no sabe de
        // permisos — sólo mira si el club está en esta lista.
        getMisClubesConPermiso('results'),
        supabase.auth.getUser(),
      ]);
    const [mConClubes] = await withClubs(m ? [m] : []);
    if (!vivo.current) return;
    setMatch(mConClubes || m || null);
    setChallenge(ch || null);
    setResultado(res || null);
    setNomina(filas || []);
    setMisClubIdsAdmin(clubesConResults || []);
    setMe(sesion?.user?.id || null);
    setLoading(false);
  }, [matchId, challengeId]);

  useEffect(() => {
    vivo.current = true;
    cargar();
    return () => {
      vivo.current = false;
    };
  }, [cargar]);

  const acciones = useMemo(
    () =>
      accionesDeResultado({
        challenge,
        clubesAdmin: misClubIdsAdmin,
        resultadoActivo: resultado,
        miUserId: me,
      }),
    [challenge, misClubIdsAdmin, resultado, me]
  );

  // Sólo los que de verdad están dentro del partido: `pendiente` no consumió
  // cupo y no fue nadie a ninguna parte, y `cancelado` se retiró antes.
  const inscritos = useMemo(
    () =>
      (nomina || []).filter(
        (a) => a.estado === 'inscrito' || a.estado === 'confirmado_gps' || a.estado === 'no_asistio'
      ),
    [nomina]
  );

  // Todos parten marcados como que asistieron — es el caso más común —, y
  // sólo una vez: si el administrador destilda a alguien y la nómina se
  // vuelve a pedir por el sondeo, no se le vuelve a tildar solo.
  useEffect(() => {
    if (asistenciaInicializada.current || inscritos.length === 0) return;
    const inicial = {};
    for (const a of inscritos) inicial[a.id_jugador] = a.estado !== 'no_asistio';
    setAsistieron(inicial);
    asistenciaInicializada.current = true;
  }, [inscritos]);

  const toggleAsistio = useCallback((idJugador) => {
    setAsistieron((prev) => ({ ...prev, [idJugador]: !prev[idJugador] }));
  }, []);

  const volverConAviso = useCallback(() => {
    if (!challengeId) {
      navigation.goBack();
      return;
    }
    navigation.navigate({
      name: 'ChatThread',
      params: {
        threadKey: `challenge:${challengeId}`,
        resultadoRegistrado: Date.now(),
      },
      merge: true,
    });
  }, [navigation, challengeId]);

  const handleProponer = useCallback(async () => {
    const gl = Number(golLocal);
    const gv = Number(golVisitante);
    if (golLocal.trim() === '' || golVisitante.trim() === '' || Number.isNaN(gl) || Number.isNaN(gv)) {
      setBanner({
        type: 'error',
        title: 'Falta el marcador',
        message: 'Ingresa el marcador de los dos equipos.',
      });
      return;
    }
    const asistencia = inscritos.map((a) => a.id_jugador).filter((id) => asistieron[id]);

    setEnviando(true);
    const { data, error } = await proponerResultado(challengeId, gl, gv, asistencia);
    setEnviando(false);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo proponer el resultado', message: error.message });
      return;
    }
    if (data?.already) {
      volverConAviso();
      return;
    }
    volverConAviso();
  }, [challengeId, golLocal, golVisitante, inscritos, asistieron, volverConAviso]);

  const handleConfirmar = useCallback(
    async (aceptar) => {
      if (!resultado?.id) return;
      setEnviando(true);
      const { error } = await confirmarResultado(resultado.id, aceptar);
      setEnviando(false);
      if (error) {
        setBanner({ type: 'error', title: 'No se pudo responder', message: error.message });
        return;
      }
      volverConAviso();
    },
    [resultado, volverConAviso]
  );

  const clubes = useMemo(() => clubesDelPartido(match), [match]);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Resultado del encuentro</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {match ? `${clubes.local.nombre} vs ${clubes.visitante.nombre}` : 'Cargando…'}
            </Text>
          </View>
          <IconButton icon={X} onPress={() => navigation.goBack()} accessibilityLabel="Cerrar" />
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={C.green} />
          </View>
        ) : !match || !challenge ? (
          <View style={styles.content}>
            <Banner
              type="info"
              title="Este encuentro ya no está disponible"
              message="Puede que se haya cancelado, o que no seas integrante de ninguno de los dos clubes."
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

            {resultado?.estado === 'propuesto' ? (
              <ConfirmarPanel
                resultado={resultado}
                clubes={clubes}
                acciones={acciones}
                enviando={enviando}
                onAceptar={() => handleConfirmar(true)}
                onRechazar={() => handleConfirmar(false)}
              />
            ) : challenge.estado === 'resultado_en_disputa' ? (
              <Banner
                type="error"
                title="Resultado en disputa"
                message="El marcador propuesto se rechazó. Las estadísticas no cambian hasta que se resuelva."
              />
            ) : acciones.puedeProponer ? (
              <ProponerPanel
                clubes={clubes}
                golLocal={golLocal}
                golVisitante={golVisitante}
                onGolLocal={setGolLocal}
                onGolVisitante={setGolVisitante}
                inscritos={inscritos}
                asistieron={asistieron}
                onToggleAsistio={toggleAsistio}
                enviando={enviando}
                onEnviar={handleProponer}
              />
            ) : (
              <Text style={styles.motivo}>
                {acciones.bloqueoProponer || 'No puedes proponer un resultado en este encuentro.'}
              </Text>
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Marcador propuesto, y sólo el club contrario puede responderlo. */
function ConfirmarPanel({ resultado, clubes, acciones, enviando, onAceptar, onRechazar }) {
  return (
    <Card style={styles.card}>
      <SectionLabel>Resultado propuesto</SectionLabel>
      <View style={styles.marcadorRow}>
        <Text style={styles.equipoNombre} numberOfLines={1}>
          {clubes.local.nombre}
        </Text>
        <Text style={styles.marcador}>
          {resultado.goles_local} - {resultado.goles_visitante}
        </Text>
        <Text style={styles.equipoNombre} numberOfLines={1}>
          {clubes.visitante.nombre}
        </Text>
      </View>

      {acciones.puedeConfirmar ? (
        <View style={styles.accionesRow}>
          <Button
            label="Rechazar"
            variant="secondary"
            onPress={onRechazar}
            loading={enviando}
            style={{ flex: 1 }}
          />
          <Button
            label="Confirmar"
            onPress={onAceptar}
            loading={enviando}
            style={{ flex: 1 }}
          />
        </View>
      ) : (
        <Text style={styles.motivo}>
          {acciones.bloqueoConfirmar || 'Esperando confirmación del club contrario.'}
        </Text>
      )}
    </Card>
  );
}

/** El marcador y la asistencia real de los inscritos. */
function ProponerPanel({
  clubes,
  golLocal,
  golVisitante,
  onGolLocal,
  onGolVisitante,
  inscritos,
  asistieron,
  onToggleAsistio,
  enviando,
  onEnviar,
}) {
  return (
    <>
      <Card style={styles.card}>
        <SectionLabel>Marcador final</SectionLabel>
        <View style={styles.marcadorRow}>
          <Text style={styles.equipoNombre} numberOfLines={1}>
            {clubes.local.nombre}
          </Text>
          <TextInput
            value={golLocal}
            onChangeText={(v) => onGolLocal(v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            maxLength={2}
            style={styles.golInput}
            placeholder="0"
            placeholderTextColor={C.textSecondary}
          />
          <Text style={styles.golGuion}>-</Text>
          <TextInput
            value={golVisitante}
            onChangeText={(v) => onGolVisitante(v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            maxLength={2}
            style={styles.golInput}
            placeholder="0"
            placeholderTextColor={C.textSecondary}
          />
          <Text style={styles.equipoNombre} numberOfLines={1}>
            {clubes.visitante.nombre}
          </Text>
        </View>
      </Card>

      <Card style={styles.card}>
        <SectionLabel>Quién llegó</SectionLabel>
        <Text style={styles.asistenciaAyuda}>
          Destilda a quien no se presentó. El resto queda confirmado.
        </Text>
        {inscritos.length === 0 ? (
          <Text style={styles.vacio}>No hay nadie inscrito en este partido.</Text>
        ) : (
          inscritos.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => onToggleAsistio(a.id_jugador)}
              style={({ pressed }) => [styles.jugadorRow, pressed && { opacity: 0.7 }]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!asistieron[a.id_jugador] }}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarTxt}>{iniciales(nombreDe(a))}</Text>
              </View>
              <Text style={styles.jugadorNombre} numberOfLines={1}>
                {nombreDe(a)}
              </Text>
              <View style={[styles.check, asistieron[a.id_jugador] && styles.checkOn]}>
                {asistieron[a.id_jugador] ? (
                  <Check color={C.textOnGreen} size={14} strokeWidth={3} />
                ) : null}
              </View>
            </Pressable>
          ))
        )}
      </Card>

      <Button label="Proponer resultado" onPress={onEnviar} loading={enviando} style={styles.accionBtn} />
    </>
  );
}

function nombreDe(fila) {
  return fila?.profiles?.nombre || fila?.profiles?.username || 'Jugador';
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
  headerTitle: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 20, letterSpacing: -0.3 },
  headerSubtitle: { fontFamily: F.medium, color: C.textSecondary, fontSize: 12, marginTop: 2 },
  content: {
    paddingHorizontal: S.screenPadding,
    paddingBottom: 40,
    gap: S.cardGap,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },

  card: { gap: 12 },
  marcadorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  equipoNombre: { flex: 1, fontFamily: F.bold, fontSize: 14, color: C.textPrimary },
  marcador: { fontFamily: F.extraBold, fontSize: 24, color: C.textPrimary },
  golInput: {
    width: 46,
    height: 46,
    borderRadius: R.iconBtn,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
    fontFamily: F.extraBold,
    fontSize: 18,
    color: C.textPrimary,
    textAlign: 'center',
  },
  golGuion: { fontFamily: F.bold, fontSize: 16, color: C.textMuted },

  accionesRow: { flexDirection: 'row', gap: 10 },
  accionBtn: { marginTop: 4 },
  motivo: {
    fontFamily: F.medium,
    fontSize: 13,
    color: C.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
  },

  asistenciaAyuda: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, marginTop: -6, lineHeight: 16.5 },
  vacio: { fontFamily: F.medium, fontSize: 13, color: C.textSecondary },
  jugadorRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTxt: { fontFamily: F.bold, fontSize: 11, color: C.textSecondary },
  jugadorNombre: { flex: 1, fontFamily: F.semiBold, fontSize: 14, color: C.textPrimary },
  check: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: C.green, borderColor: C.green },
});
