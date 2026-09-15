import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Plus, AlertTriangle, UserX, Search, SlidersHorizontal, Check,
} from 'lucide-react-native';

import { reservas as C, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, Badge, Sheet, NoticeCard, StickyFooter } from '../components/reservas/ui';
import { Switch } from '../components/reservas/recintoUi';
import {
  PERMISOS, SIEMPRE_PUEDE, permisosCambiaron, permisosDe, resumenDePermisos,
} from '../utils/permisosAdmin';
import { Skeleton, FieldLabel, TextField } from '../components/reservas/recintoUi';
import { useAuth } from '../contexts/AuthContext';
import {
  administradoresDelRecinto, buscarUsuarioPorUsername,
  agregarAdministrador, quitarAdministrador, guardarPermisosAdmin,
} from '../services/recinto';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** 'marzo 2025', para decir desde cuándo está esa persona en FutFinder. */
function desdeCuando(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Administradores del recinto (artboard 1s). Solo el dueño llega acá.
 *
 * LOS PERMISOS SON TRES Y LOS REPARTE EL DUEÑO (migración 83): canchas,
 * cobros y ficha. Un administrador nuevo nace SIN NINGUNO y aun así sirve:
 * el día a día —agenda, calendario, ocupar una hora, cancelar una reserva—
 * no es un permiso y no se puede apagar. Es para lo que se suma a alguien.
 *
 * LAS CASILLAS NO SON UN ADORNO: quien manda es el servidor. Cada permiso se
 * aplica en disparadores sobre las tablas, así que apagarlo acá lo apaga de
 * verdad, incluso para una RPC que se agregue mañana.
 *
 * SE AGREGA A ALGUIEN QUE YA TIENE CUENTA, buscándolo por su `@usuario`. No
 * se crean cuentas ni se piden contraseñas: crear una cuenta a nombre de otra
 * persona, sin que la pida, no corresponde. El vacío de la búsqueda explica
 * esa fricción real en vez de dejarla como un error.
 *
 * LAS FILAS DE DUEÑO NO TRAEN ACCIÓN, ni la de otro dueño ni la propia. Para
 * cambiar un dueño hay que escribirle a FutFinder — es la única forma de que
 * un recinto no se quede sin nadie a cargo por accidente.
 */
export default function AdministradoresScreen({ navigation, route }) {
  const { complejoId, nombre } = route.params || {};
  const { user } = useAuth();
  const yo = user?.id || null;

  const [admins, setAdmins] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [hoja, setHoja] = useState(false);
  // A quién se le están editando los permisos, y cómo quedaron las casillas.
  const [permisosDe_, setPermisosDe] = useState(null);
  const [casillas, setCasillas] = useState({});
  const [guardandoPermisos, setGuardandoPermisos] = useState(false);
  const [texto, setTexto] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [encontrado, setEncontrado] = useState(null);
  const [busco, setBusco] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errorHoja, setErrorHoja] = useState(null);

  const [quitar, setQuitar] = useState(null);
  const [quitando, setQuitando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: err } = await administradoresDelRecinto(complejoId);
    setAdmins(data || []);
    setError(err?.message || null);
    setCargando(false);
  }, [complejoId]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  // Búsqueda con debounce: es coincidencia exacta, así que no tiene sentido
  // consultar en cada tecla mientras alguien escribe un usuario completo.
  useEffect(() => {
    const u = texto.trim().replace(/^@/, '');
    if (u.length < 2) { setEncontrado(null); setBusco(false); return undefined; }
    setBuscando(true);
    let vivo = true;
    const t = setTimeout(async () => {
      const { data } = await buscarUsuarioPorUsername(u);
      if (!vivo) return;
      setEncontrado(data);
      setBusco(true);
      setBuscando(false);
    }, 400);
    return () => { vivo = false; clearTimeout(t); };
  }, [texto]);

  const yaEsta = encontrado && admins.some((a) => a.userId === encontrado.id);

  const abrirPermisos = (a) => {
    setPermisosDe(a);
    setCasillas(permisosDe(a));
  };

  const guardarPermisos = async () => {
    setGuardandoPermisos(true);
    const { data, error: err } = await guardarPermisosAdmin(
      complejoId, permisosDe_.userId, casillas,
    );
    setGuardandoPermisos(false);
    if (err || !data?.ok) {
      setError(err?.message || data?.reason || 'No pudimos guardar los permisos.');
      return;
    }
    setPermisosDe(null);
    cargar();
  };

  const agregar = async () => {
    if (!encontrado) return;
    setEnviando(true);
    setErrorHoja(null);
    const { error: err } = await agregarAdministrador(complejoId, encontrado.id, 'admin');
    setEnviando(false);
    if (err) { setErrorHoja(err.message); return; }
    setHoja(false);
    setTexto('');
    setEncontrado(null);
    setBusco(false);
    cargar();
  };

  const confirmarQuitar = async () => {
    if (!quitar) return;
    setQuitando(true);
    const { error: err } = await quitarAdministrador(complejoId, quitar.userId);
    setQuitando(false);
    if (err) { setError(err.message); setQuitar(null); return; }
    setQuitar(null);
    cargar();
  };

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Administradores</Text>
          {nombre ? <Text style={styles.headerSub} numberOfLines={1}>{nombre}</Text> : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={cargar} tintColor={C.green} />}
      >
        {cargando ? (
          <View style={{ gap: S.cardGap }}>
            {[0, 1, 2].map((i) => <Card key={i}><Skeleton height={16} width="45%" /></Card>)}
          </View>
        ) : error ? (
          <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard>
        ) : (
          <View style={{ gap: 14 }}>
            <NoticeCard tone="info">
              Un administrador entra al día a día —la agenda, el calendario y los bloqueos— y
              nada más. Lo que puede CAMBIAR —las canchas, los horarios y tarifas, los cobros y la
              ficha— se lo enciendes tú, uno por uno. Esta lista es solo tuya.
            </NoticeCard>

            <View style={{ gap: S.cardGap }}>
              {admins.map((a) => {
                const esDueno = a.rol === 'dueño';
                const soyYo = a.userId === yo;
                return (
                  <Card key={a.id}>
                    <View style={styles.fila}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarTexto}>
                          {String(a.username || '?').slice(0, 2).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.usuario} numberOfLines={1}>
                          @{a.username}{soyYo ? ' · tú' : ''}
                        </Text>
                        {a.enFutfinderDesde ? (
                          <Text style={styles.desde}>En FutFinder desde {desdeCuando(a.enFutfinderDesde)}</Text>
                        ) : null}
                      </View>
                      <Badge label={esDueno ? 'Dueño' : 'Admin'} tone={esDueno ? 'green' : 'neutral'} />
                      {!esDueno ? (
                        <IconButton
                          icon={UserX}
                          onPress={() => setQuitar(a)}
                          accessibilityLabel={`Quitar a @${a.username}`}
                        />
                      ) : null}
                    </View>

                    <Text style={styles.resumenPermisos}>{resumenDePermisos(a)}</Text>

                    {/* El dueño no tiene permisos que editar: los tiene por
                        ser dueño, y ofrecer casillas que no hacen nada sería
                        peor que no ofrecerlas. */}
                    {!esDueno ? (
                      <Button
                        label="Editar permisos"
                        variant="secondary"
                        icon={SlidersHorizontal}
                        style={{ marginTop: 11 }}
                        onPress={() => abrirPermisos(a)}
                      />
                    ) : null}
                  </Card>
                );
              })}
            </View>

            <Text style={styles.pie}>
              Las filas de dueño no traen acción — ni la de otro dueño ni la tuya. Para cambiar un
              dueño hay que escribirle a FutFinder.
            </Text>
          </View>
        )}
      </ScrollView>

      {!cargando && !error ? (
        <StickyFooter>
          <Button label="Agregar administrador" icon={Plus} onPress={() => setHoja(true)} />
        </StickyFooter>
      ) : null}

      {/* Agregar */}
      <Sheet
        visible={!!permisosDe_}
        onClose={() => setPermisosDe(null)}
        title={permisosDe_ ? `Permisos de @${permisosDe_.username}` : 'Permisos'}
      >
        <Text style={styles.permisoAyuda}>
          Enciende solo lo que quieras que pueda cambiar. Lo demás lo va a ver, pero no lo va a
          poder tocar.
        </Text>

        <View style={{ gap: 14, marginTop: 16 }}>
          {PERMISOS.map((permiso) => (
            <Switch
              key={permiso.clave}
              valor={!!casillas[permiso.clave]}
              onChange={(v) => setCasillas((prev) => ({ ...prev, [permiso.clave]: v }))}
              etiqueta={permiso.nombre}
              descripcion={permiso.descripcion}
              deshabilitado={guardandoPermisos}
            />
          ))}
        </View>

        {/* Lo que no se puede apagar, dicho acá mismo: si no, la pregunta
            «¿y entonces para qué sirve un admin sin permisos?» queda sin
            respuesta justo donde se está decidiendo. */}
        <View style={styles.siemprePuede}>
          <Text style={styles.siempreTitulo}>Sin encender nada, igual puede</Text>
          {SIEMPRE_PUEDE.map((linea) => (
            <View key={linea} style={styles.siempreFila}>
              <Check color={C.green} size={13} strokeWidth={2.6} />
              <Text style={styles.siempreTexto}>{linea}</Text>
            </View>
          ))}
        </View>

        <Button
          label="Guardar permisos"
          style={{ marginTop: 16 }}
          loading={guardandoPermisos}
          disabled={!permisosCambiaron(permisosDe_, casillas)}
          onPress={guardarPermisos}
        />
      </Sheet>

      <Sheet visible={hoja} onClose={() => setHoja(false)} title="Agregar administrador">
        <View style={{ gap: 15 }}>
          <View>
            <FieldLabel>Busca su usuario de FutFinder</FieldLabel>
            <TextField
              value={texto}
              onChangeText={setTexto}
              placeholder="@jorgetapia"
              maxLength={40}
            />
          </View>

          {buscando ? (
            <Card><Skeleton height={16} width="55%" /></Card>
          ) : encontrado ? (
            <Card>
              <View style={styles.fila}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarTexto}>
                    {String(encontrado.username || '?').slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.usuario}>@{encontrado.username}</Text>
                  {encontrado.created_at ? (
                    <Text style={styles.desde}>En FutFinder desde {desdeCuando(encontrado.created_at)}</Text>
                  ) : null}
                </View>
              </View>
              {yaEsta ? (
                <Text style={styles.yaEsta}>Ya administra este recinto.</Text>
              ) : (
                <Text style={styles.ayuda}>
                  Va a quedar como <Text style={styles.fuerte}>admin</Text>: entra a la agenda y al
                  calendario. Lo que puede cambiar se lo enciendes después, en «Editar permisos».
                </Text>
              )}
            </Card>
          ) : busco ? (
            <Card>
              <View style={styles.vacioFila}>
                <Search color={C.textSecondary} size={16} strokeWidth={2.2} />
                <Text style={styles.vacioTitulo}>No encontramos a nadie con ese usuario</Text>
              </View>
              <Text style={styles.ayuda}>
                Solo puedes agregar a alguien que ya tenga cuenta en FutFinder. Si es alguien de tu
                equipo, pídele que se registre y te pase su @usuario.
              </Text>
            </Card>
          ) : null}

          {errorHoja ? <NoticeCard tone="warning" icon={AlertTriangle}>{errorHoja}</NoticeCard> : null}

          <View style={{ gap: 9 }}>
            <Button
              label="Agregar como admin"
              disabled={!encontrado || yaEsta || enviando}
              loading={enviando}
              onPress={agregar}
            />
            <Button label="Cancelar" variant="secondary" onPress={() => setHoja(false)} />
          </View>
        </View>
      </Sheet>

      {/* Quitar */}
      <Sheet
        visible={!!quitar}
        onClose={() => setQuitar(null)}
        title={quitar ? `¿Quitar a @${quitar.username}?` : ''}
      >
        <View style={{ gap: 15 }}>
          <Text style={styles.quitarTexto}>
            Pierde el acceso a este recinto: deja de ver la agenda, las reservas y los datos de
            contacto de los jugadores. Su cuenta de jugador queda intacta y lo puedes volver a
            agregar cuando quieras.
          </Text>
          <View style={{ gap: 9 }}>
            <Button
              label="Quitar administrador"
              variant="destructive"
              loading={quitando}
              onPress={confirmarQuitar}
            />
            <Button label="No quitar" variant="secondary" onPress={() => setQuitar(null)} />
          </View>
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  resumenPermisos: { fontFamily: F.semiBold, fontSize: 12, color: C.textSecondary, marginTop: 11 },
  permisoAyuda: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, lineHeight: 18 },
  siemprePuede: {
    marginTop: 18, padding: 14, borderRadius: 16,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
  },
  siempreTitulo: { fontFamily: F.extraBold, fontSize: 12.5, color: C.textPrimary, marginBottom: 9 },
  siempreFila: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  siempreTexto: { flex: 1, fontFamily: F.medium, fontSize: 12, color: C.textSecondary },

  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: S.screenPadding, paddingTop: 6, paddingBottom: 12,
  },
  headerTitle: { fontFamily: F.extraBold, fontSize: 20, color: C.textPrimary },
  headerSub: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { paddingHorizontal: S.screenPadding, paddingBottom: 110 },

  fila: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: C.shieldBg, borderWidth: 1, borderColor: C.greenDeepBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarTexto: { fontFamily: F.extraBold, fontSize: 13, color: C.green },
  usuario: { fontFamily: F.bold, fontSize: 14.5, color: C.textPrimary },
  desde: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, marginTop: 3 },
  pie: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16.5 },

  ayuda: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, lineHeight: 17, marginTop: 11 },
  fuerte: { fontFamily: F.extraBold, color: C.green },
  yaEsta: { fontFamily: F.semiBold, fontSize: 12, color: C.textAmber, marginTop: 11 },
  vacioFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vacioTitulo: { flex: 1, fontFamily: F.bold, fontSize: 14, color: C.textPrimary },
  quitarTexto: { fontFamily: F.medium, fontSize: 13, color: C.textSecondary, lineHeight: 19 },
});
