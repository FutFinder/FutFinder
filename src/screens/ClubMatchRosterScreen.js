import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Check, UserX, Shield, Clock } from 'lucide-react-native';

import {
  paleta as C,
  fuentes as F,
} from '../theme/colors';
import Banner from '../components/Banner';
import {
  Avatar, Card, GhostButton, IconButton, PrimaryButton, SectionLabel,
} from '../components/partidos/ui';
import { supabase } from '../services/supabase';
import { getMatchById, withClubs } from '../services/matches';
import { getMyClubs } from '../services/clubs';
import {
  getNominaPartido,
  inscribirmeEnPartidoDeClub,
  salirDePartidoDeClub,
  confirmarNominaClub,
  suscribirseANomina,
} from '../services/clubRoster';
import {
  resumenNomina,
  miFilaEnNomina,
  accionNomina,
  ACCION_LABEL,
  puedoConfirmarNomina,
  clubesDelPartido,
} from '../services/clubMatchRules';

/**
 * Nómina de un partido entre clubes: quién va por cada club, quién postuló y
 * cuántos cupos quedan.
 *
 * params: { matchId }
 *
 * LOS CUPOS SON POR CLUB Y NO SE COMPARTEN. Toda la pantalla está construida
 * alrededor de esa regla: dos columnas, dos conteos, dos listas. Un total
 * único sería el error que la 45 vino a corregir en la base y que la tarjeta
 * del partido ya corrigió en pantalla.
 *
 * LA PANTALLA NO DECIDE NADA. Los botones se dibujan según `accionNomina()`,
 * pero quien autoriza es la RPC: `join_club_match`, `leave_club_match` y
 * `confirmar_nomina_club` vuelven a comprobarlo todo con la fila del partido
 * bloqueada. Esconder un botón es cortesía, no seguridad.
 *
 * SE REFRESCA SOLA. `suscribirseANomina` escucha `attendees` de este partido:
 * si alguien se inscribe, se sale o lo confirman, la lista se vuelve a pedir
 * sin que nadie tire hacia abajo.
 */
export default function ClubMatchRosterScreen({ navigation, route }) {
  const { matchId } = route.params || {};
  const { width } = useWindowDimensions();
  // A partir de aquí caben las dos nóminas lado a lado sin que los nombres se
  // partan. Por debajo van apiladas: es un teléfono, no una tabla.
  const dosColumnas = width >= 720;

  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState(null);
  const [nomina, setNomina] = useState([]);
  // Una nómina vacía y una nómina que no se pudo cargar NO se dibujan igual.
  // Pintar «0 de 7» y las listas en blanco cuando la consulta se cayó es
  // inventar un hecho: se ve idéntico a un partido al que no se ha inscrito
  // nadie, y encima ofrece «Inscribirme» a quien ya está dentro.
  const [errorNomina, setErrorNomina] = useState(null);
  const [misClubes, setMisClubes] = useState([]);
  const [me, setMe] = useState(null);
  const [banner, setBanner] = useState(null);
  const [enviando, setEnviando] = useState(false);

  // Evita pintar sobre una pantalla ya desmontada cuando Realtime dispara una
  // recarga justo mientras se sale.
  const vivo = useRef(true);

  const cargar = useCallback(async () => {
    const [{ data: m }, { data: filas, error: errNomina }, { data: clubes }, { data: sesion }] =
      await Promise.all([
        getMatchById(matchId),
        getNominaPartido(matchId),
        getMyClubs(),
        supabase.auth.getUser(),
      ]);
    // `getMatchById` trae la fila plana. La nómina necesita además nombres y
    // escudos para no pintar «Club local vs Club visitante» cuando sí existen.
    const [mConClubes] = await withClubs(m ? [m] : []);
    if (!vivo.current) return;
    setMatch(mConClubes || m || null);
    // `filas === null` es «no se pudo cargar»; `[]` es «no hay nadie».
    setNomina(filas || []);
    setErrorNomina(errNomina || null);
    setMisClubes(clubes || []);
    setMe(sesion?.user?.id || null);
    setLoading(false);
  }, [matchId]);

  useEffect(() => {
    vivo.current = true;
    cargar();
    return () => {
      vivo.current = false;
    };
  }, [cargar]);

  // Sin recarga manual: cualquier cambio en la nómina de ESTE partido vuelve a
  // pedirla. No se aplica el evento fila por fila a propósito — reconstruir el
  // estado desde el payload es donde se cuelan las divergencias.
  useEffect(() => {
    if (!matchId) return undefined;
    return suscribirseANomina(matchId, () => cargar());
  }, [matchId, cargar]);

  const misClubIds = useMemo(() => misClubes.map((c) => c.club?.id).filter(Boolean), [misClubes]);
  const misClubIdsAdmin = useMemo(
    () => misClubes.filter((c) => c.miRol === 'admin').map((c) => c.club?.id).filter(Boolean),
    [misClubes]
  );

  const miClubId = useMemo(() => {
    if (!match) return null;
    if (misClubIds.includes(match.club_local_id)) return match.club_local_id;
    if (misClubIds.includes(match.club_visitante_id)) return match.club_visitante_id;
    return null;
  }, [match, misClubIds]);

  const miFila = useMemo(() => miFilaEnNomina(nomina, me), [nomina, me]);
  const miResumen = useMemo(
    () => (miClubId ? resumenNomina(nomina, miClubId, match?.cupos_por_club) : null),
    [nomina, miClubId, match?.cupos_por_club]
  );

  const { accion, motivo } = useMemo(
    () => accionNomina({ match, misClubIds, miFila, resumen: miResumen }),
    [match, misClubIds, miFila, miResumen]
  );

  const ejecutar = useCallback(
    async (fn, exito) => {
      setEnviando(true);
      const { data, error } = await fn();
      setEnviando(false);
      if (error) {
        setBanner({ type: 'error', title: 'No se pudo', message: error.message });
        return;
      }
      setBanner({ type: 'success', title: exito(data), message: null });
      await cargar();
    },
    [cargar]
  );

  const handleAccion = useCallback(() => {
    if (accion === 'inscribirse' || accion === 'postular') {
      return ejecutar(
        () => inscribirmeEnPartidoDeClub(matchId),
        (d) =>
          d?.already
            ? 'Ya estabas en la nómina'
            : d?.estado === 'pendiente'
              ? 'Postulación enviada'
              : '¡Estás en la nómina!'
      );
    }
    if (accion === 'salir' || accion === 'cancelar_postulacion') {
      return ejecutar(
        () => salirDePartidoDeClub(matchId),
        () => (accion === 'salir' ? 'Saliste del partido' : 'Retiraste tu postulación')
      );
    }
    return undefined;
  }, [accion, matchId, ejecutar]);

  const handleConfirmar = useCallback(
    (playerId, aprobar) =>
      ejecutar(
        () => confirmarNominaClub(matchId, playerId, aprobar),
        () => (aprobar ? 'Jugador confirmado' : 'Postulación rechazada')
      ),
    [matchId, ejecutar]
  );

  const clubes = useMemo(() => clubesDelPartido(match), [match]);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      {/* Misma cabecera que el detalle del partido: flecha a la izquierda,
          título y subtítulo. Antes era una X a la derecha, que es de hoja
          modal — y esta pantalla no lo es: se llega navegando. */}
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Nómina del partido</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {match ? `${clubes.local.nombre} vs ${clubes.visitante.nombre}` : 'Cargando…'}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.green} />
        </View>
      ) : !match ? (
        <View style={styles.content}>
          <Banner
            type="info"
            title="Este partido ya no está disponible"
            message="Puede que se haya cancelado, o que no seas integrante de ninguno de los dos clubes."
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

          {match.metodo_inscripcion === 'seleccion_admin' && (
            <Text style={styles.aviso}>
              En este partido los cupos los reparte un administrador de cada club: te postulas y él
              confirma. Postular no reserva cupo.
            </Text>
          )}

          {errorNomina ? (
            // Ni conteos ni listas ni botón de acción: los tres dirían algo que
            // no sabemos. Se dice lo único cierto —que no cargó— y se ofrece
            // volver a intentarlo.
            <>
              <Banner
                type="error"
                title="No se pudo cargar la nómina"
                message={`${errorNomina.message} No se muestran los cupos ni las listas para no darte un dato equivocado.`}
              />
              <GhostButton label="Reintentar" onPress={cargar} style={styles.accionBtn} />
            </>
          ) : (
            <>
              <View style={[styles.columnas, dosColumnas && styles.columnasAncho]}>
                <NominaClub
                  club={clubes.local}
                  clubId={match.club_local_id}
                  nomina={nomina}
                  cuposPorClub={match.cupos_por_club}
                  esMiClub={miClubId === match.club_local_id}
                  puedoConfirmar={puedoConfirmarNomina(match.club_local_id, misClubIdsAdmin)}
                  me={me}
                  enviando={enviando}
                  onConfirmar={handleConfirmar}
                  ancho={dosColumnas}
                />
                <NominaClub
                  club={clubes.visitante}
                  clubId={match.club_visitante_id}
                  nomina={nomina}
                  cuposPorClub={match.cupos_por_club}
                  esMiClub={miClubId === match.club_visitante_id}
                  puedoConfirmar={puedoConfirmarNomina(match.club_visitante_id, misClubIdsAdmin)}
                  me={me}
                  enviando={enviando}
                  onConfirmar={handleConfirmar}
                  ancho={dosColumnas}
                />
              </View>

              {accion === 'ninguna' ? (
                <Text style={styles.motivo}>{motivo}</Text>
              ) : (
                accion === 'salir' || accion === 'cancelar_postulacion' ? (
                  <GhostButton
                    label={ACCION_LABEL[accion]}
                    onPress={handleAccion}
                    disabled={enviando}
                    tone="danger"
                    style={styles.accionBtn}
                  />
                ) : (
                  <PrimaryButton
                    label={ACCION_LABEL[accion]}
                    onPress={handleAccion}
                    loading={enviando}
                    style={styles.accionBtn}
                  />
                )
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/**
 * La nómina de UN club: cabecera con el conteo, inscritos y postulaciones.
 *
 * El conteo se dice con el numerador siempre —«3 de 9 inscritos»— porque acá
 * sí se conoce: la lista entera está cargada. En las tarjetas de las listas no
 * se conoce, y por eso allá la etiqueta se queda sin numerador.
 */
function NominaClub({
  club,
  clubId,
  nomina,
  cuposPorClub,
  esMiClub,
  puedoConfirmar,
  me,
  enviando,
  onConfirmar,
  ancho,
}) {
  const resumen = resumenNomina(nomina, clubId, cuposPorClub);
  const filas = (nomina || []).filter((a) => a.club_id === clubId);
  const inscritos = filas.filter((a) => a.estado === 'inscrito' || a.estado === 'confirmado_gps');
  const pendientes = filas.filter((a) => a.estado === 'pendiente');

  return (
    <Card style={[ancho && { flex: 1 }, styles.columna, esMiClub && styles.columnaMia]}>
      <View style={styles.columnaHead}>
        <Avatar name={club.nombre} size={38} ring={esMiClub} />
        <View style={{ flex: 1 }}>
          <Text style={styles.clubNombre} numberOfLines={1}>
            {club.nombre}
          </Text>
          <Text style={styles.conteo}>
            {resumen.inscritos} de {resumen.cupos} inscritos
            {esMiClub ? ' de tu club' : ''}
          </Text>
        </View>
      </View>

      {inscritos.length === 0 ? (
        <Text style={styles.vacio}>Todavía no hay nadie inscrito.</Text>
      ) : (
        inscritos.map((a) => (
          <Jugador key={a.id} fila={a} esYo={a.id_jugador === me} />
        ))
      )}

      {pendientes.length > 0 && (
        <>
          <View style={{ marginTop: 10, marginBottom: 2 }}>
            <SectionLabel>
              {pendientes.length === 1 ? '1 postulación' : `${pendientes.length} postulaciones`}
            </SectionLabel>
          </View>
          {pendientes.map((a) => (
            <Jugador
              key={a.id}
              fila={a}
              esYo={a.id_jugador === me}
              // Nadie se confirma a sí mismo: la RPC lo rechaza y ofrecerlo
              // sería prometer algo que el servidor no va a hacer.
              acciones={
                puedoConfirmar && a.id_jugador !== me ? (
                  <View style={styles.accionesFila}>
                    <IconButton
                      icon={Check}
                      tone="green"
                      size={38}
                      onPress={enviando ? undefined : () => onConfirmar(a.id_jugador, true)}
                      accessibilityLabel={`Confirmar a ${nombreDe(a)}`}
                    />
                    <IconButton
                      icon={UserX}
                      size={38}
                      onPress={enviando ? undefined : () => onConfirmar(a.id_jugador, false)}
                      accessibilityLabel={`Rechazar a ${nombreDe(a)}`}
                    />
                  </View>
                ) : null
              }
            />
          ))}
        </>
      )}
    </Card>
  );
}

function nombreDe(fila) {
  return fila?.profiles?.nombre || fila?.profiles?.username || 'Jugador';
}

/**
 * Una línea de la nómina.
 *
 * `origen` se traduce a una etiqueta sólo cuando dice algo que no se deduce de
 * mirar la lista: que un administrador se reservó el cupo al proponer o al
 * aprobar. Un `orden_llegada` no lleva etiqueta — es lo normal, y marcarlo
 * sería ruido.
 */
function Jugador({ fila, esYo, acciones }) {
  const etiqueta = ETIQUETA_ORIGEN[fila.origen];
  return (
    <View style={styles.jugador}>
      <Avatar name={nombreDe(fila)} size={32} tone={esYo ? 'green' : 'neutral'} />
      <View style={{ flex: 1 }}>
        <Text style={styles.jugadorNombre} numberOfLines={1}>
          {nombreDe(fila)}
          {esYo ? ' · tú' : ''}
        </Text>
        {!!etiqueta && (
          <View style={styles.etiquetaFila}>
            {fila.estado === 'pendiente' ? (
              <Clock color={C.textSecondary} size={11} />
            ) : (
              <Shield color={C.textSecondary} size={11} />
            )}
            <Text style={styles.etiqueta}>{etiqueta}</Text>
          </View>
        )}
      </View>
      {acciones}
    </View>
  );
}

/** `attendees.origen` → qué decir. Lo que no aporta, no se dice. */
const ETIQUETA_ORIGEN = {
  reserva_proponente: 'Reservó su cupo al proponer el partido',
  reserva_aprobador: 'Reservó su cupo al aprobar el partido',
  postulacion: 'Esperando que su club lo confirme',
  postulacion_aprobada: 'Confirmado por su club',
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    width: '100%',
    maxWidth: 932,
    alignSelf: 'center',
  },
  headerCenter: { flex: 1 },
  headerTitle: { color: C.textPrimary, fontSize: 19, fontFamily: F.extraBold, letterSpacing: -0.4 },
  headerSubtitle: { color: C.textSecondary, fontSize: 12, marginTop: 2 },

  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
    width: '100%',
    maxWidth: 932,
    alignSelf: 'center',
  },
  aviso: { color: C.textSecondary, fontSize: 12, lineHeight: 17 },

  // Apiladas en teléfono, lado a lado desde 720 px. El `maxWidth` es lo que
  // evita que en un monitor ancho las dos columnas se estiren hasta dejar los
  // nombres nadando en el vacío.
  columnas: { gap: 12 },
  columnasAncho: { flexDirection: 'row', maxWidth: 900, alignSelf: 'center', width: '100%' },

  columna: { gap: 8 },
  // El club propio se marca con el verde de la app, no con un borde de otro
  // tono: es la misma señal que usan las tarjetas de partidos.
  columnaMia: { borderColor: C.greenBorder },
  columnaHead: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 4 },
  clubNombre: { color: C.textPrimary, fontSize: 15.5, fontFamily: F.extraBold, letterSpacing: -0.2 },
  conteo: { color: C.green, fontSize: 12, fontFamily: F.bold, marginTop: 2 },

  vacio: { color: C.textFaint, fontSize: 13, paddingVertical: 2 },

  jugador: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 6 },
  jugadorNombre: { color: C.textStrong, fontSize: 14, fontFamily: F.semiBold },
  etiquetaFila: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  etiqueta: { color: C.textSecondary, fontSize: 11, flexShrink: 1 },

  accionesFila: { flexDirection: 'row', gap: 6 },

  accionBtn: { marginTop: 8 },
  motivo: { color: C.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 12, lineHeight: 18 },
});
