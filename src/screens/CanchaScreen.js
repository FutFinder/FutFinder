import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, AlertTriangle, Clock, CalendarClock, Tag, Lock } from 'lucide-react-native';

import { reservas as C, reservasRadius as R, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, ListRow, NoticeCard, StickyFooter } from '../components/reservas/ui';
import { Skeleton, FieldLabel, TextField, Switch } from '../components/reservas/recintoUi';
import { canchasDelRecinto, crearCancha, actualizarCancha } from '../services/recinto';
import { formatCLP } from '../services/reservasRules';

const TIPOS = [
  { valor: 'futbol_5', numero: '5', etiqueta: 'fútbol 5' },
  { valor: 'futbol_7', numero: '7', etiqueta: 'fútbol 7' },
  { valor: 'futbol_11', numero: '11', etiqueta: 'fútbol 11' },
];

const NOMBRE_TIPO = Object.fromEntries(TIPOS.map((t) => [t.valor, `Fútbol ${t.numero}`]));

// De a 30 minutos, que es como se parte el día en el calendario del jugador.
const DURACIONES = [30, 60, 90, 120];

/**
 * Crear y editar una cancha (artboards 1l y 1m). Una sola pantalla en dos
 * modos: sin `canchaId` crea, con `canchaId` edita.
 *
 * EL TIPO NO SE PUEDE CAMBIAR, y el servidor tampoco lo acepta:
 * `admin_actualizar_cancha` ni siquiera recibe `p_tipo`. Una cancha de fútbol
 * 7 no se convierte en fútbol 11 sin obra, y reescribir el tipo cambiaría
 * hacia atrás lo que dicen las reservas ya jugadas. Si la cancha cambió de
 * verdad, se crea otra y se desactiva esta.
 *
 * DESACTIVAR NO CANCELA NADA. Es lo que un dueño va a temer al apretar el
 * interruptor, así que se dice ahí mismo: deja de recibir reservas nuevas,
 * las confirmadas se respetan. Es la misma distinción que despublicar el
 * recinto, en chico.
 */
export default function CanchaScreen({ navigation, route }) {
  const { complejoId, canchaId, complejoNombre } = route.params || {};
  const esNueva = !canchaId;

  const [cancha, setCancha] = useState(null);
  const [cargando, setCargando] = useState(!esNueva);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState('futbol_7');
  const [precio, setPrecio] = useState('');
  const [duracion, setDuracion] = useState(60);
  const [activa, setActiva] = useState(true);

  const cargar = useCallback(async () => {
    if (esNueva) return;
    const { data, error: err } = await canchasDelRecinto(complejoId);
    const mia = (data || []).find((k) => k.id === canchaId) || null;
    setCancha(mia);
    setError(err?.message || null);
    if (mia) {
      setNombre(mia.nombre || '');
      setTipo(mia.tipo);
      setPrecio(String(mia.precio_hora ?? ''));
      setDuracion(mia.duracion_slot_min || 60);
      setActiva(!!mia.activa);
    }
    setCargando(false);
  }, [complejoId, canchaId, esNueva]);

  useEffect(() => { cargar(); }, [cargar]);

  const precioNumero = Number(String(precio).replace(/\D/g, ''));
  const nombreOk = nombre.trim().length > 0;
  const precioOk = Number.isFinite(precioNumero) && precioNumero >= 0 && String(precio).trim() !== '';
  const puedeGuardar = nombreOk && precioOk && !enviando;

  const guardar = async () => {
    setEnviando(true);
    setError(null);
    const { error: err } = esNueva
      ? await crearCancha(complejoId, {
          nombre: nombre.trim(),
          tipo,
          precioHora: precioNumero,
          duracionSlotMin: duracion,
        })
      : await actualizarCancha(canchaId, {
          nombre: nombre.trim(),
          precioHora: precioNumero,
          duracionSlotMin: duracion,
          activa,
        });
    setEnviando(false);
    if (err) { setError(err.message); return; }
    navigation.goBack();
  };

  if (cargando) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <Cabecera navigation={navigation} titulo="Cancha" />
        <View style={styles.scroll}>
          <Card><Skeleton height={18} width="60%" /><Skeleton height={12} width="40%" style={{ marginTop: 10 }} /></Card>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <Cabecera
        navigation={navigation}
        titulo={esNueva ? 'Nueva cancha' : cancha?.nombre || 'Cancha'}
        subtitulo={complejoNombre}
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={{ gap: 16 }}>
            {!esNueva ? (
              <Card>
                <Switch
                  valor={activa}
                  onChange={setActiva}
                  etiqueta="Cancha activa"
                  descripcion={
                    activa
                      ? 'Aparece en el buscador y recibe reservas.'
                      : 'Si la apagas deja de aparecer y no recibe reservas nuevas. Las que ya están confirmadas se respetan.'
                  }
                />
              </Card>
            ) : null}

            <Card>
              <FieldLabel>Nombre</FieldLabel>
              <TextField
                value={nombre}
                onChangeText={setNombre}
                placeholder="Ej: Cancha 3"
                maxLength={60}
              />
            </Card>

            <Card>
              <FieldLabel marca={esNueva ? undefined : 'no se puede cambiar'}>Tipo</FieldLabel>
              {esNueva ? (
                <>
                  <View style={styles.tiposFila}>
                    {TIPOS.map((t) => {
                      const on = t.valor === tipo;
                      return (
                        <Pressable
                          key={t.valor}
                          onPress={() => setTipo(t.valor)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                          style={({ pressed }) => [styles.tipo, on && styles.tipoOn, pressed && { opacity: 0.9 }]}
                        >
                          <Text style={[styles.tipoNumero, on && styles.tipoNumeroOn]}>{t.numero}</Text>
                          <Text style={[styles.tipoEtiqueta, on && styles.tipoEtiquetaOn]}>{t.etiqueta}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.ayuda}>Elige bien: el tipo no se puede cambiar después.</Text>
                </>
              ) : (
                <>
                  <View style={styles.tipoFijo}>
                    <Lock color={C.textSecondary} size={14} strokeWidth={2.2} />
                    <Text style={styles.tipoFijoTexto}>{NOMBRE_TIPO[tipo] || tipo}</Text>
                  </View>
                  <Text style={styles.ayuda}>
                    Si la cancha cambió de verdad, crea una nueva y desactiva esta. Cambiar el tipo
                    reescribiría lo que dicen las reservas ya jugadas.
                  </Text>
                </>
              )}
            </Card>

            <Card>
              <FieldLabel>{esNueva ? 'Precio base por hora' : 'Precio por hora'}</FieldLabel>
              <TextField
                value={precio}
                onChangeText={(t) => setPrecio(t.replace(/\D/g, ''))}
                placeholder="28000"
                keyboardType="number-pad"
                maxLength={7}
              />
              <Text style={styles.ayuda}>
                {precioOk && precioNumero > 0 ? `${formatCLP(precioNumero)} por hora. ` : ''}
                Este es el precio base: se usa cuando ninguna tarifa por horario aplica.
              </Text>
            </Card>

            <Card>
              <FieldLabel>Duración del bloque</FieldLabel>
              <View style={styles.duracionesFila}>
                {DURACIONES.map((d) => {
                  const on = d === duracion;
                  return (
                    <Pressable
                      key={d}
                      onPress={() => setDuracion(d)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      style={({ pressed }) => [styles.duracion, on && styles.duracionOn, pressed && { opacity: 0.9 }]}
                    >
                      <Text style={[styles.duracionTexto, on && styles.duracionTextoOn]}>{d} min</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.ayuda}>
                Así se parte el día en el calendario del jugador.
                {!esNueva && cancha?.tiene_tarifas
                  ? ' Ojo: esta cancha tiene tarifas por horario, y cambiar la duración mueve qué bloques cae en cada una.'
                  : ''}
              </Text>
            </Card>

            {!esNueva ? (
              <Card padded={false}>
                <ListRow
                  icon={Clock}
                  title="Horarios de atención"
                  subtitle={
                    cancha?.tiene_horario
                      ? `${cancha.dias_con_horario} ${cancha.dias_con_horario === 1 ? 'día' : 'días'} con horario`
                      : 'Sin horario · la cancha no tiene bloques reservables'
                  }
                  onPress={() => navigation.navigate('Horarios', {
                    canchaId,
                    canchaNombre: cancha?.nombre,
                    duracionSlotMin: cancha?.duracion_slot_min,
                  })}
                />
                <ListRow
                  icon={CalendarClock}
                  title="Calendario y bloqueos"
                  subtitle="Ocupar horas de una fecha puntual"
                  onPress={() => navigation.navigate('CalendarioCancha', {
                    complejoId, canchaId, nombre: complejoNombre,
                  })}
                />
                <ListRow
                  icon={Tag}
                  title="Tarifas por horario"
                  subtitle={
                    cancha?.tiene_tarifas
                      ? 'El precio base se usa si ninguna aplica'
                      : 'Precio único · todavía sin tarifas por franja'
                  }
                  last
                />
              </Card>
            ) : null}

            {error ? <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <StickyFooter>
        <Button
          label={esNueva ? 'Crear cancha' : 'Guardar cambios'}
          disabled={!puedeGuardar}
          loading={enviando}
          onPress={guardar}
        />
      </StickyFooter>
    </SafeAreaView>
  );
}

function Cabecera({ navigation, titulo, subtitulo }) {
  return (
    <View style={styles.header}>
      <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle} numberOfLines={1}>{titulo}</Text>
        {subtitulo ? <Text style={styles.headerSub} numberOfLines={1}>{subtitulo}</Text> : null}
      </View>
    </View>
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
  scroll: { paddingHorizontal: S.screenPadding, paddingBottom: 120 },

  ayuda: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16.5, marginTop: 9 },

  tiposFila: { flexDirection: 'row', gap: 9 },
  tipo: {
    flex: 1, paddingVertical: 13, borderRadius: R.cardSm,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
    alignItems: 'center', gap: 3,
  },
  tipoOn: { borderColor: C.green, backgroundColor: C.selectedBg },
  tipoNumero: { fontFamily: F.extraBold, fontSize: 20, color: C.textPrimary },
  tipoNumeroOn: { color: C.green },
  tipoEtiqueta: { fontFamily: F.medium, fontSize: 11, color: C.textSecondary },
  tipoEtiquetaOn: { color: C.green },
  tipoFijo: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    minHeight: 48, paddingHorizontal: 14,
    borderRadius: R.row, borderWidth: 1, borderColor: C.border, backgroundColor: C.surfaceAlt,
  },
  tipoFijoTexto: { fontFamily: F.bold, fontSize: 14.5, color: C.textSecondary },

  duracionesFila: { flexDirection: 'row', gap: 8 },
  duracion: {
    flex: 1, height: 44, borderRadius: R.chip,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  duracionOn: { borderColor: C.green, backgroundColor: C.selectedBg },
  duracionTexto: { fontFamily: F.bold, fontSize: 13, color: C.textPrimary },
  duracionTextoOn: { color: C.green },
});
