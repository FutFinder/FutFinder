import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Plus, AlertTriangle } from 'lucide-react-native';

import { reservas as C, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, Badge, Sheet, NoticeCard, StickyFooter } from '../components/reservas/ui';
import { Skeleton, FieldLabel, TextField, Switch } from '../components/reservas/recintoUi';
import {
  cobrosDelRecinto, crearCobro, actualizarCobro, canchasDelRecinto, comisionDe,
} from '../services/recinto';
import { formatCLP } from '../services/reservasRules';

/** El servidor rechaza el noveno activo; la pantalla lo dice antes. */
const TOPE_ACTIVOS = 8;

const EJEMPLOS = [
  { nombre: 'Arriendo de balón', precio: 3000 },
  { nombre: 'Árbitro', precio: 12000 },
  { nombre: 'Camarines con toalla', precio: 6000 },
];

/**
 * Cobros adicionales del recinto (artboards 3e, 3f, 3g y 3h).
 *
 * SON SIEMPRE OPCIONALES. No hay ningún camino en el código para marcarlos
 * obligatorios, ni en la pantalla ni en el servidor, y no debería haberlo: el
 * jugador elige si los quiere y una reserva se puede completar sin ninguno.
 *
 * SON DEL PARTIDO COMPLETO, no por persona. Se descartó la unidad «por
 * jugador» porque obligaría a cuentas separadas dentro de un pago único: o
 * los toma el grupo, o nadie.
 *
 * APAGAR NO ES BORRAR, y es la distinción que esta pantalla tiene que dejar
 * clara. Un cobro apagado deja de ofrecerse en reservas nuevas, pero las
 * reservas que ya lo incluyen lo siguen mostrando **con el precio que tenía
 * ese día**: `reserva_cobros` lo congela con nombre y precio (migración 68).
 * Por eso tampoco existe un botón de borrar: borrarlo dejaría reservas
 * apuntando a algo que no está.
 *
 * LA COMISIÓN VA SOBRE EL TOTAL, cancha + adicionales. Es deliberado: si
 * fuera solo sobre la cancha, bastaría ponerla a $1.000 y un «balón» a
 * $27.000 para esquivarla.
 */
export default function CobrosScreen({ navigation, route }) {
  const { complejoId, nombre } = route.params || {};
  const [cobros, setCobros] = useState([]);
  const [precioCancha, setPrecioCancha] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [hoja, setHoja] = useState(false);
  const [editando, setEditando] = useState(null);
  const [nombreCobro, setNombreCobro] = useState('');
  const [precio, setPrecio] = useState('');
  const [activo, setActivo] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [errorHoja, setErrorHoja] = useState(null);

  const cargar = useCallback(async () => {
    const [lista, canchas] = await Promise.all([
      cobrosDelRecinto(complejoId),
      canchasDelRecinto(complejoId),
    ]);
    setCobros(lista.data || []);
    // Una cancha cualquiera sirve de ejemplo para el «así se va a ver».
    setPrecioCancha((canchas.data || []).find((k) => k.activa)?.precio_hora ?? null);
    setError(lista.error?.message || null);
    setCargando(false);
  }, [complejoId]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const activos = cobros.filter((c) => c.activo).length;
  const lleno = activos >= TOPE_ACTIVOS;

  const abrirNuevo = () => {
    setEditando(null);
    setNombreCobro('');
    setPrecio('');
    setActivo(true);
    setErrorHoja(null);
    setHoja(true);
  };

  const abrirEdicion = (c) => {
    setEditando(c);
    setNombreCobro(c.nombre || '');
    setPrecio(String(c.precio ?? ''));
    setActivo(!!c.activo);
    setErrorHoja(null);
    setHoja(true);
  };

  const precioNumero = Number(String(precio).replace(/\D/g, ''));
  const precioOk = String(precio).trim() !== '' && Number.isFinite(precioNumero) && precioNumero >= 0;
  const nombreOk = nombreCobro.trim().length > 0;
  // Encender uno apagado también cuenta contra el tope, igual que en el servidor.
  const encendiendo = editando ? activo && !editando.activo : true;
  const topeBloquea = encendiendo && lleno && !(editando && editando.activo);
  const puedeGuardar = nombreOk && precioOk && !topeBloquea && !enviando;

  const guardar = async () => {
    setEnviando(true);
    setErrorHoja(null);
    const { error: err } = editando
      ? await actualizarCobro(editando.id, { nombre: nombreCobro.trim(), precio: precioNumero, activo })
      : await crearCobro(complejoId, { nombre: nombreCobro.trim(), precio: precioNumero });
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
          <Text style={styles.headerTitle}>Cobros adicionales</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {cargando ? nombre || '' : `${activos} ${activos === 1 ? 'activo' : 'activos'} de ${TOPE_ACTIVOS}`}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={cargar} tintColor={C.green} />}
      >
        {cargando ? (
          <View style={{ gap: S.cardGap }}>
            {[0, 1, 2].map((i) => <Card key={i}><Skeleton height={16} width="50%" /><Skeleton height={12} width="35%" style={{ marginTop: 9 }} /></Card>)}
          </View>
        ) : error ? (
          <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard>
        ) : cobros.length === 0 ? (
          <Vacio />
        ) : (
          <View style={{ gap: 14 }}>
            <NoticeCard tone="info">
              El jugador elige si los quiere y nunca son obligatorios para reservar. Se cobran una vez
              por reserva: o los toma el grupo completo, o nadie. La comisión de FutFinder se calcula
              sobre cancha + adicionales.
            </NoticeCard>

            <View style={{ gap: S.cardGap }}>
              {cobros.map((c) => (
                <Card key={c.id} onPress={() => abrirEdicion(c)} style={!c.activo && styles.apagado}>
                  <View style={styles.fila}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.nombre} numberOfLines={1}>{c.nombre}</Text>
                      <Text style={styles.detalle}>{formatCLP(c.precio)} · por reserva</Text>
                    </View>
                    {c.activo ? null : <Badge label="Apagado" tone="neutral" />}
                  </View>
                </Card>
              ))}
            </View>

            <Text style={styles.pie}>
              Apagar uno no lo borra: deja de ofrecerse en reservas nuevas y las reservas que ya lo
              incluyen lo siguen mostrando, con el precio que tenía ese día.
            </Text>

            {lleno ? (
              <NoticeCard tone="warning" icon={AlertTriangle}>
                Llegaste al tope de {TOPE_ACTIVOS} activos. Con más, la pantalla del jugador se vuelve
                un catálogo y baja la conversión de la reserva. Apaga uno para encender otro.
              </NoticeCard>
            ) : null}
          </View>
        )}
      </ScrollView>

      {!cargando && !error ? (
        <StickyFooter>
          <Button
            label={cobros.length === 0 ? 'Agregar mi primer cobro' : 'Agregar cobro'}
            icon={Plus}
            disabled={lleno && cobros.length > 0}
            onPress={abrirNuevo}
          />
        </StickyFooter>
      ) : null}

      <Sheet visible={hoja} onClose={() => setHoja(false)} title={editando ? editando.nombre : 'Nuevo cobro'}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 470 }}>
          <View style={{ gap: 15, paddingBottom: 6 }}>
            {editando ? (
              <Card>
                <Switch
                  valor={activo}
                  onChange={setActivo}
                  etiqueta="Se ofrece al reservar"
                  descripcion={
                    activo
                      ? 'El jugador lo ve y puede tomarlo al reservar.'
                      : 'Apagado deja de aparecer en reservas nuevas. Las que ya lo tienen lo siguen mostrando y te lo pagamos igual.'
                  }
                />
              </Card>
            ) : null}

            <View>
              <FieldLabel>Nombre</FieldLabel>
              <TextField
                value={nombreCobro}
                onChangeText={setNombreCobro}
                placeholder="Árbitro"
                maxLength={60}
              />
              <Text style={styles.ayuda}>Como lo va a leer el jugador al reservar.</Text>
            </View>

            <View>
              <FieldLabel>Precio por reserva</FieldLabel>
              <TextField
                value={precio}
                onChangeText={(t) => setPrecio(t.replace(/\D/g, ''))}
                placeholder="12000"
                keyboardType="number-pad"
                maxLength={7}
              />
              <Text style={styles.ayuda}>
                Se cobra una vez por reserva, sin importar cuántos jueguen. No existen cobros que
                pague una persona por su cuenta.
                {editando ? ' Cambiar el precio no toca las reservas ya hechas.' : ''}
              </Text>
            </View>

            {precioOk && nombreOk ? (
              <AsiSeVeVa nombre={nombreCobro.trim()} precio={precioNumero} precioCancha={precioCancha} />
            ) : null}

            {topeBloquea ? (
              <NoticeCard tone="warning" icon={AlertTriangle}>
                Ya tienes {TOPE_ACTIVOS} cobros activos. Apaga uno antes de encender este.
              </NoticeCard>
            ) : null}

            {errorHoja ? <NoticeCard tone="warning" icon={AlertTriangle}>{errorHoja}</NoticeCard> : null}

            <Button
              label={editando ? 'Guardar cambios' : 'Crear cobro'}
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

/**
 * «Así se va a ver» (artboard 3g): el cobro junto a una cancha real, con la
 * comisión sobre el TOTAL para que se entienda que sube al agregar adicionales.
 */
function AsiSeVeVa({ nombre, precio, precioCancha }) {
  const [comision, setComision] = useState(null);
  const total = (precioCancha || 0) + precio;

  useEffect(() => {
    if (!precioCancha) { setComision(null); return undefined; }
    let vivo = true;
    const t = setTimeout(() => {
      comisionDe(total).then(({ data }) => { if (vivo) setComision(data); });
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
  }, [total, precioCancha]);

  return (
    <Card>
      <Text style={styles.previaTitulo}>Así se va a ver</Text>
      <View style={styles.previaFila}>
        <Text style={styles.previaNombre} numberOfLines={1}>{nombre}</Text>
        <Text style={styles.previaPrecio}>{formatCLP(precio)}</Text>
      </View>
      {precioCancha ? (
        <>
          <View style={[styles.previaFila, styles.previaTotal]}>
            <Text style={styles.previaNombreFuerte} numberOfLines={1}>
              Cancha {formatCLP(precioCancha)} + {nombre.toLowerCase()}
            </Text>
            <Text style={styles.previaPrecioFuerte}>{formatCLP(total)}</Text>
          </View>
          {comision !== null ? (
            <Text style={styles.previaNota}>
              La comisión de esa reserva sería {formatCLP(comision)}: se calcula sobre el total,
              cancha + adicionales, con piso $1.000 y techo $2.500. Es una sola por reserva.
            </Text>
          ) : null}
          <Text style={styles.previaNota}>
            Si el grupo divide el pago, esos {formatCLP(total)} se reparten entre quienes se unan y
            cada uno paga su parte con su balance FutFinder.
          </Text>
        </>
      ) : null}
    </Card>
  );
}

/** Artboard 3f: el vacío con ejemplos que no se crean solos. */
function Vacio() {
  return (
    <View style={{ gap: 16 }}>
      <Card>
        <Text style={styles.vacioTitulo}>Cobra por lo que ya prestas</Text>
        <Text style={styles.vacioTexto}>
          Si arriendas balones, prestas petos o pones árbitro, agrégalo acá y el jugador lo elige y lo
          paga junto con la cancha. Llega todo en el mismo depósito.
        </Text>
      </Card>

      <Card>
        <View style={{ gap: 11 }}>
          {EJEMPLOS.map((e) => (
            <View key={e.nombre} style={styles.ejemploFila}>
              <Text style={styles.ejemploNombre}>{e.nombre}</Text>
              <Text style={styles.ejemploPrecio}>{formatCLP(e.precio)} · por reserva</Text>
            </View>
          ))}
        </View>
        <Text style={styles.ejemploPie}>Ejemplos. Nada se crea hasta que tú lo agregues.</Text>
      </Card>
    </View>
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

  apagado: { opacity: 0.65 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nombre: { fontFamily: F.bold, fontSize: 15, color: C.textPrimary },
  detalle: { fontFamily: F.medium, fontSize: 12.5, color: C.textAmber, marginTop: 4 },
  pie: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16.5 },
  ayuda: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16.5, marginTop: 7 },

  previaTitulo: { fontFamily: F.extraBold, fontSize: 14, color: C.textPrimary, marginBottom: 11 },
  previaFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  previaNombre: { flex: 1, fontFamily: F.medium, fontSize: 13.5, color: C.textPrimary },
  previaPrecio: { fontFamily: F.semiBold, fontSize: 13.5, color: C.textAmber },
  previaTotal: { borderTopWidth: 1, borderTopColor: C.dividerInner, paddingTop: 9, marginTop: 9 },
  previaNombreFuerte: { flex: 1, fontFamily: F.bold, fontSize: 13.5, color: C.textPrimary },
  previaPrecioFuerte: { fontFamily: F.extraBold, fontSize: 15, color: C.textPrimary },
  previaNota: { fontFamily: F.medium, fontSize: 11, color: C.textSecondary, lineHeight: 15.5, marginTop: 10 },

  vacioTitulo: { fontFamily: F.extraBold, fontSize: 17, color: C.textPrimary },
  vacioTexto: { fontFamily: F.medium, fontSize: 13.5, color: C.textSecondary, lineHeight: 19, marginTop: 8 },
  ejemploFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  ejemploNombre: { flex: 1, fontFamily: F.bold, fontSize: 13.5, color: C.textSecondary },
  ejemploPrecio: { fontFamily: F.medium, fontSize: 12, color: C.textMuted },
  ejemploPie: {
    fontFamily: F.medium, fontSize: 11, color: C.textMuted,
    marginTop: 13, paddingTop: 11, borderTopWidth: 1, borderTopColor: C.dividerInner,
  },
});
