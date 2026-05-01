import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ShieldCheck, AlertCircle } from 'lucide-react-native';

import Logo from '../components/Logo';
import Button from '../components/Button';
import { colors, radius } from '../theme/colors';
import { verifyEmailOtp, resendOtp } from '../services/auth';
import { isSupabaseConfigured } from '../services/supabase';

const CODE_LENGTH = 6;

export default function VerificationScreen({ navigation, route }) {
  const email = route?.params?.email || '';

  const [digits, setDigits] = useState(Array(CODE_LENGTH).fill(''));
  const [channel, setChannel] = useState('Correo'); // Correo | SMS
  const [error, setError] = useState(null);
  const [seconds, setSeconds] = useState(42);
  const [loading, setLoading] = useState(false);
  const inputs = useRef([]);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds(seconds - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const handleChange = (val, idx) => {
    setError(null);
    const clean = val.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[idx] = clean;
    setDigits(next);
    if (clean && idx < CODE_LENGTH - 1) inputs.current[idx + 1]?.focus();
  };

  const handleKey = (e, idx) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[idx] && idx > 0) {
      inputs.current[idx - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const code = digits.join('');
    if (code.length < CODE_LENGTH) {
      setError('Ingresa los 6 dígitos');
      return;
    }

    // Modo demo: si Supabase no está configurado, aceptamos 472000
    if (!isSupabaseConfigured) {
      if (code !== '472000') {
        setError('Código incorrecto. Intente de nuevo');
        return;
      }
      navigation.navigate('LocationPermission');
      return;
    }

    setLoading(true);
    const { error: err } = await verifyEmailOtp({ email, token: code });
    setLoading(false);

    if (err) {
      setError(err.message || 'Código incorrecto. Intente de nuevo');
      return;
    }
    navigation.navigate('LocationPermission');
  };

  const handleResend = async () => {
    setError(null);
    setSeconds(42);
    setDigits(Array(CODE_LENGTH).fill(''));
    inputs.current[0]?.focus();
    if (isSupabaseConfigured && email) {
      await resendOtp({ email });
    }
  };

  const fmt = `0:${seconds.toString().padStart(2, '0')}`;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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
              <ShieldCheck color={colors.primary} size={20} />
              <Text style={styles.title}>Verificación de cuenta</Text>
            </View>
            <Text style={styles.subtitle}>
              {email
                ? `Ingresa el código de 6 dígitos enviado a ${email}`
                : 'Ingresa el código de 6 dígitos enviado a tu correo o SMS'}
            </Text>

            <View style={styles.codeRow}>
              {digits.map((d, i) => (
                <TextInput
                  key={i}
                  ref={(r) => (inputs.current[i] = r)}
                  style={[
                    styles.codeBox,
                    d && styles.codeBoxFilled,
                    error && styles.codeBoxError,
                  ]}
                  value={d}
                  onChangeText={(v) => handleChange(v, i)}
                  onKeyPress={(e) => handleKey(e, i)}
                  keyboardType="number-pad"
                  maxLength={1}
                  textAlign="center"
                  selectTextOnFocus
                />
              ))}
            </View>

            <View style={styles.channelRow}>
              <View style={styles.channelGroup}>
                {['Correo', 'SMS'].map((c) => {
                  const active = channel === c;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => setChannel(c)}
                      style={[
                        styles.channelBtn,
                        active && styles.channelBtnActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.channelText,
                          active && styles.channelTextActive,
                        ]}
                      >
                        {c}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable disabled={seconds > 0} onPress={handleResend} hitSlop={8}>
                <Text
                  style={[
                    styles.resend,
                    seconds === 0 && { color: colors.primary },
                  ]}
                >
                  {seconds > 0 ? `Reenviar en ${fmt}` : 'Reenviar código'}
                </Text>
              </Pressable>
            </View>

            <View style={{ height: 18 }} />

            <Button
              label={loading ? 'Verificando…' : 'Verificar código'}
              variant="primary"
              onPress={handleVerify}
              loading={loading}
            />

            {error && (
              <View style={styles.errorBox}>
                <AlertCircle color={colors.error} size={16} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {!isSupabaseConfigured && (
              <Text style={styles.hint}>
                💡 Modo demo: el código válido es{' '}
                <Text style={{ color: colors.primary, fontWeight: '700' }}>
                  472000
                </Text>
              </Text>
            )}
          </View>

          <Text style={styles.footer}>FUTFINDER v1.2.0 · © 2026</Text>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
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
    marginBottom: 4,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: 22,
  },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 18,
  },
  codeBox: {
    flex: 1,
    aspectRatio: 1,
    minWidth: 38,
    maxWidth: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    ...Platform.select({ web: { outlineStyle: 'none' } }),
  },
  codeBoxFilled: { borderColor: colors.primary },
  codeBoxError: { borderColor: colors.error },
  channelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  channelGroup: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  channelBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: radius.pill },
  channelBtnActive: { backgroundColor: colors.primary },
  channelText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  channelTextActive: { color: '#0E0E0D' },
  resend: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  errorBox: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.errorSoft,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.error,
  },
  errorText: { color: colors.error, fontSize: 13, fontWeight: '600', flex: 1 },
  hint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 14,
    textAlign: 'center',
  },
  footer: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 24,
    letterSpacing: 0.5,
  },
});
