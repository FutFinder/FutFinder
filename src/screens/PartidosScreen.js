import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowDownUp,
  ChevronRight,
  Filter,
  Map as MapIcon,
  MapPin,
  List as ListIcon,
  Search as SearchIcon,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  fuentes as F,
  alfa,
} from '../theme/colors';
import { Pill, Tag, Avatar, PrimaryButton, SurfaceButton } from '../components/partidos/ui';
import PartidoCard from '../components/partidos/PartidoCard';
import ClubMatchCard from '../components/partidos/ClubMatchCard';
import { esPartidoDeClubes } from '../services/clubMatchRules';
import FiltersSheet, {
  EMPTY_FILTERS,
  countActiveFilters,
  shorten,
} from '../components/partidos/FiltersSheet';
import PickerSheet from '../components/partidos/PickerSheet';
import BrandMark from '../components/BrandMark';
import NotificationBell from '../components/NotificationBell';
import WalletButton from '../components/WalletButton';
import {
  EmptyByFilters,
  EmptyByRegion,
  ErrorState,
  LoadingList,
  NoLocationState,
  OfflineNotice,
} from '../components/partidos/StateViews';
import MatchMap from '../components/MatchMap';
import {
  buscarPartidos,
  contarPartidos,
  filterMatches,
  listMatchesInBounds,
} from '../services/matches';
import {
  crearSecuencia,
  cursorDePagina,
  resultadoDeCargarMas,
} from '../utils/paginacionPartidos';
import { getCurrentLocation, requestLocationPermission } from '../services/location';
import { getCurrentUser } from '../services/auth';
import { getMyClubIds } from '../services/clubs';
import { getMyAccountStatus, searchPlayers } from '../services/profile';
import { isSupabaseConfigured } from '../services/supabase';
import {
  cacheRead,
  cacheWrite,
  isNetworkError,
  markOffline,
  markOnline,
  useOnline,
} from '../services/connectivity';
import { REGIONES, getComunasOfRegion } from '../data/regiones-chile';
import { DIST_OPTS } from '../services/matchRules';

const CACHE_KEY = 'partidos/open';

/** Partidos por página. La siguiente se pide con «Ver más partidos». */
const PAGINA = 50;

const POS_OPTS = [
  { label: 'Cualquier posición', value: null },
  { label: 'Arquero', value: 'arquero' },
  { label: 'Defensa', value: 'defensa' },
  { label: 'Lateral', value: 'lateral' },
  { label: 'Volante', value: 'volante' },
  { label: 'Mediocampista', value: 'medio' },
  { label: 'Delantero', value: 'delantero' },
];
const EDAD_JUG_OPTS = [
  { label: 'Cualquier edad', value: null },
  { label: '12–17', value: { min: 12, max: 17 } },
  { label: '18–25', value: { min: 18, max: 25 } },
  { label: '26–35', value: { min: 26, max: 35 } },
  { label: '36–45', value: { min: 36, max: 45 } },
  { label: '46+', value: { min: 46, max: 99 } },
];

/**
 * «Descubrir partidos» — pantalla principal del módulo (sección 1 del handoff).
 *
 * Mantiene todo lo que ya hacía la pantalla anterior (selector
 * Partidos/Jugadores, buscador, filtros, orden por cercanía, mapa con «buscar
 * en esta zona», aviso de cuenta suspendida) con la estética y la jerarquía
 * nuevas, y agrega los estados diferenciados que faltaban: carga con
 * skeletons, error de servidor con reintento, sin conexión con caché, sin
 * ubicación con alternativa manual y dos vacíos distintos (por filtros vs.
 * porque nadie publicó en la zona).
 */
export default function PartidosScreen({ navigation, route }) {
  const online = useOnline();
  const scrollRef = useRef(null);

  const [mode, setMode] = useState(route.params?.initialMode || 'matches');
  const [view, setView] = useState('lista'); // 'lista' | 'mapa'

  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [fromCache, setFromCache] = useState(null); // timestamp del caché
  const [myUserId, setMyUserId] = useState(null);
  // Los clubes a los que pertenezco, con cualquier rol: deciden si un partido
  // de clubes me muestra «cupos para tu club» y la dirección exacta.
  const [misClubIds, setMisClubIds] = useState([]);
  const [suspended, setSuspended] = useState(null);

  const [text, setText] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [hayMas, setHayMas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  // Un fallo al pedir la página siguiente NO es «se acabaron los partidos»:
  // se conserva el botón y se muestra el error con su reintento.
  const [errorMas, setErrorMas] = useState(null);
  // Sólo la búsqueda vigente puede escribir el listado, la caché y la
  // paginación. Sin esto, una respuesta lenta de los filtros anteriores
  // llegaba después y pisaba los resultados de los filtros actuales.
  const secuencia = useRef(crearSecuencia()).current;
  // `load` no depende de los filtros para no reconstruirse en cada tecla: lee
  // el valor vigente por referencia.
  const filtrosRef = useRef(filters);
  const textoRef = useRef(text);
  filtrosRef.current = filters;
  textoRef.current = text;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [picker, setPicker] = useState(null); // 'region' | 'comuna'

  // Ubicación
  const [userCoords, setUserCoords] = useState(null);
  const [locationDenied, setLocationDenied] = useState(false);

  // Mapa
  const [mapRegion, setMapRegion] = useState(null);
  const [pendingRegion, setPendingRegion] = useState(null);
  const [showSearchHere, setShowSearchHere] = useState(false);
  const [selectedMarkerId, setSelectedMarkerId] = useState(null);

  // Jugadores
  const [players, setPlayers] = useState([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [posIdx, setPosIdx] = useState(0);
  const [edadIdx, setEdadIdx] = useState(0);

  useEffect(() => {
    if (route.params?.initialMode) {
      setMode(route.params.initialMode);
      navigation.setParams({ initialMode: undefined });
    }
  }, [route.params?.initialMode]);

  // Quien llega desde «Ver partidos sin mínimo» tiene que aterrizar con ese
  // filtro puesto, no en el buscador general con los mismos partidos que
  // acaban de rechazarlo.
  useEffect(() => {
    if (route.params?.initialFilters) {
      setFilters((prev) => ({ ...prev, ...route.params.initialFilters }));
      navigation.setParams({ initialFilters: undefined });
    }
  }, [route.params?.initialFilters]);

  // ------------------------------------------------------------- carga

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoadError(null);
    const turno = secuencia.abrir();
    const [res, loc, user, status, misClubes] = await Promise.all([
      // Los filtros que la base sabe resolver van EN la consulta: antes se
      // traían los N partidos más próximos y se filtraba después, así que uno
      // que calzaba pero caía fuera de esos N era invisible. `lleno` también
      // viene, porque el filtro «Todos» los promete y es donde se descubre la
      // lista de espera.
      buscarPartidos({ filtros: filtrosRef.current, texto: textoRef.current, limite: PAGINA }).catch(
        (e) => ({ data: [], hayMas: false, error: e })
      ),
      getCurrentLocation(),
      getCurrentUser(),
      getMyAccountStatus().catch(() => null),
      getMyClubIds().catch(() => ({ data: [] })),
    ]);

    // Llegó tarde: entremedio se cambió un filtro (o se pidió otra página) y
    // esta respuesta ya no corresponde a lo que la pantalla está mostrando.
    // Se descarta entera, incluida la escritura de la caché. Los indicadores
    // sí se sueltan: la búsqueda vigente es la que manda en el contenido, pero
    // nadie más va a apagar estos dos.
    if (!secuencia.vigente(turno)) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setMyUserId(user?.id || null);
    setMisClubIds(misClubes?.data || []);
    setSuspended(status?.suspended ? status : null);

    if (loc?.ok) {
      setUserCoords({ lat: loc.latitude, lng: loc.longitude });
      setLocationDenied(false);
      setMapRegion((prev) =>
        prev || {
          latitude: loc.latitude,
          longitude: loc.longitude,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }
      );
    } else {
      setUserCoords(null);
      setLocationDenied(true);
      setMapRegion((prev) =>
        prev || {
          latitude: -33.4489,
          longitude: -70.6693,
          latitudeDelta: 0.2,
          longitudeDelta: 0.2,
        }
      );
    }

    if (res.error) {
      const net = isNetworkError(res.error);
      if (net) markOffline();
      const cached = await cacheRead(CACHE_KEY);
      if (cached?.value) {
        setMatches(cached.value);
        setFromCache(cached.at);
        setLoadError(net ? null : res.error);
      } else {
        setMatches([]);
        setFromCache(null);
        setLoadError(res.error);
      }
    } else {
      markOnline();
      setMatches(res.data || []);
      setHayMas(!!res.hayMas);
      setFromCache(null);
      setLoadError(null);
      setErrorMas(null);
      cacheWrite(CACHE_KEY, res.data || []);
    }

    setLoading(false);
    setRefreshing(false);
  }, [secuencia]);

  /** La página siguiente, sin perder lo que ya está en pantalla. */
  const cargarMas = useCallback(async () => {
    if (cargandoMas || !hayMas) return;
    setCargandoMas(true);
    setErrorMas(null);
    const turno = secuencia.abrir();
    // El cursor es el par (hora, id) del último partido: con sólo la hora, un
    // partido que empataba con él en el corte entre páginas se perdía.
    const res = await buscarPartidos({
      filtros: filtrosRef.current,
      texto: textoRef.current,
      limite: PAGINA,
      despuesDe: cursorDePagina(matches),
    }).catch((e) => ({ data: [], hayMas: false, error: e }));

    if (!secuencia.vigente(turno)) {
      setCargandoMas(false);
      return;
    }

    // Por id: dos páginas pueden solaparse si alguien publica entremedio. Y un
    // error conserva la lista, el cursor y el botón, en vez de disfrazarse de
    // «no hay más partidos».
    const siguiente = resultadoDeCargarMas({ previos: matches, hayMasPrevio: hayMas, res });
    setMatches(siguiente.matches);
    setHayMas(siguiente.hayMas);
    setErrorMas(siguiente.error);
    setCargandoMas(false);
  }, [cargandoMas, hayMas, matches, secuencia]);

  // Cambiar un filtro o el texto vuelve a preguntarle a la base. El texto se
  // deja reposar: si no, cada letra sería una consulta. La primera vuelta se
  // salta: la carga inicial ya pidió lo mismo, y sin esto entrar al buscador
  // disparaba dos consultas idénticas.
  const yaPregunto = useRef(false);
  useEffect(() => {
    if (!yaPregunto.current) {
      yaPregunto.current = true;
      return undefined;
    }
    const t = setTimeout(() => load({ silent: true }), text.trim() ? 350 : 0);
    return () => clearTimeout(t);
  }, [filters, text]);

  useEffect(() => {
    load();
  }, [load]);

  // Al volver de publicar/gestionar, el listado se refresca solo.
  useEffect(() => navigation.addListener('focus', () => load({ silent: true })), [navigation, load]);

  const handleEnableLocation = async () => {
    const { granted } = await requestLocationPermission();
    if (!granted) {
      setLocationDenied(true);
      return;
    }
    const loc = await getCurrentLocation();
    if (loc?.ok) {
      setUserCoords({ lat: loc.latitude, lng: loc.longitude });
      setLocationDenied(false);
    }
  };

  const handleSearchHere = useCallback(async () => {
    const r = pendingRegion || mapRegion;
    if (!r) return;
    const { data, error } = await listMatchesInBounds({
      minLat: r.latitude - r.latitudeDelta / 2,
      maxLat: r.latitude + r.latitudeDelta / 2,
      minLng: r.longitude - r.longitudeDelta / 2,
      maxLng: r.longitude + r.longitudeDelta / 2,
      limit: 200,
      estados: ['abierto', 'lleno'],
    });
    if (!error) {
      setMatches(data || []);
      // Este resultado es por zona del mapa, no por la búsqueda general
      // paginada: sin esto, «Ver más partidos» seguía ofreciendo la página
      // siguiente de la búsqueda anterior con un offset que ya no
      // correspondía a nada, mezclando partidos de acá con los de allá.
      setHayMas(false);
      setMapRegion(r);
      setShowSearchHere(false);
      setSelectedMarkerId(null);
    }
  }, [pendingRegion, mapRegion]);

  // ------------------------------------------------------------ filtros

  const applyFilterSet = useCallback(
    (f) => filterMatches(matches, { ...f, text }, userCoords),
    [matches, text, userCoords]
  );

  const filtered = useMemo(() => applyFilterSet(filters), [applyFilterSet, filters]);
  const activeCount = countActiveFilters(filters);
  const hasQuery = text.trim().length > 0;

  /**
   * Sugerencias reales: qué pasaría si suelto un filtro.
   *
   * Antes se contaban sobre la lista en memoria, que traía TODOS los partidos
   * próximos. Ahora la consulta ya viene filtrada, así que la lista no tiene
   * los partidos que el filtro dejó fuera: cada sugerencia se cuenta con su
   * propia consulta de conteo, y solo cuando la búsqueda quedó vacía. La
   * distancia es la excepción: se calcula en el teléfono, así que esa se
   * sigue contando acá.
   */
  const [suggestions, setSuggestions] = useState([]);
  useEffect(() => {
    if (mode !== 'matches' || loading || filtered.length > 0) {
      setSuggestions([]);
      return undefined;
    }
    let vivo = true;
    (async () => {
      const out = [];

      if (filters.maxKm != null) {
        const wider = DIST_OPTS.filter((d) => d.value == null || d.value > filters.maxKm);
        for (const d of wider) {
          const n = applyFilterSet({ ...filters, maxKm: d.value }).length;
          if (n > 0) {
            out.push({
              label: d.value == null ? 'Quitar el límite de distancia' : `Ampliar a ${d.label}`,
              count: n,
            });
            break;
          }
        }
      }

      const candidatos = [
        filters.nivel && [{ ...filters, nivel: null }, `Quitar «${filters.nivel}»`],
        filters.modalidad && [{ ...filters, modalidad: null }, 'Aceptar las dos modalidades'],
        filters.fecha !== 'todos' && [{ ...filters, fecha: 'todos' }, 'Incluir otros días'],
        filters.comuna && [
          { ...filters, comuna: null },
          `Buscar en toda ${shorten(filters.region || '')}`.trim(),
        ],
        filters.sinMinimoTrust && [
          { ...filters, sinMinimoTrust: false },
          'Incluir partidos con Trust Score mínimo',
        ],
      ].filter(Boolean);

      for (const [f, label] of candidatos) {
        if (out.length >= 3) break;
        const n = await contarPartidos({ filtros: f, texto: text });
        if (!vivo) return;
        if (n > 0) out.push({ label, count: n });
      }

      if (vivo) setSuggestions(out.slice(0, 3));
    })();
    return () => {
      vivo = false;
    };
  }, [mode, loading, filtered.length, filters, text, applyFilterSet]);

  // ---------------------------------------------------------- jugadores

  useEffect(() => {
    if (mode !== 'players') return;
    let cancelled = false;
    setLoadingPlayers(true);
    const edad = EDAD_JUG_OPTS[edadIdx].value;
    const t = setTimeout(async () => {
      const { data } = await searchPlayers(text, {
        limit: 30,
        filters: {
          posicion: POS_OPTS[posIdx].value,
          region: filters.region,
          comuna: filters.comuna,
          edadMin: edad?.min ?? null,
          edadMax: edad?.max ?? null,
        },
      });
      if (!cancelled) {
        setPlayers(data || []);
        setLoadingPlayers(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [mode, text, posIdx, edadIdx, filters.region, filters.comuna]);

  // ----------------------------------------------------------- navegación

  const openMatch = (id) => navigation.getParent()?.navigate('MatchDetail', { matchId: id });
  const openPublish = () => navigation.getParent()?.navigate('CreateMatch');

  const zoneLabel = filters.comuna
    ? `${filters.comuna} · ${shorten(filters.region)}`
    : filters.region
    ? shorten(filters.region)
    : userCoords
    ? 'Partidos abiertos cerca de ti'
    : 'Elige tu zona para ver partidos cerca';

  // ------------------------------------------------------------- render

  if (suspended) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <Header />
          <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
            <View style={styles.suspended}>
              <Text style={styles.suspendedTitle}>Tu cuenta tiene una restricción activa</Text>
              <Text style={styles.suspendedText}>
                Tu Trust Score llegó a 0, así que por ahora no puedes buscar ni unirte a
                partidos.
                {suspended.suspended_until
                  ? ` Se reactiva el ${new Date(suspended.suspended_until).toLocaleDateString('es-CL', { day: '2-digit', month: 'long' })}.`
                  : ''}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <Header
          onFilters={() => setFiltersOpen(true)}
          activeCount={activeCount}
          showFilters={mode === 'matches'}
        />

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={C.green}
              colors={[C.green]}
            />
          }
        >
          {/* Título de la pantalla */}
          <View style={styles.titleBlock}>
            <Text style={styles.h1}>Partidos</Text>
            <Text style={styles.h1sub} numberOfLines={1}>
              {mode === 'matches' ? zoneLabel : 'Encuentra jugadores para tu partido'}
            </Text>
          </View>

          {/* Selector Partidos / Jugadores */}
          <View style={styles.modeRow}>
            <ModeTab
              label="Partidos"
              icon={Users}
              active={mode === 'matches'}
              onPress={() => setMode('matches')}
            />
            <ModeTab
              label="Jugadores"
              icon={UserIcon}
              active={mode === 'players'}
              onPress={() => setMode('players')}
            />
          </View>

          {/* Buscador */}
          <View style={[styles.search, hasQuery && styles.searchActive]}>
            <SearchIcon color={hasQuery ? C.green : C.textSecondary} size={16} strokeWidth={2} />
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={
                mode === 'matches'
                  ? 'Buscar por comuna, cancha o nombre…'
                  : 'Buscar jugador por nombre de usuario…'
              }
              placeholderTextColor={C.textPlaceholder}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {hasQuery ? (
              <Pressable
                onPress={() => setText('')}
                hitSlop={10}
                accessibilityLabel="Limpiar búsqueda"
                style={styles.clearBtn}
              >
                <X color={C.textSoft} size={11} strokeWidth={3} />
              </Pressable>
            ) : null}
          </View>

          {/* ===================== PARTIDOS ===================== */}
          {mode === 'matches' ? (
            <>
              {/* Pills de filtro */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pills}
              >
                <Pill
                  icon={MapPin}
                  label={filters.region ? shorten(filters.region) : 'Región'}
                  active={!!filters.region}
                  onPress={() => setPicker('region')}
                />
                {filters.region ? (
                  <Pill
                    label={filters.comuna || 'Comuna'}
                    active={!!filters.comuna}
                    onPress={() => setPicker('comuna')}
                  />
                ) : null}
                <Pill
                  label={DIST_OPTS.find((d) => d.value === filters.maxKm)?.label || 'Cualquier dist.'}
                  active={filters.maxKm != null}
                  onPress={() => setFiltersOpen(true)}
                />
                <Pill
                  label={
                    { todos: 'Cualquier día', hoy: 'Hoy', manana: 'Mañana', finde: 'Fin de semana' }[
                      filters.fecha
                    ]
                  }
                  active={filters.fecha !== 'todos'}
                  onPress={() => setFiltersOpen(true)}
                />
                <Pill
                  label={
                    filters.modalidad === 'futbol7'
                      ? 'Fútbol 7'
                      : filters.modalidad === 'futbol11'
                      ? 'Fútbol 11'
                      : 'Modalidad'
                  }
                  active={!!filters.modalidad}
                  onPress={() => setFiltersOpen(true)}
                />
                <Pill
                  label={filters.nivel ? capitalize(filters.nivel) : 'Nivel'}
                  active={!!filters.nivel}
                  onPress={() => setFiltersOpen(true)}
                />
                <Pill
                  label="Más filtros"
                  icon={Filter}
                  active={activeCount > 0}
                  onPress={() => setFiltersOpen(true)}
                />
              </ScrollView>

              {/* Contador + orden + vista */}
              <View style={styles.statusRow}>
                <View style={styles.statusLeft}>
                  <Text style={styles.count}>
                    {loading
                      ? 'Buscando…'
                      : `${filtered.length}${hayMas ? '+' : ''} ${
                          filtered.length === 1 ? 'partido' : 'partidos'
                        }`}
                  </Text>
                  {activeCount > 0 || hasQuery ? (
                    <Pressable
                      onPress={() => {
                        setFilters(EMPTY_FILTERS);
                        setText('');
                      }}
                      hitSlop={8}
                    >
                      <Text style={styles.clearLink}>Limpiar</Text>
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.statusRight}>
                  <ArrowDownUp color={C.green} size={13} strokeWidth={2} />
                  <Text style={styles.sort}>{userCoords ? 'Más cercanos' : 'Próximos en hora'}</Text>
                  <Pressable
                    onPress={() => setView(view === 'lista' ? 'mapa' : 'lista')}
                    hitSlop={8}
                    accessibilityLabel={view === 'lista' ? 'Ver en el mapa' : 'Ver como lista'}
                    style={styles.viewToggle}
                  >
                    {view === 'lista' ? (
                      <MapIcon color={C.textStrong} size={14} strokeWidth={2} />
                    ) : (
                      <ListIcon color={C.textStrong} size={14} strokeWidth={2} />
                    )}
                  </Pressable>
                </View>
              </View>

              {/* Sin conexión → contenido en caché */}
              {fromCache && !online ? (
                <View style={{ marginBottom: 10 }}>
                  <OfflineNotice at={fromCache} onRetry={() => load()} />
                </View>
              ) : null}

              {/* Mapa */}
              {view === 'mapa' && mapRegion ? (
                <View style={{ marginBottom: 12 }}>
                  <MatchMap
                    initialRegion={mapRegion}
                    matches={filtered}
                    selectedId={selectedMarkerId}
                    onSelectMarker={(m) => setSelectedMarkerId(m.id)}
                    onRegionChange={(r) => {
                      setPendingRegion(r);
                      setShowSearchHere(true);
                    }}
                    onSearchHere={handleSearchHere}
                    showSearchHere={showSearchHere}
                    userCoords={userCoords}
                  />
                  {selectedMarkerId
                    ? (() => {
                        const sel = filtered.find((m) => m.id === selectedMarkerId);
                        if (!sel) return null;
                        return (
                          <View style={{ marginTop: 10 }}>
                            {esPartidoDeClubes(sel) ? (
                              <ClubMatchCard
                                match={sel}
                                misClubIds={misClubIds}
                                onPress={() => openMatch(sel.id)}
                              />
                            ) : (
                              <PartidoCard
                                match={sel}
                                distanceKm={sel._distanciaKm}
                                isMine={sel.id_organizador === myUserId}
                                onPress={() => openMatch(sel.id)}
                              />
                            )}
                          </View>
                        );
                      })()
                    : null}
                </View>
              ) : null}

              {/* Contenido */}
              {loading ? (
                <LoadingList />
              ) : loadError ? (
                <ErrorState
                  onRetry={() => {
                    setLoading(true);
                    load();
                  }}
                  detail={loadError.message}
                />
              ) : locationDenied && !filters.region && matches.length === 0 ? (
                <NoLocationState
                  onEnable={handleEnableLocation}
                  onPickManually={() => setPicker('region')}
                />
              ) : filtered.length === 0 ? (
                /*
                  Dos vacíos distintos, nunca el mismo mensaje:
                  · hay partidos publicados pero los filtros los dejaron fuera
                  · no hay ningún partido publicado en la zona
                */
                matches.length > 0 && (activeCount > 0 || hasQuery) ? (
                  <EmptyByFilters
                    suggestions={suggestions}
                    onClearFilters={() => {
                      setFilters(EMPTY_FILTERS);
                      setText('');
                    }}
                    onPublish={openPublish}
                  />
                ) : (
                  <EmptyByRegion
                    regionLabel={filters.region ? shorten(filters.region) : null}
                    onPublish={openPublish}
                    onChangeRegion={() => setPicker('region')}
                  />
                )
              ) : (
                <>
                  {locationDenied ? (
                    <Pressable onPress={handleEnableLocation} style={styles.locHint}>
                      <MapPin color={C.gold} size={14} strokeWidth={2} />
                      <Text style={styles.locHintText}>
                        Sin ubicación no calculamos la distancia. Toca para activarla.
                      </Text>
                    </Pressable>
                  ) : null}
                  <View style={{ gap: 9 }}>
                    {filtered.map((m) =>
                      esPartidoDeClubes(m) ? (
                        <ClubMatchCard
                          key={m.id}
                          match={m}
                          misClubIds={misClubIds}
                          onPress={() => openMatch(m.id)}
                        />
                      ) : (
                        <PartidoCard
                          key={m.id}
                          match={m}
                          distanceKm={m._distanciaKm}
                          isMine={m.id_organizador === myUserId}
                          onPress={() => openMatch(m.id)}
                        />
                      )
                    )}
                  </View>
                  {hayMas ? (
                    <>
                      {/* Un fallo de la página siguiente no borra el botón: lo
                          que ya está en pantalla se conserva y se puede volver
                          a pedir la MISMA página, sin recargar la búsqueda. */}
                      {errorMas ? (
                        <Text style={styles.errorMas}>
                          No pudimos cargar más partidos. Los {matches.length} de arriba siguen
                          acá; vuelve a intentarlo.
                        </Text>
                      ) : null}
                      <SurfaceButton
                        label={
                          cargandoMas
                            ? 'Buscando más…'
                            : errorMas
                              ? 'Reintentar'
                              : 'Ver más partidos'
                        }
                        onPress={cargarMas}
                        height={48}
                        disabled={cargandoMas}
                        style={{ marginTop: 12 }}
                      />
                    </>
                  ) : null}
                  <PrimaryButton
                    label="Publicar un partido"
                    onPress={openPublish}
                    height={50}
                    style={{ marginTop: 16 }}
                  />
                </>
              )}

              {!isSupabaseConfigured ? (
                <Text style={styles.demo}>
                  Modo demo — sin Supabase configurado los partidos son de ejemplo y las
                  acciones no se guardan.
                </Text>
              ) : null}
            </>
          ) : (
            /* ===================== JUGADORES ===================== */
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pills}
              >
                <Pill
                  icon={MapPin}
                  label={filters.region ? shorten(filters.region) : 'Región'}
                  active={!!filters.region}
                  onPress={() => setPicker('region')}
                />
                {filters.region ? (
                  <Pill
                    label={filters.comuna || 'Comuna'}
                    active={!!filters.comuna}
                    onPress={() => setPicker('comuna')}
                  />
                ) : null}
                <Pill
                  label={POS_OPTS[posIdx].label}
                  active={POS_OPTS[posIdx].value !== null}
                  onPress={() => setPosIdx((posIdx + 1) % POS_OPTS.length)}
                />
                <Pill
                  label={EDAD_JUG_OPTS[edadIdx].label}
                  active={EDAD_JUG_OPTS[edadIdx].value !== null}
                  onPress={() => setEdadIdx((edadIdx + 1) % EDAD_JUG_OPTS.length)}
                />
              </ScrollView>

              <View style={styles.statusRow}>
                <Text style={styles.count}>
                  {loadingPlayers
                    ? 'Buscando…'
                    : hasQuery
                    ? `${players.length} ${players.length === 1 ? 'jugador' : 'jugadores'}`
                    : 'Sugeridos por reputación'}
                </Text>
              </View>

              {loadingPlayers ? (
                <View style={{ paddingVertical: 34 }}>
                  <ActivityIndicator color={C.green} />
                </View>
              ) : players.length === 0 ? (
                <View style={{ paddingVertical: 30, paddingHorizontal: 20, alignItems: 'center' }}>
                  <Text style={styles.emptyTitle}>Sin resultados</Text>
                  <Text style={styles.emptyText}>
                    {hasQuery
                      ? `No encontramos jugadores con «${text.trim()}». Revisa el nombre de usuario.`
                      : 'Escribe el nombre de usuario de un jugador para encontrarlo.'}
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 9 }}>
                  {players.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => navigation.getParent()?.navigate('UserProfile', { userId: p.id })}
                      style={({ pressed }) => [styles.playerCard, pressed && { opacity: 0.85 }]}
                    >
                      {p.foto_url ? (
                        <Image source={{ uri: p.foto_url }} style={styles.playerAvatar} />
                      ) : (
                        <Avatar name={p.username} size={44} />
                      )}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={styles.playerName}>
                          @{p.username || 'jugador'}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          {p.comuna ? <Tag label={p.comuna} /> : null}
                          <Tag
                            label={
                              p.rating_count > 0
                                ? `★ ${Number(p.rating_nivel_avg || 0).toFixed(1)} (${p.rating_count})`
                                : `Trust ${p.trust_score ?? '—'}`
                            }
                            tone="green"
                          />
                        </View>
                      </View>
                      <ChevronRight color={C.textSecondary} size={17} />
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}

          <View style={{ height: 20 }} />
        </ScrollView>
      </SafeAreaView>

      <FiltersSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        onApply={setFilters}
        previewCount={(f) => applyFilterSet(f).length}
      />
      <PickerSheet
        visible={picker === 'region'}
        onClose={() => setPicker(null)}
        title="Región"
        options={REGIONES.map((r) => ({ value: r.nombre, label: r.nombre }))}
        value={filters.region}
        searchPlaceholder="Buscar región…"
        allowClear
        clearLabel="Cualquier región"
        onSelect={(v) => setFilters((f) => ({ ...f, region: v, comuna: null }))}
      />
      <PickerSheet
        visible={picker === 'comuna'}
        onClose={() => setPicker(null)}
        title="Comuna"
        subtitle={
          filters.region
            ? `${getComunasOfRegion(filters.region).length} en ${shorten(filters.region)}`
            : ''
        }
        options={filters.region ? getComunasOfRegion(filters.region) : []}
        value={filters.comuna}
        searchPlaceholder="Buscar comuna…"
        allowClear
        clearLabel="Cualquier comuna"
        onSelect={(v) => setFilters((f) => ({ ...f, comuna: v }))}
      />
    </View>
  );
}

function Header({ onFilters, activeCount = 0, showFilters }) {
  return (
    <View style={styles.header}>
      <BrandMark />
      <View style={styles.headerActions}>
        <WalletButton />
        <NotificationBell />
        {showFilters ? (
          <Pressable
            onPress={onFilters}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Abrir filtros"
            style={({ pressed }) => [
              styles.headerBtn,
              activeCount > 0 && styles.headerBtnActive,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Filter color={activeCount > 0 ? C.green : C.textDim} size={16} strokeWidth={2} />
            {activeCount > 0 ? (
              <View style={styles.headerBadge}>
                <Text style={styles.headerBadgeText}>{activeCount}</Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function ModeTab({ label, icon: Icon, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.modeTab,
        active ? styles.modeTabOn : styles.modeTabOff,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Icon color={active ? C.greenInk : C.textSecondary} size={16} strokeWidth={active ? 2.3 : 1.9} />
      <Text style={[styles.modeTabText, active && styles.modeTabTextOn]}>{label}</Text>
    </Pressable>
  );
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 16, paddingBottom: 26 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerBtn: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnActive: { backgroundColor: alfa(C.green, 0.13), borderColor: C.greenBorder },
  headerBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 15,
    height: 15,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: C.green,
    borderWidth: 2,
    borderColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBadgeText: { fontSize: 9, fontFamily: F.bold, color: C.greenInk },

  titleBlock: { marginBottom: 14 },
  h1: { fontSize: 31, fontFamily: F.extraBold, color: C.textPrimary, letterSpacing: -1, lineHeight: 34 },
  h1sub: { fontSize: 12.5, fontFamily: F.medium, color: C.textFaint, marginTop: 4 },

  modeRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  modeTab: {
    flex: 1,
    height: 42,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  modeTabOn: { backgroundColor: C.green },
  modeTabOff: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.hairline },
  modeTabText: { fontSize: 13.5, fontFamily: F.semiBold, color: C.textSecondary },
  modeTabTextOn: { color: C.greenInk, fontFamily: F.bold },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 46,
    paddingHorizontal: 13,
    borderRadius: R.row,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  searchActive: { borderColor: alfa(C.green, 0.45) },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 13.5,
    fontFamily: F.medium,
    color: C.textPrimary,
    ...({ outlineStyle: 'none' }),
  },
  clearBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.track,
    alignItems: 'center',
    justifyContent: 'center',
  },

  pills: { flexDirection: 'row', gap: 5, paddingTop: 11, paddingRight: 16 },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingBottom: 8,
    gap: 10,
  },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  count: { fontSize: 12, fontFamily: F.semiBold, color: C.textSecondary },
  clearLink: { fontSize: 12, fontFamily: F.semiBold, color: C.red },
  sort: { fontSize: 12, fontFamily: F.semiBold, color: C.green },
  viewToggle: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },

  locHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.goldSoft,
    borderWidth: 1,
    borderColor: C.goldBorder,
    borderRadius: R.row,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  locHintText: { flex: 1, fontSize: 11.5, fontFamily: F.semiBold, color: C.gold },

  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.cardSm,
    padding: 12,
  },
  playerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.chip },
  playerName: { fontSize: 14.5, fontFamily: F.bold, color: C.textPrimary },

  emptyTitle: { fontSize: 16, fontFamily: F.bold, color: C.textPrimary },
  emptyText: {
    fontSize: 12.5,
    lineHeight: 19,
    color: C.textFaint,
    textAlign: 'center',
    marginTop: 6,
  },

  suspended: {
    backgroundColor: C.redSoft,
    borderWidth: 1,
    borderColor: C.redBorder,
    borderRadius: R.cardSm,
    padding: 20,
  },
  suspendedTitle: { fontSize: 17, fontFamily: F.bold, color: C.red },
  suspendedText: { fontSize: 13, lineHeight: 20, color: C.textSoft, marginTop: 8 },

  demo: {
    fontSize: 11,
    lineHeight: 16,
    color: C.textGhost,
    textAlign: 'center',
    marginTop: 18,
  },
  errorMas: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: F.medium,
    color: C.textMuted,
    textAlign: 'center',
    marginTop: 14,
  },
});
