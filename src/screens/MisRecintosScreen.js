import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, MapPin, ChevronRight, Building2, AlertTriangle } from 'lucide-react-native';

import { reservas as C, reservasRadius as R, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, Badge, NoticeCard } from '../components/reservas/ui';
import { Skeleton, Pasos } from '../components/reservas/recintoUi';
import { misRecintos } from '../services/recinto';

/**
 * «Mis recintos» (artboards 1c, 1d y 1e del handoff del recinto).
 *
 * NO TIENE BOTÓN DE CREAR, y no es un olvido: los recintos los da de alta el
 * equipo de FutFinder. El vacío tiene que explicar esa fricción de frente en
 * vez de dejar a alguien buscando un botón que no existe.
 *
 * Con un solo recinto esta pantalla se salta —el acceso de Reservas entra
 * directo al panel— así que en la práctica solo la ve quien administra dos o
 * más. Existe igual porque el cambio de recinto vive acá.
 */
export default function MisRecintosScreen({ navigation }) {
  const [recintos, setRecintos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    const { data, error: err } = await misRecintos();
    setError(err?.message || null);
    setRecintos(data || []);
    setCargando(false);
  }, []);

  // Al volver del panel: si allá se publicó o despublicó, la lista tiene que
  // reflejarlo sin obligar a bajar a refrescar.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const abrir = (recinto) =>
    navigation.navigate('PanelRecinto', { complejoId: recinto.id, nombre: recinto.nombre });

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <Text style={styles.headerTitle}>Mis recintos</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={cargar} tintColor={C.green} />}
      >
        {cargando ? (
          <View style={{ gap: S.cardGap }}>
            {[0, 1].map((i) => (
              <Card key={i}>
                <Skeleton height={16} width="60%" />
                <Skeleton height={12} width="40%" style={{ marginTop: 9 }} />
              </Card>
            ))}
          </View>
        ) : error ? (
          <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard>
        ) : recintos.length === 0 ? (
          <Vacio navigation={navigation} />
        ) : (
          <View style={{ gap: S.cardGap }}>
            {recintos.map((r) => (
              <Card key={r.id} onPress={() => abrir(r)}>
                <View style={styles.fila}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.tituloFila}>
                      <Text style={styles.nombre} numberOfLines={1}>{r.nombre}</Text>
                      {!r.publicado ? <Badge label="No publicado" tone="amber" /> : null}
                    </View>
                    <View style={styles.ubicacionFila}>
                      <MapPin color={C.textSecondary} size={12} strokeWidth={2.2} />
                      <Text style={styles.ubicacion} numberOfLines={1}>
                        {[r.comuna, r.region].filter(Boolean).join(', ')}
                      </Text>
                    </View>
                    <Text style={styles.rol}>{r.rol === 'dueño' ? 'Eres dueño' : 'Eres administrador'}</Text>
                  </View>
                  <ChevronRight color={C.textSecondary} size={18} strokeWidth={2.2} />
                </View>
              </Card>
            ))}
            <Text style={styles.pie}>
              ¿Te falta un recinto acá? Los da de alta el equipo de FutFinder.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Artboard 1d: sin recintos, sin botón de crear, con la fricción explicada. */
function Vacio({ navigation }) {
  return (
    <View style={{ gap: 16 }}>
      <Card>
        <View style={styles.vacioIcono}>
          <Building2 color={C.green} size={22} strokeWidth={2} />
        </View>
        <Text style={styles.vacioTitulo}>Todavía no administras ningún recinto</Text>
        <Text style={styles.vacioTexto}>
          Los recintos los da de alta el equipo de FutFinder. Cuéntanos de tu complejo y te dejamos
          como dueño para que lo administres desde acá.
        </Text>
      </Card>

      <Card>
        <Text style={styles.vacioSubtitulo}>Cómo se solicita</Text>
        <Pasos
          pasos={[
            'Nos escribes con el nombre y la dirección del complejo',
            'Verificamos los datos (1 a 2 días hábiles)',
            'Te contactamos para agregar tu recinto a FutFinder',
          ]}
        />
      </Card>

      <Button label="Escribir a FutFinder" onPress={() => navigation.navigate('ReportarProblema')} />
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
  headerTitle: { flex: 1, fontFamily: F.extraBold, fontSize: 20, color: C.textPrimary },
  scroll: { paddingHorizontal: S.screenPadding, paddingBottom: 40 },

  fila: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tituloFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nombre: { flexShrink: 1, fontFamily: F.extraBold, fontSize: 16, color: C.textPrimary },
  ubicacionFila: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  ubicacion: { flex: 1, fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary },
  rol: { fontFamily: F.semiBold, fontSize: 12, color: C.green, marginTop: 6 },
  pie: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, lineHeight: 17, marginTop: 4 },

  vacioIcono: {
    width: 44, height: 44, borderRadius: R.cardSm,
    backgroundColor: C.shieldBg, borderWidth: 1, borderColor: C.greenDeepBorder,
    alignItems: 'center', justifyContent: 'center', marginBottom: 13,
  },
  vacioTitulo: { fontFamily: F.extraBold, fontSize: 17, color: C.textPrimary, marginBottom: 8 },
  vacioTexto: { fontFamily: F.medium, fontSize: 13.5, color: C.textSecondary, lineHeight: 19 },
  vacioSubtitulo: { fontFamily: F.extraBold, fontSize: 14, color: C.textPrimary, marginBottom: 13 },
});
