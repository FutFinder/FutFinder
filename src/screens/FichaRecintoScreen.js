import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, AlertTriangle, MapPin, ImagePlus, Trash2, X, Check } from 'lucide-react-native';

import { reservas as C, reservasRadius as R, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, NoticeCard, StickyFooter } from '../components/reservas/ui';
import { Skeleton, FieldLabel, TextField } from '../components/reservas/recintoUi';
import {
  misRecintos, actualizarFicha, serviciosDelRecinto, guardarServicios, quitarFotoRecinto,
  fotosDelRecinto, agregarFotoRecinto, quitarFotoGaleria,
} from '../services/recinto';
import {
  pickImage, uploadComplejoFoto, uploadFotoGaleria, removeComplejoFotoFile, pathFromPublicUrl,
} from '../services/storage';
import { SERVICIOS } from '../utils/serviciosRecinto';
import EncuadreSheet from '../components/reservas/EncuadreSheet';
import { queSobra, PROPORCION_PORTADA } from '../utils/encuadre';

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
 * LAS FOTOS SE GUARDAN SOLAS, y por eso el botón «Guardar cambios» no se
 * enciende al cambiarlas. No es un descuido: subir una foto ya la deja
 * guardada en el servidor, así que no hay nada que guardar después. Pero un
 * botón apagado después de hacer algo se lee como «no se guardó», así que
 * ahora la pantalla lo DICE en vez de dejar que alguien lo deduzca — era
 * exactamente lo que pasaba cuando se probó.
 *
 * LA FOTO SE RECORTA AL SUBIRLA, Y LO ELIGE QUIEN LA SUBE. Se muestra en
 * cajas horizontales y nadie saca fotos horizontales, así que siempre sobra
 * algo. En el teléfono el selector ya deja recortar; en el navegador no, y ahí
 * se abre `EncuadreSheet` para elegir con qué parte quedarse. Sin eso, una
 * foto sacada de pie terminaba siendo una franja.
 *
 * LA PORTADA Y LA GALERÍA SON COSAS DISTINTAS (migración 80). La portada es
 * la única que representa al recinto en el buscador: es UNA y la elige el
 * recinto. La galería es contexto —camarines, luz de noche, estacionamiento—
 * y va hasta ocho.
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
  const [galeria, setGaleria] = useState([]);
  const [subiendoGaleria, setSubiendoGaleria] = useState(false);
  // Lo que acaba de pasar con las fotos. Se muestra y se va: es un acuse, no
  // un estado.
  const [aviso, setAviso] = useState(null);
  // La foto elegida que todavía no se sube porque falta decidir el encuadre.
  const [pendiente, setPendiente] = useState(null);

  const cargar = useCallback(async () => {
    const [{ data, error: err }, { data: servs }, { data: fotos }] = await Promise.all([
      misRecintos(),
      serviciosDelRecinto(complejoId),
      fotosDelRecinto(complejoId),
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
    setGaleria(fotos || []);
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

  const avisar = (texto) => {
    setAviso(texto);
    setTimeout(() => setAviso(null), 3500);
  };

  /**
   * Elegir una foto. Si ya viene con la proporción en que se va a mostrar
   —el selector del teléfono recorta solo— se sube directo; si no, se
   * pregunta con qué parte quedarse antes de tocar nada.
   */
  const elegirFoto = async (destino) => {
    const { ok, asset, reason } = await pickImage({ aspect: [16, 9], quality: 0.8, base64: false });
    if (!ok) { if (reason) setError(reason); return; }
    setError(null);
    if (!queSobra(asset.width, asset.height, PROPORCION_PORTADA)) {
      subirFoto(destino, asset, 'centro');
      return;
    }
    setPendiente({ asset, destino });
  };

  const subirFoto = async (destino, asset, anclaje) => {
    const enGaleria = destino === 'galeria';
    const marcar = enGaleria ? setSubiendoGaleria : setSubiendo;
    marcar(true);

    if (enGaleria) {
      const { url, error: errSubida } = await uploadFotoGaleria(complejoId, asset, { anclaje });
      if (errSubida) { marcar(false); setPendiente(null); setError(errSubida.message); return; }
      const { data, error: err } = await agregarFotoRecinto(complejoId, url);
      marcar(false);
      setPendiente(null);
      if (err) { setError(err.message); return; }
      // El tope de ocho lo aplica el servidor, así que esto puede volver con
      // un «no» aunque la subida haya salido bien. Se dice, no se ignora.
      if (data && data.ok === false) { setError(data.reason); return; }
      await cargar();
      avisar('Foto agregada. Ya está guardada.');
      return;
    }

    const { error: err } = await uploadComplejoFoto(complejoId, asset, { anclaje });
    marcar(false);
    setPendiente(null);
    if (err) { setError(err.message); return; }
    await cargar();
    avisar('Portada actualizada. Las fotos se guardan solas, no hace falta guardar nada más.');
  };

  const borrarFoto = async () => {
    setSubiendo(true);
    const { error: err } = await quitarFotoRecinto(complejoId);
    setSubiendo(false);
    if (err) { setError(err.message); return; }
    await cargar();
    avisar('Quitamos la portada.');
  };

  const quitarDeGaleria = async (foto) => {
    setSubiendoGaleria(true);
    const { data, error: err } = await quitarFotoGaleria(foto.id);
    setSubiendoGaleria(false);
    if (err) { setError(err.message); return; }
    // El archivo del bucket se borra DESPUÉS y sin bloquear: si esto falla,
    // la foto ya no se muestra en ninguna parte y lo único que queda es un
    // archivo suelto. Es mejor que dejar la fila colgada por un error de red.
    const path = pathFromPublicUrl(data?.url || foto.url, 'complejo-fotos');
    if (path) removeComplejoFotoFile(path);
    await cargar();
    avisar('Foto quitada.');
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
                Horizontal, con la cancha completa. Es la única que representa al recinto en el
                buscador. Se guarda sola apenas la eliges: no hace falta tocar «Guardar cambios».
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
                  onPress={() => elegirFoto('portada')}
                  style={{ flex: 1 }}
                />
                {recinto.foto_url ? (
                  <IconButton icon={Trash2} onPress={borrarFoto} accessibilityLabel="Quitar la foto" />
                ) : null}
              </View>
            </Card>

            <Card>
              <FieldLabel>Más fotos del recinto</FieldLabel>
              <Text style={styles.ayuda}>
                Hasta ocho. Son las que le muestran al jugador cómo es el lugar: los camarines, la
                iluminación de noche, el estacionamiento. También se guardan solas.
              </Text>

              {galeria.length ? (
                <View style={styles.galeriaGrid}>
                  {galeria.map((f, i) => (
                    <View key={f.id} style={styles.galeriaItem}>
                      <Image
                        source={{ uri: f.url }}
                        style={styles.galeriaFoto}
                        resizeMode="cover"
                        accessibilityLabel={`Foto ${i + 1} de ${recinto.nombre}`}
                      />
                      <Pressable
                        onPress={() => quitarDeGaleria(f)}
                        accessibilityRole="button"
                        accessibilityLabel={`Quitar la foto ${i + 1}`}
                        hitSlop={8}
                        style={({ pressed }) => [styles.galeriaQuitar, pressed && { opacity: 0.8 }]}
                      >
                        <X color={C.textPrimary} size={13} strokeWidth={2.6} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.galeriaVacia}>
                  <Text style={styles.fotoVaciaTexto}>Todavía no hay más fotos</Text>
                </View>
              )}

              <Button
                label={galeria.length >= 8 ? 'Ya tienes ocho fotos' : 'Agregar una foto'}
                variant="secondary"
                icon={ImagePlus}
                loading={subiendoGaleria}
                disabled={galeria.length >= 8}
                onPress={() => elegirFoto('galeria')}
                style={{ marginTop: 12 }}
              />
            </Card>

            {aviso ? (
              <NoticeCard tone="info" icon={Check}>{aviso}</NoticeCard>
            ) : null}
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

      <EncuadreSheet
        visible={!!pendiente}
        asset={pendiente?.asset}
        guardando={subiendo || subiendoGaleria}
        onCancelar={() => setPendiente(null)}
        onConfirmar={(anclaje) => subirFoto(pendiente.destino, pendiente.asset, anclaje)}
      />
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

  galeriaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 },
  // Tres por fila con 8 de separación: 31% deja el margen justo sin tener que
  // medir el ancho de la pantalla.
  galeriaItem: { width: '31%', aspectRatio: PROPORCION_PORTADA },
  galeriaFoto: {
    width: '100%', height: '100%', borderRadius: R.cardSm,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
  },
  galeriaQuitar: {
    position: 'absolute', top: 5, right: 5,
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(8,10,8,0.86)', borderWidth: 1, borderColor: C.border,
  },
  galeriaVacia: {
    marginTop: 13, paddingVertical: 22, alignItems: 'center', borderRadius: R.cardSm,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.dashedBorder, borderStyle: 'dashed',
  },
});
