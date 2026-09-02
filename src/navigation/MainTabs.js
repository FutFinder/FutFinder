import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  Home as HomeIcon,
  Plus,
  Shield,
  Calendar,
  MessageSquare,
  User as UserIcon,
} from 'lucide-react-native';

import HomeScreen from '../screens/HomeScreen';
import PartidosScreen from '../screens/PartidosScreen';
import ClubsScreen from '../screens/ClubsScreen';
import ReservasScreen from '../screens/ReservasScreen';
import ChatScreen from '../screens/ChatScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SearchFootballIcon from '../components/SearchFootballIcon';
import { tactical } from '../theme/colors';
import { countUnreadTotal, subscribeToMessages } from '../services/messages';

import { ClubsHomeProvider, useClubsHome } from '../contexts/ClubsHomeContext';
import { etiquetaBadge } from '../utils/clubsHomeTasks.js';

const Tab = createBottomTabNavigator();

const ICON_SIZE = 21;
const ICON_STROKE = 1.9;
const LEFT_TABS = ['HomeTab', 'SearchTab', 'ClubsTab'];
// Avisos deja de ser una pestaña (decisión del handoff de Reservas: la
// campana de notificaciones pasa arriba a la derecha en cada pantalla, ver
// `NotificationBell`) y su lugar en la barra lo toma Reservas.
const RIGHT_TABS = ['ReservasTab', 'ChatTab', 'ProfileTab'];

/**
 * Componente "vacío" que nunca se monta — las pestañas Crear y
 * Notificaciones NO renderizan contenido propio: interceptan el press
 * y navegan a su pantalla del stack raíz (modal sobre las tabs).
 */
function PlaceholderTab() {
  return null;
}

/**
 * Tab bar custom estilo "Dark Tactical Pitch":
 *   - Fondo negro puro con borde superior tenue
 *   - Iconos Lucide con peso óptico uniforme, verde flúor cuando activos
 *   - Botón Crear flotante circular verde flúor en el centro
 *   - Badges sobre Chat (mensajes sin leer) y Clubes (pendientes con
 *     acción del club activo). El de Avisos ya no vive acá — ver
 *     `NotificationBell` en el header
 */
function CustomTabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  const [chatUnread, setChatUnread] = useState(0);

  // El MISMO número que la sección «Pendiente para ti» de la portada: sale
  // del estado compartido, no de un conteo propio. Con dos cuentas del mismo
  // dato, la barra y la portada terminan discrepando y ninguna de las dos se
  // puede creer.
  const { badgeCount: clubPendientes } = useClubsHome();

  // Mensajes sin leer del tab Chat. El total lo calcula el servidor
  // (`get_chat_unread_total`), que ya descuenta las conversaciones
  // silenciadas salvo que tengan un aviso /importante pendiente.
  useEffect(() => {
    let mounted = true;
    let pending = null;

    const reload = async () => {
      const n = await countUnreadTotal();
      if (mounted) setChatUnread(n || 0);
    };
    // Una ráfaga de mensajes no debe disparar una consulta por mensaje.
    const scheduleReload = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        reload();
      }, 600);
    };

    reload();
    const unsubscribe = subscribeToMessages(scheduleReload);
    const navUnsub = navigation.addListener('state', scheduleReload);

    return () => {
      mounted = false;
      if (pending) clearTimeout(pending);
      try { unsubscribe(); } catch {}
      navUnsub();
    };
  }, [navigation]);

  const renderTab = (route) => {
    const index = state.routes.indexOf(route);
    const isFocused = state.index === index;
    const color = isFocused ? tactical.neon : 'rgba(255,255,255,0.42)';
    const Icon = iconFor(route.name);
    const badge =
      route.name === 'ChatTab'
        ? chatUnread
        : route.name === 'ClubsTab'
          ? clubPendientes
          : 0;

    const onPress = () => {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (!isFocused && !event.defaultPrevented) {
        navigation.navigate(route.name, route.params);
      }
    };

    return (
      <Pressable
        key={route.key}
        onPress={onPress}
        hitSlop={6}
        accessibilityRole="tab"
        accessibilityState={{ selected: isFocused }}
        accessibilityLabel={
          badge > 0
            ? `${labelFor(route.name)}, ${badge} ${
                // Los pendientes del club son tareas por hacer, no mensajes
                // por leer: quien navega con lector de pantalla escuchaba
                // «Clubes, 3 sin leer» sobre desafíos sin responder.
                route.name === 'ClubsTab' ? 'pendientes' : 'sin leer'
              }`
            : labelFor(route.name)
        }
        className="flex-1 items-center gap-1 active:opacity-70"
      >
        <View>
          <Icon size={ICON_SIZE} color={color} strokeWidth={ICON_STROKE} />
          {badge > 0 ? (
            // Dos badges en la barra: mensajes sin leer del Chat y pendientes
            // con acción del club activo. El de Clubes sale del mismo
            // `badgeCount` que muestra «Pendiente para ti» en la portada, no
            // de un conteo aparte: dos cuentas del mismo número acaban
            // discrepando.
            <View
              className="absolute -right-2 -top-1.5 min-w-[15px] items-center justify-center rounded-full px-1"
              style={{ backgroundColor: tactical.neon }}
            >
              <Text className="text-[9.5px] font-bold" style={{ color: tactical.neonInk }}>
                {etiquetaBadge(badge)}
              </Text>
            </View>
          ) : null}
        </View>
        <Text className="text-[10.5px] font-semibold" style={{ color }}>
          {labelFor(route.name)}
        </Text>
      </Pressable>
    );
  };

  const leftRoutes = LEFT_TABS.map((name) => state.routes.find((r) => r.name === name)).filter(Boolean);
  const rightRoutes = RIGHT_TABS.map((name) => state.routes.find((r) => r.name === name)).filter(Boolean);

  return (
    <View
      className="absolute inset-x-0 bottom-0 flex-row items-start border-t border-white/8 bg-[#050605] px-3.5 pt-3"
      style={{ height: 88 + insets.bottom, paddingBottom: insets.bottom }}
    >
      {leftRoutes.map(renderTab)}
      <View className="flex-1" />
      {rightRoutes.map(renderTab)}

      <Pressable
        onPress={() => navigation.getParent()?.navigate('CreateMatch')}
        hitSlop={6}
        className="absolute -top-5 left-1/2 h-[58px] w-[58px] -translate-x-[29px] items-center justify-center rounded-full border-4 border-[#050605] bg-[#00FF66] active:opacity-85"
        style={{
          shadowColor: tactical.neon,
          shadowOpacity: 0.45,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        <Plus size={28} color={tactical.neonInk} strokeWidth={3} />
      </Pressable>
    </View>
  );
}

function iconFor(name) {
  switch (name) {
    case 'HomeTab': return HomeIcon;
    case 'SearchTab': return SearchFootballIcon;
    case 'ClubsTab': return Shield;
    case 'ReservasTab': return Calendar;
    case 'ChatTab': return MessageSquare;
    case 'ProfileTab': return UserIcon;
    default: return HomeIcon;
  }
}

function labelFor(name) {
  switch (name) {
    case 'HomeTab': return 'Inicio';
    case 'SearchTab': return 'Partidos';
    case 'ClubsTab': return 'Clubes';
    case 'ReservasTab': return 'Reservas';
    case 'ChatTab': return 'Chat';
    case 'ProfileTab': return 'Perfil';
    default: return '';
  }
}

/**
 * El proveedor de la portada de Clubes envuelve las pestañas enteras, no solo
 * `ClubsTab`: la barra inferior también lee de él para su badge, y montarlo
 * más adentro dejaría a la barra fuera. Más arriba tampoco sirve — acá ya
 * estamos detrás del guard de sesión, así que no se consulta sin usuario.
 */
export default function MainTabs() {
  return (
    <ClubsHomeProvider>
      <Tab.Navigator
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <CustomTabBar {...props} />}
      >
        <Tab.Screen name="HomeTab" component={HomeScreen} />
        <Tab.Screen name="SearchTab" component={PartidosScreen} />
        <Tab.Screen name="ClubsTab" component={ClubsScreen} />
        <Tab.Screen name="CreateTab" component={PlaceholderTab} />
        <Tab.Screen name="ReservasTab" component={ReservasScreen} />
        <Tab.Screen name="ChatTab" component={ChatScreen} />
        <Tab.Screen name="ProfileTab" component={ProfileScreen} />
      </Tab.Navigator>
    </ClubsHomeProvider>
  );
}
