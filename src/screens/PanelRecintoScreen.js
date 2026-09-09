import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, MapPin, Star, ShieldCheck, CalendarDays, CalendarClock,
  ChevronRight, AlertTriangle,
} from 'lucide-react-native';

import { reservas as C, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Badge, ListRow, SectionLabel, NoticeCard } from '../components/reservas/ui';
import { Skeleton, StatTrio, StatusBanner } from '../components/reservas/recintoUi';
import NotificationBell from '../components/NotificationBell';
import { misRecintos, agendaDelDia, reservasProximas } from '../services/recinto';
import { resumenDelPanel } from '../utils/recintoAgenda';
import { hoyISO, fechaRelativa } from '../utils/recintoPantallas';
import { formatCLP } from '../services/reservasRules';

/**
 * Panel del recinto (artboards 1f, 1h, 4g y 4i).
 *
 * NO HAY PERMISOS PARCIALES. El panel de un `admin` es idéntico al del dueño
 * salvo la sección de Administradores: las funciones del servidor validan que
 * quien llama administre esa cancha, sin mirar si es dueño o admin. Esconderle
 * secciones a un admin sería mentir sobre lo que puede hacer.
 *
 * EL ESTADO «NO PUBLICADO» VA EN UNA FRANJA FIJA, no en un badge más: es la
 * diferencia entre estar recibiendo reservas y no, y tiene que notarse antes
 * de leer nada.
 *
 * Todavía faltan por construir las secciones de configuración (canchas,
 * horarios, tarifas, cobros adicionales, ficha, administradores e ingresos).
 * Se listan solo las que existen: una fila que no lleva a ninguna parte es
 * peor que una fila que todavía no está.
 */
export default function PanelRecintoScreen({ navigation, route }) {
  const { complejoId } = route.params || {};
  const [recinto, setRecinto] = useState(null);
  const [varios, setVarios] = useState(false);
  const [resumen, setResumen] = useState(null);
  const [proximas, setProximas] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    const hoy = hoyISO();
    const [lista, agenda, prox] = await Promise.all([
      misRecintos(),
      agendaDelDia(complejoId, hoy),
      reservasProximas(complejoId, 3),
    ]);
    const mio = (lista.data || []).find((r) => r.id === complejoId) || null;
    setRecinto(mio);
    setVarios((lista.data || []).length > 1);
    setResumen(resumenDelPanel(agenda.data?.resumen));
    setProximas(prox.data || null);
    setError(lista.error?.message || agenda.error?.message || prox.error?.message || null);
    setCargando(false);
  }, [complejoId]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const publicado = recinto?.publicado;

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      {!cargando && recinto && !publicado ? (
        <StatusBanner texto="No estás publicado · nadie puede reservarte" tono="amber" />
      ) : null}

      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <Text style={styles.headerTitle} numberOfLines={1}>
          {recinto?.nombre || route.params?.nombre || 'Mi recinto'}
        </Text>
        {varios ? (
          <Text
            style={styles.cambiar}
            accessibilityRole="button"
            onPress={() => navigation.navigate('MisRecintos')}
          >
            Cambiar
          </Text>
        ) : null}
        <NotificationBell />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={cargar} tintColor={C.green} />}
      >
        {cargando ? (
          <View style={{ gap: S.cardGap }}>
            <Card><Skeleton height={18} width="70%" /><Skeleton height={12} width="45%" style={{ marginTop: 10 }} /></Card>
            <Card><Skeleton height={54} /></Card>
            <Card><Skeleton height={90} /></Card>
          </View>
        ) : error ? (
          <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard>
        ) : !recinto ? (
          <NoticeCard tone="warning" icon={AlertTriangle}>
            No encontramos este recinto entre los que administras.
          </NoticeCard>
        ) : (
          <View style={{ gap: 16 }}>
            <Cabecera recinto={recinto} />

            <StatTrio
              items={[
                { valor: resumen?.reservasConfirmadas ?? 0, rotulo: 'reservas hoy' },
                { valor: `${resumen?.canchasActivas ?? 0}/${resumen?.canchasTotal ?? 0}`, rotulo: 'canchas activas' },
                { valor: resumen?.bloqueos ?? 0, rotulo: 'horas ocupadas hoy' },
              ]}
            />

            <View style={{ gap: 10 }}>
              <SectionLabel right={proximas?.total ? `${proximas.total} por jugar` : undefined}>
                Próximas reservas
              </SectionLabel>
              <Card padded={false}>
                {(proximas?.reservas || []).length === 0 ? (
                  <Text style={styles.sinProximas}>
                    No tienes reservas por jugar. Cuando alguien reserve, aparece acá.
                  </Text>
                ) : (
                  (proximas.reservas || []).map((r, i, arr) => (
                    <ListRow
                      key={r.id}
                      title={`${r.hora_inicio} · ${r.cancha_nombre}`}
                      subtitle={`${fechaRelativa(r.fecha)} · @${r.organizador_username} · ${formatCLP(r.precio_total)}`}
                      right={<ChevronRight color={C.textSecondary} size={17} strokeWidth={2.2} />}
                      last={i === arr.length - 1}
                      onPress={() => navigation.navigate('ReservaRecinto', { reservaId: r.id })}
                    />
                  ))
                )}
              </Card>
            </View>

            <View style={{ gap: 10 }}>
              <SectionLabel>Administrar</SectionLabel>
              <Card padded={false}>
                <ListRow
                  icon={CalendarDays}
                  title="Agenda del día"
                  subtitle="Lo que pasa hoy en todo el recinto"
                  right={<ChevronRight color={C.textSecondary} size={17} strokeWidth={2.2} />}
                  onPress={() => navigation.navigate('AgendaRecinto', { complejoId, nombre: recinto.nombre })}
                />
                <ListRow
                  icon={CalendarClock}
                  title="Calendario y bloqueos"
                  subtitle={resumen?.bloqueos ? `${resumen.bloqueos} horas ocupadas hoy` : 'Ocupar horas cancha por cancha'}
                  right={<ChevronRight color={C.textSecondary} size={17} strokeWidth={2.2} />}
                  last
                  onPress={() => navigation.navigate('CalendarioCancha', { complejoId, nombre: recinto.nombre })}
                />
              </Card>
            </View>

            {resumen?.bruto ? (
              <Card>
                <Text style={styles.dineroTitulo}>Hoy llevas {formatCLP(resumen.neto)}</Text>
                <Text style={styles.dineroDetalle}>
                  {formatCLP(resumen.bruto)} en reservas confirmadas, menos {formatCLP(resumen.comision)} de comisión
                  FutFinder. Te lo pagamos de 1 a 2 días hábiles después de que se jugó el partido.
                </Text>
              </Card>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Cabecera({ recinto }) {
  const tieneRating = Number(recinto.rating_count) > 0;
  return (
    <Card>
      <Text style={styles.nombre}>{recinto.nombre}</Text>
      {recinto.direccion ? (
        <View style={styles.filaIcono}>
          <MapPin color={C.textSecondary} size={12.5} strokeWidth={2.2} />
          <Text style={styles.direccion} numberOfLines={2}>{recinto.direccion}</Text>
        </View>
      ) : null}
      {tieneRating ? (
        <View style={styles.filaIcono}>
          <Star color={C.green} size={12.5} strokeWidth={2.4} />
          <Text style={styles.direccion}>
            {Number(recinto.rating_avg).toFixed(1)} · {recinto.rating_count} calificaciones
          </Text>
        </View>
      ) : null}
      <View style={styles.badges}>
        <Badge label={recinto.publicado ? 'Publicado' : 'No publicado'} tone={recinto.publicado ? 'green' : 'amber'} />
        {recinto.verificado_futfinder ? <Badge label="Verificado" tone="green" /> : null}
        <Badge label={recinto.rol === 'dueño' ? 'Eres dueño' : 'Eres administrador'} tone="neutral" />
      </View>
      {!recinto.publicado ? (
        <View style={styles.avisoPublicar}>
          <ShieldCheck color={C.textAmber} size={15} strokeWidth={2.2} style={{ marginTop: 1 }} />
          <Text style={styles.avisoPublicarTexto}>
            No apareces en el buscador y no entran reservas nuevas. Las que ya tienes siguen en pie.
          </Text>
        </View>
      ) : null}
    </Card>
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
  cambiar: { fontFamily: F.bold, fontSize: 13, color: C.green },
  scroll: { paddingHorizontal: S.screenPadding, paddingBottom: 40 },

  nombre: { fontFamily: F.extraBold, fontSize: 19, color: C.textPrimary },
  filaIcono: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 7 },
  direccion: { flex: 1, fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, lineHeight: 17 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12 },
  avisoPublicar: { flexDirection: 'row', gap: 7, marginTop: 12 },
  avisoPublicarTexto: { flex: 1, fontFamily: F.medium, fontSize: 12, color: C.textAmber, lineHeight: 16.5 },

  sinProximas: {
    fontFamily: F.medium, fontSize: 13, color: C.textSecondary,
    lineHeight: 18, paddingHorizontal: 15, paddingVertical: 18,
  },
  dineroTitulo: { fontFamily: F.extraBold, fontSize: 16, color: C.textPrimary },
  dineroDetalle: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, lineHeight: 18, marginTop: 6 },
});
