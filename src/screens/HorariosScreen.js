import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Plus, AlertTriangle, Trash2 } from 'lucide-react-native';

import { reservas as C, reservasRadius as R, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, Sheet, NoticeCard, StickyFooter } from '../components/reservas/ui';
import {
  Skeleton, FieldLabel, TimeField, DayToggleGroup,
} from '../components/reservas/recintoUi';
import { horariosDeCancha, guardarHorario, eliminarHorario } from '../services/recinto';
import {
  DIAS_SEMANA, horasDelReloj, horariosDelDia, rangoLegible, choqueDeHorario, horaAMinutos,
} from '../utils/recintoPantallas';

const HORAS_APERTURA = horasDelReloj();
const HORAS_CIERRE = horasDelReloj({ incluirMedianoche: true });

/**
 * Horarios de atención de una cancha (artboards 1n y 1o).
 *
 * ES UNA PLANTILLA SEMANAL, NO UN CALENDARIO. Lo que se carga acá se repite
 * todas las semanas; cerrar un día puntual es un bloqueo y vive en otra
 * pantalla. Confundir las dos cosas es el error más fácil de cometer, así que
 * la pantalla lo dice arriba y enlaza a la otra.
 *
 * SE MARCAN VARIOS DÍAS A LA VEZ. Un recinto que abre igual de lunes a
 * viernes no tiene por qué cargar cinco veces lo mismo: se marcan los cinco y
 * la regla se crea en todos. Cada día es una fila propia en la base — así el
 * día que uno cambie, se edita solo ese.
 *
 * EL CHOQUE SE AVISA ANTES. `admin_upsert_horario_regla` rechaza reglas que
 * se cruzan el mismo día, porque dos reglas superpuestas hacen que el
 * calendario emita el mismo bloque dos veces. Acá se comprueba antes de
 * enviar para poder ofrecer la salida —empezar donde termina la otra— en vez
 * de mostrar un error y dejar a la persona adivinando. Pegados sí valen:
 * 14:00–16:00 después de 10:00–14:00 está bien.
 */
export default function HorariosScreen({ navigation, route }) {
  const { canchaId, canchaNombre } = route.params || {};
  const [reglas, setReglas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [hoja, setHoja] = useState(false);
  const [editando, setEditando] = useState(null); // la regla que se está editando, o null
  const [dias, setDias] = useState([]);
  const [apertura, setApertura] = useState('09:00');
  const [cierre, setCierre] = useState('23:00');
  const [enviando, setEnviando] = useState(false);
  const [errorHoja, setErrorHoja] = useState(null);

  const cargar = useCallback(async () => {
    const { data, error: err } = await horariosDeCancha(canchaId);
    setReglas(data || []);
    setError(err?.message || null);
    setCargando(false);
  }, [canchaId]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const abrirNuevo = (dia) => {
    setEditando(null);
    setDias(dia === undefined ? [] : [dia]);
    setApertura('09:00');
    setCierre('23:00');
    setErrorHoja(null);
    setHoja(true);
  };

  const abrirEdicion = (regla) => {
    setEditando(regla);
    setDias([regla.dia_semana]);
    setApertura(String(regla.hora_apertura).slice(0, 5));
    setCierre(String(regla.hora_cierre).slice(0, 5));
    setErrorHoja(null);
    setHoja(true);
  };

  const borrar = async (reglaId) => {
    const { error: err } = await eliminarHorario(reglaId);
    if (err) { setError(err.message); return; }
    cargar();
  };

  // El choque se busca en TODOS los días marcados: con cinco días marcados,
  // basta que uno choque para que el servidor rechace ese uno.
  const choques = useMemo(
    () => dias
      .map((d) => ({ dia: d, regla: choqueDeHorario(reglas, d, apertura, cierre, editando?.id || null) }))
      .filter((c) => c.regla),
    [dias, reglas, apertura, cierre, editando],
  );

  const rangoOk = horaAMinutos(cierre) > horaAMinutos(apertura);
  const puedeGuardar = dias.length > 0 && rangoOk && choques.length === 0 && !enviando;

  const guardar = async () => {
    setEnviando(true);
    setErrorHoja(null);
    // Un upsert por día marcado. Si uno falla, se corta y se muestra su
    // mensaje: los que ya pasaron quedan guardados, y la lista al recargar
    // muestra exactamente lo que hay.
    for (const dia of dias) {
      const { error: err } = await guardarHorario(canchaId, {
        diaSemana: dia,
        horaApertura: apertura,
        horaCierre: cierre,
        reglaId: editando?.id || null,
      });
      if (err) {
        setEnviando(false);
        setErrorHoja(err.message);
        cargar();
        return;
      }
    }
    setEnviando(false);
    setHoja(false);
    cargar();
  };

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Horarios</Text>
          {canchaNombre ? <Text style={styles.headerSub} numberOfLines={1}>{canchaNombre}</Text> : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={cargar} tintColor={C.green} />}
      >
        {cargando ? (
          <View style={{ gap: 9 }}>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} height={52} radius={18} />)}
          </View>
        ) : error ? (
          <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard>
        ) : (
          <View style={{ gap: 14 }}>
            <NoticeCard tone="info">
              Esto se repite todas las semanas. Para cerrar un día puntual, ocupa esa hora desde el
              calendario en vez de cambiar el horario.
            </NoticeCard>

            <View style={{ gap: 9 }}>
              {DIAS_SEMANA.map((d) => {
                const delDia = horariosDelDia(reglas, d.dia);
                return (
                  <Card key={d.dia} style={delDia.length === 0 && styles.diaVacio}>
                    <View style={styles.diaCabecera}>
                      <Text style={styles.diaNombre}>{d.corto}</Text>
                      <Pressable
                        onPress={() => abrirNuevo(d.dia)}
                        accessibilityRole="button"
                        accessibilityLabel={`Agregar horario el ${d.largo}`}
                        style={({ pressed }) => [styles.agregarDia, pressed && { opacity: 0.85 }]}
                      >
                        <Plus color={C.green} size={13} strokeWidth={2.6} />
                        <Text style={styles.agregarDiaTexto}>Agregar</Text>
                      </Pressable>
                    </View>

                    {delDia.length === 0 ? (
                      <Text style={styles.cerrado}>Cerrado — sin horario</Text>
                    ) : (
                      <View style={{ gap: 7, marginTop: 9 }}>
                        {delDia.map((r) => (
                          <View key={r.id} style={styles.rangoFila}>
                            <Pressable
                              onPress={() => abrirEdicion(r)}
                              accessibilityRole="button"
                              accessibilityLabel={`Editar ${d.largo} ${r.hora_apertura} a ${r.hora_cierre}`}
                              style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.8 }]}
                            >
                              <Text style={styles.rango}>
                                {rangoLegible(r.hora_apertura, r.hora_cierre)}
                              </Text>
                            </Pressable>
                            <Pressable
                              onPress={() => borrar(r.id)}
                              accessibilityRole="button"
                              accessibilityLabel={`Quitar ${d.largo} ${r.hora_apertura} a ${r.hora_cierre}`}
                              style={({ pressed }) => [styles.borrar, pressed && { opacity: 0.8 }]}
                            >
                              <Trash2 color={C.textSecondary} size={15} strokeWidth={2.2} />
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    )}
                  </Card>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>

      {!cargando && !error ? (
        <StickyFooter>
          <Button label="Agregar horario" icon={Plus} onPress={() => abrirNuevo()} />
        </StickyFooter>
      ) : null}

      <Sheet
        visible={hoja}
        onClose={() => setHoja(false)}
        title={editando ? 'Editar horario' : 'Nuevo horario'}
      >
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
          <View style={{ gap: 15, paddingBottom: 6 }}>
            <View>
              <FieldLabel>Días</FieldLabel>
              <DayToggleGroup
                dias={DIAS_SEMANA}
                seleccionados={dias}
                onToggle={(d) => {
                  if (editando) { setDias([d]); return; } // editar toca una sola regla
                  setDias((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
                }}
              />
              <Text style={styles.ayuda}>
                {editando
                  ? 'Al editar se cambia solo esta regla. Para agregar el mismo horario a otros días, ciérralo y usa Agregar horario.'
                  : 'Marca varios días y el mismo horario se crea en todos.'}
              </Text>
            </View>

            <View style={styles.horasFila}>
              <View style={{ flex: 1 }}>
                <FieldLabel>Abre</FieldLabel>
                <TimeField valor={apertura} opciones={HORAS_APERTURA} onChange={setApertura} titulo="Hora de apertura" />
              </View>
              <View style={{ flex: 1 }}>
                <FieldLabel>Cierra</FieldLabel>
                <TimeField valor={cierre} opciones={HORAS_CIERRE} onChange={setCierre} titulo="Hora de cierre" />
              </View>
            </View>

            {!rangoOk ? (
              <NoticeCard tone="warning" icon={AlertTriangle}>
                La hora de cierre tiene que ser posterior a la de apertura. Para cerrar a medianoche,
                elige 24:00.
              </NoticeCard>
            ) : null}

            {choques.map(({ dia, regla }) => {
              const nombreDia = DIAS_SEMANA.find((d) => d.dia === dia);
              return (
                <Card key={dia} style={styles.choque}>
                  <Text style={styles.choqueTitulo}>
                    El {nombreDia?.largo} ya tiene un horario que se cruza
                  </Text>
                  <Text style={styles.choqueTexto}>
                    Ya existe {nombreDia?.largo} {rangoLegible(regla.hora_apertura, regla.hora_cierre)}.
                    Empieza donde ese termina, o edita el que ya está.
                  </Text>
                  <View style={{ gap: 8, marginTop: 12 }}>
                    <Button
                      label={`Empezar a las ${String(regla.hora_cierre).slice(0, 5)}`}
                      variant="secondary"
                      onPress={() => setApertura(String(regla.hora_cierre).slice(0, 5))}
                    />
                    <Button
                      label="Editar el que ya está"
                      variant="secondary"
                      onPress={() => abrirEdicion(regla)}
                    />
                  </View>
                </Card>
              );
            })}

            {choques.length === 0 && rangoOk && dias.length > 1 ? (
              <Text style={styles.ayuda}>
                Se van a crear {dias.length} horarios, uno por día marcado.
              </Text>
            ) : null}

            {errorHoja ? <NoticeCard tone="warning" icon={AlertTriangle}>{errorHoja}</NoticeCard> : null}

            <Button
              label={editando ? 'Guardar horario' : 'Crear horario'}
              disabled={!puedeGuardar}
              loading={enviando}
              onPress={guardar}
            />
          </View>
        </ScrollView>
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: S.screenPadding,
    paddingTop: 6,
    paddingBottom: 12,
  },
  headerTitle: { fontFamily: F.extraBold, fontSize: 20, color: C.textPrimary },
  headerSub: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { paddingHorizontal: S.screenPadding, paddingBottom: 110 },

  diaVacio: { borderStyle: 'dashed', borderColor: C.dashedBorder },
  diaCabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  diaNombre: { fontFamily: F.extraBold, fontSize: 14.5, color: C.textPrimary },
  agregarDia: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  agregarDiaTexto: { fontFamily: F.bold, fontSize: 12.5, color: C.green },
  cerrado: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, marginTop: 8 },

  rangoFila: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: R.row, backgroundColor: C.surfaceAlt,
    borderWidth: 1, borderColor: C.border,
  },
  rango: { fontFamily: F.bold, fontSize: 14, color: C.textPrimary },
  borrar: { padding: 4 },

  horasFila: { flexDirection: 'row', gap: 12 },
  ayuda: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16.5, marginTop: 9 },

  choque: { borderColor: C.amberBorder, backgroundColor: C.amberSoft },
  choqueTitulo: { fontFamily: F.extraBold, fontSize: 14, color: C.textAmber },
  choqueTexto: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, lineHeight: 18, marginTop: 7 },
});
