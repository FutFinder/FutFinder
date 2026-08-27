import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  Modal,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  Search as SearchIcon,
  X,
  SlidersHorizontal,
  Plus,
  ArrowLeft,
  ChevronDown,
  Check,
  Shield,
  Swords,
  AlertCircle,
} from 'lucide-react-native';

import { clubsExplorer as CE, clubsExplorerRadius as CER } from '../../theme/colors';
import Banner from '../Banner';
import ClubExplorerCard from './ClubExplorerCard';
import NotificationBell from '../NotificationBell';
import {
  searchClubs,
  getMyClubs,
  listMyInvitations,
  respondToRequest,
  listRivalCandidates,
} from '../../services/clubs';
import { NOMBRES_REGIONES } from '../../data/regiones-chile';

/**
 * Explorador de clubes (handoff `Clubes.dc.html`): buscador + filtros por
 * región/comuna + listado de todos los clubes de FutFinder, con estados de
 * carga, vacío (sin clubes / sin resultados) y error.
 *
 * Se usa en dos contextos:
 *  - Embebido como raíz de la pestaña «Clubes» cuando el usuario no
 *    pertenece a ningún club (`ClubsScreen`).
 *  - Empujado sobre el stack cuando un integrante quiere conocer otros
 *    clubes (`ExploreClubsScreen`, botón «Buscar rivales», etc.).
 */
export default function ClubExplorer({
  navigation,
  showBackButton = false,
  onBack,
  extraBottomClearance = 0,
  initialBanner = null,
  onMembershipChanged,
  // Modo «elegir rival»: la lista deja de ser el catálogo de clubes y pasa a
  // ser sólo la de candidatos válidos. Los clubes propios y el que reta no
  // aparecen — no basta con esconderles el botón «Desafiar», porque entonces
  // siguen ocupando la lista y el usuario cree que puede desafiarlos.
  modoRival = false,
  retadorClubId = null,
}) {
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [clubs, setClubs] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [soyAdminDeAlgo, setSoyAdminDeAlgo] = useState(false);
  const [misClubIds, setMisClubIds] = useState(new Set());
  const [hasMaxClubs, setHasMaxClubs] = useState(false);
  const [banner, setBanner] = useState(initialBanner);

  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [regionSel, setRegionSel] = useState('');
  const [comunaSel, setComunaSel] = useState('');
  const [picker, setPicker] = useState(null); // null | 'region' | 'comuna'

  const load = useCallback(async () => {
    const [{ data: found, error: err }, { data: mine }] = await Promise.all([
      // En modo rival la exclusión viaja dentro de la consulta, no como un
      // filtro posterior: un club propio no debe llegar ni a la respuesta.
      modoRival ? listRivalCandidates({ retadorClubId }) : searchClubs(''),
      getMyClubs(),
    ]);
    setError(Boolean(err));
    setClubs(found || []);
    const misIds = new Set((mine || []).map((m) => m.club?.id).filter(Boolean));
    setMisClubIds(misIds);
    setSoyAdminDeAlgo((mine || []).some((m) => m.miRol === 'admin'));
    setHasMaxClubs((mine || []).length >= 3);
    // Elegir rival no es momento de responder invitaciones a otros clubes.
    if (!modoRival && (mine || []).length < 3) {
      const { data: invs } = await listMyInvitations();
      setInvitations(invs || []);
    } else {
      setInvitations([]);
    }
    setLoading(false);
  }, [modoRival, retadorClubId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleInvitation = async (inv, accept) => {
    const { error: err } = await respondToRequest(inv.request_id, accept);
    if (err) {
      setBanner({ type: 'error', title: 'No se pudo responder', message: err.message });
      return;
    }
    if (accept) {
      // Al aceptar, el estado de membresía cambió: si un padre nos pasó
      // onMembershipChanged (ClubsScreen embebido), lo avisamos para que
      // salte directo al detalle del nuevo club sin esperar a un cambio de
      // foco de navegación. Ese re-render reemplaza esta pantalla, así que
      // no hace falta un banner local: no llegaría a verse.
      if (onMembershipChanged) {
        await onMembershipChanged();
        return;
      }
      setBanner({
        type: 'success',
        title: '¡Bienvenido al club!',
        message: `Ahora eres parte de ${inv.club.nombre}.`,
      });
    }
    await load();
  };

  // Opciones de filtro derivadas de los clubes reales cargados, no de la
  // lista completa de regiones/comunas de Chile: así nunca se ofrece un
  // filtro que garantizadamente deja la lista vacía.
  const regionOptions = useMemo(() => {
    const set = new Set(clubs.map((c) => c.region).filter(Boolean));
    return NOMBRES_REGIONES.filter((r) => set.has(r));
  }, [clubs]);

  const comunaOptions = useMemo(() => {
    const pool = regionSel ? clubs.filter((c) => c.region === regionSel) : clubs;
    const set = new Set(pool.map((c) => c.comuna).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es-CL'));
  }, [clubs, regionSel]);

  const filteredClubs = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = q ? clubs.filter((c) => c.nombre.toLowerCase().includes(q)) : clubs;
    if (regionSel) list = list.filter((c) => c.region === regionSel);
    if (comunaSel) list = list.filter((c) => c.comuna === comunaSel);
    return list;
  }, [clubs, query, regionSel, comunaSel]);

  const filtersActive = Boolean(regionSel || comunaSel);
  const hasQuery = query.length > 0;
  const showEmptyNoClubs = !loading && !error && clubs.length === 0;
  const showEmptyNoResults = !loading && !error && clubs.length > 0 && filteredClubs.length === 0;

  const clearFilters = () => {
    setRegionSel('');
    setComunaSel('');
  };
  const clearAll = () => {
    setQuery('');
    setRegionSel('');
    setComunaSel('');
  };

  const fabBottom = extraBottomClearance + insets.bottom + 20;

  return (
    <View style={styles.root}>
      <View style={styles.glow} pointerEvents="none" />

      <SafeAreaView edges={['top']} style={styles.safe}>
        <FlatList
          data={loading || error ? [] : filteredClubs}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={CE.green}
              colors={[CE.green]}
            />
          }
          contentContainerStyle={[styles.listContent, { paddingBottom: fabBottom + 80 }]}
          ListHeaderComponent={
            <View>
              <View style={styles.topRow}>
                {showBackButton ? (
                  <Pressable
                    onPress={onBack}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Volver"
                    style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
                  >
                    <ArrowLeft color={CE.textPrimary} size={20} strokeWidth={2.2} />
                  </Pressable>
                ) : (
                  <View style={styles.topRowSpacer} />
                )}
                {!showBackButton && <NotificationBell />}
              </View>

              <Text style={styles.title}>Clubes</Text>

              {banner && (
                <View style={styles.bannerWrap}>
                  <Banner {...banner} onClose={() => setBanner(null)} />
                </View>
              )}

              {invitations.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Invitaciones</Text>
                  {invitations.map((inv) => (
                    <ClubExplorerCard
                      key={inv.request_id}
                      club={inv.club}
                      onPress={() => navigation.navigate('ClubDetail', { clubId: inv.club_id })}
                      rightAccessory={
                        <View style={styles.invActions}>
                          <Pressable
                            onPress={() => handleInvitation(inv, true)}
                            hitSlop={6}
                            accessibilityRole="button"
                            accessibilityLabel="Aceptar invitación"
                            style={({ pressed }) => [styles.invBtn, styles.invAccept, pressed && { opacity: 0.7 }]}
                          >
                            <Check color={CE.bg} size={16} strokeWidth={2.6} />
                          </Pressable>
                          <Pressable
                            onPress={() => handleInvitation(inv, false)}
                            hitSlop={6}
                            accessibilityRole="button"
                            accessibilityLabel="Rechazar invitación"
                            style={({ pressed }) => [styles.invBtn, styles.invReject, pressed && { opacity: 0.7 }]}
                          >
                            <X color="#E8737B" size={16} strokeWidth={2.6} />
                          </Pressable>
                        </View>
                      }
                    />
                  ))}
                </View>
              )}

              <View style={[styles.searchRow, { marginBottom: filterOpen ? 12 : 24 }]}>
                <View style={styles.searchBox}>
                  <SearchIcon color={CE.textSecondary} size={18} strokeWidth={2} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Buscar clubes por nombre..."
                    placeholderTextColor={CE.textSecondary}
                    style={styles.searchInput}
                    autoCapitalize="none"
                  />
                  {hasQuery && (
                    <Pressable
                      onPress={() => setQuery('')}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Limpiar búsqueda"
                      style={({ pressed }) => [styles.clearBtn, pressed && { backgroundColor: CE.border }]}
                    >
                      <X color={CE.textSecondary} size={13} strokeWidth={2.4} />
                    </Pressable>
                  )}
                </View>
                <Pressable
                  onPress={() => setFilterOpen((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel="Filtros"
                  style={({ pressed }) => [
                    styles.filterBtn,
                    (filterOpen || filtersActive) && styles.filterBtnActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <SlidersHorizontal color={CE.textPrimary} size={18} strokeWidth={2} />
                  {filtersActive && <View style={styles.filterDot} />}
                </Pressable>
              </View>

              {filterOpen && (
                <View style={styles.filterPanel}>
                  <FilterField
                    label="Región"
                    value={regionSel}
                    placeholder="Todas las regiones"
                    onPress={() => setPicker('region')}
                  />
                  <FilterField
                    label="Comuna"
                    value={comunaSel}
                    placeholder="Todas las comunas"
                    onPress={() => setPicker('comuna')}
                  />
                  {filtersActive && (
                    <Pressable onPress={clearFilters} hitSlop={6}>
                      <Text style={styles.clearFiltersText}>Limpiar filtros</Text>
                    </Pressable>
                  )}
                </View>
              )}

              {!loading && !error && filteredClubs.length > 0 && (
                <Text style={styles.sectionLabel}>
                  {modoRival ? 'Clubes que puedes desafiar' : 'Clubes en FutFinder'}
                </Text>
              )}
            </View>
          }
          renderItem={({ item }) => {
            // En modo rival la lista ya viene depurada por el servicio, así que
            // todo lo que se ve es desafiable.
            const puedoDesafiar =
              modoRival || (soyAdminDeAlgo && !misClubIds.has(item.id));
            return (
              <ClubExplorerCard
                club={item}
                onPress={() => navigation.navigate('ClubDetail', { clubId: item.id })}
                onPressMembers={() => navigation.navigate('ClubMembers', { clubId: item.id })}
                rightAccessory={
                  puedoDesafiar ? (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation?.();
                        navigation.navigate('ClubChallenge', {
                          rivalClubId: item.id,
                          rivalNombre: item.nombre,
                          rivalFotoUrl: item.foto_url || null,
                        });
                      }}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={`Desafiar a ${item.nombre}`}
                      style={({ pressed }) => [styles.desafiarBtn, pressed && { opacity: 0.7 }]}
                    >
                      <Swords color={CE.bg} size={14} strokeWidth={2.4} />
                      <Text style={styles.desafiarText}>Desafiar</Text>
                    </Pressable>
                  ) : undefined
                }
              />
            );
          }}
          ListEmptyComponent={
            loading ? (
              <View style={styles.stateBox}>
                <ActivityIndicator color={CE.green} />
              </View>
            ) : error ? (
              <View style={styles.stateBox}>
                <View style={styles.stateIconWrap}>
                  <AlertCircle color="#E8737B" size={30} strokeWidth={1.8} />
                </View>
                <Text style={styles.stateTitle}>No se pudo cargar</Text>
                <Text style={styles.stateText}>Revisa tu conexión e inténtalo de nuevo.</Text>
                <Pressable
                  onPress={load}
                  style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.retryText}>Reintentar</Text>
                </Pressable>
              </View>
            ) : showEmptyNoClubs ? (
              <View style={styles.stateBox}>
                <View style={styles.stateIconWrap}>
                  <Shield color={CE.green} size={34} strokeWidth={2} />
                </View>
                <Text style={styles.stateTitle}>Todavía no tienes clubes</Text>
                <Text style={styles.stateText}>
                  Crea tu club para organizar partidos e invitar a tus compañeros.
                </Text>
              </View>
            ) : showEmptyNoResults ? (
              <View style={styles.stateBox}>
                <View style={styles.stateIconWrap}>
                  <SearchIcon color={CE.textMuted} size={28} strokeWidth={2} />
                </View>
                <Text style={styles.stateTitle}>Sin resultados</Text>
                <Text style={styles.stateText}>
                  {query.trim()
                    ? `No encontramos clubes que coincidan con "${query.trim()}".`
                    : 'No encontramos clubes con los filtros seleccionados.'}
                </Text>
                <Pressable
                  onPress={clearAll}
                  style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.retryText}>
                    {query.trim() ? 'Limpiar búsqueda' : 'Limpiar filtros'}
                  </Text>
                </Pressable>
              </View>
            ) : null
          }
        />
      </SafeAreaView>

      {!hasMaxClubs && (
        <Pressable
          onPress={() => navigation.navigate('CreateClub')}
          accessibilityRole="button"
          accessibilityLabel="Crear club"
          style={({ pressed }) => [
            styles.createFab,
            { bottom: fabBottom },
            pressed && { backgroundColor: CE.greenActive },
          ]}
        >
          <Plus color={CE.greenInk} size={20} strokeWidth={2.6} />
          <Text style={styles.createFabText}>Crear club</Text>
        </Pressable>
      )}

      <OptionPickerModal
        visible={picker === 'region'}
        title="Región"
        options={regionOptions}
        value={regionSel}
        allowClear
        clearLabel="Todas las regiones"
        onClose={() => setPicker(null)}
        onSelect={(v) => {
          setRegionSel(v || '');
          setComunaSel('');
        }}
      />
      <OptionPickerModal
        visible={picker === 'comuna'}
        title="Comuna"
        options={comunaOptions}
        value={comunaSel}
        allowClear
        clearLabel="Todas las comunas"
        onClose={() => setPicker(null)}
        onSelect={(v) => setComunaSel(v || '')}
      />
    </View>
  );
}

function FilterField({ label, value, placeholder, onPress }) {
  return (
    <View style={styles.filterField}>
      <Text style={styles.filterLabel}>{label}</Text>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.filterSelect, pressed && { borderColor: CE.green }]}
      >
        <Text style={value ? styles.filterValue : styles.filterPlaceholder} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <ChevronDown color={CE.textSecondary} size={16} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

function OptionPickerModal({ visible, title, options, value, onSelect, onClose, allowClear, clearLabel }) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={() => {}}>
          <Text style={styles.modalTitle}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(item) => item}
            style={{ maxHeight: 360 }}
            ListHeaderComponent={
              allowClear ? (
                <OptionRow
                  label={clearLabel}
                  selected={!value}
                  onPress={() => {
                    onSelect(null);
                    onClose();
                  }}
                />
              ) : null
            }
            renderItem={({ item }) => (
              <OptionRow
                label={item}
                selected={value === item}
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
              />
            )}
            ListEmptyComponent={
              <Text style={styles.modalEmpty}>No hay opciones disponibles.</Text>
            }
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function OptionRow({ label, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.optionRow, pressed && { backgroundColor: CE.surfaceAlt }]}
    >
      <Text style={[styles.optionText, selected && styles.optionTextActive]} numberOfLines={1}>
        {label}
      </Text>
      {selected && <Check color={CE.green} size={16} strokeWidth={2.6} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CE.bg },
  glow: {
    position: 'absolute',
    top: -160,
    left: '10%',
    right: '10%',
    height: 260,
    borderRadius: 999,
    backgroundColor: CE.headerGlowFrom,
    opacity: 0.35,
  },
  safe: { flex: 1 },
  listContent: { paddingHorizontal: 20 },

  topRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 8 },
  topRowSpacer: { flex: 1 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CE.surface,
    borderWidth: 1,
    borderColor: CE.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '800',
    color: CE.textPrimary,
    letterSpacing: -0.5,
    paddingTop: 8,
    paddingBottom: 20,
  },

  bannerWrap: { marginBottom: 12 },

  section: { marginBottom: 20 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    color: CE.textMuted,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  invActions: { flexDirection: 'row', gap: 8 },
  invBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invAccept: { backgroundColor: CE.green },
  invReject: {
    backgroundColor: 'rgba(232,115,123,0.12)',
    borderWidth: 1,
    borderColor: '#E8737B',
  },

  searchRow: { flexDirection: 'row', gap: 10 },
  searchBox: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: CE.surface,
    borderWidth: 1,
    borderColor: CE.border,
    borderRadius: CER.input,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, color: CE.textPrimary, fontSize: 15, fontWeight: '500' },
  clearBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: CE.surfaceAlt,
    borderWidth: 1,
    borderColor: CE.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtn: {
    width: 48,
    height: 48,
    borderRadius: CER.input,
    backgroundColor: CE.surface,
    borderWidth: 1,
    borderColor: CE.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnActive: { borderColor: CE.green },
  filterDot: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: CE.green,
  },

  filterPanel: {
    backgroundColor: CE.surface,
    borderWidth: 1,
    borderColor: CE.border,
    borderRadius: CER.panel,
    padding: 16,
    gap: 12,
    marginBottom: 24,
  },
  filterField: { gap: 6 },
  filterLabel: { fontSize: 12, fontWeight: '600', color: CE.textSecondary },
  filterSelect: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: CE.surfaceAlt,
    borderWidth: 1,
    borderColor: CE.border,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  filterValue: { color: CE.textPrimary, fontSize: 14, fontWeight: '500', flex: 1 },
  filterPlaceholder: { color: CE.textSecondary, fontSize: 14, fontWeight: '500', flex: 1 },
  clearFiltersText: { color: CE.green, fontSize: 13, fontWeight: '600' },

  desafiarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: CE.green,
    borderRadius: CER.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  desafiarText: { color: CE.greenInk, fontSize: 12, fontWeight: '800' },

  stateBox: { alignItems: 'center', textAlign: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 4 },
  stateIconWrap: {
    width: 72,
    height: 72,
    borderRadius: CER.empty,
    backgroundColor: CE.surface,
    borderWidth: 1,
    borderColor: CE.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  stateTitle: { fontSize: 19, fontWeight: '700', color: CE.textPrimary, marginBottom: 8 },
  stateText: {
    fontSize: 14,
    color: CE.textSecondary,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 280,
    marginBottom: 4,
  },
  retryBtn: {
    marginTop: 12,
    height: 40,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CE.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: CE.textPrimary, fontSize: 14, fontWeight: '600' },

  createFab: {
    position: 'absolute',
    left: 20,
    right: 20,
    height: 56,
    borderRadius: CER.fab,
    backgroundColor: CE.green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    elevation: 10,
  },
  createFabText: { color: CE.greenInk, fontSize: 16, fontWeight: '700' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: CE.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: CE.border,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  modalTitle: {
    color: CE.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  modalEmpty: {
    color: CE.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: CE.border,
  },
  optionText: { color: CE.textSecondary, fontSize: 14, fontWeight: '600', flex: 1 },
  optionTextActive: { color: CE.green },
});
