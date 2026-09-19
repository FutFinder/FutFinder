import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Image, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, AlertTriangle, CheckCircle2, Lock, ImagePlus, X } from 'lucide-react-native';

import { paleta as C, radios as R, medidas as S, fuentes as F } from '../theme/colors';
import { Card, IconButton, Button, NoticeCard, StickyFooter, Chip } from '../components/reservas/ui';
import { FieldLabel, TextField } from '../components/reservas/recintoUi';
import { camposFaltantes, MAX_FOTOS, MAX_CANCHAS } from '../utils/solicitudRecinto';
import { SERVICIOS } from '../utils/serviciosRecinto';
import { enviarSolicitudRecinto } from '../services/solicitudRecinto';
import { pickImages, uploadFotoSolicitud, removeFotoSolicitudFile } from '../services/storage';

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
 *
 * LAS FOTOS SE SUBEN AL ELEGIRLAS y no al mandar el formulario (migración
 * 110). Así se ven de inmediato, quitarlas borra el archivo de verdad, y
 * apretar «Mandar mi solicitud» no queda esperando seis subidas. Lo que viaja
 * en el envío son las RUTAS, no las imágenes.
 *
 * Y POR ESO SE LIMPIAN AL SALIR: si alguien sube fotos y se arrepiente, los
 * archivos no pueden quedar en el bucket sin ninguna solicitud que los
 * mencione. Se borran al desmontar la pantalla, salvo que la solicitud se haya
 * mandado — ahí son justamente lo que el equipo va a mirar.
 */
const FORM_VACIO = {
  nombreRecinto: '',
  direccion: '',
  comuna: '',
  nCanchas: '',
  nombreDueno: '',
  telefono: '',
  correo: '',
  mensaje: '',
  fotos: [],      // { path, uri }: la ruta viaja, la uri es la copia local
  servicios: [],  // claves del catálogo de la 75
};

export default function SolicitudRecintoScreen({ navigation }) {
  const [form, setForm] = useState(FORM_VACIO);
  const [intentado, setIntentado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState(null);
  const [enviada, setEnviada] = useState(null);

  const campo = (clave) => (valor) => {
    setForm((f) => ({ ...f, [clave]: valor }));
    setError(null);
  };

  // Las refs son para poder limpiar al desmontar sin volver a montar el efecto
  // en cada tecla: el efecto de limpieza corre una sola vez, al salir, y ahí
  // necesita el ÚLTIMO estado, no el que había cuando se montó.
  const fotosRef = useRef([]);
  const enviadaRef = useRef(false);
  useEffect(() => { fotosRef.current = form.fotos; }, [form.fotos]);
  useEffect(() => { enviadaRef.current = !!enviada; }, [enviada]);
  useEffect(() => () => {
    if (enviadaRef.current) return;
    fotosRef.current.forEach((f) => removeFotoSolicitudFile(f.path));
  }, []);

  const alternarServicio = (clave) => {
    setForm((f) => ({
      ...f,
      servicios: f.servicios.includes(clave)
        ? f.servicios.filter((c) => c !== clave)
        : [...f.servicios, clave],
    }));
  };

  /**
   * Varias fotos de una vez, y nunca más de las que faltan para el tope: el
   * servidor rechaza la solicitud ENTERA si llegan siete, y esa negativa
   * después de llenar todo el formulario sería la peor forma de enterarse.
   */
  const agregarFotos = async () => {
    const restantes = MAX_FOTOS - form.fotos.length;
    if (restantes <= 0) return;

    const { ok, assets, reason } = await pickImages({
      quality: 0.8,
      selectionLimit: restantes,
      base64: false,
    });
    if (!ok) {
      // Cancelar no es un error que mostrar: es alguien que se arrepintió.
      if (reason && reason !== 'Cancelado') setError(reason);
      return;
    }

    setSubiendo(true);
    setError(null);
    // De a una y en orden: una falla corta el resto en vez de dejar huecos, y
    // las que ya subieron se conservan — no hay que volver a elegirlas.
    const subidas = [];
    let falla = null;
    for (const asset of assets.slice(0, restantes)) {
      const { path, uri, error: err } = await uploadFotoSolicitud(asset);
      if (err) { falla = err.message; break; }
      subidas.push({ path, uri });
    }
    if (subidas.length) setForm((f) => ({ ...f, fotos: [...f.fotos, ...subidas] }));
    if (falla) setError(falla);
    setSubiendo(false);
  };

  /** Quitarla la borra del bucket: si no, quedaría un archivo que nadie mira. */
  const quitarFoto = (foto) => {
    setForm((f) => ({ ...f, fotos: f.fotos.filter((x) => x.path !== foto.path) }));
    removeFotoSolicitudFile(foto.path);
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

  /**
   * Vuelve al formulario en blanco para mandar otra solicitud — un dueño con
   * más de un recinto no tiene por qué salir de la pantalla y volver a
   * entrar. Las fotos de la solicitud recién enviada NO se tocan: son las
   * que el equipo va a mirar, y el efecto de limpieza al desmontar sólo
   * borra las que quedaron sueltas sin ninguna solicitud mandada.
   */
  const otraSolicitud = () => {
    setForm(FORM_VACIO);
    setIntentado(false);
    setError(null);
    setEnviada(null);
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
          <View style={{ gap: 10 }}>
            <Button label="Enviar otra solicitud" variant="secondary" onPress={otraSolicitud} />
            <Button label="Volver a Reservas" onPress={() => navigation.goBack()} />
          </View>
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
                <View>
                  <FieldLabel>Cuántas canchas</FieldLabel>
                  <TextField
                    value={form.nCanchas}
                    onChangeText={campo('nCanchas')}
                    placeholder="6"
                    keyboardType="number-pad"
                    maxLength={2}
                  />
                  <Text style={styles.ayuda}>
                    Las que se pueden arrendar a la vez. Es lo primero que miramos para saber si
                    alcanzamos a cargarte ahora.
                  </Text>
                  {falla('nCanchas') ? (
                    <Text style={styles.errorCampo}>Un número entre 1 y {MAX_CANCHAS}.</Text>
                  ) : null}
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
              <FieldLabel marca="opcional">Qué más ofrece tu recinto</FieldLabel>
              <Text style={styles.ayuda}>
                Toca lo que tengas. Es la misma lista que después se ve en tu ficha, así que lo
                que marques acá no hay que volver a marcarlo cuando carguemos el recinto.
              </Text>
              <View style={styles.serviciosGrid}>
                {SERVICIOS.map((sv) => (
                  <Chip
                    key={sv.clave}
                    label={sv.nombre}
                    active={form.servicios.includes(sv.clave)}
                    onPress={() => alternarServicio(sv.clave)}
                  />
                ))}
              </View>
            </Card>

            <Card>
              <FieldLabel marca="opcional">Fotos del recinto</FieldLabel>
              <Text style={styles.ayuda}>
                Hasta {MAX_FOTOS}. Las canchas, los camarines, cómo se ve de noche: con verlas nos
                ahorramos media primera llamada. Las vemos solo nosotros y no se publican.
              </Text>

              {form.fotos.length ? (
                <View style={styles.fotosGrid}>
                  {form.fotos.map((f, i) => (
                    <View key={f.path} style={styles.fotoItem}>
                      <Image
                        source={{ uri: f.uri }}
                        style={styles.foto}
                        resizeMode="cover"
                        accessibilityLabel={`Foto ${i + 1} de tu recinto`}
                      />
                      <Pressable
                        onPress={() => quitarFoto(f)}
                        accessibilityRole="button"
                        accessibilityLabel={`Quitar la foto ${i + 1}`}
                        hitSlop={8}
                        style={({ pressed }) => [styles.fotoQuitar, pressed && { opacity: 0.8 }]}
                      >
                        <X color={C.textPrimary} size={13} strokeWidth={2.6} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}

              <Button
                label={
                  form.fotos.length >= MAX_FOTOS
                    ? `Ya tienes ${MAX_FOTOS} fotos`
                    : (form.fotos.length ? 'Agregar otra foto' : 'Agregar fotos')
                }
                variant="secondary"
                icon={ImagePlus}
                loading={subiendo}
                disabled={form.fotos.length >= MAX_FOTOS}
                onPress={agregarFotos}
                style={{ marginTop: 13 }}
              />
            </Card>

            <Card>
              <FieldLabel marca="opcional">Cuéntanos de tu recinto</FieldLabel>
              <TextField
                value={form.mensaje}
                onChangeText={campo('mensaje')}
                placeholder="Son de fútbol 7 con pasto sintético, abrimos de 11:00 a 22:00 todos los días y tenemos dos canchas techadas."
                multiline
                maxLength={1000}
                contador
              />
              <Text style={styles.ayuda}>
                De qué tipo son las canchas, en qué horario atiendes, lo que no cabe en lo de arriba.
                Puedes dejarlo en blanco.
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

  serviciosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 },

  fotosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 },
  // Tres por fila con 8 de separación: 31% deja el margen justo sin tener que
  // medir el ancho de la pantalla. Cuadradas y no apaisadas como la galería de
  // la ficha: acá no se recorta nada, el equipo mira la foto completa.
  fotoItem: { width: '31%', aspectRatio: 1 },
  foto: {
    width: '100%', height: '100%', borderRadius: R.cardSm,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
  },
  fotoQuitar: {
    position: 'absolute', top: 5, right: 5,
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(8,10,8,0.86)', borderWidth: 1, borderColor: C.border,
  },

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
