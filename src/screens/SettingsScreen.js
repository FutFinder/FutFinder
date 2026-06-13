import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  TextInput,
  Modal,
  Alert,
  Platform,
  Linking,
  ActivityIndicator,
  PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Mail,
  Lock,
  LogOut,
  Trash2,
  Users,
  Eye,
  Bell,
  Shield,
  MessageCircle,
  UserPlus,
  MapPin,
  Flag,
  FileText,
  Crown,
  ChevronRight,
  X,
  SlidersHorizontal,
  FileLock,
} from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import Banner from '../components/Banner';
import Button from '../components/Button';
import { getMyProfile, updateMyProfile } from '../services/profile';
import { signOut } from '../services/auth';
import {
  changeEmail,
  changePassword,
  deleteAccount,
  verifyPassword,
  requestPasswordReset,
} from '../services/settings';

const SUPPORT_EMAIL = 'futfindercl@gmail.com';
const TERMS_URL = 'https://futfinder.cl/terminos';
const PRIVACY_URL = 'https://futfinder.cl/privacidad';

function confirmAction(title, message, onConfirm) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Confirmar', style: 'destructive', onPress: onConfirm },
  ]);
}

function pickOption(title, options, onPick) {
  if (Platform.OS === 'web') {
    const labels = options.map((o) => o.label).join(' / ');
    const idx = window.confirm(`${title}\n\n${labels}\n\n(OK = ${options[0].label}, Cancelar = ${options[1]?.label})`)
      ? 0 : 1;
    onPick(options[idx]?.value);
    return;
  }
  Alert.alert(
    title, '',
    [
      ...options.map((o) => ({ text: o.label, onPress: () => onPick(o.value) })),
      { text: 'Cancelar', style: 'cancel' },
    ],
  );
}

// ── Custom slider (no deps externos) ─────────────────────────────
// onValueChange: llama en cada movimiento (UI en tiempo real)
// onValueCommit: llama solo al soltar (persistir en DB)
function RadiusSlider({ value, onValueChange, onValueCommit }) {
  const MIN = 1, MAX = 50, THUMB = 24;
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onValueChange);
  const onCommitRef = useRef(onValueCommit);
  const startXRef = useRef(0);

  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { onChangeRef.current = onValueChange; }, [onValueChange]);
  useEffect(() => { onCommitRef.current = onValueCommit; }, [onValueCommit]);

  const getInner = () => Math.max(1, widthRef.current - THUMB);
  const valToX = (v) => ((v - MIN) / (MAX - MIN)) * getInner();
  const xToVal = (x) => {
    const clamped = Math.max(0, Math.min(x, getInner()));
    return Math.round(MIN + (clamped / getInner()) * (MAX - MIN));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startXRef.current = valToX(valueRef.current);
      },
      onPanResponderMove: (_, { dx }) => {
        const x = Math.max(0, Math.min(startXRef.current + dx, getInner()));
        onChangeRef.current(xToVal(x));
      },
      onPanResponderRelease: (_, { dx }) => {
        const x = Math.max(0, Math.min(startXRef.current + dx, getInner()));
        const v = xToVal(x);
        onChangeRef.current(v);
        onCommitRef.current?.(v);
      },
    })
  ).current;

  const thumbX = width > 0 ? valToX(value) : 0;

  return (
    <View
      style={{ height: THUMB, justifyContent: 'center', marginVertical: 6 }}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        widthRef.current = w;
        setWidth(w);
      }}
    >
      {/* Track background */}
      <View style={{
        position: 'absolute', left: 0, right: 0,
        height: 4, backgroundColor: colors.borderSoft, borderRadius: 2,
        top: (THUMB - 4) / 2,
      }} />
      {/* Fill */}
      <View style={{
        position: 'absolute', left: 0,
        width: Math.max(0, thumbX + THUMB / 2),
        height: 4, backgroundColor: colors.primary, borderRadius: 2,
        top: (THUMB - 4) / 2,
      }} />
      {/* Thumb */}
      <View
        {...pan.panHandlers}
        style={{
          position: 'absolute',
          left: thumbX, top: 0,
          width: THUMB, height: THUMB,
          borderRadius: THUMB / 2,
          backgroundColor: colors.primary,
          borderWidth: 2.5, borderColor: '#fff',
          shadowColor: '#000', shadowOpacity: 0.3,
          shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
          elevation: 4,
        }}
      />
    </View>
  );
}

// ── Pantalla principal ────────────────────────────────────────────

export default function SettingsScreen({ navigation }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);

  // Modal state
  const [modal, setModal] = useState(null); // 'email' | 'password' | 'location'

  // Email modal
  const [emailInput, setEmailInput] = useState('');
  const [currentPwdForEmail, setCurrentPwdForEmail] = useState('');

  // Password modal
  const [currentPwdInput, setCurrentPwdInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [password2Input, setPassword2Input] = useState('');

  // Location modal
  const [regionInput, setRegionInput] = useState('');
  const [comunaInput, setComunaInput] = useState('');

  // Preferences
  const [radiusKm, setRadiusKm] = useState(10);

  const load = useCallback(async () => {
    const p = await getMyProfile();
    setProfile(p);
    setRadiusKm(p?.search_radius_km ?? 10);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const showBanner = (type, title, message = '') => {
    setBanner({ type, title, message });
    if (type !== 'error') setTimeout(() => setBanner(null), 4000);
  };

  const navigateToAuth = () => {
    const parent = navigation.getParent();
    const nav = parent || navigation;
    nav.reset({ index: 0, routes: [{ name: 'Welcome' }] });
  };

  const save = async (patch, successMsg = 'Guardado') => {
    setSaving(true);
    const { error } = await updateMyProfile(patch);
    setSaving(false);
    if (error) {
      showBanner('error', 'No se pudo guardar', error.message);
      return false;
    }
    setProfile((p) => ({ ...p, ...patch }));
    if (successMsg) showBanner('success', successMsg);
    return true;
  };

  const toggleField = async (field, value) => {
    setProfile((p) => ({ ...p, [field]: value }));
    const { error } = await updateMyProfile({ [field]: value });
    if (error) {
      setProfile((p) => ({ ...p, [field]: !value }));
      showBanner('error', 'No se pudo guardar', error.message);
    }
  };

  const handleRadiusRelease = async (km) => {
    setRadiusKm(km);
    const { error } = await updateMyProfile({ search_radius_km: km });
    if (error) showBanner('error', 'No se pudo guardar el radio', error.message);
    else setProfile((p) => ({ ...p, search_radius_km: km }));
  };

  // ── Cambiar email (FIX 2) ─────────────────────────────────────
  const handleChangeEmail = async () => {
    const email = emailInput.trim();
    if (!email.includes('@')) {
      showBanner('error', 'Email inválido', 'Introduce un email válido.');
      return;
    }
    if (!currentPwdForEmail) {
      showBanner('error', 'Falta la contraseña actual', 'Ingrésala para confirmar el cambio.');
      return;
    }
    setSaving(true);
    const { error: verifyErr } = await verifyPassword(profile?.email, currentPwdForEmail);
    if (verifyErr) {
      setSaving(false);
      showBanner('error', 'Contraseña incorrecta', verifyErr.message);
      return;
    }
    const { error } = await changeEmail(email);
    setSaving(false);
    if (error) { showBanner('error', 'No se pudo cambiar', error.message); return; }
    setModal(null);
    setEmailInput('');
    setCurrentPwdForEmail('');
    showBanner('success', 'Revisa tu bandeja', 'Te enviamos un link de confirmación al nuevo email.');
  };

  // ── Cambiar contraseña (FIX 1) ────────────────────────────────
  const handleChangePassword = async () => {
    if (!currentPwdInput) {
      showBanner('error', 'Falta la contraseña actual', 'Ingrésala para continuar.');
      return;
    }
    if (passwordInput.length < 6) {
      showBanner('error', 'Contraseña muy corta', 'Mínimo 6 caracteres.');
      return;
    }
    if (passwordInput !== password2Input) {
      showBanner('error', 'No coinciden', 'Las contraseñas no son iguales.');
      return;
    }
    setSaving(true);
    const { error: verifyErr } = await verifyPassword(profile?.email, currentPwdInput);
    if (verifyErr) {
      setSaving(false);
      showBanner('error', 'Contraseña incorrecta', verifyErr.message);
      return;
    }
    const { error } = await changePassword(passwordInput);
    setSaving(false);
    if (error) { showBanner('error', 'No se pudo cambiar', error.message); return; }
    setModal(null);
    setCurrentPwdInput('');
    setPasswordInput('');
    setPassword2Input('');
    showBanner('success', 'Contraseña actualizada');
  };

  const handleForgotPassword = async () => {
    if (!profile?.email) return;
    const { error } = await requestPasswordReset(profile.email);
    if (error) {
      showBanner('error', 'No se pudo enviar', error.message);
    } else {
      setModal(null);
      showBanner('success', 'Email enviado', `Revisa ${profile.email} para restablecer tu contraseña.`);
    }
  };

  const handleSaveLocation = async () => {
    await save(
      { pref_region: regionInput.trim() || null, pref_comuna: comunaInput.trim() || null },
      'Preferencia guardada',
    );
    setModal(null);
  };

  const handleLogout = () => {
    confirmAction(
      'Cerrar sesión',
      '¿Seguro que quieres salir de tu cuenta?',
      async () => { await signOut(); navigateToAuth(); },
    );
  };

  const handleDeleteAccount = () => {
    confirmAction(
      '¿Eliminar tu cuenta?',
      'Esta acción es permanente e irreversible. Se borrarán todos tus datos, partidos, mensajes y membresías.',
      async () => {
        setSaving(true);
        const { error } = await deleteAccount();
        if (error) {
          setSaving(false);
          showBanner('error', 'No se pudo eliminar', error.message);
          return;
        }
        await signOut();
        navigateToAuth();
      },
    );
  };

  const openFriendRequestPicker = () => {
    pickOption(
      '¿Quién puede enviarte solicitudes de amistad?',
      [
        { label: 'Todos', value: 'everyone' },
        { label: 'Nadie', value: 'nobody' },
      ],
      (value) => value && toggleField('privacy_friend_requests', value),
    );
  };

  const openSupportEmail = () => {
    const subject = encodeURIComponent('Reportar un problema — FutFinder');
    const body = encodeURIComponent('Describe el problema que encontraste:\n\n');
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`).catch(() =>
      showBanner('error', 'No se pudo abrir el email', `Escríbenos a ${SUPPORT_EMAIL}`)
    );
  };

  const openURL = (url) => {
    Linking.openURL(url).catch(() =>
      showBanner('error', 'No se pudo abrir el enlace', url)
    );
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <Header navigation={navigation} />
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const friendRequestLabel = profile?.privacy_friend_requests === 'nobody' ? 'Nadie' : 'Todos';
  const planLabel = profile?.plan === 'premium' ? 'Premium' : 'Estándar';

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <Header navigation={navigation} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

        {/* ── PRIVACIDAD (FIX 3: ahora es primero) ─────────── */}
        <SectionHeader title="Privacidad" />

        <View style={styles.card}>
          <ArrowRow
            icon={<Users color={colors.primary} size={18} />}
            label="Solicitudes de amistad"
            value={friendRequestLabel}
            onPress={openFriendRequestPicker}
          />
          <Divider />
          <ToggleRow
            icon={<Eye color={colors.primary} size={18} />}
            label="Visible en búsquedas"
            value={profile?.privacy_visible_in_search ?? true}
            onToggle={(v) => toggleField('privacy_visible_in_search', v)}
          />
        </View>

        {/* ── NOTIFICACIONES ──────────────────────────────── */}
        <SectionHeader title="Notificaciones" />

        <View style={styles.card}>
          <ToggleRow
            icon={<Bell color={colors.primary} size={18} />}
            label="Partidos"
            value={profile?.notif_matches ?? true}
            onToggle={(v) => toggleField('notif_matches', v)}
          />
          <Divider />
          <ToggleRow
            icon={<Shield color={colors.primary} size={18} />}
            label="Clubes"
            value={profile?.notif_clubs ?? true}
            onToggle={(v) => toggleField('notif_clubs', v)}
          />
          <Divider />
          <ToggleRow
            icon={<MessageCircle color={colors.primary} size={18} />}
            label="Chat"
            value={profile?.notif_chat ?? true}
            onToggle={(v) => toggleField('notif_chat', v)}
          />
          <Divider />
          <ToggleRow
            icon={<UserPlus color={colors.primary} size={18} />}
            label="Solicitudes de amistad"
            value={profile?.notif_friends ?? true}
            onToggle={(v) => toggleField('notif_friends', v)}
          />
        </View>

        {/* ── PREFERENCIAS (FIX 4 + FIX 5) ───────────────── */}
        <SectionHeader title="Preferencias" />

        <View style={styles.card}>
          <ArrowRow
            icon={<MapPin color={colors.primary} size={18} />}
            label="Región y comuna de búsqueda"
            value={
              profile?.pref_comuna || profile?.comuna
                ? `${profile.pref_comuna || profile.comuna}${(profile.pref_region || profile.region) ? `, ${profile.pref_region || profile.region}` : ''}`
                : 'No definida'
            }
            onPress={() => {
              // FIX 4: fallback a profile.region / profile.comuna
              setRegionInput(profile?.pref_region || profile?.region || '');
              setComunaInput(profile?.pref_comuna || profile?.comuna || '');
              setModal('location');
            }}
          />
          <Divider />
          {/* FIX 5: Slider de radio */}
          <View style={styles.sliderRow}>
            <View style={styles.sliderHeader}>
              <View style={styles.rowLeft}>
                <SlidersHorizontal color={colors.primary} size={18} />
                <Text style={styles.rowLabel}>Radio de búsqueda</Text>
              </View>
              <Text style={styles.radiusLabel}>{radiusKm} km</Text>
            </View>
            <RadiusSlider
              value={radiusKm}
              onValueChange={setRadiusKm}
              onValueCommit={handleRadiusRelease}
            />
            <View style={styles.sliderTicks}>
              <Text style={styles.tickLabel}>1 km</Text>
              <Text style={styles.tickLabel}>50 km</Text>
            </View>
          </View>
        </View>

        {/* ── SOPORTE ─────────────────────────────────────── */}
        <SectionHeader title="Soporte" />

        <View style={styles.card}>
          <ArrowRow
            icon={<Flag color={colors.primary} size={18} />}
            label="Reportar un problema"
            onPress={openSupportEmail}
          />
          <Divider />
          <ArrowRow
            icon={<FileText color={colors.primary} size={18} />}
            label="Términos y condiciones"
            onPress={() => {
              if (Platform.OS === 'web') { openURL(TERMS_URL); }
              else { navigation.navigate('Terms'); }
            }}
          />
          <Divider />
          {/* FIX 7: FileLock en lugar de Shield */}
          <ArrowRow
            icon={<FileLock color={colors.primary} size={18} />}
            label="Política de privacidad"
            onPress={() => openURL(PRIVACY_URL)}
          />
        </View>

        {/* ── PLAN ────────────────────────────────────────── */}
        <SectionHeader title="Mi Plan" />

        <View style={styles.card}>
          <View style={styles.planRow}>
            <View style={styles.rowLeft}>
              <Crown color={planLabel === 'Premium' ? '#F2C94C' : colors.textMuted} size={18} />
              <Text style={styles.rowLabel}>Plan actual</Text>
            </View>
            <Text style={[styles.planBadge, planLabel === 'Premium' && { color: '#F2C94C' }]}>
              {planLabel}
            </Text>
          </View>
          <Divider />
          <ArrowRow
            icon={<Crown color={colors.primary} size={18} />}
            label="Ver planes"
            onPress={() => navigation.navigate('ClubPlans', { clubId: profile?.club_id })}
          />
        </View>

        {/* ── CUENTA (FIX 3: movida al final) ─────────────── */}
        <SectionHeader title="Cuenta" />

        <View style={styles.card}>
          <ArrowRow
            icon={<Mail color={colors.primary} size={18} />}
            label="Cambiar email"
            onPress={() => setModal('email')}
          />
          <Divider />
          <ArrowRow
            icon={<Lock color={colors.primary} size={18} />}
            label="Cambiar contraseña"
            onPress={() => setModal('password')}
          />
          <Divider />
          {/* FIX 3: LogOut en gris, no rojo */}
          <ArrowRow
            icon={<LogOut color={colors.textSecondary} size={18} />}
            label="Cerrar sesión"
            labelStyle={{ color: colors.textSecondary }}
            onPress={handleLogout}
          />
          <Divider />
          <ArrowRow
            icon={<Trash2 color={colors.error} size={18} />}
            label="Eliminar cuenta"
            labelStyle={{ color: colors.error }}
            onPress={handleDeleteAccount}
          />
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      {saving && (
        <View style={styles.savingOverlay} pointerEvents="none">
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {/* ── Modal: Cambiar email (FIX 2) ─────────────────── */}
      <SettingsModal
        visible={modal === 'email'}
        title="Cambiar email"
        onClose={() => { setModal(null); setEmailInput(''); setCurrentPwdForEmail(''); }}
      >
        <Text style={styles.modalHint}>
          Recibirás un enlace de confirmación en el nuevo email antes del cambio.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Contraseña actual"
          placeholderTextColor={colors.textMuted}
          value={currentPwdForEmail}
          onChangeText={setCurrentPwdForEmail}
          secureTextEntry
          autoFocus
        />
        <TextInput
          style={[styles.input, { marginTop: 10 }]}
          placeholder="Nuevo email"
          placeholderTextColor={colors.textMuted}
          value={emailInput}
          onChangeText={setEmailInput}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Button
          label="Cambiar email"
          loading={saving}
          onPress={handleChangeEmail}
          style={{ marginTop: 8 }}
        />
      </SettingsModal>

      {/* ── Modal: Cambiar contraseña (FIX 1) ───────────── */}
      <SettingsModal
        visible={modal === 'password'}
        title="Cambiar contraseña"
        onClose={() => {
          setModal(null);
          setCurrentPwdInput('');
          setPasswordInput('');
          setPassword2Input('');
        }}
      >
        <TextInput
          style={styles.input}
          placeholder="Contraseña actual"
          placeholderTextColor={colors.textMuted}
          value={currentPwdInput}
          onChangeText={setCurrentPwdInput}
          secureTextEntry
          autoFocus
        />
        <Pressable onPress={handleForgotPassword} style={{ marginTop: 6, marginBottom: 4 }}>
          <Text style={styles.forgotLink}>¿Olvidaste tu contraseña?</Text>
        </Pressable>
        <TextInput
          style={[styles.input, { marginTop: 10 }]}
          placeholder="Nueva contraseña"
          placeholderTextColor={colors.textMuted}
          value={passwordInput}
          onChangeText={setPasswordInput}
          secureTextEntry
        />
        <TextInput
          style={[styles.input, { marginTop: 10 }]}
          placeholder="Repetir contraseña"
          placeholderTextColor={colors.textMuted}
          value={password2Input}
          onChangeText={setPassword2Input}
          secureTextEntry
        />
        <Button
          label="Cambiar contraseña"
          loading={saving}
          onPress={handleChangePassword}
          style={{ marginTop: 8 }}
        />
      </SettingsModal>

      {/* ── Modal: Región y comuna ───────────────────────── */}
      <SettingsModal
        visible={modal === 'location'}
        title="Región y comuna de búsqueda"
        onClose={() => setModal(null)}
      >
        <Text style={styles.modalHint}>
          Se usará como filtro por defecto al buscar partidos.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Región (ej: Metropolitana)"
          placeholderTextColor={colors.textMuted}
          value={regionInput}
          onChangeText={setRegionInput}
          autoFocus
        />
        <TextInput
          style={[styles.input, { marginTop: 10 }]}
          placeholder="Comuna (ej: Santiago)"
          placeholderTextColor={colors.textMuted}
          value={comunaInput}
          onChangeText={setComunaInput}
        />
        <Button
          label="Guardar preferencia"
          loading={saving}
          onPress={handleSaveLocation}
          style={{ marginTop: 8 }}
        />
      </SettingsModal>
    </SafeAreaView>
  );
}

// ── Subcomponentes ────────────────────────────────────────────────

function Header({ navigation }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => navigation.goBack()}
        hitSlop={12}
        style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
      >
        <ArrowLeft color={colors.textPrimary} size={20} />
      </Pressable>
      <Text style={styles.headerTitle}>Ajustes</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

function SectionHeader({ title }) {
  return <Text style={styles.sectionHeader}>{title.toUpperCase()}</Text>;
}

function Divider() {
  return <View style={styles.divider} />;
}

function ArrowRow({ icon, label, value, onPress, labelStyle }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.rowLeft}>
        {icon}
        <Text style={[styles.rowLabel, labelStyle]}>{label}</Text>
      </View>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        <ChevronRight color={colors.textMuted} size={16} />
      </View>
    </Pressable>
  );
}

function ToggleRow({ icon, label, value, onToggle }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        {icon}
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: colors.borderSoft, true: colors.primary }}
        thumbColor={value ? '#fff' : colors.textMuted}
        ios_backgroundColor={colors.borderSoft}
      />
    </View>
  );
}

function SettingsModal({ visible, title, onClose, children }) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <X color={colors.textMuted} size={20} />
            </Pressable>
          </View>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Estilos ───────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 18, fontWeight: '800', letterSpacing: -0.3,
  },

  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },

  sectionHeader: {
    color: colors.textMuted,
    fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
    marginTop: 20, marginBottom: 8, marginLeft: 4,
  },

  card: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    overflow: 'hidden',
  },

  divider: { height: 1, backgroundColor: colors.borderSoft, marginLeft: 48 },

  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 14,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  rowLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowValue: { color: colors.textMuted, fontSize: 13 },

  // Slider row
  sliderRow: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12 },
  sliderHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10,
  },
  radiusLabel: {
    color: colors.primary, fontSize: 14, fontWeight: '700',
  },
  sliderTicks: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 4,
  },
  tickLabel: { color: colors.textMuted, fontSize: 11 },

  planRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 14,
  },
  planBadge: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },

  savingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: 20, paddingBottom: 36,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
  modalHint: {
    color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 12,
  },
  forgotLink: {
    color: colors.primary, fontSize: 13, fontWeight: '600',
  },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
    color: colors.textPrimary, fontSize: 14,
  },
});
