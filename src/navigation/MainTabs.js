import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  Home as HomeIcon,
  Plus,
  Shield,
  Bell,
  MessageSquare,
  User as UserIcon,
} from 'lucide-react-native';

import HomeScreen from '../screens/HomeScreen';
import SearchScreen from '../screens/SearchScreen';
import ClubsScreen from '../screens/ClubsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import ChatScreen from '../screens/ChatScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SearchFootballIcon from '../components/SearchFootballIcon';
import { tactical } from '../theme/colors';
import { getCurrentUser } from '../services/auth';
import { countUnread, subscribeToNotifications } from '../services/notifications';
import { countUnreadTotal, subscribeToMessages } from '../services/messages';

const Tab = createBottomTabNavigator();

const ICON_SIZE = 21;
const ICON_STROKE = 1.9;
const LEFT_TABS = ['HomeTab', 'SearchTab', 'ClubsTab'];
const RIGHT_TABS = ['NotifTab', 'ChatTab', 'ProfileTab'];

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
 *   - Badge rojo de notificaciones no leídas sobre la campana
 */
function CustomTabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  const [unread, setUnread] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);

  // Contador de notificaciones no leídas: carga inicial + realtime +
  // refresco cuando cambia la navegación (p.ej. al volver del inbox).
  useEffect(() => {
    let mounted = true;
    let unsubscribe = () => {};
    const reload = async () => {
      const n = await countUnread();
      if (mounted) setUnread(n || 0);
    };
    reload();
    (async () => {
      const u = await getCurrentUser();
      if (!u?.id || !mounted) return;
      unsubscribe = subscribeToNotifications(u.id, reload);
    })();
    const parentUnsub =
      navigation.getParent()?.addListener('state', reload) || (() => {});
    return () => {
      mounted = false;
      unsubscribe();
      parentUnsub();
    };
  }, [navigation]);

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
      route.name === 'NotifTab' ? unread : route.name === 'ChatTab' ? chatUnread : 0;

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
          badge > 0 ? `${labelFor(route.name)}, ${badge} sin leer` : labelFor(route.name)
        }
        className="flex-1 items-center gap-1 active:opacity-70"
      >
        <View>
          <Icon size={ICON_SIZE} color={color} strokeWidth={ICON_STROKE} />
          {badge > 0 ? (
            // Avisos en coral (alerta) y mensajes en verde (actividad), igual
            // que en el diseño: el color distingue de qué badge se trata.
            <View
              className="absolute -right-2 -top-1.5 min-w-[15px] items-center justify-center rounded-full px-1"
              style={{
                backgroundColor: route.name === 'ChatTab' ? tactical.neon : '#FF6B6B',
              }}
            >
              <Text
                className="text-[9.5px] font-bold"
                style={{ color: route.name === 'ChatTab' ? tactical.neonInk : '#FFFFFF' }}
              >
                {badge > 9 ? '9+' : String(badge)}
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
    case 'NotifTab': return Bell;
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
    case 'NotifTab': return 'Avisos';
    case 'ChatTab': return 'Chat';
    case 'ProfileTab': return 'Perfil';
    default: return '';
  }
}

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tab.Screen name="HomeTab" component={HomeScreen} />
      <Tab.Screen name="SearchTab" component={SearchScreen} />
      <Tab.Screen name="ClubsTab" component={ClubsScreen} />
      <Tab.Screen name="CreateTab" component={PlaceholderTab} />
      <Tab.Screen name="NotifTab" component={NotificationsScreen} />
      <Tab.Screen name="ChatTab" component={ChatScreen} />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
