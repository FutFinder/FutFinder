import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  Pressable,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Search as SearchIcon,
  User,
} from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  medidas as S,
  fuentes as F,
} from '../theme/colors';
import Banner from '../components/Banner';
import { IconButton } from '../components/reservas/ui';
import { searchPlayers } from '../services/profile';
import { inviteToClub, listMembers } from '../services/clubs';

/**
 * Invitar jugadores al club (vista de admin).
 * Busca por username y envía invitaciones (tipo 'invitacion'):
 * el jugador las ve en su pestaña Clubes y decide si acepta.
 */
export default function ClubInviteScreen({ navigation, route }) {
  const { clubId, clubNombre } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState([]);
  const [memberIds, setMemberIds] = useState(new Set());
  const [invitedIds, setInvitedIds] = useState(new Set());
  const [sendingId, setSendingId] = useState(null);
  const [banner, setBanner] = useState(null);

  // Ignora una respuesta vieja que llegue después que una más nueva: sin
  // esto, buscar "j" y de inmediato "juan" podía mostrar los resultados de
  // "j" si esa consulta (más resultados) tardaba más en volver que la de
  // "juan", sin que el cuadro de texto lo reflejara.
  const searchTokenRef = useRef(0);

  const search = useCallback(async (text) => {
    const token = ++searchTokenRef.current;
    const { data } = await searchPlayers(text, { limit: 30 });
    if (token !== searchTokenRef.current) return;
    setPlayers(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: members } = await listMembers(clubId);
      setMemberIds(new Set((members || []).map((m) => m.user_id)));
      await search('');
    })();
  }, [clubId, search]);

  // El texto se deja reposar antes de preguntar: si no, cada tecla sería
  // una consulta. La primera vuelta se salta: el efecto de arriba ya pidió
  // la lista inicial con texto vacío.
  const yaPregunto = useRef(false);
  useEffect(() => {
    if (!yaPregunto.current) {
      yaPregunto.current = true;
      return undefined;
    }
    const t = setTimeout(() => search(query), query.trim() ? 350 : 0);
    return () => clearTimeout(t);
  }, [query, search]);

  const onSearch = (text) => setQuery(text);

  const handleInvite = async (player) => {
    setSendingId(player.id);
    const { error } = await inviteToClub(clubId, player.id);
    setSendingId(null);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo invitar', message: error.message });
      return;
    }
    setInvitedIds((prev) => new Set(prev).add(player.id));
    setBanner({
      type: 'success',
      title: 'Invitación enviada',
      message: `A ${player.username} le llegó un aviso, y la verá también en su pestaña Clubes.`,
    });
  };

  // Quienes ya son del club se muestran con «Ya es del club» en vez de
  // desaparecer: buscar a alguien y no encontrarlo se lee como un error.
  const candidates = players;

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Invitar jugadores</Text>
          {clubNombre ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {clubNombre}
            </Text>
          ) : null}
        </View>
      </View>

      <Text style={styles.label}>Nombre de usuario</Text>
      <View style={styles.searchBox}>
        <SearchIcon color={C.textSecondary} size={18} strokeWidth={2} />
        <TextInput
          style={styles.searchInput}
          placeholder="@usuario"
          placeholderTextColor={C.textSecondary}
          value={query}
          onChangeText={onSearch}
          autoCapitalize="none"
          autoFocus
        />
      </View>

      {banner && (
        <View style={styles.bannerWrap}>
          <Banner {...banner} onClose={() => setBanner(null)} />
        </View>
      )}

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.green} />
        </View>
      ) : (
        <FlatList
          data={candidates}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const invited = invitedIds.has(item.id);
            const esDelClub = memberIds.has(item.id);
            return (
              <Pressable
                onPress={() => navigation.navigate('UserProfile', { userId: item.id })}
                style={({ pressed }) => [styles.playerRow, pressed && { opacity: 0.85 }]}
              >
                {item.foto_url ? (
                  <Image source={{ uri: item.foto_url }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <User color={C.textMuted} size={18} strokeWidth={1.8} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.playerName}>{item.username}</Text>
                  <Text style={styles.playerMeta}>
                    @{item.username}
                    {item.comuna ? ` · ${item.comuna}` : ''}
                  </Text>
                </View>
                {esDelClub ? (
                  <View style={styles.chipNeutro}>
                    <Text style={styles.chipNeutroText}>Ya es del club</Text>
                  </View>
                ) : invited ? (
                  <View style={styles.chipNeutro}>
                    <Text style={styles.chipNeutroText}>Invitado</Text>
                  </View>
                ) : sendingId === item.id ? (
                  <ActivityIndicator color={C.green} size="small" />
                ) : (
                  <Pressable
                    onPress={() => handleInvite(item)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`Invitar a ${item.username}`}
                    style={({ pressed }) => [styles.inviteBtn, pressed && { backgroundColor: C.greenSoftStrong }]}
                  >
                    <Text style={styles.inviteBtnText}>Invitar</Text>
                  </Pressable>
                )}
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.separador} />}
          ListFooterComponent={
            candidates.length > 0 ? (
              <Text style={styles.footNote}>
                La invitación llega a su portada de Clubes. Una persona puede estar en hasta 3 clubes.
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <SearchIcon color={C.textMuted} size={36} strokeWidth={1.5} />
              <Text style={styles.emptyTitle}>
                {query.trim() ? 'Sin resultados' : 'Busca jugadores'}
              </Text>
              <Text style={styles.emptyText}>
                Escribe el nombre de usuario del jugador que quieres sumar a tu club.
              </Text>
            </View>
          }
        />
      )}
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
    paddingBottom: 12,
  },
  headerTitle: { fontFamily: F.extraBold, fontSize: 19, color: C.textPrimary, letterSpacing: -0.3 },
  headerSubtitle: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 2 },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minHeight: 48,
    paddingHorizontal: 14,
    marginHorizontal: S.screenPadding,
    marginBottom: 12,
    borderRadius: R.row,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  searchInput: {
    flex: 1,
    fontFamily: F.medium,
    fontSize: 14.5,
    color: C.textPrimary,
    // La caja ya marca el campo; el contorno naranjo del navegador no va.
    ...Platform.select({ web: { outlineStyle: 'none' } }),
  },

  bannerWrap: { paddingHorizontal: S.screenPadding },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: S.screenPadding, paddingBottom: 40 },

  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 12,
    paddingHorizontal: 2,
  },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  avatarFallback: {
    backgroundColor: C.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  playerName: { fontFamily: F.bold, fontSize: 14, color: C.textPrimary },
  playerMeta: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 2 },

  inviteBtn: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.greenBorderStrong,
    backgroundColor: C.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  inviteBtnText: { fontFamily: F.bold, fontSize: 13, color: C.green },
  chipNeutro: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceAlt,
    justifyContent: 'center',
  },
  chipNeutroText: { fontFamily: F.bold, fontSize: 12.5, color: C.textSoft },
  separador: { height: 1, backgroundColor: C.borderSoft, marginLeft: 55 },
  footNote: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, lineHeight: 17, marginTop: 14 },
  label: {
    fontFamily: F.semiBold,
    fontSize: 12.5,
    color: C.textSecondary,
    marginHorizontal: S.screenPadding,
    marginBottom: 6,
  },
  emptyBox: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyTitle: { fontFamily: F.extraBold, fontSize: 16, color: C.textPrimary },
  emptyText: {
    fontFamily: F.medium,
    fontSize: 13,
    color: C.textSecondary,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 18.5,
  },
});
