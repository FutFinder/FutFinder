import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, FileText, Check } from 'lucide-react-native';

import Logo from '../components/Logo';
import Button from '../components/Button';
import { colors, radius } from '../theme/colors';

const TERMS_TEXT =
  'Al usar FUTFINDER aceptas nuestros Términos de Servicios y Políticas de Privacidad. Tus datos de ubicación se procesarán de forma segura y no se compartirán con terceros sin tu consentimiento. Nos comprometemos a proteger tu información personal y a usarla exclusivamente para mejorar tu experiencia deportiva dentro de la plataforma.';

function CheckboxRow({ value, onToggle, label }) {
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [styles.checkRow, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.checkbox, value && styles.checkboxActive]}>
        {value && <Check color="#0E0E0D" size={14} strokeWidth={3} />}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

export default function TermsScreen({ navigation }) {
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptNotifs, setAcceptNotifs] = useState(false);

  const canContinue = acceptTerms;

  const handleContinue = () => {
    if (!canContinue) return;
    navigation.navigate('Success');
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Pressable
              onPress={() => navigation.goBack()}
              hitSlop={12}
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            >
              <ArrowLeft color={colors.textPrimary} size={22} />
            </Pressable>
            <View style={styles.logoCenter}>
              <Logo size={32} />
            </View>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.card}>
            <View style={styles.titleRow}>
              <FileText color={colors.primary} size={20} />
              <Text style={styles.title}>Términos y condiciones</Text>
            </View>

            <View style={styles.legalBox}>
              <Text style={styles.legalText}>{TERMS_TEXT}</Text>
            </View>

            <CheckboxRow
              value={acceptTerms}
              onToggle={() => setAcceptTerms(!acceptTerms)}
              label="Acepto los términos de Servicios y la Política de Privacidad"
            />
            <View style={{ height: 12 }} />
            <CheckboxRow
              value={acceptNotifs}
              onToggle={() => setAcceptNotifs(!acceptNotifs)}
              label="Deseo recibir notificaciones sobre partidos y novedades"
            />

            <View style={{ height: 22 }} />

            <Button
              label="Aceptar y continuar"
              variant="primary"
              onPress={handleContinue}
              disabled={!canContinue}
            />
          </View>

          <Text style={styles.footer}>FUTFINDER v1.2.0 · © 2026</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoCenter: { flex: 1, alignItems: 'center' },
  card: {
    marginTop: 12,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.xl,
    padding: 22,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  legalBox: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginBottom: 18,
  },
  legalText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkLabel: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 24,
    letterSpacing: 0.5,
  },
});
