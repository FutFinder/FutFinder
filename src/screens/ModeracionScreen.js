import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Gavel, RotateCcw, ShieldAlert, TriangleAlert } from 'lucide-react-native';

import { paleta as C, radios as R, fuentes as F, alfa } from '../theme/colors';
import Banner from '../components/Banner';
import useConfirmacion from '../components/useConfirmacion';
import {
  getColaModeracion,
  resolverRevision,
  reabrirResultado,
} from '../services/moderacion';
import {
  COLAS,
  filasDe,
  estadoDeLaCola,
  motivoLegible,
  tipoSancionLegible,
  totalPendiente,
  puedeResolver,
  NOTA_MAX,
} from '../utils/moderacion';

/**
 * Las tres colas de moderación (migración 151).
 *
 * QUIÉN LLEGA ACÁ. Sólo quien está en `public.moderadores`, y el padrón no se
 * lee desde la app: nombrar a alguien es un `insert` desde el panel. La
 * entrada del menú se esconde con `soyModerador()`, pero eso es cosmética —
 * las tres RPC vuelven a comprobarlo y devuelven `NO_MODERA` (42501) a quien
 * no corresponda. Esta pantalla nunca es la autoridad.
 *
 * LOS REPORTES SE MUESTRAN Y NO SE TOCAN, y la pantalla lo dice con todas
 * sus letras en vez de limitarse a no traer botones. Resolverlos exige
 * decidir estados, medidas y apelación: es diseño de producto y sigue
 * abierto. La decisión vive en `utils/moderacion.js`, con una prueba que se
 * pone roja si alguien agrega el botón sin darse cuenta.
 *
 * UN HALLAZGO DE LA 151 QUE SE NOTA ACÁ: quien modera **no ve el hilo del
 * desafío que modera** —`chat_puede_ver_desafio()` exige pertenecer a uno de
 * los dos clubes, y no pertenecer es justo lo que lo hace imparcial—. Por eso
 * la revisión muestra el `contexto`, que es el expediente copiado al pedirla.
 */

function fechaCorta(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })
      + ' · ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '';
  }
}

export default function ModeracionScreen({ navigation }) {
  const [cola, setCola] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [refrescando, setRefrescando] = useState(false);
  const [banner, setBanner] = useState(null);
  const [enCurso, setEnCurso] = useState(null);
  // La nota es por fila: dos revisiones abiertas a la vez no pueden
  // compartir el mismo texto.
  const [notas, setNotas] = useState({});
  const { confirmar, dialogo } = useConfirmacion();

  const cargar = useCallback(async () => {
    const { data, error: e } = await getColaModeracion();
    if (e) {
      setError(e);
      setCola(null);
    } else {
      setCola(data);
      setError(null);
    }
    setCargando(false);
    setRefrescando(false);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const notaDe = (id) => notas[id] || '';
  const setNota = (id, v) => setNotas((n) => ({ ...n, [id]: v }));

  /**
   * Las dos acciones terminan igual: un `{ ok, reason }` que puede venir en
   * `data` sin que `error` tenga nada. Mirar sólo `error` dejaría pasar en
   * silencio «esa revisión ya está resuelta».
   */
  const aplicar = useCallback(async (id, fn, exito) => {
    setEnCurso(id);
    const { data, error: e } = await fn();
    setEnCurso(null);
    if (e) {
      setBanner({ type: 'error', title: 'No se pudo', message: e.message || 'Intenta de nuevo.' });
      return;
    }
    if (data && data.ok === false) {
      setBanner({ type: 'error', title: 'No se pudo', message: data.reason || 'El servidor lo rechazó.' });
      return;
    }
    setBanner({ type: 'success', title: exito, message: null });
    setNota(id, '');
    await cargar();
  }, [cargar]);

  const resolver = (rev, decision) => {
    const nota = notaDe(rev.id).trim() || null;
    if (!puedeResolver({ decision, nota })) return;
    confirmar(
      decision === 'retirar' ? 'Retirar la sanción' : 'Mantener la sanción',
      decision === 'retirar'
        ? 'La sanción se levanta y el club queda sin castigo por este encuentro.'
        : 'La sanción se confirma y el club la cumple.',
      () => aplicar(rev.id, () => resolverRevision(rev.id, decision, nota), 'Revisión resuelta')
    );
  };

  const reabrir = (d) => {
    const nota = notaDe(d.challenge_id).trim() || null;
    confirmar(
      'Reabrir el resultado',
      'Los dos clubes podrán proponer el marcador de nuevo. El rechazado se queda en el historial.',
      () => aplicar(d.challenge_id, () => reabrirResultado(d.challenge_id, nota), 'Resultado reabierto')
    );
  };

  const total = totalPendiente(cola);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <View style={styles.cabecera}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Volver"
          style={styles.volver}
        >
          <ArrowLeft color={C.textPrimary} size={20} strokeWidth={2.2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.titulo}>Moderación</Text>
          <Text style={styles.subtitulo}>
            {cargando ? 'Cargando…' : `${total} ${total === 1 ? 'cosa' : 'cosas'} esperando`}
          </Text>
        </View>
        <Gavel color={C.green} size={20} strokeWidth={2} />
      </View>

      {banner ? (
        <View style={styles.bannerWrap}>
          <Banner {...banner} onClose={() => setBanner(null)} />
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.contenido}
        refreshControl={
          <RefreshControl
            refreshing={refrescando}
            onRefresh={() => { setRefrescando(true); cargar(); }}
            tintColor={C.green}
          />
        }
      >
        {COLAS.map((def) => {
          const estado = estadoDeLaCola({ cargando, error, cola, clave: def.clave });
          const filas = filasDe(cola, def.clave);

          return (
            <View key={def.clave} style={styles.seccion}>
              <View style={styles.seccionCabecera}>
                <Text style={styles.seccionTitulo}>{def.titulo}</Text>
                {estado === 'con-filas' ? (
                  <View style={styles.contador}>
                    <Text style={styles.contadorTexto}>{filas.length}</Text>
                  </View>
                ) : null}
              </View>

              {def.nota ? <Text style={styles.seccionNota}>{def.nota}</Text> : null}

              {estado === 'cargando' ? (
                <ActivityIndicator color={C.green} style={{ marginVertical: 18 }} />
              ) : null}

              {/* «No se pudo leer» NO se dibuja como «no hay nada»: lo que
                  habría detrás son sanciones sin resolver. */}
              {estado === 'error' ? (
                <View style={styles.aviso}>
                  <TriangleAlert color={C.red} size={16} strokeWidth={2} />
                  <Text style={styles.avisoTexto}>
                    No se pudo leer esta cola. Desliza hacia abajo para reintentar.
                  </Text>
                </View>
              ) : null}

              {estado === 'vacia' ? <Text style={styles.vacio}>{def.vacio}</Text> : null}

              {estado === 'con-filas' && def.clave === 'revisiones_de_sancion'
                ? filas.map((rev) => (
                    <View key={rev.id} style={styles.fila}>
                      <Text style={styles.filaTitulo}>
                        {tipoSancionLegible(rev.tipo)} · {rev.club || 'Club'}
                      </Text>
                      <Text style={styles.filaFecha}>{fechaCorta(rev.created_at)}</Text>
                      {rev.motivo ? <Text style={styles.filaTexto}>{rev.motivo}</Text> : null}
                      {rev.contexto ? (
                        <Text style={styles.filaContexto} numberOfLines={6}>
                          {typeof rev.contexto === 'string'
                            ? rev.contexto
                            : JSON.stringify(rev.contexto, null, 1)}
                        </Text>
                      ) : null}

                      <TextInput
                        value={notaDe(rev.id)}
                        onChangeText={(v) => setNota(rev.id, v)}
                        placeholder="Nota (opcional)"
                        placeholderTextColor={C.textDim}
                        maxLength={NOTA_MAX}
                        multiline
                        style={styles.nota}
                      />

                      <View style={styles.acciones}>
                        <Pressable
                          onPress={() => resolver(rev, 'retirar')}
                          disabled={enCurso === rev.id}
                          accessibilityRole="button"
                          accessibilityLabel="Retirar la sanción"
                          style={({ pressed }) => [styles.btn, styles.btnPrimario, pressed && styles.pressed]}
                        >
                          <Text style={styles.btnPrimarioTexto}>Retirar sanción</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => resolver(rev, 'mantener')}
                          disabled={enCurso === rev.id}
                          accessibilityRole="button"
                          accessibilityLabel="Mantener la sanción"
                          style={({ pressed }) => [styles.btn, styles.btnSecundario, pressed && styles.pressed]}
                        >
                          <Text style={styles.btnSecundarioTexto}>Mantener</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                : null}

              {estado === 'con-filas' && def.clave === 'resultados_en_disputa'
                ? filas.map((d) => (
                    <View key={d.challenge_id} style={styles.fila}>
                      <Text style={styles.filaTitulo}>
                        {d.club_retador || 'Club'} vs {d.club_retado || 'Club'}
                      </Text>
                      <Text style={styles.filaTexto}>
                        Los dos clubes propusieron marcadores que no coinciden.
                      </Text>
                      <TextInput
                        value={notaDe(d.challenge_id)}
                        onChangeText={(v) => setNota(d.challenge_id, v)}
                        placeholder="Nota (opcional)"
                        placeholderTextColor={C.textDim}
                        maxLength={NOTA_MAX}
                        multiline
                        style={styles.nota}
                      />
                      <View style={styles.acciones}>
                        <Pressable
                          onPress={() => reabrir(d)}
                          disabled={enCurso === d.challenge_id}
                          accessibilityRole="button"
                          accessibilityLabel="Reabrir el resultado"
                          style={({ pressed }) => [styles.btn, styles.btnPrimario, pressed && styles.pressed]}
                        >
                          <RotateCcw color="#0B0D0B" size={15} strokeWidth={2.3} />
                          <Text style={styles.btnPrimarioTexto}>Reabrir resultado</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                : null}

              {estado === 'con-filas' && def.clave === 'reportes_sin_mirar'
                ? filas.map((rep) => (
                    <View key={rep.id} style={styles.fila}>
                      <View style={styles.filaIcono}>
                        <ShieldAlert color={C.amber} size={15} strokeWidth={2} />
                        <Text style={styles.filaTitulo}>{motivoLegible(rep.motivo)}</Text>
                      </View>
                      <Text style={styles.filaFecha}>{fechaCorta(rep.created_at)}</Text>
                      {rep.elemento ? (
                        <Text style={styles.filaTexto}>{String(rep.elemento)}</Text>
                      ) : null}
                    </View>
                  ))
                : null}
            </View>
          );
        })}
      </ScrollView>

      {dialogo}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  cabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  volver: { padding: 4 },
  titulo: { color: C.textPrimary, fontSize: 19, fontFamily: F.extraBold },
  subtitulo: { color: C.textSecondary, fontSize: 12, fontFamily: F.medium, marginTop: 1 },

  bannerWrap: { paddingHorizontal: 18, paddingTop: 12 },
  contenido: { padding: 18, gap: 22, paddingBottom: 48 },

  seccion: { gap: 10 },
  seccionCabecera: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seccionTitulo: { color: C.textPrimary, fontSize: 15, fontFamily: F.bold },
  seccionNota: { color: C.textDim, fontSize: 12, lineHeight: 17, fontFamily: F.medium },
  contador: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: alfa(C.green, 0.16),
    alignItems: 'center',
  },
  contadorTexto: { color: C.green, fontSize: 11, fontFamily: F.extraBold },

  vacio: { color: C.textDim, fontSize: 13, fontFamily: F.medium },

  aviso: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: R.row,
    backgroundColor: alfa(C.red, 0.08),
    borderWidth: 1,
    borderColor: alfa(C.red, 0.25),
  },
  avisoTexto: { color: C.textSecondary, fontSize: 12, flex: 1, fontFamily: F.medium },

  fila: {
    padding: 14,
    borderRadius: R.lg,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    gap: 6,
  },
  filaIcono: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  filaTitulo: { color: C.textPrimary, fontSize: 14, fontFamily: F.bold },
  filaFecha: { color: C.textDim, fontSize: 11, fontFamily: F.medium },
  filaTexto: { color: C.textSecondary, fontSize: 13, lineHeight: 18, fontFamily: F.medium },
  filaContexto: {
    color: C.textDim,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: F.medium,
    padding: 8,
    borderRadius: R.row,
    backgroundColor: alfa(C.tinta, 0.04),
  },

  nota: {
    color: C.textPrimary,
    fontSize: 13,
    fontFamily: F.medium,
    minHeight: 44,
    padding: 10,
    marginTop: 4,
    borderRadius: R.row,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
    textAlignVertical: 'top',
  },

  acciones: { flexDirection: 'row', gap: 8, marginTop: 6 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: R.row,
  },
  btnPrimario: { backgroundColor: C.green },
  btnPrimarioTexto: { color: '#0B0D0B', fontSize: 13, fontFamily: F.extraBold },
  btnSecundario: { borderWidth: 1, borderColor: C.border },
  btnSecundarioTexto: { color: C.textSecondary, fontSize: 13, fontFamily: F.bold },
  pressed: { opacity: 0.85 },
});
