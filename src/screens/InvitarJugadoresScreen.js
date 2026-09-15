import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Check, Search, Users } from 'lucide-react-native';

import { reservas as C, reservasFonts as F } from '../theme/colors';
import { IconButton, Card, NoticeCard, StickyFooter, Button, Foto, Chip } from '../components/reservas/ui';
import { TextField } from '../components/reservas/recintoUi';
import { listMyFriends } from '../services/friends';
import { searchPlayers } from '../services/profile';
import { invitarParticipante } from '../services/reservas';
import { motivoLegible, textosDeModalidad } from '../utils/pagoDividido';

/**
 * A quién sumar a la reserva.
 *
 * DOS VÍAS, Y LA SEGUNDA NO ES UN EXTRA. Con quién uno juega a la pelota no
 * es lo mismo que a quién tiene agregado: se juega con el compañero de
 * trabajo, con el primo de alguien, con el que siempre completa el equipo.
 * Obligar a que sean amigos para poder invitarlos empujaría a la gente a
 * agregar a medio mundo solo para jugar junto, y eso ensucia la lista de
 * amigos mucho más de lo que protege a nadie.
 *
 * EL BUSCADOR ABIERTO NO EXPONE NADA NUEVO. `searchPlayers` es el mismo que
 * ya usa la búsqueda de jugadores, y respeta `privacy_visible_in_search`:
 * quien apagó «visible en búsquedas» no aparece acá tampoco. La RLS de
 * `profiles` ya permite leer todos los perfiles, así que esto es comodidad,
 * no una puerta nueva.
 *
 * SE PUEDE ELEGIR A VARIOS Y SE MANDA UNA POR UNA, EN ORDEN. El servidor
 * corta cuando se acaban los cupos (`cupos_llenos`); en paralelo dos podrían
 * pasar el chequeo a la vez y dejar la reserva imposible de confirmar.
 *
 * LA SELECCIÓN SOBREVIVE AL CAMBIO DE PESTAÑA. Uno marca a dos amigos, se va
 * al buscador por el tercero y vuelve: perder los dos primeros ahí sería la
 * clase de detalle que obliga a empezar de nuevo sin entender por qué.
 */
export default function InvitarJugadoresScreen({ navigation, route }) {
  const { reservaId, faltan = 1, yaEstan = [], modalidad = 'jugadores' } = route.params || {};
  const textos = textosDeModalidad(modalidad);
  const [pestana, setPestana] = useState('amigos');
  const [amigos, setAmigos] = useState([]);
  const [busca, setBusca] = useState('');
  const [hallados, setHallados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [elegidos, setElegidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState(null);

  const cargarAmigos = useCallback(async () => {
    const lista = await listMyFriends();
    setAmigos((lista || []).filter((a) => !yaEstan.includes(a.user_id)));
    setLoading(false);
  }, [yaEstan]);

  useEffect(() => { cargarAmigos(); }, [cargarAmigos]);

  // El buscador espera a que la persona deje de escribir: una consulta por
  // tecla son diez viajes para una palabra de diez letras.
  useEffect(() => {
    if (pestana !== 'buscar') return undefined;
    const q = busca.trim();
    if (q.length < 2) { setHallados([]); setBuscando(false); return undefined; }
    setBuscando(true);
    const t = setTimeout(async () => {
      const { data } = await searchPlayers(q, { limit: 25 });
      setHallados((data || []).filter((p) => !yaEstan.includes(p.id)));
      setBuscando(false);
    }, 350);
    return () => clearTimeout(t);
  }, [busca, pestana, yaEstan]);

  const amigosVisibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (pestana !== 'amigos' || !q) return amigos;
    return amigos.filter((a) => (a.username || '').toLowerCase().includes(q));
  }, [amigos, busca, pestana]);

  const alternar = (persona) => {
    setAviso(null);
    setElegidos((prev) => {
      if (prev.some((p) => p.userId === persona.userId)) {
        return prev.filter((p) => p.userId !== persona.userId);
      }
      // El tope es el de la reserva: dejar marcar de más sería prometer algo
      // que el servidor va a rechazar en la mitad del envío.
      if (prev.length >= faltan) return prev;
      return [...prev, persona];
    });
  };

  const invitar = async () => {
    setEnviando(true);
    setAviso(null);
    let ok = 0;
    let fallo = null;
    for (const p of elegidos) {
      const { data, error } = await invitarParticipante(reservaId, p.userId, textos.rol);
      if (data?.ok) ok += 1;
      else fallo = motivoLegible(data?.reason) || error?.message;
    }
    setEnviando(false);

    if (ok > 0 && !fallo) { navigation.goBack(); return; }
    // Si alguna pasó y otra no, se dice: volver atrás en silencio haría
    // pensar que se invitó a todos.
    setAviso(ok > 0
      ? `Invitamos a ${ok}, pero una no se pudo: ${fallo}`
      : fallo || 'No pudimos invitar.');
    setElegidos([]);
    cargarAmigos();
  };

  // Función que devuelve JSX y NO un componente declarado acá adentro: un
  // componente definido dentro del render se vuelve a montar en cada tecla
  // que se escribe en el buscador.
  const fila = (persona) => {
    const on = elegidos.some((p) => p.userId === persona.userId);
    const tope = !on && elegidos.length >= faltan;
    return (
      <Pressable
        key={persona.userId}
        onPress={() => alternar(persona)}
        disabled={tope}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on, disabled: tope }}
        style={({ pressed }) => [styles.fila, tope && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
      >
        <Foto uri={persona.fotoUrl} style={styles.avatar} iconSize={16} alt={`Foto de ${persona.nombre}`} />
        <View style={{ flex: 1 }}>
          <Text style={styles.nombre} numberOfLines={1}>{persona.nombre}</Text>
          {persona.detalle ? (
            <Text style={styles.sub} numberOfLines={1}>{persona.detalle}</Text>
          ) : null}
        </View>
        <View style={[styles.check, on && styles.checkOn]}>
          {on ? <Check color={C.textOnGreen} size={14} strokeWidth={3} /> : null}
        </View>
      </Pressable>
    );
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.center}><ActivityIndicator color={C.green} /></View>
      </SafeAreaView>
    );
  }

  const enAmigos = pestana === 'amigos';
  const lista = enAmigos
    ? amigosVisibles.map((a) => ({
      userId: a.user_id, nombre: a.username, fotoUrl: a.foto_url, detalle: a.comuna,
    }))
    : hallados.map((p) => ({
      userId: p.id, nombre: p.username, fotoUrl: p.foto_url, detalle: p.comuna,
    }));

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{textos.tituloInvitar}</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {modalidad === 'capitanes'
              ? textos.ayudaInvitar
              : elegidos.length > 0
              ? `${elegidos.length} de ${faltan} ${faltan === 1 ? 'cupo' : 'cupos'}`
              : `Quedan ${faltan} ${faltan === 1 ? 'cupo' : 'cupos'}`}
          </Text>
        </View>
      </View>

      <View style={styles.pestanas}>
        <Chip label="Mis amigos" active={enAmigos} onPress={() => setPestana('amigos')} icon={Users} />
        <Chip label="Buscar" active={!enAmigos} onPress={() => setPestana('buscar')} icon={Search} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TextField
          value={busca}
          onChangeText={setBusca}
          placeholder={enAmigos ? 'Buscar entre tus amigos' : 'Nombre de usuario'}
        />

        {!enAmigos && busca.trim().length < 2 ? (
          <NoticeCard tone="info" icon={Search}>
            Escribe el nombre de usuario de quien quieres {modalidad === 'capitanes' ? 'elegir' : 'invitar'}.
            No hace falta que sea tu amigo: le llega la invitación igual, con tu nombre.
          </NoticeCard>
        ) : null}

        {!enAmigos && buscando ? (
          <View style={{ paddingVertical: 20 }}><ActivityIndicator color={C.green} /></View>
        ) : null}

        {enAmigos && amigos.length === 0 ? (
          <NoticeCard tone="info" icon={Users}>
            Todavía no tienes amigos agregados, o ya están todos en esta reserva. Puedes invitar a
            cualquiera desde «Buscar».
          </NoticeCard>
        ) : null}

        {lista.length > 0 ? (
          <Card padded={false} style={{ paddingVertical: 4 }}>
            {lista.map(fila)}
          </Card>
        ) : null}

        {lista.length === 0 && busca.trim().length >= 2 && !buscando ? (
          <View style={styles.vacio}>
            <Search color={C.textMuted} size={16} strokeWidth={2} />
            <Text style={styles.vacioTexto}>
              {enAmigos ? 'Ninguno de tus amigos con ese nombre.' : 'Nadie con ese nombre de usuario.'}
            </Text>
          </View>
        ) : null}

        {aviso ? <NoticeCard tone="warning">{aviso}</NoticeCard> : null}
      </ScrollView>

      {elegidos.length > 0 ? (
        <StickyFooter>
          <Button
            label={elegidos.length === 1
              ? `${modalidad === 'capitanes' ? 'Elegir a' : 'Invitar a'} ${elegidos[0].nombre}`
              : `Invitar a ${elegidos.length}`}
            loading={enviando}
            onPress={invitar}
          />
        </StickyFooter>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  headerTitle: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 17, letterSpacing: -0.2 },
  headerSub: { fontFamily: F.medium, color: C.textSecondary, fontSize: 12, marginTop: 2 },

  pestanas: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 4 },

  scroll: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 130, gap: 14 },

  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  avatar: {
    width: 38, height: 38, borderRadius: 999, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
  },
  nombre: { fontFamily: F.bold, fontSize: 14, color: C.textPrimary },
  sub: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, marginTop: 2 },
  check: {
    width: 24, height: 24, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: C.border,
  },
  checkOn: { borderWidth: 0, backgroundColor: C.green },
  vacio: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingVertical: 8 },
  vacioTexto: { fontFamily: F.medium, fontSize: 13, color: C.textMuted },
});
