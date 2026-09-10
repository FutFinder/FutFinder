import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, MapPin, Star, ShieldCheck, CalendarDays, CalendarClock,
  ChevronRight, AlertTriangle, LayoutGrid, Clock, ShoppingBag,
  FileText, Users, Globe, EyeOff,
} from 'lucide-react-native';

import { reservas as C, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, Badge, ListRow, SectionLabel, Sheet, NoticeCard } from '../components/reservas/ui';
import { Skeleton, StatTrio, StatusBanner } from '../components/reservas/recintoUi';
import NotificationBell from '../components/NotificationBell';
import {
  misRecintos, agendaDelDia, reservasProximas, canchasDelRecinto, publicarRecinto,
} from '../services/recinto';
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
  const [canchas, setCanchas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [hoja, setHoja] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [errorPublicar, setErrorPublicar] = useState(null);

  const cargar = useCallback(async () => {
    const hoy = hoyISO();
    const [lista, agenda, prox, ks] = await Promise.all([
      misRecintos(),
      agendaDelDia(complejoId, hoy),
      reservasProximas(complejoId, 20),
      canchasDelRecinto(complejoId),
    ]);
    const mio = (lista.data || []).find((r) => r.id === complejoId) || null;
    setRecinto(mio);
    setVarios((lista.data || []).length > 1);
    setResumen(resumenDelPanel(agenda.data?.resumen));
    setProximas(prox.data || null);
    setCanchas(ks.data || []);
    setError(lista.error?.message || agenda.error?.message || prox.error?.message || null);
    setCargando(false);
  }, [complejoId]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const publicado = recinto?.publicado;
  const esDueno = recinto?.rol === 'dueño';

  // La misma condición que exige `admin_publicar_complejo`. Se comprueba acá
  // para poder decir QUÉ falta antes de que el servidor rechace; el mensaje
  // que se muestra si igual se envía es el del servidor.
  const listaParaPublicar = canchas.some((k) => k.activa && k.tiene_horario);
  // El servidor PERMITE estar publicado con todas las canchas apagadas, así
  // que la app tiene que empujar a salir de ahí: el jugador te encuentra y ve
  // el recinto vacío, que se lee peor que no aparecer.
  const publicadoSinCanchas = publicado && canchas.length > 0 && !canchas.some((k) => k.activa);

  const cambiarPublicado = async (aPublicar) => {
    setPublicando(true);
    setErrorPublicar(null);
    const { error: err } = await publicarRecinto(complejoId, aPublicar);
    setPublicando(false);
    if (err) { setErrorPublicar(err.message); return; }
    setHoja(false);
    cargar();
  };

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      {!cargando && recinto && !publicado ? (
        <StatusBanner texto="No estás publicado · nadie puede reservarte" tono="amber" />
      ) : !cargando && publicadoSinCanchas ? (
        <StatusBanner
          texto="Apareces, pero sin ninguna hora para reservar: todas tus canchas están inactivas"
          tono="red"
          accion="Activar"
          onPress={() => navigation.navigate('Canchas', { complejoId, nombre: recinto?.nombre })}
        />
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
                  onPress={() => navigation.navigate('CalendarioCancha', { complejoId, nombre: recinto.nombre })}
                />
                <ListRow
                  icon={LayoutGrid}
                  title="Canchas"
                  subtitle={
                    resumen
                      ? `${resumen.canchasTotal} ${resumen.canchasTotal === 1 ? 'cancha' : 'canchas'}`
                        + (resumen.canchasTotal - resumen.canchasActivas > 0
                          ? ` · ${resumen.canchasTotal - resumen.canchasActivas} inactiva${resumen.canchasTotal - resumen.canchasActivas === 1 ? '' : 's'}`
                          : '')
                      : 'Crear, editar y activar canchas'
                  }
                  right={<ChevronRight color={C.textSecondary} size={17} strokeWidth={2.2} />}
                  onPress={() => navigation.navigate('Canchas', { complejoId, nombre: recinto.nombre })}
                />
                <ListRow
                  icon={Clock}
                  title="Horarios y tarifas"
                  subtitle="Por cancha: cuándo abre y cuánto cobra"
                  right={<ChevronRight color={C.textSecondary} size={17} strokeWidth={2.2} />}
                  onPress={() => navigation.navigate('Canchas', { complejoId, nombre: recinto.nombre })}
                />
                <ListRow
                  icon={ShoppingBag}
                  title="Cobros adicionales"
                  subtitle="Balón, petos, árbitro · opcionales para el jugador"
                  right={<ChevronRight color={C.textSecondary} size={17} strokeWidth={2.2} />}
                  onPress={() => navigation.navigate('Cobros', { complejoId, nombre: recinto.nombre })}
                />
                <ListRow
                  icon={FileText}
                  title="Ficha del recinto"
                  subtitle="Nombre, descripción, dirección y foto"
                  right={<ChevronRight color={C.textSecondary} size={17} strokeWidth={2.2} />}
                  last={!esDueno}
                  onPress={() => navigation.navigate('FichaRecinto', { complejoId })}
                />
                {esDueno ? (
                  <ListRow
                    icon={Users}
                    title="Administradores"
                    subtitle="Solo tú puedes cambiar esta lista"
                    right={<ChevronRight color={C.textSecondary} size={17} strokeWidth={2.2} />}
                    last
                    onPress={() => navigation.navigate('Administradores', { complejoId, nombre: recinto.nombre })}
                  />
                ) : null}
              </Card>
            </View>

            <Card>
              {publicado ? (
                <>
                  <Text style={styles.publicarTitulo}>Estás recibiendo reservas</Text>
                  <Text style={styles.publicarTexto}>
                    Apareces en el buscador y cualquiera puede reservar tus canchas disponibles.
                  </Text>
                  <Button
                    label="Dejar de recibir reservas"
                    variant="secondary"
                    icon={EyeOff}
                    style={{ marginTop: 13 }}
                    onPress={() => { setErrorPublicar(null); setHoja(true); }}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.publicarTitulo}>Todavía no apareces en la app</Text>
                  <Text style={styles.publicarTexto}>
                    {listaParaPublicar
                      ? 'Ya tienes al menos una cancha activa con horario cargado: puedes publicar cuando quieras.'
                      : 'Para publicar necesitas al menos una cancha activa con horario cargado.'}
                  </Text>
                  {!listaParaPublicar ? (
                    <View style={styles.faltaCaja}>
                      <Text style={styles.faltaTexto}>
                        {canchas.length === 0
                          ? 'Todavía no tienes canchas.'
                          : `${canchas.filter((k) => k.activa).length} de ${canchas.length} canchas activas, y ninguna con horario cargado.`}
                      </Text>
                      <Button
                        label={canchas.length === 0 ? 'Crear la primera cancha' : 'Cargar horarios'}
                        variant="secondary"
                        onPress={() => navigation.navigate('Canchas', { complejoId, nombre: recinto.nombre })}
                      />
                    </View>
                  ) : (
                    <Button
                      label="Publicar recinto"
                      icon={Globe}
                      style={{ marginTop: 13 }}
                      loading={publicando}
                      onPress={() => cambiarPublicado(true)}
                    />
                  )}
                  {errorPublicar ? (
                    <View style={{ marginTop: 12 }}>
                      <NoticeCard tone="warning" icon={AlertTriangle}>{errorPublicar}</NoticeCard>
                    </View>
                  ) : null}
                </>
              )}
            </Card>

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

      <HojaDespublicar
        visible={hoja}
        nombre={recinto?.nombre}
        proximas={proximas}
        enviando={publicando}
        error={errorPublicar}
        onCerrar={() => setHoja(false)}
        onConfirmar={() => cambiarPublicado(false)}
      />
    </SafeAreaView>
  );
}

/**
 * La hoja de despublicar (artboard 4h). Es donde el dueño decide si confía en
 * la app, así que dice exactamente qué pasa — y sobre todo qué NO pasa.
 *
 * DESPUBLICAR NO CANCELA NADA. Es justo lo que se teme al apretar el
 * interruptor, y lista las reservas que quedan por jugar con su monto: el dato
 * que decide no es «tienes 3 pendientes», es cuáles y cuánto.
 */
function HojaDespublicar({ visible, nombre, proximas, enviando, error, onCerrar, onConfirmar }) {
  const reservas = proximas?.reservas || [];
  const total = Number(proximas?.total) || 0;

  return (
    <Sheet visible={visible} onClose={onCerrar} title="¿Dejar de recibir reservas?">
      <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
        <View style={{ gap: 15, paddingBottom: 6 }}>
          <View style={{ gap: 9 }}>
            <Consecuencia>{nombre} deja de aparecer en el buscador</Consecuencia>
            <Consecuencia>No entran reservas nuevas en ninguna cancha</Consecuencia>
            <Consecuencia fuerte>Las reservas ya confirmadas se respetan tal cual</Consecuencia>
          </View>

          {total > 0 ? (
            <Card>
              <Text style={styles.porJugarTitulo}>
                Tienes por jugar {total} {total === 1 ? 'reserva' : 'reservas'}
              </Text>
              <View style={{ gap: 9, marginTop: 11 }}>
                {reservas.slice(0, 5).map((r) => (
                  <View key={r.id} style={styles.porJugarFila}>
                    <Text style={styles.porJugarHora}>
                      {fechaRelativa(r.fecha).toLowerCase()} {r.hora_inicio}
                    </Text>
                    <Text style={styles.porJugarQuien} numberOfLines={1}>
                      {r.cancha_nombre} · @{r.organizador_username}
                    </Text>
                    <Text style={styles.porJugarMonto}>{formatCLP(r.precio_total)}</Text>
                  </View>
                ))}
                {total > 5 ? (
                  <Text style={styles.porJugarMas}>y {total - 5} más</Text>
                ) : null}
              </View>
              <Text style={styles.porJugarNota}>
                Las vas a seguir viendo en tu agenda y el jugador también. Si necesitas liberar una de
                esas horas, tienes que cancelar esa reserva, que es otra cosa.
              </Text>
            </Card>
          ) : null}

          <NoticeCard tone="info">
            Desactivar una cancha saca esa cancha y las otras siguen recibiendo. Despublicar saca el
            recinto completo del buscador.
          </NoticeCard>

          {error ? <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard> : null}

          <View style={{ gap: 9 }}>
            <Button label="Despublicar" variant="destructive" loading={enviando} onPress={onConfirmar} />
            <Button label="Seguir publicado" variant="secondary" onPress={onCerrar} />
          </View>
          <Text style={styles.volverNota}>Puedes volver a publicar cuando quieras, con un toque.</Text>
        </View>
      </ScrollView>
    </Sheet>
  );
}

function Consecuencia({ children, fuerte }) {
  return (
    <View style={styles.consecuencia}>
      <View style={[styles.punto, fuerte && { backgroundColor: C.green }]} />
      <Text style={[styles.consecuenciaTexto, fuerte && styles.consecuenciaFuerte]}>{children}</Text>
    </View>
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
  publicarTitulo: { fontFamily: F.extraBold, fontSize: 15.5, color: C.textPrimary },
  publicarTexto: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, lineHeight: 18, marginTop: 6 },
  faltaCaja: {
    marginTop: 13, padding: 12, gap: 11,
    borderRadius: 18, backgroundColor: C.amberSoft, borderWidth: 1, borderColor: C.amberBorder,
  },
  faltaTexto: { fontFamily: F.semiBold, fontSize: 12.5, color: C.textAmber, lineHeight: 17.5 },

  consecuencia: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  punto: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.textSecondary, marginTop: 6 },
  consecuenciaTexto: { flex: 1, fontFamily: F.medium, fontSize: 13, color: C.textSecondary, lineHeight: 18.5 },
  consecuenciaFuerte: { fontFamily: F.bold, color: C.textPrimary },

  porJugarTitulo: { fontFamily: F.extraBold, fontSize: 14, color: C.textPrimary },
  porJugarFila: { flexDirection: 'row', alignItems: 'baseline', gap: 9 },
  porJugarHora: { width: 78, fontFamily: F.bold, fontSize: 12, color: C.textPrimary },
  porJugarQuien: { flex: 1, fontFamily: F.medium, fontSize: 12, color: C.textSecondary },
  porJugarMonto: { fontFamily: F.semiBold, fontSize: 12, color: C.textPrimary },
  porJugarMas: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary },
  porJugarNota: {
    fontFamily: F.medium, fontSize: 11, color: C.textSecondary, lineHeight: 15.5,
    marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.dividerInner,
  },
  volverNota: { fontFamily: F.medium, fontSize: 11, color: C.textMuted, textAlign: 'center' },

  dineroTitulo: { fontFamily: F.extraBold, fontSize: 16, color: C.textPrimary },
  dineroDetalle: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, lineHeight: 18, marginTop: 6 },
});
