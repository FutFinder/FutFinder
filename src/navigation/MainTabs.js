import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  Home as HomeIcon,
  Search as SearchIcon,
  Plus,
  MessageCircle,
  User as UserIcon,
} from 'lucide-react-native';

import HomeScreen from '../screens/HomeScreen';
import SearchScreen from '../screens/SearchScreen';
import ChatScreen from '../screens/ChatScreen';
import ProfileScreen from '../screens/ProfileScreen';
import { colors, radius } from '../theme/colors';

const Tab = createBottomTabNavigator();

/**
 * Componente "vacío" que nunca se monta — la pestaña Crear NO renderiza
 * contenido propio, en vez de eso intercepta el press y navega al stack
 * de CreateMatch (modal sobre las tabs).
 */
function CreatePlaceholder() {
  return null;
}

/**
 * Tab bar custom con estética luxury-night:
 *   - Fondo negro con borde superior tenue
 *   - Iconos minimalistas Lucide
 *   - Texto pequeño solo en activos
 *   - Botón Crear elevado al centro como un círculo verde flotante
 */
function CustomTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.barInner}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const isCreate = route.name === 'CreateTab';

          const onPress = () => {
            if (isCreate) {
              // Botón especial: no entra a una pestaña, abre CreateMatch
              // como modal sobre las tabs.
              navigation
                .getParent()
                ?.navigate('CreateMatch');
              return;
            }
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          if (isCreate) {
            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                style={styles.createSlot}
                hitSlop={6}
              >
                <View style={styles.createBtn}>
                  <Plus color="#0E0E0D" size={26} strokeWidth={2.8} />
                </View>
                <Text style={styles.createLabel}>Crear</Text>
              </Pressable>
            );
          }

          const IconCmp = iconFor(route.name);
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              style={styles.tabSlot}
              hitSlop={6}
            >
              <IconCmp
                color={isFocused ? colors.primary : colors.textMuted}
                size={22}
                strokeWidth={isFocused ? 2.3 : 1.8}
              />
              <Text
                style={[
                  styles.tabLabel,
                  { color: isFocused ? colors.primary : colors.textMuted,
                    fontWeight: isFocused ? '800' : '600' },
                ]}
              >
                {labelFor(route.name)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function iconFor(name) {
  switch (name) {
    case 'HomeTab': return HomeIcon;
    case 'SearchTab': return SearchIcon;
    case 'ChatTab': return MessageCircle;
    case 'ProfileTab': return UserIcon;
    default: return HomeIcon;
  }
}

function labelFor(name) {
  switch (name) {
    case 'HomeTab': return 'Inicio';
    case 'SearchTab': return 'Buscar';
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
      <Tab.Screen name="CreateTab" component={CreatePlaceholder} />
      <Tab.Screen name="ChatTab" component={ChatScreen} />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const BAR_HEIGHT = 64;
const CREATE_SIZE = 56;

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    ...Platform.select({
      web: {
        boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
      },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.5,
        shadowOffset: { width: 0, height: -8 },
        shadowRadius: 16,
        elevation: 12,
      },
    }),
  },
  barInner: {
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabSlot: {
    flex: 1,
    height: BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabLabel: {
    fontSize: 10,
    letterSpacing: 0.3,
  },
  createSlot: {
    flex: 1,
    height: BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 6,
    gap: 4,
  },
  createBtn: {
    position: 'absolute',
    top: -CREATE_SIZE / 2 + 4, // sobresale del bar
    width: CREATE_SIZE,
    height: CREATE_SIZE,
    borderRadius: CREATE_SIZE / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.background,
    ...Platform.select({
      web: {
        boxShadow: '0 6px 20px rgba(113,181,51,0.45)',
      },
      default: {
        shadowColor: colors.primary,
        shadowOpacity: 0.45,
        shadowOffset: { width: 0, height: 6 },
        shadowRadius: 12,
        elevation: 8,
      },
    }),
  },
  createLabel: {
    fontSize: 10,
    color: colors.primary,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginTop: CREATE_SIZE / 2 + 2, // espacio para que no choque con el botón
  },
});
