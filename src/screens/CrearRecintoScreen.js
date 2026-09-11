import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, AlertTriangle, MapPin, ShieldCheck } from 'lucide-react-native';

import { reservas as C, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, NoticeCard, StickyFooter } from '../components/reservas/ui';
import { FieldLabel, TextField } from '../components/reservas/recintoUi';
import LocationAutocomplete from '../components/LocationAutocomplete';
import { crearMiRecinto } from '../services/recinto';
import { problemasDelRecinto } from '../utils/crearRecinto';
import {
  UBICACION_VACIA, escribirDireccion, seleccionarLugar, ubicacionDraft,
} from '../utils/ubicacionPropuesta';

/**
 * Crear mi recinto (migración 82).
 *
 * SOLO LLEGA ACÁ QUIEN TIENE AUTORIZACIÓN, y la autorización la da FutFinder
 * de a una. No es una pantalla abierta: si cualquiera con cuenta pudiera
 * publicar un recinto, el buscador se llena de canchas que no trabajan con
 * nosotros y deja de servirle a nadie.
 *
 * LA DIRECCIÓN SE ELIGE DEL BUSCADOR, NO SE ESCRIBE. De ahí salen la comuna,
 * la región y —sobre todo— las coordenadas, que son obligatorias porque son
 * las que ponen el recinto en el mapa. Es el mismo componente y el mismo
 * estado que usa la creación de partidos (`utils/ubicacionPropuesta`), con su
 * regla más importante ya resuelta: si después de elegir se EDITA el texto, el
 * punto deja de valer, porque ya describe otro lugar.
 *
 * LO QUE ACÁ NO SE PIDE. Canchas, horarios, tarifas y fotos se cargan después
 * desde el panel, que ya existe. Pedir todo junto convertiría esto en un
 * formulario de veinte campos que nadie termina.
 */
export default function CrearRecintoScreen({ navigation }) {
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [ubicacion, setUbicacion] = useState(UBICACION_VACIA);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const draft = ubicacionDraft(ubicacion);
  const borrador = {
    nombre,
    comuna: draft.comuna,
    latitud: draft.latitud,
    longitud: draft.longitud,
  };
  const problemas = problemasDelRecinto(borrador);
  const problemaDe = (campo) => problemas.find((p) => p.campo === campo);

  const crear = async () => {
    setEnviando(true);
    setError(null);
    const { data, error: err } = await crearMiRecinto({
      nombre: nombre.trim(),
      direccion: draft.direccion,
      comuna: draft.comuna,
      region: draft.region,
      latitud: draft.latitud,
      longitud: draft.longitud,
      descripcion: descripcion.trim() || null,
    });
    setEnviando(false);

    if (err || !data?.ok) {
      setError(err?.message || data?.reason || 'No pudimos crear el recinto.');
      return;
    }
    // `replace` y no `navigate`: volver atrás a este formulario después de
    // crear el recinto no tiene sentido — la autorización ya se gastó.
    navigation.replace('PanelRecinto', { complejoId: data.complejo_id, nombre: nombre.trim() });
  };

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <Text style={styles.headerTitle}>Crear mi recinto</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 16 }}>
            <NoticeCard tone="info" icon={ShieldCheck}>
              Esto crea tu recinto, todavía sin publicar. Después cargas tus canchas, horarios y
              precios, y cuando esté listo nos lo mandas a revisión: publicar pasa por FutFinder.
            </NoticeCard>

            <Card>
              <FieldLabel>Nombre del recinto</FieldLabel>
              <TextField
                value={nombre}
                onChangeText={setNombre}
                placeholder="Ej: Complejo Deportivo El Bosque"
                maxLength={80}
              />
              {problemaDe('nombre') && nombre.length > 0 ? (
                <Text style={styles.errorCampo}>{problemaDe('nombre').texto}</Text>
              ) : null}
            </Card>

            <Card>
              <FieldLabel>Dirección</FieldLabel>
              <Text style={styles.ayuda}>
                Escribe y elige una de las sugerencias. De ahí salen la comuna y el punto del mapa
                con el que los jugadores te van a encontrar.
              </Text>
              <View style={{ marginTop: 11 }}>
                <LocationAutocomplete
                  value={ubicacion.direccion}
                  onChangeText={(texto) => setUbicacion((u) => escribirDireccion(u, texto))}
                  onSelect={(sel) => setUbicacion((u) => seleccionarLugar(u, sel))}
                />
              </View>

              {draft.comuna ? (
                <View style={styles.ubicacion}>
                  <MapPin color={C.green} size={13} strokeWidth={2.2} />
                  <Text style={styles.ubicacionTexto}>
                    {[draft.comuna, draft.region].filter(Boolean).join(', ')}
                    {draft.latitud != null ? ' · punto fijado' : ''}
                  </Text>
                </View>
              ) : null}

              {problemaDe('direccion') && ubicacion.direccion.length > 0 ? (
                <Text style={styles.errorCampo}>{problemaDe('direccion').texto}</Text>
              ) : null}

              <Text style={styles.ayuda}>
                La comuna y el punto los fijas una sola vez acá. Después los corrige el equipo de
                FutFinder: son con los que apareces en el buscador.
              </Text>
            </Card>

            <Card>
              <FieldLabel>Descripción (opcional)</FieldLabel>
              <TextField
                value={descripcion}
                onChangeText={setDescripcion}
                placeholder="Seis canchas de pasto sintético con iluminación, camarines y estacionamiento."
                multiline
                maxLength={500}
                contador
              />
              <Text style={styles.ayuda}>Es lo que lee el jugador antes de reservar. Se puede cambiar después.</Text>
            </Card>

            {error ? <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <StickyFooter>
        <Button
          label="Crear recinto"
          disabled={problemas.length > 0 || enviando}
          loading={enviando}
          onPress={crear}
        />
      </StickyFooter>
    </SafeAreaView>
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
  ubicacionTexto: { fontFamily: F.bold, fontSize: 12.5, color: C.green },
});
