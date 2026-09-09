import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, AlertTriangle, Lock } from 'lucide-react-native';

import { reservas as C, reservasRadius as R, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, NoticeCard, StickyFooter } from '../components/reservas/ui';
import { ChoiceCard, FieldLabel, TextField, TimeField } from '../components/reservas/recintoUi';
import { crearBloqueo } from '../services/recinto';
import {
  fechaLarga, horasElegibles, bloquesEnRango, reservasQueChocan, rangoSinChoque,
  etiquetaOcupar, telefonoAceptable,
} from '../utils/recintoPantallas';
import { formatCLP } from '../services/reservasRules';

/**
 * Ocupar un horario (artboards 1q y 1r).
 *
 * DOS MOTIVOS Y NO UNO. Cerrar la cancha y arrendarla por fuera son cosas
 * distintas para quien abre el recinto en la mañana: la segunda significa que
 * va a llegar gente. Por eso el contacto solo existe en `externo` — y el
 * servidor descarta en silencio un contacto mandado con `cerrado`, así que la
 * pantalla ni siquiera lo muestra ahí.
 *
 * EL CHOQUE CON UNA RESERVA SE AVISA ANTES, PERO EL MENSAJE ES DEL SERVIDOR.
 * `admin_crear_bloqueo` rechaza el bloqueo si hay una reserva CONFIRMADA
 * encima, con un texto ya redactado. Acá se anticipa mirando el calendario que
 * ya está cargado, para no mandar algo que va a fallar y para ofrecer las dos
 * salidas — recortar el rango o cancelar la reserva. Si las dos versiones
 * alguna vez difieren, la que se muestra es la del servidor.
 *
 * Y UNA RESERVA A MEDIO ARMAR NO ES UN CHOQUE: la hora sigue libre hasta que
 * alguien confirme, así que se puede ocupar.
 */
export default function OcuparHorarioScreen({ navigation, route }) {
  const { canchaId, canchaNombre, fecha, desde: desdeInicial, slots = [] } = route.params || {};

  const { inicios, terminos } = useMemo(() => horasElegibles(slots), [slots]);
  const [desde, setDesde] = useState(desdeInicial || inicios[0] || null);
  const [hasta, setHasta] = useState(() => {
    const i = inicios.indexOf(desdeInicial || inicios[0]);
    return terminos[i] || terminos[0] || null;
  });
  const [tipo, setTipo] = useState('cerrado');
  const [motivo, setMotivo] = useState('');
  const [contactoNombre, setContactoNombre] = useState('');
  const [contactoTelefono, setContactoTelefono] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const externo = tipo === 'externo';
  const bloques = bloquesEnRango(slots, desde, hasta);
  const choques = reservasQueChocan(slots, desde, hasta);
  const recorte = choques.length > 0 ? rangoSinChoque(slots, desde, hasta) : null;
  const telefonoOk = telefonoAceptable(contactoTelefono);
  // Solo las horas de término posteriores al inicio elegido: ofrecer las
  // anteriores dejaría armar un rango invertido que el servidor rechaza.
  const terminosValidos = useMemo(() => {
    const i = inicios.indexOf(desde);
    return i >= 0 ? terminos.slice(i) : terminos;
  }, [inicios, terminos, desde]);

  const puedeEnviar = bloques.length > 0 && choques.length === 0 && telefonoOk && !enviando;

  const elegirDesde = (h) => {
    setDesde(h);
    // Si el término quedó antes del nuevo inicio, se corre al primero válido.
    const i = inicios.indexOf(h);
    if (i >= 0 && terminos[i] && (!hasta || terminos.indexOf(hasta) < i)) setHasta(terminos[i]);
  };

  const enviar = async () => {
    setEnviando(true);
    setError(null);
    const { error: err } = await crearBloqueo(canchaId, {
      fecha,
      horaInicio: desde,
      horaFin: hasta,
      motivo,
      tipo,
      contactoNombre: externo ? contactoNombre : null,
      contactoTelefono: externo ? contactoTelefono : null,
    });
    setEnviando(false);
    if (err) { setError(err.message); return; }
    navigation.goBack();
  };

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Ocupar un horario</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {canchaNombre} · {fechaLarga(fecha)}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={{ gap: 16 }}>
            <NoticeCard tone="info">
              Esto ocupa una sola fecha. Para cerrar todos los martes, eso se define en el horario de
              atención de la cancha.
            </NoticeCard>

            <View style={{ gap: 10 }}>
              <Text style={styles.seccion}>¿Por qué se ocupa la hora?</Text>
              <ChoiceCard
                titulo="La cancha no se puede usar"
                descripcion="Mantención, arreglo, campeonato propio."
                seleccionado={tipo === 'cerrado'}
                onPress={() => setTipo('cerrado')}
              />
              <ChoiceCard
                titulo="Se arrendó por fuera de FutFinder"
                descripcion="Alguien la tomó por teléfono o en persona. Marca la hora para que no llegue una reserva doble."
                seleccionado={externo}
                onPress={() => setTipo('externo')}
              />
            </View>

            <Card>
              <View style={styles.horasFila}>
                <View style={{ flex: 1 }}>
                  <FieldLabel>Desde</FieldLabel>
                  <TimeField valor={desde} opciones={inicios} onChange={elegirDesde} titulo="Desde qué hora" />
                </View>
                <View style={{ flex: 1 }}>
                  <FieldLabel>Hasta</FieldLabel>
                  <TimeField valor={hasta} opciones={terminosValidos} onChange={setHasta} titulo="Hasta qué hora" />
                </View>
              </View>
              <Text style={styles.horasNota}>
                {bloques.length > 0
                  ? `Son ${bloques.length} ${bloques.length === 1 ? 'bloque' : 'bloques'}: ${bloques.map((b) => b.hora_inicio).join(', ')}. `
                    + 'El bloque que empieza justo a la hora de término queda afuera.'
                  : 'Elige un rango que tenga al menos un bloque adentro.'}
              </Text>
            </Card>

            {choques.length > 0 ? (
              <Card style={styles.choqueCard}>
                <View style={styles.choqueTitulo}>
                  <AlertTriangle color={C.red} size={16} strokeWidth={2.3} />
                  <Text style={styles.choqueTituloTexto}>
                    Ese horario tiene una reserva confirmada
                  </Text>
                </View>
                <Text style={styles.choqueTexto}>
                  No se puede ocupar una hora ya vendida. Cancélala antes de bloquearla —o marca solo
                  las horas que quedan libres.
                </Text>
                <View style={{ gap: 9, marginTop: 13 }}>
                  {choques.map((c) => (
                    <View key={c.hora_inicio} style={styles.choqueFila}>
                      <Text style={styles.choqueHora}>{c.hora_inicio}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.choqueQuien}>@{c.reserva.organizador_username}</Text>
                        {c.reserva.precio_total ? (
                          <Text style={styles.choqueMonto}>Pagada · {formatCLP(c.reserva.precio_total)}</Text>
                        ) : null}
                      </View>
                      <Text
                        style={styles.choqueEnlace}
                        accessibilityRole="button"
                        onPress={() => navigation.navigate('ReservaRecinto', { reservaId: c.reserva.id })}
                      >
                        Ver reserva
                      </Text>
                    </View>
                  ))}
                </View>
                {recorte ? (
                  <Button
                    label={`Ocupar solo ${recorte.desde}–${recorte.hasta}`}
                    variant="secondary"
                    style={{ marginTop: 13 }}
                    onPress={() => setDesde(recorte.desde)}
                  />
                ) : null}
              </Card>
            ) : null}

            {externo ? (
              <Card>
                <FieldLabel marca="opcional">De quién es</FieldLabel>
                <Text style={styles.ayuda}>
                  Si quieres tener la hora ordenada, anota quién la tomó. Puedes dejarlo en blanco y
                  marcar la hora igual.
                </Text>
                <View style={{ gap: 12, marginTop: 13 }}>
                  <TextField
                    value={contactoNombre}
                    onChangeText={setContactoNombre}
                    placeholder="Club Los Halcones"
                    maxLength={80}
                  />
                  <View>
                    <TextField
                      value={contactoTelefono}
                      onChangeText={setContactoTelefono}
                      placeholder="9 8765 4321"
                      keyboardType="phone-pad"
                      maxLength={20}
                    />
                    {!telefonoOk ? (
                      <Text style={styles.errorCampo}>
                        Revisa el teléfono: son 9 dígitos y parte con 9.
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.privacidad}>
                  <Lock color={C.textSecondary} size={11} strokeWidth={2.2} style={{ marginTop: 2 }} />
                  <Text style={styles.privacidadTexto}>
                    Estos datos los anotas tú y los ve solo tu recinto. Los jugadores no los ven.
                  </Text>
                </View>
              </Card>
            ) : null}

            <Card>
              <FieldLabel marca="opcional">Motivo</FieldLabel>
              <TextField
                value={motivo}
                onChangeText={setMotivo}
                placeholder={externo ? 'Arriendo del club, pagan en efectivo' : 'Mantención del pasto sintético'}
                multiline
                maxLength={300}
                contador
              />
              <Text style={styles.ayuda}>
                Es una nota tuya. Los jugadores no la ven: para ellos esas horas simplemente no están
                disponibles, igual que cualquier hora reservada.
              </Text>
            </Card>

            {error ? <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <StickyFooter>
        <Button
          label={etiquetaOcupar(desde, hasta)}
          disabled={!puedeEnviar}
          loading={enviando}
          onPress={enviar}
        />
      </StickyFooter>
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
  scroll: { paddingHorizontal: S.screenPadding, paddingBottom: 120 },

  seccion: { fontFamily: F.extraBold, fontSize: 15, color: C.textPrimary },
  horasFila: { flexDirection: 'row', gap: 12 },
  horasNota: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16.5, marginTop: 11 },
  ayuda: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16.5, marginTop: 7 },
  errorCampo: { fontFamily: F.semiBold, fontSize: 11.5, color: C.red, marginTop: 6 },

  choqueCard: { borderColor: 'rgba(237,107,118,0.4)', backgroundColor: 'rgba(237,107,118,0.08)' },
  choqueTitulo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  choqueTituloTexto: { flex: 1, fontFamily: F.extraBold, fontSize: 14.5, color: C.textPrimary },
  choqueTexto: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, lineHeight: 18, marginTop: 8 },
  choqueFila: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    padding: 11, borderRadius: R.cardSm,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  choqueHora: { fontFamily: F.extraBold, fontSize: 13.5, color: C.textPrimary },
  choqueQuien: { fontFamily: F.bold, fontSize: 13, color: C.textPrimary },
  choqueMonto: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, marginTop: 2 },
  choqueEnlace: { fontFamily: F.bold, fontSize: 12, color: C.green },

  privacidad: { flexDirection: 'row', gap: 6, marginTop: 12 },
  privacidadTexto: { flex: 1, fontFamily: F.medium, fontSize: 11, color: C.textSecondary, lineHeight: 15.5 },
});
