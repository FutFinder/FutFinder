import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Plus, AlertTriangle, Trash2 } from 'lucide-react-native';

import { reservas as C, reservasRadius as R, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, Sheet, Badge, NoticeCard, StickyFooter } from '../components/reservas/ui';
import {
  Skeleton, FieldLabel, TextField, TimeField, ChoiceCard, DayToggleGroup,
} from '../components/reservas/recintoUi';
import {
  canchasDelRecinto, tarifasDeCancha, horariosDeCancha,
  guardarTarifa, eliminarTarifa, comisionDe,
} from '../services/recinto';
import {
  DIAS_SEMANA, horasDelReloj, rangoLegible, choqueDeTarifa, horaAMinutos,
  bloquesDeTarifa, preciosDelDia, tramosDelDia, horariosDelDia,
} from '../utils/recintoPantallas';
import { formatCLP } from '../services/reservasRules';

const HORAS = horasDelReloj();
const HORAS_FIN = horasDelReloj({ incluirMedianoche: true });

/**
 * Tarifas por franja horaria de una cancha (artboards 4a, 4b, 4c y 4d).
 *
 * DOS REGLAS QUE LA PANTALLA TIENE QUE HACER EVIDENTES, porque las dos
 * confunden la primera vez y las dos vienen del servidor:
 *
 * 1. EL RANGO ES SEMIABIERTO. Una tarifa de 11:00 a 16:00 cubre los bloques
 *    que EMPIEZAN a las 11, 12, 13, 14 y 15. El de las 16:00 ya pertenece a
 *    la siguiente. No se explica con un texto: se muestran los bloques que
 *    quedan dentro mientras se carga, y el del borde aparte.
 *
 * 2. UNA TARIFA DE UN DÍA NO CHOCA CON LA DE TODOS LOS DÍAS: la pisa. Por eso
 *    el alcance se pregunta ANTES que las horas — con esa respuesta la
 *    pantalla sabe contra qué validar, y el cruce deja de ser una sorpresa.
 *
 * LA COMISIÓN SE MUESTRA AL CARGAR LA TARIFA, y dice «desde». El número exacto
 * depende del total de la reserva (cancha + adicionales), así que un número
 * seco se leería como promesa. Se pide a `calcular_comision()` en el servidor
 * en vez de replicar la fórmula: el día que la tasa cambie, esto cambia solo.
 */
export default function TarifasScreen({ navigation, route }) {
  const { complejoId, canchaId } = route.params || {};
  const [cancha, setCancha] = useState(null);
  const [tarifas, setTarifas] = useState([]);
  const [horarios, setHorarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [hoja, setHoja] = useState(false);
  const [editando, setEditando] = useState(null);
  const [alcance, setAlcance] = useState('todos'); // 'todos' | 'dia'
  const [dia, setDia] = useState(6);
  const [desde, setDesde] = useState('11:00');
  const [hasta, setHasta] = useState('16:00');
  const [precio, setPrecio] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorHoja, setErrorHoja] = useState(null);

  const cargar = useCallback(async () => {
    const [lista, tar, hor] = await Promise.all([
      canchasDelRecinto(complejoId),
      tarifasDeCancha(canchaId),
      horariosDeCancha(canchaId),
    ]);
    setCancha((lista.data || []).find((k) => k.id === canchaId) || null);
    setTarifas(tar.data || []);
    setHorarios(hor.data || []);
    setError(lista.error?.message || tar.error?.message || hor.error?.message || null);
    setCargando(false);
  }, [complejoId, canchaId]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  // El día que se usa de referencia para la barra: lunes si tiene horario, y
  // si no, el primer día que lo tenga. Sin horario no hay bloques que mostrar.
  const diaReferencia = useMemo(() => {
    const conHorario = DIAS_SEMANA.find((d) => horariosDelDia(horarios, d.dia).length > 0);
    return conHorario?.dia ?? null;
  }, [horarios]);

  const reglaDelDia = diaReferencia === null ? null : horariosDelDia(horarios, diaReferencia)[0];

  const bloquesDelDia = useMemo(() => {
    if (!reglaDelDia || !cancha) return [];
    return preciosDelDia({
      tarifas,
      diaSemana: diaReferencia,
      horaApertura: reglaDelDia.hora_apertura,
      horaCierre: reglaDelDia.hora_cierre,
      duracionSlotMin: cancha.duracion_slot_min,
      precioBase: cancha.precio_hora,
    });
  }, [tarifas, diaReferencia, reglaDelDia, cancha]);

  const tramos = useMemo(() => tramosDelDia(bloquesDelDia), [bloquesDelDia]);

  const abrirNueva = () => {
    setEditando(null);
    setAlcance('todos');
    setDia(6);
    setDesde(reglaDelDia ? String(reglaDelDia.hora_apertura).slice(0, 5) : '11:00');
    setHasta('16:00');
    setPrecio('');
    setErrorHoja(null);
    setHoja(true);
  };

  const abrirEdicion = (t) => {
    setEditando(t);
    setAlcance(t.dia_semana === null || t.dia_semana === undefined ? 'todos' : 'dia');
    setDia(t.dia_semana ?? 6);
    setDesde(String(t.hora_desde).slice(0, 5));
    setHasta(String(t.hora_hasta).slice(0, 5));
    setPrecio(String(t.precio ?? ''));
    setErrorHoja(null);
    setHoja(true);
  };

  const borrar = async (tarifaId) => {
    const { error: err } = await eliminarTarifa(tarifaId);
    if (err) { setError(err.message); return; }
    cargar();
  };

  const diaSemanaElegido = alcance === 'todos' ? null : dia;
  const precioNumero = Number(String(precio).replace(/\D/g, ''));
  const precioOk = String(precio).trim() !== '' && Number.isFinite(precioNumero) && precioNumero >= 0;
  const rangoOk = horaAMinutos(hasta) > horaAMinutos(desde);
  const choque = choqueDeTarifa(tarifas, diaSemanaElegido, desde, hasta, editando?.id || null);
  const puedeGuardar = precioOk && rangoOk && !choque && !enviando;

  const guardar = async () => {
    setEnviando(true);
    setErrorHoja(null);
    const { error: err } = await guardarTarifa(canchaId, {
      horaDesde: desde,
      horaHasta: hasta,
      precio: precioNumero,
      diaSemana: diaSemanaElegido,
      tarifaId: editando?.id || null,
    });
    setEnviando(false);
    if (err) { setErrorHoja(err.message); return; }
    setHoja(false);
    cargar();
  };

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Tarifas</Text>
          {cancha ? (
            <Text style={styles.headerSub} numberOfLines={1}>
              {cancha.nombre} · bloques de {cancha.duracion_slot_min} min
            </Text>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={cargar} tintColor={C.green} />}
      >
        {cargando ? (
          <View style={{ gap: S.cardGap }}>
            <Card><Skeleton height={40} /></Card>
            {[0, 1].map((i) => <Card key={i}><Skeleton height={16} width="55%" /><Skeleton height={12} width="70%" style={{ marginTop: 9 }} /></Card>)}
          </View>
        ) : error ? (
          <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard>
        ) : (
          <View style={{ gap: 16 }}>
            {bloquesDelDia.length > 0 ? (
              <Card>
                <Text style={styles.seccion}>Cómo queda el día</Text>
                <BarraDelDia bloques={bloquesDelDia} tramos={tramos} regla={reglaDelDia} />
              </Card>
            ) : null}

            {tarifas.length === 0 ? (
              <Vacio cancha={cancha} regla={reglaDelDia} />
            ) : (
              <View style={{ gap: S.cardGap }}>
                {tarifas.map((t) => (
                  <FilaTarifa
                    key={t.id}
                    tarifa={t}
                    cancha={cancha}
                    regla={reglaDelDia}
                    onPress={() => abrirEdicion(t)}
                    onBorrar={() => borrar(t.id)}
                  />
                ))}
              </View>
            )}

            {cancha ? (
              <Card>
                <Text style={styles.baseTitulo}>Precio base {formatCLP(cancha.precio_hora)}</Text>
                <Text style={styles.baseTexto}>
                  Se usa en las horas que ninguna tarifa cubre. Por eso una cancha sin tarifas no se
                  rompe: se sigue arrendando a este precio.
                </Text>
              </Card>
            ) : null}
          </View>
        )}
      </ScrollView>

      {!cargando && !error ? (
        <StickyFooter>
          <Button
            label={tarifas.length === 0 ? 'Crear mi primera tarifa' : 'Agregar tarifa'}
            icon={Plus}
            onPress={abrirNueva}
          />
        </StickyFooter>
      ) : null}

      <Sheet visible={hoja} onClose={() => setHoja(false)} title={editando ? 'Editar tarifa' : 'Nueva tarifa'}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          <View style={{ gap: 15, paddingBottom: 6 }}>
            <View style={{ gap: 10 }}>
              <Text style={styles.seccion}>¿A qué días?</Text>
              <ChoiceCard
                titulo="Todos los días"
                descripcion="Una sola tarifa para la semana completa."
                seleccionado={alcance === 'todos'}
                onPress={() => setAlcance('todos')}
              />
              <ChoiceCard
                titulo="Un día en particular"
                descripcion="Manda sobre la de todos los días. Así se cobra distinto el sábado sin cargar siete tarifas."
                seleccionado={alcance === 'dia'}
                onPress={() => setAlcance('dia')}
              />
              {alcance === 'dia' ? (
                <DayToggleGroup dias={DIAS_SEMANA} seleccionados={[dia]} onToggle={setDia} />
              ) : null}
            </View>

            <View style={styles.horasFila}>
              <View style={{ flex: 1 }}>
                <FieldLabel>Desde</FieldLabel>
                <TimeField valor={desde} opciones={HORAS} onChange={setDesde} titulo="Desde qué hora" />
              </View>
              <View style={{ flex: 1 }}>
                <FieldLabel>Hasta</FieldLabel>
                <TimeField valor={hasta} opciones={HORAS_FIN} onChange={setHasta} titulo="Hasta qué hora" />
              </View>
            </View>

            <View>
              <FieldLabel>Precio por hora</FieldLabel>
              <TextField
                value={precio}
                onChangeText={(t) => setPrecio(t.replace(/\D/g, ''))}
                placeholder="14000"
                keyboardType="number-pad"
                maxLength={7}
              />
            </View>

            {!rangoOk ? (
              <NoticeCard tone="warning" icon={AlertTriangle}>
                La hora de término tiene que ser posterior a la de inicio.
              </NoticeCard>
            ) : null}

            {choque ? (
              <Card style={styles.choque}>
                <Text style={styles.choqueTitulo}>Ya hay una tarifa que se cruza con ese horario</Text>
                <Text style={styles.choqueTexto}>
                  {choque.dia_semana === null || choque.dia_semana === undefined
                    ? 'Todos los días'
                    : DIAS_SEMANA.find((d) => d.dia === choque.dia_semana)?.largo}
                  {' · '}{rangoLegible(choque.hora_desde, choque.hora_hasta)} a {formatCLP(choque.precio)}.
                </Text>
                <View style={{ gap: 8, marginTop: 12 }}>
                  <Button
                    label={`Empezar a las ${String(choque.hora_hasta).slice(0, 5)}`}
                    variant="secondary"
                    onPress={() => setDesde(String(choque.hora_hasta).slice(0, 5))}
                  />
                  <Button label="Editar la que ya está" variant="secondary" onPress={() => abrirEdicion(choque)} />
                </View>
              </Card>
            ) : null}

            {rangoOk && !choque && cancha ? (
              <VistaPrevia
                desde={desde}
                hasta={hasta}
                precio={precioOk ? precioNumero : null}
                cancha={cancha}
                regla={reglaDelDia}
              />
            ) : null}

            {errorHoja ? <NoticeCard tone="warning" icon={AlertTriangle}>{errorHoja}</NoticeCard> : null}

            <Button
              label={editando ? 'Guardar tarifa' : 'Crear tarifa'}
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

/* ── La barra proporcional del día (artboard 4a) ────────────────────────── */

function BarraDelDia({ bloques, tramos, regla }) {
  const total = bloques.length || 1;
  return (
    <View>
      <View style={styles.barra}>
        {tramos.map((t, i) => (
          <View
            key={t.precio}
            style={[
              styles.barraTramo,
              {
                flex: t.bloques / total,
                backgroundColor: i === 0 ? C.shieldBg : C.green,
                borderTopLeftRadius: i === 0 ? 8 : 0,
                borderBottomLeftRadius: i === 0 ? 8 : 0,
                borderTopRightRadius: i === tramos.length - 1 ? 8 : 0,
                borderBottomRightRadius: i === tramos.length - 1 ? 8 : 0,
              },
            ]}
          >
            <Text style={[styles.barraPrecio, i > 0 && { color: C.textOnGreen }]} numberOfLines={1}>
              {formatCLP(t.precio)}
            </Text>
          </View>
        ))}
      </View>
      {regla ? (
        <Text style={styles.barraPie}>
          {String(regla.hora_apertura).slice(0, 5)} a {String(regla.hora_cierre).slice(0, 5)} ·{' '}
          {tramos.map((t) => `${t.bloques} ${t.bloques === 1 ? 'bloque' : 'bloques'} a ${formatCLP(t.precio)}`).join(' y ')}.
        </Text>
      ) : null}
    </View>
  );
}

/* ── Una tarifa de la lista ─────────────────────────────────────────────── */

function FilaTarifa({ tarifa, cancha, regla, onPress, onBorrar }) {
  const [comision, setComision] = useState(null);
  const esDeUnDia = tarifa.dia_semana !== null && tarifa.dia_semana !== undefined;

  useEffect(() => {
    let vivo = true;
    comisionDe(tarifa.precio).then(({ data }) => { if (vivo) setComision(data); });
    return () => { vivo = false; };
  }, [tarifa.precio]);

  const { dentro } = bloquesDeTarifa({
    horaDesde: tarifa.hora_desde,
    horaHasta: tarifa.hora_hasta,
    horaApertura: regla?.hora_apertura,
    horaCierre: regla?.hora_cierre,
    duracionSlotMin: cancha?.duracion_slot_min,
  });

  return (
    <Card onPress={onPress}>
      <View style={styles.tarifaCabecera}>
        <View style={{ flex: 1 }}>
          <View style={styles.tarifaTituloFila}>
            <Text style={styles.tarifaRango}>{rangoLegible(tarifa.hora_desde, tarifa.hora_hasta)}</Text>
            {esDeUnDia ? (
              <Badge label={DIAS_SEMANA.find((d) => d.dia === tarifa.dia_semana)?.corto || ''} tone="green" />
            ) : (
              <Badge label="Todos los días" tone="neutral" />
            )}
          </View>
          {dentro.length > 0 ? (
            <Text style={styles.tarifaBloques} numberOfLines={2}>
              Bloques que empiezan {dentro.map((h) => h.slice(0, 5)).join(', ')}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.tarifaPrecio}>{formatCLP(tarifa.precio)}</Text>
          {comision !== null ? (
            <Text style={styles.tarifaComision}>Comisión desde {formatCLP(comision)}</Text>
          ) : null}
        </View>
        <Pressable
          onPress={onBorrar}
          accessibilityRole="button"
          accessibilityLabel={`Quitar la tarifa de ${tarifa.hora_desde} a ${tarifa.hora_hasta}`}
          style={({ pressed }) => [{ padding: 4 }, pressed && { opacity: 0.8 }]}
        >
          <Trash2 color={C.textSecondary} size={15} strokeWidth={2.2} />
        </Pressable>
      </View>
      {esDeUnDia ? (
        <Text style={styles.tarifaManda}>Manda sobre la de todos los días.</Text>
      ) : null}
    </Card>
  );
}

/* ── Vista previa al cargar una tarifa (artboard 4c) ────────────────────── */

function VistaPrevia({ desde, hasta, precio, cancha, regla }) {
  const [comision, setComision] = useState(null);

  useEffect(() => {
    if (!precio) { setComision(null); return undefined; }
    let vivo = true;
    // Se pide al servidor, no se calcula acá: la migración 62 pide
    // explícitamente que el cliente no replique la fórmula.
    const t = setTimeout(() => {
      comisionDe(precio).then(({ data }) => { if (vivo) setComision(data); });
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
  }, [precio]);

  const { dentro, elDelBorde } = bloquesDeTarifa({
    horaDesde: desde,
    horaHasta: hasta,
    horaApertura: regla?.hora_apertura,
    horaCierre: regla?.hora_cierre,
    duracionSlotMin: cancha?.duracion_slot_min,
  });

  if (!regla) {
    return (
      <NoticeCard tone="warning" icon={AlertTriangle}>
        Esta cancha todavía no tiene horario de atención, así que no se puede mostrar qué bloques
        quedan dentro. La tarifa se puede crear igual.
      </NoticeCard>
    );
  }

  return (
    <Card>
      <Text style={styles.previaTitulo}>
        {precio ? `Quedan a ${formatCLP(precio)}` : 'Bloques que quedan dentro'} · {dentro.length}{' '}
        {dentro.length === 1 ? 'bloque' : 'bloques'}
      </Text>
      <View style={styles.chips}>
        {dentro.map((h) => (
          <View key={h} style={styles.chipDentro}>
            <Text style={styles.chipDentroTexto}>{h}</Text>
          </View>
        ))}
        {dentro.length === 0 ? (
          <Text style={styles.previaVacio}>Ningún bloque cae en este rango.</Text>
        ) : null}
      </View>

      {elDelBorde ? (
        <View style={styles.borde}>
          <View style={styles.chipBorde}>
            <Text style={styles.chipBordeTexto}>{elDelBorde}</Text>
          </View>
          <Text style={styles.bordeTexto}>
            El bloque de las {elDelBorde} queda afuera: empieza justo en el borde, así que entra en
            la tarifa siguiente.
          </Text>
        </View>
      ) : null}

      {precio && comision !== null ? (
        <View style={styles.comisionCaja}>
          <View style={styles.comisionFila}>
            <Text style={styles.comisionEtiqueta}>Cobras por la hora</Text>
            <Text style={styles.comisionMonto}>{formatCLP(precio)}</Text>
          </View>
          <View style={styles.comisionFila}>
            <Text style={styles.comisionEtiqueta}>Comisión FutFinder</Text>
            <Text style={[styles.comisionMonto, { color: C.textAmber }]}>−{formatCLP(comision)}</Text>
          </View>
          <View style={[styles.comisionFila, styles.comisionTotal]}>
            <Text style={styles.comisionEtiquetaFuerte}>Recibes</Text>
            <Text style={[styles.comisionMontoFuerte, { color: C.green }]}>{formatCLP(precio - comision)}</Text>
          </View>
          <Text style={styles.comisionNota}>
            Decimos «desde» porque la comisión se calcula sobre el total de la reserva: si el grupo
            además toma un adicional, sube. Es una sola por reserva.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

/* ── Vacío (artboard 4b) ────────────────────────────────────────────────── */

function Vacio({ cancha, regla }) {
  return (
    <Card>
      <Text style={styles.vacioTitulo}>
        {cancha ? `${formatCLP(cancha.precio_hora)} todo el día` : 'Precio único'}
      </Text>
      <Text style={styles.vacioSub}>
        Precio base{regla ? `, de ${String(regla.hora_apertura).slice(0, 5)} a ${String(regla.hora_cierre).slice(0, 5)}` : ''}.
      </Text>
      <Text style={styles.vacioTexto}>
        Un martes a las 13:00 no vale lo mismo que un viernes a las 21:00. Baja el precio de las
        horas muertas y llénalas: es plata que hoy no entra.
      </Text>
      <Text style={styles.vacioPie}>
        Sin tarifas, la cancha se sigue arrendando a su precio base. No se rompe nada.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: S.screenPadding, paddingTop: 6, paddingBottom: 12,
  },
  headerTitle: { fontFamily: F.extraBold, fontSize: 20, color: C.textPrimary },
  headerSub: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { paddingHorizontal: S.screenPadding, paddingBottom: 110 },

  seccion: { fontFamily: F.extraBold, fontSize: 15, color: C.textPrimary, marginBottom: 12 },

  barra: { flexDirection: 'row', height: 38, gap: 2 },
  barraTramo: { justifyContent: 'center', paddingHorizontal: 9 },
  barraPrecio: { fontFamily: F.extraBold, fontSize: 12, color: C.green },
  barraPie: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16.5, marginTop: 10 },

  tarifaCabecera: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  tarifaTituloFila: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  tarifaRango: { fontFamily: F.extraBold, fontSize: 15, color: C.textPrimary },
  tarifaBloques: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16, marginTop: 5 },
  tarifaPrecio: { fontFamily: F.extraBold, fontSize: 15, color: C.textPrimary },
  tarifaComision: { fontFamily: F.medium, fontSize: 10.5, color: C.textSecondary, marginTop: 3 },
  tarifaManda: {
    fontFamily: F.medium, fontSize: 11, color: C.textAmber,
    marginTop: 10, paddingTop: 9, borderTopWidth: 1, borderTopColor: C.dividerInner,
  },

  baseTitulo: { fontFamily: F.bold, fontSize: 14.5, color: C.textPrimary },
  baseTexto: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, lineHeight: 17, marginTop: 6 },

  horasFila: { flexDirection: 'row', gap: 12 },

  choque: { borderColor: C.amberBorder, backgroundColor: C.amberSoft },
  choqueTitulo: { fontFamily: F.extraBold, fontSize: 14, color: C.textAmber },
  choqueTexto: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, lineHeight: 18, marginTop: 7 },

  previaTitulo: { fontFamily: F.extraBold, fontSize: 14, color: C.textPrimary, marginBottom: 10 },
  previaVacio: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipDentro: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: R.chip,
    backgroundColor: C.shieldBg, borderWidth: 1, borderColor: C.greenDeepBorder,
  },
  chipDentroTexto: { fontFamily: F.bold, fontSize: 12, color: C.green },
  borde: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 13 },
  chipBorde: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: R.chip,
    borderWidth: 1, borderColor: C.dashedBorderStrong, borderStyle: 'dashed',
  },
  chipBordeTexto: { fontFamily: F.bold, fontSize: 12, color: C.textSecondary },
  bordeTexto: { flex: 1, fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16 },

  comisionCaja: {
    marginTop: 14, paddingTop: 13,
    borderTopWidth: 1, borderTopColor: C.dividerInner, gap: 8,
  },
  comisionFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  comisionEtiqueta: { flex: 1, fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary },
  comisionMonto: { fontFamily: F.semiBold, fontSize: 13, color: C.textPrimary },
  comisionTotal: { borderTopWidth: 1, borderTopColor: C.dividerInner, paddingTop: 8 },
  comisionEtiquetaFuerte: { flex: 1, fontFamily: F.bold, fontSize: 13.5, color: C.textPrimary },
  comisionMontoFuerte: { fontFamily: F.extraBold, fontSize: 15 },
  comisionNota: { fontFamily: F.medium, fontSize: 11, color: C.textSecondary, lineHeight: 15.5, marginTop: 3 },

  vacioTitulo: { fontFamily: F.extraBold, fontSize: 18, color: C.textPrimary },
  vacioSub: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 4 },
  vacioTexto: { fontFamily: F.medium, fontSize: 13.5, color: C.textSecondary, lineHeight: 19, marginTop: 13 },
  vacioPie: { fontFamily: F.medium, fontSize: 11.5, color: C.textMuted, lineHeight: 16, marginTop: 12 },
});
