import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, AlertTriangle, MapPin, ImagePlus, Trash2 } from 'lucide-react-native';

import { reservas as C, reservasRadius as R, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, NoticeCard, StickyFooter } from '../components/reservas/ui';
import { Skeleton, FieldLabel, TextField } from '../components/reservas/recintoUi';
import {
  misRecintos, actualizarFicha, serviciosDelRecinto, guardarServicios, quitarFotoRecinto,
} from '../services/recinto';
import { pickImage, uploadComplejoFoto } from '../services/storage';
import { SERVICIOS } from '../utils/serviciosRecinto';

/**
 * Ficha del recinto (artboards 1i y 1j).
 *
 * UN CAMPO EN BLANCO SIGNIFICA «NO CAMBIAR», NO «BORRAR». Es lo que hace
 * `admin_actualizar_complejo`: cada campo va con `coalesce`, así que mandar
 * `null` deja el valor que había. Por eso hoy no se puede vaciar la
 * descripción ni la dirección, y la pantalla lo dice en vez de dejar que
 * alguien lo descubra guardando. Si algún día hace falta vaciarlas, se agrega
 * un parámetro de borrado explícito — no se le cambia el significado al
 * `null`.
 *
 * REGIÓN, COMUNA Y COORDENADAS NO SE EDITAN ACÁ, y no es un olvido: son los
 * datos con los que el recinto aparece en el buscador y en el mapa. Un dueño
 * que mueve su pin dos comunas para salir en más búsquedas rompe el buscador
 * para todos, así que los cambia el equipo de FutFinder. La RPC ni siquiera
 * los recibe.
 *
 * LOS SERVICIOS SON UN CATÁLOGO CERRADO, no texto libre (migración 75): con
 * texto libre un recinto escribe «Estacionamiento» y otro «parking», y
 * filtrar por «con estacionamiento» deja de ser posible. Se guardan todos
 * juntos —la lista completa reemplaza a la anterior— porque son chips que se
 * encienden y apagan y mandar el estado final evita que dos toques seguidos
 * dejen la base en algo que la pantalla no muestra.
 */
export default function FichaRecintoScreen({ navigation, route }) {
  const { complejoId } = route.params || {};
  const [recinto, setRecinto] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [direccion, setDireccion] = useState('');
  const [servicios, setServicios] = useState([]);
  const [serviciosGuardados, setServiciosGuardados] = useState([]);
  const [subiendo, setSubiendo] = useState(false);

  const cargar = useCallback(async () => {
    const [{ data, error: err }, { data: servs }] = await Promise.all([
      misRecintos(),
      serviciosDelRecinto(complejoId),
    ]);
    const mio = (data || []).find((r) => r.id === complejoId) || null;
    setRecinto(mio);
    setError(err?.message || null);
    if (mio) {
      setNombre(mio.nombre || '');
      setDescripcion(mio.descripcion || '');
      setDireccion(mio.direccion || '');
    }
    setServicios(servs || []);
    setServiciosGuardados(servs || []);
    setCargando(false);
  }, [complejoId]);

  useEffect(() => { cargar(); }, [cargar]);

  const nombreOk = nombre.trim().length > 0;
  const mismosServicios = servicios.length === serviciosGuardados.length
    && servicios.every((x) => serviciosGuardados.includes(x));
  const cambio = recinto && (
    nombre.trim() !== (recinto.nombre || '')
    || descripcion.trim() !== (recinto.descripcion || '')
    || direccion.trim() !== (recinto.direccion || '')
    || !mismosServicios
  );

  const alternarServicio = (clave) =>
    setServicios((prev) => (prev.includes(clave) ? prev.filter((x) => x !== clave) : [...prev, clave]));

  const cambiarFoto = async () => {
    const { ok, asset, reason } = await pickImage({ aspect: [16, 9], quality: 0.8, base64: false });
    if (!ok) { if (reason) setError(reason); return; }
    setSubiendo(true);
    setError(null);
    const { error: err } = await uploadComplejoFoto(complejoId, asset);
    setSubiendo(false);
    if (err) { setError(err.message); return; }
    cargar();
  };

  const borrarFoto = async () => {
    setSubiendo(true);
    const { error: err } = await quitarFotoRecinto(complejoId);
    setSubiendo(false);
    if (err) { setError(err.message); return; }
    cargar();
  };
  const puedeGuardar = nombreOk && cambio && !enviando;

  const guardar = async () => {
    setEnviando(true);
    setError(null);
    // Solo lo que cambió, y nunca una cadena vacía: vaciar un campo hoy no se
    // puede, y mandar '' haría que el `coalesce` del servidor lo dejara igual
    // sin decir nada. Mejor no mandarlo.
    const { error: err } = await actualizarFicha(complejoId, {
      nombre: nombre.trim() !== (recinto.nombre || '') ? nombre.trim() : null,
      descripcion: descripcion.trim() && descripcion.trim() !== (recinto.descripcion || '')
        ? descripcion.trim() : null,
      direccion: direccion.trim() && direccion.trim() !== (recinto.direccion || '')
        ? direccion.trim() : null,
    });
    if (err) { setEnviando(false); setError(err.message); return; }

    if (!mismosServicios) {
      const { error: errServ } = await guardarServicios(complejoId, servicios);
      if (errServ) { setEnviando(false); setError(errServ.message); return; }
    }
    setEnviando(false);
    navigation.goBack();
  };

  if (cargando) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <Cabecera navigation={navigation} />
        <View style={styles.scroll}>
          <Card><Skeleton height={18} width="60%" /><Skeleton height={12} width="40%" style={{ marginTop: 10 }} /></Card>
        </View>
      </SafeAreaView>
    );
  }

  if (!recinto) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <Cabecera navigation={navigation} />
        <View style={styles.scroll}>
          <NoticeCard tone="warning" icon={AlertTriangle}>
            {error || 'No encontramos este recinto entre los que administras.'}
          </NoticeCard>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <Cabecera navigation={navigation} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={{ gap: 16 }}>
            <NoticeCard tone="info">
              Lo que dejes en blanco se queda como está. Por ahora no se puede vaciar la descripción
              ni la dirección.
            </NoticeCard>

            <Card>
              <FieldLabel>Nombre</FieldLabel>
              <TextField value={nombre} onChangeText={setNombre} placeholder="MaiClub" maxLength={80} />
              {!nombreOk ? (
                <Text style={styles.errorCampo}>El recinto necesita un nombre.</Text>
              ) : null}
            </Card>

            <Card>
              <FieldLabel>Descripción</FieldLabel>
              <TextField
                value={descripcion}
                onChangeText={setDescripcion}
                placeholder="Seis canchas de pasto sintético con iluminación, camarines y estacionamiento."
                multiline
                maxLength={500}
                contador
              />
              <Text style={styles.ayuda}>Es lo que lee el jugador antes de reservar.</Text>
            </Card>

            <Card>
              <FieldLabel>Dirección</FieldLabel>
              <TextField
                value={direccion}
                onChangeText={setDireccion}
                placeholder="Avenida El Rosal 6281"
                maxLength={160}
              />
              <View style={styles.ubicacion}>
                <MapPin color={C.textSecondary} size={13} strokeWidth={2.2} />
                <Text style={styles.ubicacionTexto}>
                  {[recinto.comuna, recinto.region].filter(Boolean).join(', ')}
                </Text>
              </View>
              <Text style={styles.ayuda}>
                La región, la comuna y las coordenadas del mapa las cambia el equipo de FutFinder: son
                con las que el recinto aparece en el buscador. Escríbenos si están mal.
              </Text>
            </Card>

            <Card>
              <FieldLabel>Servicios</FieldLabel>
              <Text style={styles.ayuda}>
                Lo que el jugador ve en tu ficha antes de reservar. Toca para encender y apagar.
              </Text>
              <View style={styles.serviciosGrid}>
                {SERVICIOS.map((sv) => {
                  const on = servicios.includes(sv.clave);
                  return (
                    <Pressable
                      key={sv.clave}
                      onPress={() => alternarServicio(sv.clave)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      style={({ pressed }) => [styles.servicio, on && styles.servicioOn, pressed && { opacity: 0.85 }]}
                    >
                      <Text style={[styles.servicioTexto, on && styles.servicioTextoOn]}>{sv.nombre}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>

            <Card>
              <FieldLabel>Foto de portada</FieldLabel>
              <Text style={styles.ayuda}>
                Horizontal, con la cancha completa. Es la primera impresión del recinto en el
                buscador.
              </Text>
              {recinto.foto_url ? (
                <Image
                  source={{ uri: recinto.foto_url }}
                  style={styles.foto}
                  resizeMode="cover"
                  accessibilityLabel={`Portada de ${recinto.nombre}`}
                />
              ) : (
                <View style={[styles.foto, styles.fotoVacia]}>
                  <ImagePlus color={C.textMuted} size={26} strokeWidth={1.7} />
                  <Text style={styles.fotoVaciaTexto}>Sin foto todavía</Text>
                </View>
              )}
              <View style={styles.fotoBotones}>
                <Button
                  label={recinto.foto_url ? 'Cambiar foto' : 'Subir foto'}
                  variant="secondary"
                  icon={ImagePlus}
                  loading={subiendo}
                  onPress={cambiarFoto}
                  style={{ flex: 1 }}
                />
                {recinto.foto_url ? (
                  <IconButton icon={Trash2} onPress={borrarFoto} accessibilityLabel="Quitar la foto" />
                ) : null}
              </View>
            </Card>

            {error ? <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <StickyFooter>
        <Button
          label="Guardar cambios"
          disabled={!puedeGuardar}
          loading={enviando}
          onPress={guardar}
        />
      </StickyFooter>
    </SafeAreaView>
  );
}

function Cabecera({ navigation }) {
  return (
    <View style={styles.header}>
      <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
      <Text style={styles.headerTitle}>Ficha del recinto</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: S.screenPadding, paddingTop: 6, paddingBottom: 12,
  },
  headerTitle: { flex: 1, fontFamily: F.extraBold, fontSize: 20, color: C.textPrimary },
  scroll: { paddingHorizontal: S.screenPadding, paddingBottom: 120 },

  ayuda: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16.5, marginTop: 9 },
  errorCampo: { fontFamily: F.semiBold, fontSize: 11.5, color: C.red, marginTop: 7 },
  ubicacion: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 11 },
  ubicacionTexto: { fontFamily: F.bold, fontSize: 12.5, color: C.textSecondary },
  serviciosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 },
  servicio: {
    paddingHorizontal: 13, paddingVertical: 9,
    borderRadius: R.pill, borderWidth: 1,
    borderColor: C.border, backgroundColor: C.surface,
  },
  servicioOn: { borderColor: C.green, backgroundColor: C.selectedBg },
  servicioTexto: { fontFamily: F.semiBold, fontSize: 12.5, color: C.textSecondary },
  servicioTextoOn: { color: C.green, fontFamily: F.bold },

  foto: { width: '100%', aspectRatio: 16 / 9, borderRadius: R.cardSm, marginTop: 13 },
  fotoVacia: {
    alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.dashedBorder, borderStyle: 'dashed',
  },
  fotoVaciaTexto: { fontFamily: F.medium, fontSize: 12, color: C.textMuted },
  fotoBotones: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12 },
});
