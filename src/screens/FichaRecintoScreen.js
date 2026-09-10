import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, AlertTriangle, MapPin, Info } from 'lucide-react-native';

import { reservas as C, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, NoticeCard, StickyFooter } from '../components/reservas/ui';
import { Skeleton, FieldLabel, TextField } from '../components/reservas/recintoUi';
import { misRecintos, actualizarFicha } from '../services/recinto';

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
 * LA FOTO TODAVÍA NO SE PUEDE SUBIR desde acá. `actualizarFicha` acepta una
 * `fotoUrl`, pero falta el paso de subida a Storage; se muestra lo que hay y
 * se dice que está pendiente, en vez de ofrecer un botón que no funciona.
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

  const cargar = useCallback(async () => {
    const { data, error: err } = await misRecintos();
    const mio = (data || []).find((r) => r.id === complejoId) || null;
    setRecinto(mio);
    setError(err?.message || null);
    if (mio) {
      setNombre(mio.nombre || '');
      setDescripcion(mio.descripcion || '');
      setDireccion(mio.direccion || '');
    }
    setCargando(false);
  }, [complejoId]);

  useEffect(() => { cargar(); }, [cargar]);

  const nombreOk = nombre.trim().length > 0;
  const cambio = recinto && (
    nombre.trim() !== (recinto.nombre || '')
    || descripcion.trim() !== (recinto.descripcion || '')
    || direccion.trim() !== (recinto.direccion || '')
  );
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
    setEnviando(false);
    if (err) { setError(err.message); return; }
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
              <FieldLabel>Foto de portada</FieldLabel>
              <View style={styles.fotoCaja}>
                <Info color={C.textSecondary} size={15} strokeWidth={2.2} />
                <Text style={styles.fotoTexto}>
                  {recinto.foto_url
                    ? 'Tu recinto ya tiene foto. Cambiarla desde la app está pendiente.'
                    : 'Subir la foto desde la app está pendiente. Mándanosla y la cargamos: horizontal, con la cancha completa.'}
                </Text>
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
  fotoCaja: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  fotoTexto: { flex: 1, fontFamily: F.medium, fontSize: 12, color: C.textSecondary, lineHeight: 17 },
});
