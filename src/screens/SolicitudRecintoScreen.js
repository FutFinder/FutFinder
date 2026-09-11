import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, AlertTriangle, CheckCircle2, Lock } from 'lucide-react-native';

import { reservas as C, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, NoticeCard, StickyFooter } from '../components/reservas/ui';
import { FieldLabel, TextField } from '../components/reservas/recintoUi';
import { camposFaltantes } from '../utils/solicitudRecinto';
import { enviarSolicitudRecinto } from '../services/solicitudRecinto';

/**
 * «Suma tu recinto»: el formulario con que el dueño de un complejo pide
 * trabajar con FutFinder (migración 80).
 *
 * NO CREA UN RECINTO. Es una solicitud que lee una persona del equipo, que
 * después llama y carga el complejo a mano. La pantalla lo dice en vez de
 * dejar creer que el recinto va a aparecer solo: prometer un alta automática
 * sería mentir sobre lo que pasa después de apretar el botón.
 *
 * LOS ERRORES APARECEN AL INTENTAR, NO MIENTRAS SE ESCRIBE. Marcar en rojo un
 * correo a medio escribir es regañar a alguien que todavía no termina. Y el
 * botón queda ENCENDIDO aunque falte algo, para que al apretarlo pueda decir
 * qué falta: un botón apagado sin explicación es la peor de las dos.
 */
export default function SolicitudRecintoScreen({ navigation }) {
  const [form, setForm] = useState({
    nombreRecinto: '',
    direccion: '',
    comuna: '',
    nombreDueno: '',
    telefono: '',
    correo: '',
    mensaje: '',
  });
  const [intentado, setIntentado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [enviada, setEnviada] = useState(null);

  const campo = (clave) => (valor) => {
    setForm((f) => ({ ...f, [clave]: valor }));
    setError(null);
  };

  const faltantes = useMemo(() => camposFaltantes(form), [form]);
  const falla = (clave) => intentado && faltantes.includes(clave);

  const enviar = async () => {
    setIntentado(true);
    if (faltantes.length > 0) return;

    setEnviando(true);
    setError(null);
    const { data, error: err } = await enviarSolicitudRecinto(form);
    setEnviando(false);
    if (err) { setError(err.message); return; }
    setEnviada(data);
  };

  if (enviada) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.header}>
          <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
          <Text style={styles.headerTitle}>Solicitud enviada</Text>
        </View>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Card style={styles.listaCard}>
            <View style={styles.exitoIcono}>
              <CheckCircle2 color={C.green} size={26} strokeWidth={2} />
            </View>
            <Text style={styles.exitoTitulo}>
              {enviada.reusada ? 'Ya teníamos tu solicitud' : `Recibimos ${form.nombreRecinto}`}
            </Text>
            <Text style={styles.exitoTexto}>
              {enviada.reusada
                ? 'Tu recinto ya estaba en la lista, así que no mandamos una segunda solicitud. Seguimos con la primera.'
                : 'Alguien del equipo la va a revisar y te va a llamar al número que dejaste para ver los horarios, '
                  + 'los precios y las canchas. Si todo calza, cargamos tu recinto y quedas como dueño.'}
            </Text>
          </Card>
        </ScrollView>
        <StickyFooter>
          <Button label="Volver a Reservas" onPress={() => navigation.goBack()} />
        </StickyFooter>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Suma tu recinto</Text>
          <Text style={styles.headerSub}>Para que aparezca en FutFinder</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={{ gap: 16 }}>
            <NoticeCard tone="info">
              Esto no publica tu recinto al instante: lo revisamos, te llamamos y lo cargamos contigo.
              Déjanos los datos y te contactamos.
            </NoticeCard>

            <Card>
              <Text style={styles.seccion}>Tu recinto</Text>
              <View style={{ gap: 14, marginTop: 13 }}>
                <View>
                  <FieldLabel>Nombre del recinto</FieldLabel>
                  <TextField
                    value={form.nombreRecinto}
                    onChangeText={campo('nombreRecinto')}
                    placeholder="FutCenter Maipú"
                    maxLength={120}
                  />
                  {falla('nombreRecinto') ? <Text style={styles.errorCampo}>Escribe el nombre con que se conoce tu recinto.</Text> : null}
                </View>
                <View>
                  <FieldLabel>Dirección exacta</FieldLabel>
                  <TextField
                    value={form.direccion}
                    onChangeText={campo('direccion')}
                    placeholder="Av. El Rosal 6281"
                    maxLength={200}
                  />
                  {falla('direccion') ? <Text style={styles.errorCampo}>Con calle y número: es lo que usamos para ubicarte.</Text> : null}
                </View>
                <View>
                  <FieldLabel>Comuna</FieldLabel>
                  <TextField
                    value={form.comuna}
                    onChangeText={campo('comuna')}
                    placeholder="Maipú"
                    maxLength={80}
                  />
                  {falla('comuna') ? <Text style={styles.errorCampo}>Falta la comuna.</Text> : null}
                </View>
              </View>
            </Card>

            <Card>
              <Text style={styles.seccion}>Cómo te ubicamos</Text>
              <View style={{ gap: 14, marginTop: 13 }}>
                <View>
                  <FieldLabel>Tu nombre</FieldLabel>
                  <TextField
                    value={form.nombreDueno}
                    onChangeText={campo('nombreDueno')}
                    placeholder="Nombre y apellido"
                    maxLength={120}
                  />
                  {falla('nombreDueno') ? <Text style={styles.errorCampo}>Dinos con quién hablamos.</Text> : null}
                </View>
                <View>
                  <FieldLabel>Teléfono</FieldLabel>
                  <TextField
                    value={form.telefono}
                    onChangeText={campo('telefono')}
                    placeholder="9 8765 4321"
                    keyboardType="phone-pad"
                    maxLength={20}
                  />
                  {falla('telefono') ? <Text style={styles.errorCampo}>Revisa el teléfono: son 9 dígitos y parte con 9.</Text> : null}
                </View>
                <View>
                  <FieldLabel>Correo</FieldLabel>
                  <TextField
                    value={form.correo}
                    onChangeText={campo('correo')}
                    placeholder="contacto@turecinto.cl"
                    keyboardType="email-address"
                    maxLength={120}
                  />
                  {falla('correo') ? <Text style={styles.errorCampo}>Revisa el correo: ahí te vamos a responder.</Text> : null}
                </View>
              </View>
              <View style={styles.privacidad}>
                <Lock color={C.textSecondary} size={11} strokeWidth={2.2} style={{ marginTop: 2 }} />
                <Text style={styles.privacidadTexto}>
                  Tu teléfono y tu correo los vemos solo nosotros, para responderte. No aparecen en la app.
                </Text>
              </View>
            </Card>

            <Card>
              <FieldLabel marca="opcional">Cuéntanos de tu recinto</FieldLabel>
              <TextField
                value={form.mensaje}
                onChangeText={campo('mensaje')}
                placeholder="Seis canchas de fútbol 7, abrimos de 11:00 a 22:00 todos los días, tenemos estacionamiento y camarines."
                multiline
                maxLength={1000}
                contador
              />
              <Text style={styles.ayuda}>
                Cuántas canchas tienes, de qué tipo, en qué horario atiendes. Nos ahorra la mitad de la
                primera llamada, pero puedes dejarlo en blanco.
              </Text>
            </Card>

            {intentado && faltantes.length > 0 ? (
              <NoticeCard tone="warning" icon={AlertTriangle}>
                Falta completar {faltantes.length === 1 ? 'un dato' : `${faltantes.length} datos`} más arriba.
              </NoticeCard>
            ) : null}

            {error ? <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <StickyFooter>
        <Button label="Mandar mi solicitud" loading={enviando} onPress={enviar} />
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
  ayuda: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16.5, marginTop: 7 },
  errorCampo: { fontFamily: F.semiBold, fontSize: 11.5, color: C.red, marginTop: 6 },

  privacidad: { flexDirection: 'row', gap: 6, marginTop: 14 },
  privacidadTexto: { flex: 1, fontFamily: F.medium, fontSize: 11, color: C.textSecondary, lineHeight: 15.5 },

  listaCard: { alignItems: 'center', paddingVertical: 26 },
  exitoIcono: { marginBottom: 12 },
  exitoTitulo: { fontFamily: F.extraBold, fontSize: 17, color: C.textPrimary, textAlign: 'center' },
  exitoTexto: {
    fontFamily: F.medium, fontSize: 13, color: C.textSecondary,
    lineHeight: 19, textAlign: 'center', marginTop: 9,
  },
});
