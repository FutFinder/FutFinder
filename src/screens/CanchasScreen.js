import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Plus, ChevronRight, AlertTriangle } from 'lucide-react-native';

import { reservas as C, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, Chip, Badge, NoticeCard, StickyFooter } from '../components/reservas/ui';
import { Skeleton } from '../components/reservas/recintoUi';
import { canchasDelRecinto } from '../services/recinto';
import { pluraliza } from '../utils/recintoPantallas';
import { formatCLP } from '../services/reservasRules';

const TIPOS = {
  futbol_5: 'Fútbol 5',
  futbol_7: 'Fútbol 7',
  futbol_11: 'Fútbol 11',
};

/**
 * Las canchas del recinto (artboards 1k y 1l).
 *
 * UNA CANCHA INACTIVA NO SE BORRA NI SE ESCONDE. Sigue en la lista con su
 * estado a la vista: desactivarla es dejar de recibir reservas, no hacerla
 * desaparecer, y sus reservas históricas siguen apuntando a ella. Por eso el
 * filtro por defecto es «Todas».
 *
 * LO QUE LE FALTA A CADA CANCHA SE MUESTRA ACÁ. «Sin horario» no es un
 * detalle: una cancha activa sin horario cargado no tiene ni un bloque
 * reservable, y además es lo que impide publicar el recinto entero. Vale más
 * decirlo en la lista que hacer que alguien lo descubra al intentar publicar.
 */
export default function CanchasScreen({ navigation, route }) {
  const { complejoId, nombre } = route.params || {};
  const [canchas, setCanchas] = useState([]);
  const [filtro, setFiltro] = useState('todas');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    const { data, error: err } = await canchasDelRecinto(complejoId);
    setCanchas(data || []);
    setError(err?.message || null);
    setCargando(false);
  }, [complejoId]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const activas = canchas.filter((k) => k.activa).length;
  const inactivas = canchas.length - activas;

  const visibles = useMemo(() => {
    if (filtro === 'activas') return canchas.filter((k) => k.activa);
    if (filtro === 'inactivas') return canchas.filter((k) => !k.activa);
    return canchas;
  }, [canchas, filtro]);

  const abrir = (canchaId) =>
    navigation.navigate('Cancha', { complejoId, canchaId, complejoNombre: nombre });

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Canchas</Text>
          {nombre ? <Text style={styles.headerSub} numberOfLines={1}>{nombre}</Text> : null}
        </View>
      </View>

      {canchas.length > 0 ? (
        <View style={styles.filtros}>
          <Chip label={`Todas · ${canchas.length}`} active={filtro === 'todas'} onPress={() => setFiltro('todas')} />
          <Chip label={`Activas · ${activas}`} active={filtro === 'activas'} onPress={() => setFiltro('activas')} />
          {inactivas > 0 ? (
            <Chip
              label={`Inactivas · ${inactivas}`}
              active={filtro === 'inactivas'}
              onPress={() => setFiltro('inactivas')}
            />
          ) : null}
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={cargar} tintColor={C.green} />}
      >
        {cargando ? (
          <View style={{ gap: S.cardGap }}>
            {[0, 1, 2].map((i) => (
              <Card key={i}><Skeleton height={16} width="55%" /><Skeleton height={12} width="70%" style={{ marginTop: 9 }} /></Card>
            ))}
          </View>
        ) : error ? (
          <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard>
        ) : canchas.length === 0 ? (
          <Card>
            <Text style={styles.vacioTitulo}>Sin canchas todavía</Text>
            <Text style={styles.vacioTexto}>
              Una cancha es cada superficie que arriendas por hora. Crea la primera con su tipo, su
              precio y cuánto dura cada bloque.
            </Text>
          </Card>
        ) : (
          <View style={{ gap: S.cardGap }}>
            {visibles.map((k) => (
              <Card key={k.id} onPress={() => abrir(k.id)} style={!k.activa && styles.apagada}>
                <View style={styles.fila}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nombre} numberOfLines={1}>{k.nombre}</Text>
                    <Text style={styles.detalle} numberOfLines={1}>
                      {TIPOS[k.tipo] || k.tipo} · bloques de {k.duracion_slot_min} min
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.precio}>{formatCLP(k.precio_hora)}</Text>
                    <Text style={styles.precioSub}>/hora</Text>
                  </View>
                  <ChevronRight color={C.textSecondary} size={17} strokeWidth={2.2} />
                </View>

                <View style={styles.badges}>
                  {k.activa ? (
                    <Badge label="Activa" tone="green" />
                  ) : (
                    <Badge label="Inactiva · no recibe reservas" tone="neutral" />
                  )}
                  {k.tiene_horario ? (
                    <Badge
                      label={k.dias_con_horario === 7 ? 'Todos los días' : `${pluraliza(k.dias_con_horario, 'día', 'días')} con horario`}
                      tone="neutral"
                    />
                  ) : (
                    <Badge label="Sin horario" tone="amber" />
                  )}
                  {k.tiene_tarifas ? <Badge label="Con tarifas" tone="neutral" /> : null}
                </View>

                {k.activa && !k.tiene_horario ? (
                  <Text style={styles.aviso}>
                    Activa pero sin horario: no tiene ni un bloque reservable, y mientras siga así no
                    puedes publicar el recinto.
                  </Text>
                ) : null}
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      {!cargando && !error ? (
        <StickyFooter>
          <Button
            label={canchas.length === 0 ? 'Crear cancha' : 'Agregar cancha'}
            icon={Plus}
            onPress={() => navigation.navigate('Cancha', { complejoId, complejoNombre: nombre })}
          />
        </StickyFooter>
      ) : null}
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
    paddingBottom: 10,
  },
  headerTitle: { fontFamily: F.extraBold, fontSize: 20, color: C.textPrimary },
  headerSub: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 2 },
  filtros: { flexDirection: 'row', gap: 8, paddingHorizontal: S.screenPadding, paddingBottom: 12 },
  scroll: { paddingHorizontal: S.screenPadding, paddingBottom: 110 },

  apagada: { opacity: 0.72 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nombre: { fontFamily: F.extraBold, fontSize: 16, color: C.textPrimary },
  detalle: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 3 },
  precio: { fontFamily: F.extraBold, fontSize: 15, color: C.textPrimary },
  precioSub: { fontFamily: F.medium, fontSize: 10.5, color: C.textSecondary },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  aviso: {
    fontFamily: F.medium, fontSize: 11.5, color: C.textAmber, lineHeight: 16,
    marginTop: 11, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.dividerInner,
  },

  vacioTitulo: { fontFamily: F.extraBold, fontSize: 17, color: C.textPrimary },
  vacioTexto: { fontFamily: F.medium, fontSize: 13.5, color: C.textSecondary, lineHeight: 19, marginTop: 8 },
});
