import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Check, Search, Users } from 'lucide-react-native';

import { reservas as C, reservasFonts as F } from '../theme/colors';
import { IconButton, Card, NoticeCard, StickyFooter, Button, Foto } from '../components/reservas/ui';
import { TextField } from '../components/reservas/recintoUi';
import { listMyFriends } from '../services/friends';
import { invitarJugador } from '../services/reservas';
import { motivoLegible } from '../utils/pagoDividido';

/**
 * A quién sumar a la reserva.
 *
 * SE INVITA DESDE LOS AMIGOS, no desde un buscador abierto de usuarios. Una
 * invitación a una reserva le llega a alguien como una notificación con el
 * nombre de quien invita: abrirla a cualquier @usuario sería una vía directa
 * para molestar a desconocidos, y no hay ningún caso real en que uno divida
 * la cuenta de una cancha con alguien que no tiene agregado.
 *
 * SE PUEDE ELEGIR A VARIOS Y SE MANDA UNA POR UNA. El servidor corta cuando
 * se acaban los cupos (`cupos_llenos`), así que si dos invitaciones se pisan
 * la segunda se rechaza sola en vez de dejar la reserva imposible de
 * confirmar.
 *
 * LOS QUE YA ESTÁN NO APARECEN. Volver a invitar a alguien que ya está no
 * rompe nada —el insert es `on conflict do nothing`— pero verlo en la lista
 * hace pensar que no se mandó.
 */
export default function InvitarJugadoresScreen({ navigation, route }) {
  const { reservaId, faltan = 1, yaEstan = [] } = route.params || {};
  const [amigos, setAmigos] = useState([]);
  const [busca, setBusca] = useState('');
  const [elegidos, setElegidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState(null);

  const load = useCallback(async () => {
    const lista = await listMyFriends();
    setAmigos((lista || []).filter((a) => !yaEstan.includes(a.user_id)));
    setLoading(false);
  }, [yaEstan]);

  useEffect(() => { load(); }, [load]);

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return amigos;
    return amigos.filter((a) => (a.username || '').toLowerCase().includes(q));
  }, [amigos, busca]);

  const alternar = (id) => {
    setAviso(null);
    setElegidos((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // El tope es el de la reserva: dejar marcar de más sería prometer algo
      // que el servidor va a rechazar en la mitad del envío.
      if (prev.length >= faltan) return prev;
      return [...prev, id];
    });
  };

  const invitar = async () => {
    setEnviando(true);
    setAviso(null);
    let ok = 0;
    let fallo = null;
    // Una por una y en orden a propósito: el servidor corta cuando se acaban
    // los cupos, y en paralelo dos podrían pasar el chequeo a la vez.
    for (const userId of elegidos) {
      const { data, error } = await invitarJugador(reservaId, userId);
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
    load();
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.center}><ActivityIndicator color={C.green} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Invitar jugadores</Text>
          <Text style={styles.headerSub}>
            Quedan {faltan} {faltan === 1 ? 'cupo' : 'cupos'}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {amigos.length === 0 ? (
          <NoticeCard tone="info" icon={Users}>
            Todavía no tienes amigos agregados, o ya están todos en esta reserva. Agrega jugadores
            desde su perfil y vuelve acá.
          </NoticeCard>
        ) : (
          <>
            <TextField value={busca} onChangeText={setBusca} placeholder="Buscar entre tus amigos" />
            <Card padded={false} style={{ paddingVertical: 4 }}>
              {visibles.map((a) => {
                const on = elegidos.includes(a.user_id);
                const tope = !on && elegidos.length >= faltan;
                return (
                  <Pressable
                    key={a.user_id}
                    onPress={() => alternar(a.user_id)}
                    disabled={tope}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: tope }}
                    style={({ pressed }) => [styles.fila, tope && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
                  >
                    <Foto uri={a.foto_url} style={styles.avatar} iconSize={16} alt={`Foto de ${a.username}`} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.nombre} numberOfLines={1}>{a.username}</Text>
                      {a.comuna ? <Text style={styles.sub} numberOfLines={1}>{a.comuna}</Text> : null}
                    </View>
                    <View style={[styles.check, on && styles.checkOn]}>
                      {on ? <Check color={C.textOnGreen} size={14} strokeWidth={3} /> : null}
                    </View>
                  </Pressable>
                );
              })}
              {visibles.length === 0 ? (
                <View style={styles.vacio}>
                  <Search color={C.textMuted} size={16} strokeWidth={2} />
                  <Text style={styles.vacioTexto}>Ninguno con ese nombre.</Text>
                </View>
              ) : null}
            </Card>
          </>
        )}

        {aviso ? <NoticeCard tone="warning">{aviso}</NoticeCard> : null}
      </ScrollView>

      {elegidos.length > 0 ? (
        <StickyFooter>
          <Button
            label={`Invitar a ${elegidos.length}`}
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

  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 130, gap: 14 },

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
  vacio: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 16 },
  vacioTexto: { fontFamily: F.medium, fontSize: 13, color: C.textMuted },
});
