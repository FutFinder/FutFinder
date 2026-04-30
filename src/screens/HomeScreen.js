import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  MapPin,
  Clock,
  Users,
  Search,
  LogOut,
  Plus,
} from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import Logo from '../components/Logo';

// Datos de prueba — luego vendrán de Supabase
const MOCK_MATCHES = [
  {
    id: '1',
    title: 'Partido en Estadio Nacional',
    venue: 'Complejo Ñuñoa · Cancha 3',
    distance: '1.2 km',
    time: 'Hoy · 20:30',
    players: '8/10',
    level: 'Intermedio',
    price: '$3.500',
  },
  {
    id: '2',
    title: 'Pichanga las Condes',
    venue: 'Club Manquehue · Cancha A',
    distance: '3.8 km',
    time: 'Mañana · 19:00',
    players: '6/12',
    level: 'Principiante',
    price: '$4.200',
  },
  {
    id: '3',
    title: 'Fulbito post-pega',
    venue: 'Providencia Sport · Cancha 1',
    distance: '5.4 km',
    time: 'Vie · 21:00',
    players: '9/10',
    level: 'Avanzado',
    price: '$5.000',
  },
];

export default function HomeScreen({ navigation }) {
  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Header */}
        <View style={styles.header}>
          <Logo size={28} />
          <Pressable
            onPress={() => navigation.replace('Welcome')}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
            hitSlop={8}
          >
            <LogOut color={colors.textSecondary} size={20} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Saludo */}
          <View style={styles.greetingBox}>
            <Text style={styles.hello}>¡Hola, jugador!</Text>
            <Text style={styles.subhello}>
              Hay 12 partidos cerca de ti hoy
            </Text>
          </View>

          {/* Search bar */}
          <View style={styles.searchBar}>
            <Search color={colors.textMuted} size={18} />
            <Text style={styles.searchText}>Buscar canchas o partidos…</Text>
          </View>

          {/* Trust score badge */}
          <View style={styles.trustCard}>
            <View style={styles.trustLeft}>
              <Text style={styles.trustLabel}>Tu Trust Score</Text>
              <Text style={styles.trustValue}>4.8 / 5.0</Text>
            </View>
            <View style={styles.trustBadge}>
              <Text style={styles.trustBadgeText}>VERIFICADO</Text>
            </View>
          </View>

          {/* Section title */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Partidos cerca de ti</Text>
            <Pressable hitSlop={8}>
              <Text style={styles.sectionLink}>Ver todos</Text>
            </Pressable>
          </View>

          {/* Match list */}
          {MOCK_MATCHES.map((m) => (
            <Pressable
              key={m.id}
              style={({ pressed }) => [
                styles.matchCard,
                pressed && { opacity: 0.85 },
              ]}
            >
              <View style={styles.matchTopRow}>
                <Text style={styles.matchTitle}>{m.title}</Text>
                <View style={styles.priceTag}>
                  <Text style={styles.priceText}>{m.price}</Text>
                </View>
              </View>

              <Text style={styles.matchVenue}>{m.venue}</Text>

              <View style={styles.matchMeta}>
                <View style={styles.metaItem}>
                  <MapPin color={colors.primary} size={14} />
                  <Text style={styles.metaText}>{m.distance}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Clock color={colors.primary} size={14} />
                  <Text style={styles.metaText}>{m.time}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Users color={colors.primary} size={14} />
                  <Text style={styles.metaText}>{m.players}</Text>
                </View>
              </View>

              <View style={styles.levelTag}>
                <Text style={styles.levelText}>Nivel: {m.level}</Text>
              </View>
            </Pressable>
          ))}

          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Floating action button */}
        <Pressable
          style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
        >
          <Plus color="#0E0E0D" size={26} strokeWidth={2.5} />
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  greetingBox: {
    marginTop: 8,
    marginBottom: 16,
  },
  hello: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  subhello: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 2,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    height: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  searchText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  trustCard: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  trustLeft: {},
  trustLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  trustValue: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
  },
  trustBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  trustBadgeText: {
    color: '#0E0E0D',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  sectionLink: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  matchCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  matchTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  matchTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  matchVenue: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: 12,
  },
  matchMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 10,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '500',
  },
  priceTag: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  priceText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  levelTag: {
    alignSelf: 'flex-start',
    backgroundColor: colors.background,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  levelText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
