import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Image as ImageIcon, MapPin, AlertTriangle } from 'lucide-react-native';

import { reservas as C, reservasRadius as R, reservasFonts as F } from '../theme/colors';
import { Badge, IconButton, NoticeCard, StickyFooter, Button } from '../components/reservas/ui';
import NotificationBell from '../components/NotificationBell';
import { getComplejoById } from '../services/reservas';
import { formatCLP } from '../services/reservasRules';

/** Pantalla 5 del handoff `Reservas.dc.html`: perfil de un complejo. */
export default function ComplejoDetailScreen({ navigation, route }) {
  const { complejoId } = route.params || {};
  const [complejo, setComplejo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await getComplejoById(complejoId);
    setComplejo(data);
    setLoading(false);
  }, [complejoId]);

  useEffect(() => { load(); }, [load]);

  const proximamente = (mensaje) => {
    setToast(mensaje);
    setTimeout(() => setToast(null), 2400);
  };

  const goHorarios = (canchaId) => {
    navigation.navigate('ElegirCancha', { complejoId, canchaId });
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.center}>
          <ActivityIndicator color={C.green} />
        </View>
      </SafeAreaView>
    );
  }

  if (!complejo) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.header}>
          <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        </View>
        <View style={styles.center}>
          <AlertTriangle color={C.red} size={28} strokeWidth={1.8} />
          <Text style={styles.errorText}>No encontramos este complejo.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const hayCanchas = complejo.canchas.length > 0;

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.photo}>
          <ImageIcon color={C.textMuted} size={26} strokeWidth={1.6} />
          <IconButton
            icon={ArrowLeft}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Volver"
            style={styles.photoBack}
          />
          <View style={styles.photoBell}>
            <NotificationBell />
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.nombre}>{complejo.nombre}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>★ {complejo.rating}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>({complejo.reseñas})</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{complejo.sector}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{complejo.distanciaKm} km</Text>
          </View>
          <Text style={styles.descripcion}>{complejo.descripcion}</Text>

          <Text style={styles.sectionLabel}>SERVICIOS</Text>
          <View style={styles.tagsRow}>
            {complejo.servicios.map((s) => (
              <Badge key={s} label={s} tone="neutral" />
            ))}
          </View>

          <Text style={styles.sectionLabel}>CANCHAS · {complejo.canchas.length}</Text>
          {hayCanchas ? (
            <View style={{ gap: 11 }}>
              {complejo.canchas.map((k) => (
                <View key={k.id} style={styles.canchaRow}>
                  <View style={styles.canchaThumb} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.canchaNombre}>{k.nombre}</Text>
                    <Text style={styles.canchaNota} numberOfLines={1}>{k.tipo} · {k.nota}</Text>
                    <Text style={styles.canchaPrecio}>
                      {formatCLP(k.total)}<Text style={styles.canchaPrecioSub}> / hora</Text>
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => goHorarios(k.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Ver horarios de ${k.nombre}`}
                    style={({ pressed }) => [styles.horariosBtn, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={styles.horariosBtnText}>Horarios</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <NoticeCard tone="info">Este complejo todavía no tiene canchas cargadas.</NoticeCard>
          )}

          <Text style={styles.sectionLabel}>UBICACIÓN</Text>
          <View style={styles.mapCard}>
            <View style={styles.mapArt}>
              <View style={styles.mapDot} />
            </View>
            <View style={styles.direccionRow}>
              <Text style={styles.direccionText} numberOfLines={1}>{complejo.direccion}</Text>
              <Pressable
                onPress={() => proximamente('Muy pronto vas a poder trazar la ruta desde aquí.')}
                style={({ pressed }) => [styles.comoLlegarBtn, pressed && { opacity: 0.85 }]}
              >
                <MapPin color={C.textPrimary} size={13} strokeWidth={2} />
                <Text style={styles.comoLlegarText}>Cómo llegar</Text>
              </Pressable>
            </View>
          </View>

          {toast ? (
            <View style={{ marginTop: 14 }}>
              <NoticeCard tone="info">{toast}</NoticeCard>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {hayCanchas && (
        <StickyFooter>
          <View style={styles.footerRow}>
            <View>
              <Text style={styles.desdeLabel}>DESDE</Text>
              <Text style={styles.desdePrecio}>{formatCLP(complejo.desde)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Ver horarios" onPress={() => goHorarios(complejo.canchas[0].id)} />
            </View>
          </View>
        </StickyFooter>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  errorText: { fontFamily: F.medium, color: C.textSecondary, fontSize: 13 },
  header: { paddingHorizontal: 16, paddingTop: 10 },

  photo: {
    height: 250, backgroundColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center',
  },
  photoBack: { position: 'absolute', top: 12, left: 16 },
  photoBell: { position: 'absolute', top: 12, right: 16 },

  body: { paddingHorizontal: 20, paddingTop: 18 },
  nombre: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 24, letterSpacing: -0.4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  metaText: { fontFamily: F.semiBold, color: C.textSecondary, fontSize: 13 },
  metaDot: { color: C.textSecondary, fontSize: 13 },
  descripcion: { fontFamily: F.medium, color: '#B4BAB5', fontSize: 13.5, lineHeight: 21, marginTop: 14 },

  sectionLabel: {
    fontFamily: F.bold, fontSize: 11, letterSpacing: 1.5, color: C.textSecondary, marginTop: 26, marginBottom: 12,
  },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  canchaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: R.row, padding: 13,
  },
  canchaThumb: { width: 62, height: 62, borderRadius: 15, flexShrink: 0, backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border },
  canchaNombre: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 15.5 },
  canchaNota: { fontFamily: F.medium, color: C.textSecondary, fontSize: 12, marginTop: 3 },
  canchaPrecio: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 14, marginTop: 6 },
  canchaPrecioSub: { fontFamily: F.semiBold, color: C.textSecondary, fontSize: 11.5 },
  horariosBtn: {
    height: 38, paddingHorizontal: 13, borderRadius: 13, backgroundColor: C.shieldBg, borderWidth: 1, borderColor: C.greenDeepBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  horariosBtnText: { fontFamily: F.extraBold, color: C.green, fontSize: 12.5 },

  mapCard: { borderRadius: R.row, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  mapArt: { height: 120, backgroundColor: '#0B0E0B', alignItems: 'center', justifyContent: 'center' },
  mapDot: {
    width: 12, height: 12, borderRadius: 999, backgroundColor: C.green,
    shadowColor: C.green, shadowOpacity: 0.4, shadowRadius: 10, elevation: 4,
  },
  direccionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, backgroundColor: C.surface },
  direccionText: { flex: 1, fontFamily: F.medium, color: C.textSecondary, fontSize: 12.5 },
  comoLlegarBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12,
    borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surfaceAlt,
  },
  comoLlegarText: { fontFamily: F.bold, color: C.textPrimary, fontSize: 12.5 },

  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  desdeLabel: { fontFamily: F.semiBold, color: C.textMuted, fontSize: 10.5, letterSpacing: 0.6 },
  desdePrecio: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 17, letterSpacing: -0.3, marginTop: 2 },
});
