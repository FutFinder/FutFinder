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

import { colors, radius } from '../theme/colors';
import Banner from '../components/Banner';
import Button from '../components/Button';
import { supabase } from '../services/supabase';
import { getMatchById, withClubs } from '../services/matches';
import { getMyClubs } from '../services/clubs';
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
  const [misClubes, setMisClubes] = useState([]);
  const [me, setMe] = useState(null);
  const [banner, setBanner] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const [golLocal, setGolLocal] = useState('');
  const [golVisitante, setGolVisitante] = useState('');
  const [asistieron, setAsistieron] = useState({});
  const asistenciaInicializada = useRef(false);

  const vivo = useRef(true);

  const cargar = useCallback(async () => {
    const [{ data: m }, { data: ch }, { data: res }, { data: filas }, { data: clubes }, { data: sesion }] =
      await Promise.all([
        getMatchById(matchId),
        refreshChallenge(challengeId),
        getResultadoActivo(challengeId),
        getNominaPartido(matchId),
        getMyClubs(),
        supabase.auth.getUser(),
      ]);
    const [mConClubes] = await withClubs(m ? [m] : []);
    if (!vivo.current) return;
    setMatch(mConClubes || m || null);
    setChallenge(ch || null);
    setResultado(res || null);
    setNomina(filas || []);
    setMisClubes(clubes || []);
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

  const misClubIdsAdmin = useMemo(
    () => misClubes.filter((c) => c.miRol === 'admin').map((c) => c.club?.id).filter(Boolean),
    [misClubes]
  );

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
    <View style={styles.card}>
      <Text style={styles.marcadorLabel}>Resultado propuesto</Text>
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
    </View>
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
      <View style={styles.card}>
        <Text style={styles.marcadorLabel}>Marcador final</Text>
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
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.golGuion}>-</Text>
          <TextInput
            value={golVisitante}
            onChangeText={(v) => onGolVisitante(v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            maxLength={2}
            style={styles.golInput}
            placeholder="0"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.equipoNombre} numberOfLines={1}>
            {clubes.visitante.nombre}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.marcadorLabel}>Quién llegó</Text>
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
                {asistieron[a.id_jugador] ? <Check color="#000" size={14} strokeWidth={3} /> : null}
              </View>
            </Pressable>
          ))
        )}
      </View>

      <Button label="Proponer resultado" onPress={onEnviar} loading={enviando} style={styles.accionBtn} />
    </>
  );
}

function nombreDe(fila) {
  return fila?.profiles?.nombre || fila?.profiles?.username || 'Jugador';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    width: '100%',
    maxWidth: 932,
    alignSelf: 'center',
  },
  headerCenter: { flex: 1 },
  headerTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  headerSubtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 16,
    gap: 12,
  },
  marcadorLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  marcadorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  equipoNombre: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  marcador: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  golInput: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  golGuion: { color: colors.textMuted, fontSize: 16, fontWeight: '700' },

  accionesRow: { flexDirection: 'row', gap: 10 },
  accionBtn: { marginTop: 4 },
  motivo: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 18 },

  asistenciaAyuda: { color: colors.textMuted, fontSize: 12, marginTop: -6 },
  vacio: { color: colors.textMuted, fontSize: 13 },
  jugadorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTxt: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  jugadorNombre: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  check: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
