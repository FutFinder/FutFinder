import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ImageBackground,
  Pressable,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Navigation,
  SlidersHorizontal,
  CheckCircle2,
  Star,
} from 'lucide-react-native';

import Logo from '../components/Logo';
import Button from '../components/Button';
import FeatureCard from '../components/FeatureCard';
import { colors, radius } from '../theme/colors';

const HERO_IMAGE = {
  uri: 'https://images.unsplash.com/photo-1551958219-acbc608c6377?auto=format&fit=crop&w=1600&q=80',
};

export default function WelcomeScreen({ navigation }) {
  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* HERO con imagen + logo + tagline */}
        <ImageBackground
          source={HERO_IMAGE}
          style={styles.hero}
          imageStyle={styles.heroImage}
        >
          <View style={styles.heroOverlay} />
          <SafeAreaView edges={['top']} style={styles.heroContent}>
            <View style={styles.logoWrap}>
              <Logo size={40} />
            </View>
            <Text style={styles.tagline}>
              Encuentra o completa tu partido en minutos
            </Text>
          </SafeAreaView>
        </ImageBackground>

        {/* Línea verde decorativa */}
        <View style={styles.greenBar} />

        {/* Grid 2x2 de features */}
        <View style={styles.gridContainer}>
          <View style={styles.gridRow}>
            <FeatureCard
              icon={Navigation}
              title="Partidos cercanos"
              description={'Canchas cerca de ti en tiempo real'}
            />
            <View style={{ width: 12 }} />
            <FeatureCard
              icon={SlidersHorizontal}
              title="Filtra por nivel y precio"
              description={'Elige según tu experiencia y bolsillo'}
            />
          </View>

          <View style={{ height: 12 }} />

          <View style={styles.gridRow}>
            <FeatureCard
              icon={CheckCircle2}
              title="Validación de asistencia"
              description={'Confirma quién realmente llega'}
            />
            <View style={{ width: 12 }} />
            <FeatureCard
              icon={Star}
              title="Reputación confiable"
              description={'Jugadores verificados y puntuados'}
            />
          </View>
        </View>

        {/* CTAs */}
        <View style={styles.ctas}>
          <Button
            label="Comenzar ahora"
            variant="primary"
            onPress={() => navigation.navigate('Login')}
          />
          <View style={{ height: 12 }} />
          <Pressable
            onPress={() => navigation.navigate('Login')}
            style={({ pressed }) => [
              styles.outlineBtn,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={styles.outlineLabel}>Ya tengo cuenta</Text>
          </Pressable>
        </View>

        <Text style={styles.legal}>
          Al continuar aceptas nuestros Términos y Política de Privacidad
        </Text>
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flexGrow: 1,
  },
  hero: {
    height: 380,
    width: '100%',
    justifyContent: 'flex-end',
  },
  heroImage: {
    resizeMode: 'cover',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(32,31,29,0.55)',
  },
  heroContent: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'flex-end',
    paddingBottom: 24,
    alignItems: 'center',
  },
  logoWrap: {
    marginBottom: 16,
  },
  tagline: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  greenBar: {
    height: 6,
    backgroundColor: colors.primary,
    width: '100%',
    ...Platform.select({
      web: { boxShadow: '0 0 24px rgba(113,181,51,0.6)' },
      default: {
        shadowColor: colors.primary,
        shadowOpacity: 0.6,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 0 },
        elevation: 6,
      },
    }),
  },
  gridContainer: {
    paddingHorizontal: 20,
    paddingTop: 28,
  },
  gridRow: {
    flexDirection: 'row',
  },
  ctas: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  outlineBtn: {
    height: 54,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineLabel: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  legal: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 12,
    paddingHorizontal: 32,
    paddingTop: 18,
  },
});
