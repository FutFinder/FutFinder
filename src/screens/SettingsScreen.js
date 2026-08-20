import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  Platform,
  Linking,
  ActivityIndicator,
  PanResponder,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Mail,
  Lock,
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
  SlidersHorizontal,
  FileLock,
  AlertTriangle,
  Globe,
  Moon,
  ShieldOff,
  Download,
} from 'lucide-react-native';

import { useActionSheet } from '@expo/react-native-action-sheet';

import { reservas as C, reservasRadius as R, reservasFonts as F } from '../theme/colors';
import { Card, SectionLabel, Sheet, Button, IconButton } from '../components/reservas/ui';
import NotificationBell from '../components/NotificationBell';
import Banner from '../components/Banner';
import { getMyProfileWithStatus, updateMyProfile } from '../services/profile';
import { getMyClub } from '../services/clubs';
import { signOut } from '../services/auth';
import {
  changeEmail,
  changePassword,
  deleteAccount,
  verifyPassword,
  requestPasswordReset,
} from '../services/settings';
import { getProfileLoadStatus } from '../utils/profileEdit';
import { APP_VERSION } from '../utils/appVersion';
import { buildMyDataExport } from '../services/dataExport';

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

// ── Custom slider (no deps externos) ─────────────────────────────
// onValueChange: llama en cada movimiento (UI en tiempo real)
// onValueCommit: llama solo al soltar (persistir en DB)
function RadiusSlider({ value, onValueChange, onValueCommit }) {
  const MIN = 1, MAX = 50, THUMB = 22;
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
      style={{ height: THUMB, justifyContent: 'center', marginTop: 13 }}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        widthRef.current = w;
        setWidth(w);
      }}
    >
      <View style={{
        position: 'absolute', left: 0, right: 0,
        height: 5, backgroundColor: '#20261F', borderRadius: 999,
        top: (THUMB - 5) / 2,
      }} />
      <View style={{
        position: 'absolute', left: 0,
        width: Math.max(0, thumbX + THUMB / 2),
        height: 5, backgroundColor: C.green, borderRadius: 999,
        top: (THUMB - 5) / 2,
      }} />
      <View
        {...pan.panHandlers}
        style={{
          position: 'absolute',
          left: thumbX, top: 0,
          width: THUMB, height: THUMB,
          borderRadius: THUMB / 2,
          backgroundColor: C.green,
          borderWidth: 3, borderColor: C.bg,
          shadowColor: '#000', shadowOpacity: 0.35,
          shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
          elevation: 4,
        }}
      />
    </View>
  );
}

// ── Subcomponentes propios de esta pantalla ───────────────────────
// (burbuja de icono verde + fila con divisor: rasgo propio del handoff de
// Ajustes, distinto del `ListRow` gris neutro que ya usa el resto de
// Reservas — por eso viven acá y no en components/reservas/ui.js)

function IconBubble({ icon: Icon }) {
  return (
    <View style={styles.iconBubble}>
      <Icon color={C.green} size={17} strokeWidth={1.9} />
    </View>
  );
}

function Row({ icon, title, subtitle, subtitleColor, value, showChevron, right, onPress, last, labelColor }) {
  const content = (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <IconBubble icon={icon} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, labelColor && { color: labelColor }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[styles.rowSubtitle, subtitleColor && { color: subtitleColor }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right != null ? right : (
        <View style={styles.rowRight}>
          {value ? <Text style={styles.rowValue} numberOfLines={1}>{value}</Text> : null}
          {showChevron ? <ChevronRight color={C.textMuted} size={17} /> : null}
        </View>
      )}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => pressed && { opacity: 0.75 }}>
      {content}
    </Pressable>
  );
}

function Toggle({ value, onToggle }) {
  return (
    <Pressable
      onPress={() => onToggle(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={[styles.toggleTrack, value ? styles.toggleOn : styles.toggleOff]}
    >
      <View style={[styles.toggleKnob, value ? styles.toggleKnobOn : styles.toggleKnobOff]} />
    </Pressable>
  );
}

/** Pastilla no interactiva: refleja el valor fijo actual (idioma/tema). */
function StaticPill({ label, active }) {
  return (
    <View style={[styles.pill, active ? styles.pillActive : styles.pillIdle]}>
      <Text style={[styles.pillText, active && styles.pillTextActive]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function Input(props) {
  return (
    <TextInput
      placeholderTextColor={C.textMuted}
      style={styles.input}
      {...props}
    />
  );
}

// ── Pantalla principal ────────────────────────────────────────────

export default function SettingsScreen({ navigation }) {
  const { showActionSheetWithOptions } = useActionSheet();

  const [profile, setProfile] = useState(null);
  const [misClub, setMisClub] = useState(null);
  const [loadStatus, setLoadStatus] = useState('loading'); // 'loading' | 'error' | 'ready'
  const [loadError, setLoadError] = useState(null);
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

  // Forgot password cooldown (seconds remaining)
  const [forgotCooldown, setForgotCooldown] = useState(0);
  const forgotTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (forgotTimerRef.current) clearInterval(forgotTimerRef.current);
    };
  }, []);

  const load = useCallback(async () => {
    setLoadStatus('loading');
    setLoadError(null);
    const { data: p, error } = await getMyProfileWithStatus();
    if (error) {
      setLoadError(error);
      setLoadStatus(getProfileLoadStatus({ loading: false, error }));
      return;
    }
    setProfile(p);
    setRadiusKm(p?.search_radius_km ?? 10);
    // El plan y el club de "Mi Plan" viven en `clubs`, no en `profiles` — no
    // hay (ni debería haber) un profile.plan/profile.club_id que leer. Si
    // esto falla, "Mi Plan" simplemente no muestra club (no bloquea el resto
    // de Ajustes: no es la carga que importa para el resto de la pantalla).
    const { data: club } = await getMyClub();
    setMisClub(club);
    setLoadStatus('ready');
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

  // ── Cambiar email ──────────────────────────────────────────────
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

  // ── Cambiar contraseña ─────────────────────────────────────────
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
    if (forgotCooldown > 0) return;

    const { error, email } = await requestPasswordReset();

    // Siempre mostrar feedback (Supabase no revela si el email existe)
    if (error) {
      showBanner('error', 'No se pudo enviar el email', error.message);
      return;
    }
    showBanner(
      'success',
      'Email de recuperación enviado',
      `Revisá la bandeja de ${email || 'tu email registrado'}. Si no llega, revisa el spam.`
    );

    // Cooldown de 60 segundos para evitar rebotes
    let remaining = 60;
    setForgotCooldown(remaining);
    if (forgotTimerRef.current) clearInterval(forgotTimerRef.current);
    forgotTimerRef.current = setInterval(() => {
      remaining -= 1;
      setForgotCooldown(remaining);
      if (remaining <= 0) {
        clearInterval(forgotTimerRef.current);
        forgotTimerRef.current = null;
      }
    }, 1000);
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

  const handleExportData = async () => {
    setSaving(true);
    const { data, error } = await buildMyDataExport();
    setSaving(false);
    if (error) {
      showBanner('error', 'No se pudo exportar', error.message);
      return;
    }
    const json = JSON.stringify(data, null, 2);
    if (Platform.OS === 'web') {
      try {
        await navigator.clipboard.writeText(json);
        showBanner('success', 'Datos copiados', 'Pégalos en un archivo de texto para guardarlos.');
      } catch {
        showBanner('error', 'No se pudo copiar', 'Tu navegador no permitió copiar al portapapeles.');
      }
      return;
    }
    try {
      await Share.share({ message: json, title: 'Mis datos — FutFinder' });
    } catch {
      showBanner('error', 'No se pudo compartir', 'Inténtalo de nuevo en unos segundos.');
    }
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
    const current = profile?.privacy_friend_requests === 'nobody' ? 'nobody' : 'everyone';
    const check = ' ✓';
    const options = [
      `Todos${current === 'everyone' ? check : ''}`,
      `Nadie${current === 'nobody' ? check : ''}`,
      'Cancelar',
    ];
    showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex: 2,
        title: '¿Quién puede enviarte solicitudes de amistad?',
        containerStyle: { backgroundColor: C.surface },
        textStyle: { color: C.textPrimary, fontSize: 15, fontWeight: '500' },
        titleTextStyle: { color: C.textSecondary, fontSize: 13, fontWeight: '600' },
        separatorStyle: { backgroundColor: C.border },
      },
      (index) => {
        if (index === 0) toggleField('privacy_friend_requests', 'everyone');
        else if (index === 1) toggleField('privacy_friend_requests', 'nobody');
      },
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

  if (loadStatus === 'loading') {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <Header navigation={navigation} />
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.green} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadStatus === 'error') {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <Header navigation={navigation} />
        <View style={styles.loadingBox}>
          <AlertTriangle color={C.red} size={30} strokeWidth={1.8} />
          <Text style={styles.errorTitle}>No pudimos cargar tus ajustes</Text>
          <Text style={styles.errorMsg}>
            {loadError?.message || 'Revisa tu conexión e intenta de nuevo.'}
          </Text>
          <Pressable
            onPress={load}
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.retryLabel}>Reintentar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const friendRequestLabel = profile?.privacy_friend_requests === 'nobody' ? 'Nadie' : 'Todos';
  const planLabel = misClub?.plan === 'premium' ? 'Premium' : 'Estándar';

  const nombre = profile?.nombre?.trim();
  const username = profile?.username;
  const headerSubtitle = nombre && username ? `${nombre} · @${username}` : username ? `@${username}` : nombre || '';

  const regionDefinida = Boolean(profile?.pref_comuna || profile?.comuna);
  const regionValue = regionDefinida
    ? `${profile.pref_comuna || profile.comuna}${(profile.pref_region || profile.region) ? `, ${profile.pref_region || profile.region}` : ''}`
    : 'No definida';

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <Header navigation={navigation} subtitle={headerSubtitle} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

        {/* ── PRIVACIDAD ───────────────────────────────────── */}
        <SectionLabel>Privacidad</SectionLabel>
        <Card padded={false} style={styles.card}>
          <Row
            icon={Users}
            title="Solicitudes de amistad"
            subtitle="Quién puede enviarte solicitudes"
            value={friendRequestLabel}
            showChevron
            onPress={openFriendRequestPicker}
          />
          <Row
            icon={Eye}
            title="Visible en búsquedas"
            subtitle="Tu perfil aparece al buscar jugadores"
            right={
              <Toggle
                value={profile?.privacy_visible_in_search ?? true}
                onToggle={(v) => toggleField('privacy_visible_in_search', v)}
              />
            }
          />
          <Row
            icon={ShieldOff}
            title="Bloqueados"
            showChevron
            last
            onPress={() => navigation.navigate('BlockedUsers')}
          />
        </Card>

        {/* ── APARIENCIA ───────────────────────────────────── */}
        <SectionLabel>Apariencia</SectionLabel>
        <Card padded={false} style={styles.card}>
          <View style={[styles.row, styles.rowDivider, { flexDirection: 'column', alignItems: 'stretch' }]}>
            <View style={styles.rowTop}>
              <IconBubble icon={Globe} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Idioma</Text>
                <Text style={styles.rowSubtitle}>Idioma de la aplicación</Text>
              </View>
            </View>
            <View style={styles.pillRow}>
              <StaticPill label="Español" active />
              <StaticPill label="English" />
            </View>
          </View>
          <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch' }]}>
            <View style={styles.rowTop}>
              <IconBubble icon={Moon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Tema</Text>
                <Text style={styles.rowSubtitle}>Siempre oscuro</Text>
              </View>
            </View>
            <View style={styles.pillRow}>
              <StaticPill label="Oscuro" active />
              <StaticPill label="Claro" />
              <StaticPill label="Automático" />
            </View>
          </View>
        </Card>

        {/* ── NOTIFICACIONES ──────────────────────────────── */}
        <SectionLabel>Notificaciones</SectionLabel>
        <Card padded={false} style={styles.card}>
          <Row
            icon={Bell}
            title="Partidos"
            subtitle="Invitaciones, cambios y recordatorios"
            right={<Toggle value={profile?.notif_matches ?? true} onToggle={(v) => toggleField('notif_matches', v)} />}
          />
          <Row
            icon={Shield}
            title="Clubes"
            subtitle="Desafíos, propuestas y nóminas"
            right={<Toggle value={profile?.notif_clubs ?? true} onToggle={(v) => toggleField('notif_clubs', v)} />}
          />
          <Row
            icon={MessageCircle}
            title="Chat"
            subtitle="Mensajes de coordinación"
            right={<Toggle value={profile?.notif_chat ?? true} onToggle={(v) => toggleField('notif_chat', v)} />}
          />
          <Row
            icon={UserPlus}
            title="Solicitudes de amistad"
            subtitle="Cuando alguien te quiere agregar"
            last
            right={<Toggle value={profile?.notif_friends ?? true} onToggle={(v) => toggleField('notif_friends', v)} />}
          />
        </Card>

        {/* ── PREFERENCIAS ─────────────────────────────────── */}
        <SectionLabel>Preferencias</SectionLabel>
        <Card padded={false} style={styles.card}>
          <Row
            icon={MapPin}
            title="Región y comuna"
            subtitle={regionValue}
            subtitleColor={regionDefinida ? C.green : undefined}
            showChevron
            onPress={() => {
              setRegionInput(profile?.pref_region || profile?.region || '');
              setComunaInput(profile?.pref_comuna || profile?.comuna || '');
              setModal('location');
            }}
          />
          <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch' }]}>
            <View style={styles.rowTop}>
              <IconBubble icon={SlidersHorizontal} />
              <Text style={[styles.rowTitle, { flex: 1 }]}>Radio de búsqueda</Text>
              <View style={styles.radiusBadge}>
                <Text style={styles.radiusBadgeText}>{radiusKm} km</Text>
              </View>
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
        </Card>

        {/* ── SOPORTE ─────────────────────────────────────── */}
        <SectionLabel>Soporte</SectionLabel>
        <Card padded={false} style={styles.card}>
          <Row icon={Flag} title="Reportar un problema" showChevron onPress={openSupportEmail} />
          <Row
            icon={FileText}
            title="Términos y condiciones"
            showChevron
            onPress={() => {
              if (Platform.OS === 'web') { openURL(TERMS_URL); }
              else { navigation.navigate('Terms'); }
            }}
          />
          <Row
            icon={FileLock}
            title="Política de privacidad"
            showChevron
            last
            onPress={() => openURL(PRIVACY_URL)}
          />
        </Card>

        {APP_VERSION && <Text style={styles.versionText}>FutFinder {APP_VERSION}</Text>}

        {/* ── PLAN ────────────────────────────────────────── */}
        <SectionLabel>Mi Plan</SectionLabel>
        <Card padded={false} style={styles.card}>
          <Row
            icon={Crown}
            title="Plan actual"
            right={
              <Text style={[styles.rowValue, misClub && planLabel === 'Premium' && { color: '#F2C94C' }]}>
                {/* El plan es del CLUB, no tuyo: sin club no hay nada que
                    mostrar acá — "Estándar" sería un dato inventado. */}
                {misClub ? planLabel : 'Sin club'}
              </Text>
            }
          />
          <Row
            icon={Crown}
            title="Ver planes"
            showChevron
            last
            onPress={() => navigation.navigate('ClubPlans', { clubId: misClub?.id })}
          />
        </Card>

        {/* ── CUENTA ──────────────────────────────────────── */}
        <SectionLabel>Cuenta</SectionLabel>
        <Card padded={false} style={styles.card}>
          <Row icon={Mail} title="Cambiar email" showChevron onPress={() => setModal('email')} />
          <Row icon={Lock} title="Cambiar contraseña" showChevron onPress={() => setModal('password')} />
          <Row icon={Download} title="Exportar mis datos" showChevron last onPress={handleExportData} />
        </Card>

        <View style={styles.footerBtns}>
          <Button label="Cerrar sesión" variant="secondary" onPress={handleLogout} />
          <Pressable
            onPress={handleDeleteAccount}
            accessibilityRole="button"
            accessibilityLabel="Eliminar cuenta"
            style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.8 }]}
          >
            <Trash2 color={C.red} size={16} strokeWidth={2} />
            <Text style={styles.deleteBtnText}>Eliminar cuenta</Text>
          </Pressable>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      {saving && (
        <View style={styles.savingOverlay} pointerEvents="none">
          <ActivityIndicator color={C.green} />
        </View>
      )}

      {/* ── Modal: Cambiar email ─────────────────────────── */}
      <Sheet
        visible={modal === 'email'}
        title="Cambiar email"
        onClose={() => { setModal(null); setEmailInput(''); setCurrentPwdForEmail(''); }}
      >
        <Text style={styles.modalHint}>
          Recibirás un enlace de confirmación en el nuevo email antes del cambio.
        </Text>
        <Input
          placeholder="Contraseña actual"
          value={currentPwdForEmail}
          onChangeText={setCurrentPwdForEmail}
          secureTextEntry
          autoFocus
        />
        <Input
          style={[styles.input, { marginTop: 10 }]}
          placeholder="Nuevo email"
          value={emailInput}
          onChangeText={setEmailInput}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Button
          label="Cambiar email"
          loading={saving}
          onPress={handleChangeEmail}
          style={{ marginTop: 14 }}
        />
      </Sheet>

      {/* ── Modal: Cambiar contraseña ────────────────────── */}
      <Sheet
        visible={modal === 'password'}
        title="Cambiar contraseña"
        onClose={() => {
          setModal(null);
          setCurrentPwdInput('');
          setPasswordInput('');
          setPassword2Input('');
        }}
      >
        <Input
          placeholder="Contraseña actual"
          value={currentPwdInput}
          onChangeText={setCurrentPwdInput}
          secureTextEntry
          autoFocus
        />
        <Pressable
          onPress={forgotCooldown > 0 ? undefined : handleForgotPassword}
          style={{ marginTop: 8, marginBottom: 4 }}
          disabled={forgotCooldown > 0}
        >
          <Text style={[styles.forgotLink, forgotCooldown > 0 && { color: C.textMuted }]}>
            {forgotCooldown > 0
              ? `Reenviar en ${forgotCooldown}s...`
              : '¿Olvidaste tu contraseña?'}
          </Text>
        </Pressable>
        <Input
          style={[styles.input, { marginTop: 10 }]}
          placeholder="Nueva contraseña"
          value={passwordInput}
          onChangeText={setPasswordInput}
          secureTextEntry
        />
        <Input
          style={[styles.input, { marginTop: 10 }]}
          placeholder="Repetir contraseña"
          value={password2Input}
          onChangeText={setPassword2Input}
          secureTextEntry
        />
        <Button
          label="Cambiar contraseña"
          loading={saving}
          onPress={handleChangePassword}
          style={{ marginTop: 14 }}
        />
      </Sheet>

      {/* ── Modal: Región y comuna ───────────────────────── */}
      <Sheet
        visible={modal === 'location'}
        title="Región y comuna de búsqueda"
        onClose={() => setModal(null)}
      >
        <Text style={styles.modalHint}>
          Se usará como filtro por defecto al buscar partidos.
        </Text>
        <Input
          placeholder="Región (ej: Metropolitana)"
          value={regionInput}
          onChangeText={setRegionInput}
          autoFocus
        />
        <Input
          style={[styles.input, { marginTop: 10 }]}
          placeholder="Comuna (ej: Santiago)"
          value={comunaInput}
          onChangeText={setComunaInput}
        />
        <Button
          label="Guardar preferencia"
          loading={saving}
          onPress={handleSaveLocation}
          style={{ marginTop: 14 }}
        />
      </Sheet>
    </SafeAreaView>
  );
}

// ── Subcomponentes ────────────────────────────────────────────────

function Header({ navigation, subtitle }) {
  return (
    <View style={styles.header}>
      <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>Ajustes</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      <NotificationBell />
    </View>
  );
}

// ── Estilos ───────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitle: {
    fontFamily: F.extraBold,
    color: C.textPrimary,
    fontSize: 19, letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontFamily: F.medium,
    color: C.textSecondary,
    fontSize: 12, marginTop: 2,
  },

  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 30 },
  errorTitle: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 16, textAlign: 'center' },
  errorMsg: { fontFamily: F.medium, color: C.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  retryBtn: {
    marginTop: 4,
    height: 44,
    paddingHorizontal: 24,
    borderRadius: R.pill,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryLabel: { fontFamily: F.extraBold, color: C.textOnGreen, fontSize: 14 },

  scroll: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 32, gap: 11 },

  card: { paddingHorizontal: 15, marginBottom: 2 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: C.dividerInner },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  rowTitle: { fontFamily: F.bold, color: C.textPrimary, fontSize: 14 },
  rowSubtitle: { fontFamily: F.medium, color: C.textSecondary, fontSize: 11.5, marginTop: 2 },
  rowValue: { fontFamily: F.bold, color: C.textSecondary, fontSize: 13, flexShrink: 1 },

  iconBubble: {
    width: 34, height: 34, borderRadius: 11, flexShrink: 0,
    backgroundColor: C.shieldBg, borderWidth: 1, borderColor: C.greenDeepBorder,
    alignItems: 'center', justifyContent: 'center',
  },

  toggleTrack: {
    width: 48, height: 28, borderRadius: 999, padding: 3, flexShrink: 0,
    borderWidth: 1, justifyContent: 'center',
  },
  toggleOn: { backgroundColor: C.green, borderColor: C.greenDeepBorder, alignItems: 'flex-end' },
  toggleOff: { backgroundColor: C.surfaceAlt, borderColor: C.border, alignItems: 'flex-start' },
  toggleKnob: { width: 20, height: 20, borderRadius: 999 },
  toggleKnobOn: { backgroundColor: C.textOnGreen },
  toggleKnobOff: { backgroundColor: '#3A4139' },

  pillRow: { flexDirection: 'row', gap: 8, marginTop: 12, paddingBottom: 14 },
  pill: {
    flex: 1, height: 38, borderRadius: 13, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  pillActive: { backgroundColor: C.shieldBg, borderColor: C.green },
  pillIdle: { backgroundColor: C.surfaceAlt, borderColor: C.border },
  pillText: { fontFamily: F.extraBold, color: C.textSecondary, fontSize: 12.5 },
  pillTextActive: { color: C.green },

  radiusBadge: {
    height: 28, paddingHorizontal: 11, borderRadius: 999,
    backgroundColor: C.shieldBg, borderWidth: 1, borderColor: C.greenDeepBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  radiusBadgeText: { fontFamily: F.extraBold, color: C.green, fontSize: 12.5 },
  sliderTicks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingBottom: 14 },
  tickLabel: { fontFamily: F.semiBold, color: C.textMuted, fontSize: 11 },

  versionText: {
    fontFamily: F.semiBold, color: C.textMuted, fontSize: 11,
    textAlign: 'center', marginTop: 6,
  },

  footerBtns: { gap: 10, marginTop: 22 },
  deleteBtn: {
    height: 48, borderRadius: R.ctaSecondary, borderWidth: 1, borderColor: 'rgba(237,107,118,0.35)',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  deleteBtnText: { fontFamily: F.bold, color: C.red, fontSize: 14.5 },

  savingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },

  modalHint: {
    fontFamily: F.medium, color: C.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 12,
  },
  forgotLink: { fontFamily: F.semiBold, color: C.green, fontSize: 13 },
  input: {
    backgroundColor: C.bg,
    borderWidth: 1, borderColor: C.border,
    borderRadius: R.row,
    paddingHorizontal: 14, paddingVertical: 12,
    color: C.textPrimary, fontFamily: F.medium, fontSize: 14,
  },
});
