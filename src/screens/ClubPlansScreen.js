import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Check,
  Crown,
  Shield,
  Users,
  MessageCircle,
  Trophy,
  Image as ImageIcon,
  Palette,
  Globe,
  Swords,
  BarChart3,
  Award,
  BadgeCheck,
} from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import PremiumBadge, { premiumGold } from '../components/PremiumBadge';

/**
 * Comparativa de planes del club.
 * Estándar (gratis) vs Premium (pago). Mientras no haya pasarela de
 * pagos, Premium se activa contactando al equipo de FutFinder.
 */

const FEATURES_ESTANDAR = [
  { icon: Users, text: 'Hasta 15 integrantes con perfiles y reputación visibles' },
  { icon: Crown, text: '1 administrador del club' },
  { icon: MessageCircle, text: 'Chat interno del club' },
  { icon: Swords, text: 'Encuentros contra clubes rivales (4 por mes)' },
  { icon: BarChart3, text: 'Historial de partidos: victorias, derrotas, empates y goles' },
];

const FEATURES_PREMIUM = [
  { icon: BadgeCheck, text: 'Insignia de verificación y prioridad en búsquedas' },
  { icon: Crown, text: 'Hasta 3 administradores' },
  { icon: Users, text: 'Hasta 26 integrantes' },
  { icon: Swords, text: 'Encuentros ilimitados contra clubes rivales' },
  { icon: Globe, text: 'Página pública compartible del club' },
  { icon: Palette, text: 'Logo propio + personalización de colores y banners' },
  { icon: ImageIcon, text: 'Apartado fotográfico y Arte del Club' },
  { icon: Trophy, text: 'Vitrina de Trofeos Digital' },
  { icon: Swords, text: 'Historial de Clásicos Rivales automático' },
  { icon: BarChart3, text: 'Resumen de temporada compartible cada 3 meses' },
  { icon: Award, text: 'Premiaciones semestrales: Goleador, Balón de Oro y más' },
];

export default function ClubPlansScreen({ navigation, route }) {
  // clubId disponible para cuando exista la pasarela de pagos
  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <ArrowLeft color={colors.textPrimary} size={22} />
        </Pressable>
        <Text style={styles.headerTitle}>Planes del club</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Plan Estándar */}
        <View style={styles.planCard}>
          <View style={styles.planHeader}>
            <View style={styles.planIconWrap}>
              <Shield color={colors.primary} size={22} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.planName}>Estándar</Text>
              <Text style={styles.planPrice}>Gratis</Text>
            </View>
          </View>
          {FEATURES_ESTANDAR.map((f, i) => (
            <FeatureRow key={i} icon={f.icon} text={f.text} />
          ))}
        </View>

        {/* Plan Premium */}
        <View style={[styles.planCard, styles.premiumCard]}>
          <View style={styles.planHeader}>
            <View style={[styles.planIconWrap, styles.premiumIconWrap]}>
              <Crown color={premiumGold} size={22} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.premiumNameRow}>
                <Text style={styles.planName}>Premium</Text>
                <PremiumBadge variant="badge" />
              </View>
              <Text style={styles.planPriceSub}>Todo lo del plan Estándar, más:</Text>
            </View>
          </View>
          {FEATURES_PREMIUM.map((f, i) => (
            <FeatureRow key={i} icon={f.icon} text={f.text} gold />
          ))}

          <View style={styles.premiumCta}>
            <Text style={styles.premiumCtaText}>
              Para activar Premium escríbenos a contacto@futfinder.com.
              Pronto podrás contratarlo directo desde la app.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FeatureRow({ icon: Icon, text, gold = false }) {
  return (
    <View style={styles.featureRow}>
      <View style={[styles.featureCheck, gold && styles.featureCheckGold]}>
        <Check
          color={gold ? premiumGold : colors.primary}
          size={12}
          strokeWidth={3}
        />
      </View>
      <Icon
        color={gold ? premiumGold : colors.textSecondary}
        size={16}
        strokeWidth={1.8}
      />
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const GOLD_SOFT = 'rgba(212, 164, 55, 0.12)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  content: { padding: 16, paddingBottom: 40, gap: 16 },

  planCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 18,
  },
  premiumCard: {
    borderColor: premiumGold,
    borderWidth: 1.5,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  planIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumIconWrap: { backgroundColor: GOLD_SOFT },
  planName: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  premiumNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  planPrice: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  planPriceSub: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  featureCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureCheckGold: { backgroundColor: GOLD_SOFT },
  featureText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
  },
  premiumCta: {
    backgroundColor: GOLD_SOFT,
    borderRadius: radius.lg,
    padding: 14,
    marginTop: 12,
  },
  premiumCtaText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
