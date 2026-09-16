import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
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
  Lock,
} from 'lucide-react-native';

import {
  reservas as C,
  reservasRadius as R,
  reservasSizes as S,
  reservasFonts as F,
} from '../theme/colors';
import { Card, IconButton } from '../components/reservas/ui';
import PremiumBadge, { premiumGold } from '../components/PremiumBadge';
import { getCurrentUser } from '../services/auth';
import { listMembers } from '../services/clubs';

/**
 * Comparativa de planes del club.
 * Estándar (gratis) vs Premium (pago). Mientras no haya pasarela de
 * pagos, Premium se activa contactando al equipo de FutFinder.
 *
 * El dorado de Premium sigue siendo el de `PremiumBadge` y no un tono de la
 * paleta nueva: es la marca del plan y aparece igual en el resto de la app.
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
  const { clubId } = route.params || {};
  const [checking, setChecking] = useState(true);
  const [soyMiembro, setSoyMiembro] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelado = false;
      (async () => {
        setChecking(true);
        const user = await getCurrentUser();
        const myId = user?.id || null;
        const { data: ms } = await listMembers(clubId);
        if (cancelado) return;
        setSoyMiembro(!!myId && (ms || []).some((m) => m.user_id === myId));
        setChecking(false);
      })();
      return () => {
        cancelado = true;
      };
    }, [clubId])
  );

  if (checking) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <Header navigation={navigation} />
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.green} />
        </View>
      </SafeAreaView>
    );
  }

  if (!soyMiembro) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <Header navigation={navigation} />
        <View style={styles.loadingBox}>
          <Lock color={C.textMuted} size={36} strokeWidth={1.5} />
          <Text style={styles.blockedText}>
            Solo los integrantes del club pueden ver esta sección.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <Header navigation={navigation} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Plan Estándar */}
        <Card style={styles.planCard}>
          <View style={styles.planHeader}>
            <View style={styles.planIconWrap}>
              <Shield color={C.green} size={22} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.planName}>Estándar</Text>
              <Text style={styles.planPrice}>Gratis</Text>
            </View>
          </View>
          {FEATURES_ESTANDAR.map((f, i) => (
            <FeatureRow key={i} icon={f.icon} text={f.text} />
          ))}
        </Card>

        {/* Plan Premium */}
        <Card style={[styles.planCard, styles.premiumCard]}>
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
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ navigation }) {
  return (
    <View style={styles.header}>
      <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
      <Text style={styles.headerTitle}>Planes del club</Text>
    </View>
  );
}

function FeatureRow({ icon: Icon, text, gold = false }) {
  return (
    <View style={styles.featureRow}>
      <View style={[styles.featureCheck, gold && styles.featureCheckGold]}>
        <Check
          color={gold ? premiumGold : C.green}
          size={12}
          strokeWidth={3}
        />
      </View>
      <Icon
        color={gold ? premiumGold : C.textSecondary}
        size={16}
        strokeWidth={1.8}
      />
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const GOLD_SOFT = 'rgba(212, 164, 55, 0.12)';

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

  content: { paddingHorizontal: S.screenPadding, paddingBottom: 40, gap: S.cardGap },

  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 30,
  },
  blockedText: {
    fontFamily: F.medium,
    fontSize: 14,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  planCard: { padding: 18 },
  premiumCard: { borderColor: premiumGold, borderWidth: 1.5 },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  planIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.shieldBg,
    borderWidth: 1,
    borderColor: C.greenDeepBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumIconWrap: { backgroundColor: GOLD_SOFT, borderColor: 'transparent' },
  planName: { fontFamily: F.extraBold, fontSize: 18, color: C.textPrimary, letterSpacing: -0.3 },
  premiumNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planPrice: { fontFamily: F.bold, fontSize: 13, color: C.green, marginTop: 3 },
  planPriceSub: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 3 },

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
    backgroundColor: C.shieldBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureCheckGold: { backgroundColor: GOLD_SOFT },
  featureText: { flex: 1, fontFamily: F.medium, fontSize: 13, color: C.textPrimary, lineHeight: 18.5 },

  premiumCta: {
    backgroundColor: GOLD_SOFT,
    borderRadius: R.row,
    padding: 14,
    marginTop: 12,
  },
  premiumCtaText: {
    fontFamily: F.medium,
    fontSize: 12,
    color: C.textSecondary,
    lineHeight: 18,
    textAlign: 'center',
  },
});
