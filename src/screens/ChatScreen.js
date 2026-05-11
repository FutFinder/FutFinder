import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  MessageCircle,
  Users,
  Bell,
  Lock,
  Sparkles,
} from 'lucide-react-native';

import Logo from '../components/Logo';
import { colors, radius } from '../theme/colors';

export default function ChatScreen() {
  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Header */}
        <View style={styles.header}>
          <Logo size={28} />
          <View style={styles.iconBtn}>
            <Bell color={colors.textSecondary} size={20} />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero placeholder */}
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <MessageCircle color={colors.primary} size={36} strokeWidth={1.5} />
            </View>
            <Text style={styles.title}>Chats y Amigos</Text>
            <Text style={styles.subtitle}>
              La mensajería entre jugadores llega muy pronto. Vas a poder
              coordinar partidos, retos y mensajes directos sin salir de
              FutFinder.
            </Text>
            <View style={styles.statusPill}>
              <Sparkles color={colors.primary} size={13} />
              <Text style={styles.statusText}>Próximamente</Text>
            </View>
          </View>

          {/* Features que tendrá */}
          <Text style={styles.sectionTitle}>QUÉ INCLUIRÁ</Text>

          <FeatureRow
            icon={MessageCircle}
            title="Chats de Partido"
            description="Coordina con los jugadores inscritos al mismo partido sin compartir teléfonos."
          />
          <FeatureRow
            icon={Users}
            title="Chats de Equipo"
            description="Conversación permanente con tu equipo recurrente. Uniforme, pagos, alineaciones."
          />
          <FeatureRow
            icon={MessageCircle}
            title="Mensajes Directos"
            description="Habla con jugadores que conociste en un partido y agregaste como amigos."
          />
          <FeatureRow
            icon={Lock}
            title="Privacidad por defecto"
            description="Los mensajes desaparecen 7 días después de finalizar el partido. Sin números, sin spam."
          />

          <View style={{ height: 24 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function FeatureRow({ icon: Icon, title, description }) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.featureIcon}>
        <Icon color={colors.primary} size={18} strokeWidth={1.8} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDesc}>{description}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },

  hero: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 28,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginBottom: 24,
  },
  heroIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primarySoft,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  statusText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  featureRow: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginBottom: 10,
  },
  featureIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  featureDesc: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
});
