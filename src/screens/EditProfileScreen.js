import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Camera,
  Plus,
  X as XIcon,
  Images,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react-native';

import { reservas as C, reservasRadius as R, reservasFonts as F } from '../theme/colors';
import { Card, SectionLabel, Button, IconButton } from '../components/reservas/ui';
import NotificationBell from '../components/NotificationBell';
import BannerBackdrop from '../components/ds/BannerBackdrop';
import Banner from '../components/Banner';
import { getMyProfileWithStatus, updateMyProfile } from '../services/profile';
import {
  pickImage,
  uploadAvatarFile,
  uploadBannerFile,
  removeAvatarBucketFile,
  pathFromPublicUrl,
} from '../services/storage';
import {
  getProfilePhotos,
  uploadGalleryPhoto,
  deleteProfilePhoto,
  MAX_PHOTOS,
} from '../services/gallery';
import { isSupabaseConfigured } from '../services/supabase';
import { REGIONES, getComunasOfRegion } from '../data/regiones-chile';
import { OPCIONES_MODALIDAD, OPCIONES_NIVEL, inicialDe } from '../utils/playerMeta';
import { validateImageAsset, commitProfileSave, getProfileLoadStatus } from '../utils/profileEdit';

const POSICIONES = [
  { value: 'arquero', label: 'Arquero' },
  { value: 'defensa', label: 'Defensa' },
  { value: 'lateral', label: 'Lateral' },
  { value: 'volante', label: 'Volante' },
  { value: 'medio', label: 'Mediocampista' },
  { value: 'delantero', label: 'Delantero' },
  { value: 'sin_definir', label: 'Sin definir' },
];

const FLANCOS = [
  { value: 'derecho', label: 'Der' },
  { value: 'izquierdo', label: 'Izq' },
  { value: 'ambos', label: 'Ambos' },
];

// ── Subcomponentes propios de esta pantalla ───────────────────────

function Pill({ label, active, onPress, disabled, flex }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.pill,
        flex && { flex: 1 },
        active ? styles.pillActive : styles.pillIdle,
        disabled && styles.pillDisabled,
        pressed && !disabled && { opacity: 0.8 },
      ]}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]} numberOfLines={1}>
        {active ? `✓ ${label}` : label}
      </Text>
    </Pressable>
  );
}

function NivelRow({ label, sub, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}, ${sub}`}
      style={({ pressed }) => [styles.nivelRow, active && styles.nivelRowActive, pressed && { opacity: 0.85 }]}
    >
      <View style={[styles.nivelDot, active && styles.nivelDotActive]}>
        {active ? <View style={styles.nivelDotInner} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.nivelLabel}>{label}</Text>
        <Text style={styles.nivelSub}>{sub}</Text>
      </View>
    </Pressable>
  );
}

function FieldLabel({ children }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

function Divider() {
  return <View style={styles.divider} />;
}

export default function EditProfileScreen({ navigation }) {
  const [loadStatus, setLoadStatus] = useState('loading'); // 'loading' | 'error' | 'ready'
  const [loadError, setLoadError] = useState(null);
  const [initialProfile, setInitialProfile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);

  const [username, setUsername] = useState('');
  const [edad, setEdad] = useState('');
  const [bio, setBio] = useState('');
  const [posiciones, setPosiciones] = useState(['sin_definir']);
  const [flanco, setFlanco] = useState('derecho');
  const [region, setRegion] = useState('');
  const [comuna, setComuna] = useState('');
  const [fotoUrl, setFotoUrl] = useState(null);
  const [bannerUrl, setBannerUrl] = useState(null);
  const [modalidad, setModalidad] = useState(null);
  const [nivel, setNivel] = useState(null);

  // Avatar y portada nuevos quedan como cambio LOCAL (solo el asset elegido,
  // sin subir nada) hasta que se confirme con «Guardar cambios».
  const [pendingAvatar, setPendingAvatar] = useState(null);
  const [pendingBanner, setPendingBanner] = useState(null);

  const [regionOpen, setRegionOpen] = useState(false);
  const [comunaOpen, setComunaOpen] = useState(false);

  // Galería
  const [userId, setUserId] = useState(null);
  const [galleryPhotos, setGalleryPhotos] = useState([]);
  const [uploadingGallery, setUploadingGallery] = useState(false);

  const loadProfile = async () => {
    setLoadStatus('loading');
    setLoadError(null);
    const { data: p, error } = await getMyProfileWithStatus();
    if (error) {
      setLoadError(error);
      setLoadStatus(getProfileLoadStatus({ loading: false, error }));
      return;
    }
    setInitialProfile(p);
    if (p) {
      setUserId(p.id);
      setUsername(p.username || '');
      setEdad(p.edad ? String(p.edad) : '');
      setBio(p.bio || '');
      if (Array.isArray(p.posicion_preferida) && p.posicion_preferida.length) {
        setPosiciones(p.posicion_preferida);
      } else if (typeof p.posicion_preferida === 'string') {
        setPosiciones([p.posicion_preferida]);
      } else {
        setPosiciones(['sin_definir']);
      }
      setFlanco(p.flanco || 'derecho');
      setRegion(p.region || '');
      setComuna(p.comuna || '');
      setFotoUrl(p.foto_url || null);
      setBannerUrl(p.banner_url || null);
      setModalidad(p.modalidad || null);
      setNivel(p.nivel || null);
      setPendingAvatar(null);
      setPendingBanner(null);

      const { data: photos } = await getProfilePhotos(p.id);
      setGalleryPhotos(photos || []);
    }
    setLoadStatus('ready');
  };

  useEffect(() => {
    loadProfile();
  }, []);

  // ---- Elegir portada (queda como cambio local, no se sube todavía) ----
  const handlePickBanner = async () => {
    const { ok, asset, reason } = await pickImage({ aspect: [16, 9], quality: 0.85, base64: false });
    if (!ok) {
      if (reason && reason !== 'Cancelado') {
        setBanner({ type: 'error', title: 'No pude abrir tus fotos', message: reason });
      }
      return;
    }
    const { ok: valid, reason: invalidReason } = validateImageAsset(asset);
    if (!valid) {
      setBanner({ type: 'error', title: 'Imagen no válida', message: invalidReason });
      return;
    }
    setPendingBanner(asset);
    setBanner(null);
  };

  // ---- Elegir foto de perfil (queda como cambio local, no se sube todavía) ----
  const handlePickAvatar = async () => {
    const { ok, asset, reason } = await pickImage({ aspect: [1, 1], quality: 0.9, base64: false });
    if (!ok) {
      if (reason && reason !== 'Cancelado') {
        setBanner({ type: 'error', title: 'No pude abrir tus fotos', message: reason });
      }
      return;
    }
    const { ok: valid, reason: invalidReason } = validateImageAsset(asset);
    if (!valid) {
      setBanner({ type: 'error', title: 'Imagen no válida', message: invalidReason });
      return;
    }
    setPendingAvatar(asset);
    setBanner(null);
  };

  // ---- Galería (cada foto se sube de inmediato; es independiente del formulario) ----
  const handleAddGalleryPhoto = async () => {
    if (uploadingGallery || !userId) return;
    if (galleryPhotos.length >= MAX_PHOTOS) {
      setBanner({ type: 'info', title: 'Límite alcanzado', message: `Máximo ${MAX_PHOTOS} fotos por perfil.` });
      return;
    }
    const { ok, asset, reason } = await pickImage({ aspect: [1, 1], quality: 0.9, base64: false });
    if (!ok) {
      if (reason && reason !== 'Cancelado') {
        setBanner({ type: 'error', title: 'No pude abrir tus fotos', message: reason });
      }
      return;
    }
    const { ok: valid, reason: invalidReason } = validateImageAsset(asset);
    if (!valid) {
      setBanner({ type: 'error', title: 'Imagen no válida', message: invalidReason });
      return;
    }
    setUploadingGallery(true);
    const { data, error } = await uploadGalleryPhoto(asset, userId);
    setUploadingGallery(false);
    if (error) {
      setBanner({ type: 'error', title: 'No pude subir la foto', message: error.message || '' });
      return;
    }
    setGalleryPhotos((prev) => [data, ...prev]);
    setBanner({ type: 'success', title: 'Foto agregada', message: '' });
    setTimeout(() => setBanner(null), 2500);
  };

  const handleDeleteGalleryPhoto = (photo) => {
    const doDelete = async () => {
      const { error } = await deleteProfilePhoto(photo.id, photo.photo_url, userId);
      if (error) {
        setBanner({ type: 'error', title: 'No pude eliminar la foto', message: error.message || '' });
        return;
      }
      setGalleryPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    };

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('¿Eliminar esta foto de tu galería?')) {
        doDelete();
      }
    } else {
      Alert.alert('Eliminar foto', '¿Seguro que quieres eliminar esta foto de tu galería?', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const comunasOfRegion = region ? getComunasOfRegion(region) : [];

  const togglePosicion = (val) => {
    setPosiciones((prev) => {
      // Si solo queda 1 y la deseleccionan, dejamos 'sin_definir'
      if (prev.includes(val)) {
        const next = prev.filter((x) => x !== val);
        return next.length === 0 ? ['sin_definir'] : next;
      }
      // Si tenemos solo 'sin_definir' y agregan otra real, sacamos 'sin_definir'
      const cleaned = prev.filter((x) => x !== 'sin_definir');
      // Tope razonable de 4 posiciones simultáneas
      if (cleaned.length >= 4) return prev;
      return [...cleaned, val];
    });
  };

  const validate = () => {
    if (!username.trim()) return 'El @username no puede estar vacío';
    if (username.length < 3) return '@username debe tener al menos 3 caracteres';
    if (username.length > 20) return '@username no puede tener más de 20 caracteres';
    if (!/^[a-zA-Z0-9_]+$/.test(username))
      return '@username solo puede tener letras, números y guión bajo';
    if (edad) {
      const n = parseInt(edad, 10);
      if (Number.isNaN(n) || n < 12 || n > 99) return 'La edad debe estar entre 12 y 99';
    }
    if (!posiciones || posiciones.length === 0) return 'Elige al menos una posición';
    return null;
  };

  const handleSave = async () => {
    setBanner(null);
    const err = validate();
    if (err) {
      setBanner({ type: 'error', title: 'Revisa el formulario', message: err });
      return;
    }

    if (!isSupabaseConfigured) {
      setBanner({
        type: 'info',
        title: 'Modo demo',
        message: 'Sin Supabase no podemos guardar.',
      });
      return;
    }

    setSaving(true);
    const { error, newAvatarUrl, newBannerUrl } = await commitProfileSave({
      pendingAvatar,
      pendingBanner,
      oldAvatarPath: pathFromPublicUrl(initialProfile?.foto_url, 'avatars'),
      oldBannerPath: pathFromPublicUrl(initialProfile?.banner_url, 'avatars'),
      uploadAvatarFile,
      uploadBannerFile,
      updateProfile: ({ foto_url, banner_url }) => {
        const patch = {
          username: username.trim(),
          edad: edad ? parseInt(edad, 10) : null,
          bio: bio.trim() || null,
          posicion_preferida: posiciones,
          flanco,
          region: region || null,
          comuna: comuna || null,
          modalidad: modalidad || null,
          nivel: nivel || null,
        };
        // Solo se incluyen si hay una foto/portada nueva: así no se toca la
        // columna existente cuando el usuario no cambió esa imagen.
        if (foto_url !== undefined) patch.foto_url = foto_url;
        if (banner_url !== undefined) patch.banner_url = banner_url;
        return updateMyProfile(patch);
      },
      removeFile: removeAvatarBucketFile,
    });
    setSaving(false);

    if (error) {
      const code = error.code || '';
      const msg = error.message || '';
      let userMsg = 'No pudimos guardar';
      // Postgres unique violation
      if (code === '23505' || /duplicate|unique/i.test(msg)) {
        if (/username|profiles_username_ci_idx/i.test(msg)) {
          userMsg = 'Ese @username ya está tomado, elige otro.';
        } else {
          userMsg = 'Hay un valor duplicado en el formulario.';
        }
      } else if (msg) {
        userMsg = msg;
      }
      // El perfil anterior no se tocó y los archivos huérfanos ya se
      // limpiaron dentro de commitProfileSave; el asset local elegido queda
      // disponible para reintentar sin tener que elegirlo de nuevo.
      setBanner({ type: 'error', title: 'No pudimos guardar', message: userMsg });
      return;
    }

    // Recién ahora, con el guardado confirmado, se reemplaza lo que se veía.
    if (newAvatarUrl) {
      setFotoUrl(newAvatarUrl);
      setPendingAvatar(null);
    }
    if (newBannerUrl) {
      setBannerUrl(newBannerUrl);
      setPendingBanner(null);
    }
    setInitialProfile((prev) => (prev ? { ...prev, foto_url: newAvatarUrl || prev.foto_url, banner_url: newBannerUrl || prev.banner_url } : prev));

    setBanner({
      type: 'success',
      title: '¡Perfil actualizado!',
      message: 'Tus cambios quedaron guardados.',
    });
    setTimeout(() => navigation.goBack(), 800);
  };

  const posTope = posiciones.filter((p) => p !== 'sin_definir').length >= 4;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Editar perfil</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>Otros jugadores lo ven al inscribirse contigo</Text>
          </View>
          <NotificationBell />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {banner && (
            <Banner
              type={banner.type}
              title={banner.title}
              message={banner.message}
              onClose={() => setBanner(null)}
            />
          )}

          {loadStatus === 'loading' ? (
            <View style={styles.center}>
              <ActivityIndicator color={C.green} />
            </View>
          ) : loadStatus === 'error' ? (
            <View style={styles.center}>
              <AlertTriangle color={C.red} size={30} strokeWidth={1.8} />
              <Text style={styles.errorTitle}>No pudimos cargar tu perfil</Text>
              <Text style={styles.errorMsg}>
                {loadError?.message || 'Revisa tu conexión e intenta de nuevo.'}
              </Text>
              <Pressable
                onPress={loadProfile}
                style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.retryLabel}>Reintentar</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {/* Portada + avatar */}
              <View style={styles.identityCard}>
                <Pressable
                  onPress={handlePickBanner}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={bannerUrl || pendingBanner ? 'Cambiar la portada' : 'Subir una portada'}
                  style={styles.bannerTap}
                >
                  {pendingBanner ? (
                    <Image source={{ uri: pendingBanner.uri }} style={styles.bannerImg} resizeMode="cover" />
                  ) : bannerUrl ? (
                    <Image source={{ uri: bannerUrl }} style={styles.bannerImg} resizeMode="cover" />
                  ) : (
                    <BannerBackdrop variant="empty" />
                  )}
                  {(bannerUrl || pendingBanner) ? (
                    <View style={styles.bannerChip}>
                      <Camera color="#D2D8D3" size={13} strokeWidth={2} />
                      <Text style={styles.bannerChipText}>Cambiar portada</Text>
                    </View>
                  ) : (
                    <View style={styles.bannerChip}>
                      <Camera color="#D2D8D3" size={15} strokeWidth={1.9} />
                      <Text style={styles.bannerChipText}>Subir portada</Text>
                    </View>
                  )}
                </Pressable>

                <View style={styles.avatarWrap}>
                  <Pressable
                    onPress={handlePickAvatar}
                    disabled={saving}
                    accessibilityRole="button"
                    accessibilityLabel="Cambiar tu foto de perfil"
                    style={({ pressed }) => [styles.avatarBig, pressed && { opacity: 0.88 }]}
                  >
                    {pendingAvatar ? (
                      <Image source={{ uri: pendingAvatar.uri }} style={styles.avatarImage} />
                    ) : fotoUrl ? (
                      <Image source={{ uri: fotoUrl }} style={styles.avatarImage} />
                    ) : (
                      <Text style={styles.avatarInitial}>{inicialDe({ username })}</Text>
                    )}
                    <View style={styles.avatarEditBtn}>
                      {saving && pendingAvatar ? (
                        <ActivityIndicator color={C.textOnGreen} size="small" />
                      ) : (
                        <Camera color={C.textOnGreen} size={14} strokeWidth={2.2} />
                      )}
                    </View>
                  </Pressable>
                  <Text style={styles.avatarHint}>
                    {pendingAvatar
                      ? 'Foto lista — pulsa «Guardar cambios» para aplicarla'
                      : 'Toca el avatar para cambiar tu foto'}
                  </Text>
                </View>
              </View>

              {/* Identidad */}
              <SectionLabel>Identidad</SectionLabel>
              <Card>
                <FieldLabel>@username</FieldLabel>
                <TextInput
                  style={styles.input}
                  placeholder="ej: CarlosMendez_10"
                  placeholderTextColor={C.textMuted}
                  value={username}
                  onChangeText={(v) => setUsername(v.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20))}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                />
                <Text style={styles.fieldHint}>
                  Letras, números y guión bajo. No distingue mayúsculas al detectar duplicados.
                </Text>

                <View style={styles.row2}>
                  <View style={{ width: 104 }}>
                    <FieldLabel>Edad</FieldLabel>
                    <TextInput
                      style={styles.input}
                      placeholder="24"
                      placeholderTextColor={C.textMuted}
                      value={edad}
                      onChangeText={(v) => setEdad(v.replace(/\D/g, '').slice(0, 2))}
                      keyboardType="number-pad"
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <FieldLabel>Flanco preferido</FieldLabel>
                    <View style={styles.pillRow}>
                      {FLANCOS.map((f) => (
                        <Pill
                          key={f.value}
                          label={f.label}
                          active={flanco === f.value}
                          onPress={() => setFlanco(f.value)}
                          flex
                        />
                      ))}
                    </View>
                  </View>
                </View>
              </Card>

              {/* Juego */}
              <SectionLabel>Juego</SectionLabel>
              <Card>
                <View style={styles.rowBetween}>
                  <Text style={styles.blockTitle}>Posiciones preferidas</Text>
                  <View style={[styles.countBadge, posTope && styles.countBadgeFull]}>
                    <Text style={[styles.countBadgeText, posTope && styles.countBadgeTextFull]}>
                      {posiciones.filter((p) => p !== 'sin_definir').length} de 4
                    </Text>
                  </View>
                </View>
                <View style={styles.wrapPills}>
                  {POSICIONES.map((p) => {
                    const selected = posiciones.includes(p.value);
                    return (
                      <Pill
                        key={p.value}
                        label={p.label}
                        active={selected}
                        disabled={!selected && posTope}
                        onPress={() => togglePosicion(p.value)}
                      />
                    );
                  })}
                </View>

                <Divider />

                <Text style={styles.blockTitle}>Modalidad que juegas</Text>
                <View style={styles.wrapPills}>
                  {OPCIONES_MODALIDAD.map((op) => (
                    <Pill
                      key={op.value}
                      label={op.label}
                      active={modalidad === op.value}
                      onPress={() => setModalidad(modalidad === op.value ? null : op.value)}
                    />
                  ))}
                </View>
                <Text style={styles.fieldHint}>
                  Se muestra en tu perfil. Sin elegir aparece como “Fútbol N.A.”.
                </Text>

                <Divider />

                <Text style={styles.blockTitle}>Tu nivel</Text>
                <View style={{ gap: 8, marginTop: 11 }}>
                  {OPCIONES_NIVEL.map((op) => (
                    <NivelRow
                      key={op.value}
                      label={op.label}
                      sub={op.hint}
                      active={nivel === op.value}
                      onPress={() => setNivel(nivel === op.value ? null : op.value)}
                    />
                  ))}
                </View>
                <Text style={styles.fieldHint}>
                  Lo declaras tú; no es un ranking calculado. Sin elegir aparece como “Nivel N.A.”.
                </Text>
              </Card>

              {/* Descripción */}
              <SectionLabel>Descripción</SectionLabel>
              <Card>
                <TextInput
                  style={styles.textarea}
                  placeholder="Cuenta tu trayectoria, en qué ligas jugaste, qué buscas en un partido…"
                  placeholderTextColor={C.textMuted}
                  value={bio}
                  onChangeText={setBio}
                  multiline
                  numberOfLines={4}
                  maxLength={400}
                  textAlignVertical="top"
                />
                <Text style={styles.charCount}>{bio.length}/400</Text>
              </Card>

              {/* Ubicación */}
              <SectionLabel>Ubicación habitual</SectionLabel>
              <Card>
                <Text style={styles.locationHint}>
                  Te ayuda a encontrar partidos cerca de donde sueles jugar.
                </Text>

                <FieldLabel>Región</FieldLabel>
                <Pressable
                  onPress={() => { setRegionOpen(!regionOpen); setComunaOpen(false); }}
                  style={styles.pickerRow}
                >
                  <Text style={styles.pickerText} numberOfLines={1}>
                    {region || 'Selecciona una región'}
                  </Text>
                  <ChevronDown color={C.textMuted} size={17} />
                </Pressable>
                {regionOpen && (
                  <View style={styles.pickerList}>
                    <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
                      {REGIONES.map((r) => (
                        <Pressable
                          key={r.nombre}
                          onPress={() => {
                            setRegion(r.nombre);
                            if (!r.comunas.includes(comuna)) setComuna('');
                            setRegionOpen(false);
                          }}
                          style={[styles.pickerOption, r.nombre === region && styles.pickerOptionActive]}
                        >
                          <Text
                            style={[styles.pickerOptionText, r.nombre === region && styles.pickerOptionTextActive]}
                            numberOfLines={1}
                          >
                            {r.nombre} ({r.codigo})
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                )}

                <FieldLabel>Comuna</FieldLabel>
                <Pressable
                  onPress={() => { if (!region) return; setComunaOpen(!comunaOpen); setRegionOpen(false); }}
                  style={[styles.pickerRow, !region && { opacity: 0.5 }]}
                >
                  <Text style={styles.pickerText}>
                    {comuna || (region ? 'Selecciona una comuna' : 'Primero elige una región')}
                  </Text>
                  <ChevronDown color={C.textMuted} size={17} />
                </Pressable>
                {comunaOpen && region && (
                  <View style={styles.pickerList}>
                    <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
                      {comunasOfRegion.map((c) => (
                        <Pressable
                          key={c}
                          onPress={() => { setComuna(c); setComunaOpen(false); }}
                          style={[styles.pickerOption, c === comuna && styles.pickerOptionActive]}
                        >
                          <Text style={[styles.pickerOptionText, c === comuna && styles.pickerOptionTextActive]}>
                            {c}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </Card>

              {/* Galería */}
              <View style={styles.rowBetween}>
                <SectionLabel>Galería de fotos</SectionLabel>
                <Text style={styles.galleryCount}>{galleryPhotos.length} de {MAX_PHOTOS}</Text>
              </View>
              <Card>
                <View style={editGalleryStyles.grid}>
                  {galleryPhotos.map((photo) => (
                    <View key={photo.id} style={editGalleryStyles.thumbWrap}>
                      <Image source={{ uri: photo.photo_url }} style={editGalleryStyles.thumb} resizeMode="cover" />
                      <Pressable
                        onPress={() => handleDeleteGalleryPhoto(photo)}
                        style={editGalleryStyles.deleteBtn}
                        hitSlop={4}
                        accessibilityRole="button"
                        accessibilityLabel="Eliminar esta foto"
                      >
                        <XIcon color="#D2D8D3" size={12} strokeWidth={2.6} />
                      </Pressable>
                    </View>
                  ))}
                  {galleryPhotos.length < MAX_PHOTOS && (
                    <Pressable
                      onPress={handleAddGalleryPhoto}
                      disabled={uploadingGallery}
                      accessibilityRole="button"
                      accessibilityLabel="Añadir foto a la galería"
                      style={({ pressed }) => [
                        editGalleryStyles.addTile,
                        pressed && { opacity: 0.75 },
                        uploadingGallery && { opacity: 0.5 },
                      ]}
                    >
                      {uploadingGallery ? (
                        <ActivityIndicator color={C.green} size="small" />
                      ) : (
                        <>
                          <Plus color={C.green} size={20} strokeWidth={2} />
                          <Text style={editGalleryStyles.addLabel}>Añadir foto</Text>
                        </>
                      )}
                    </Pressable>
                  )}
                </View>
                {galleryPhotos.length === 0 && (
                  <View style={editGalleryStyles.emptyRow}>
                    <Images color={C.textMuted} size={14} />
                    <Text style={editGalleryStyles.emptyText}>Aún no subes fotos a tu galería</Text>
                  </View>
                )}
              </Card>

              <View style={styles.footerSpace} />
            </>
          )}
        </ScrollView>

        {loadStatus === 'ready' && (
          <View style={styles.footer}>
            <Button
              label={saving ? 'Guardando…' : 'Guardar cambios'}
              onPress={handleSave}
              loading={saving}
              disabled={saving}
            />
          </View>
        )}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  headerTitle: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 19, letterSpacing: -0.3 },
  headerSubtitle: { fontFamily: F.medium, color: C.textSecondary, fontSize: 12, marginTop: 2 },

  scroll: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8, gap: 11 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 24, gap: 12 },
  errorTitle: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 16, textAlign: 'center' },
  errorMsg: { fontFamily: F.medium, color: C.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  retryBtn: {
    marginTop: 4, height: 44, paddingHorizontal: 24, borderRadius: R.pill,
    backgroundColor: C.green, alignItems: 'center', justifyContent: 'center',
  },
  retryLabel: { fontFamily: F.extraBold, color: C.textOnGreen, fontSize: 14 },

  identityCard: {
    borderRadius: R.card, overflow: 'hidden', borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  bannerTap: { height: 104, alignItems: 'center', justifyContent: 'center' },
  bannerImg: { ...StyleSheet.absoluteFillObject },
  bannerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 34, paddingHorizontal: 13,
    borderRadius: R.pill, backgroundColor: 'rgba(8,10,8,0.8)', borderWidth: 1, borderColor: '#3A4139',
  },
  bannerChipText: { fontFamily: F.bold, color: '#D2D8D3', fontSize: 12 },

  avatarWrap: { paddingHorizontal: 16, paddingBottom: 18, marginTop: -34, alignItems: 'center' },
  avatarBig: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: C.surfaceAlt,
    borderWidth: 3, borderColor: C.green, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', position: 'relative',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitial: { fontFamily: F.extraBold, color: C.textSecondary, fontSize: 26 },
  avatarEditBtn: {
    position: 'absolute', bottom: -2, right: -2, width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.green, borderWidth: 3, borderColor: C.surface, alignItems: 'center', justifyContent: 'center',
  },
  avatarHint: { fontFamily: F.medium, color: C.textMuted, fontSize: 11.5, marginTop: 10, textAlign: 'center' },

  fieldLabel: { fontFamily: F.bold, color: C.textSecondary, fontSize: 12, marginTop: 14 },
  input: {
    height: 48, marginTop: 9, paddingHorizontal: 14, borderRadius: R.iconBtn,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
    color: C.textPrimary, fontFamily: F.bold, fontSize: 14.5,
  },
  fieldHint: { fontFamily: F.medium, color: C.textMuted, fontSize: 11, lineHeight: 15, marginTop: 8 },
  row2: { flexDirection: 'row', gap: 11, marginTop: 16 },

  pillRow: { flexDirection: 'row', gap: 6, marginTop: 9 },
  wrapPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 11 },
  pill: {
    height: 36, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  pillActive: { backgroundColor: C.shieldBg, borderColor: C.green },
  pillIdle: { backgroundColor: C.surfaceAlt, borderColor: C.border },
  pillDisabled: { opacity: 0.4 },
  pillText: { fontFamily: F.extraBold, color: C.textSecondary, fontSize: 12.5 },
  pillTextActive: { color: C.green },

  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  blockTitle: { fontFamily: F.bold, color: C.textPrimary, fontSize: 13.5 },
  countBadge: {
    height: 24, paddingHorizontal: 9, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
  },
  countBadgeFull: { backgroundColor: C.shieldBg, borderColor: C.greenDeepBorder },
  countBadgeText: { fontFamily: F.extraBold, color: C.textSecondary, fontSize: 11 },
  countBadgeTextFull: { color: C.green },

  divider: { height: 1, backgroundColor: C.dividerInner, marginVertical: 17 },

  nivelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%',
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: R.iconBtn,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
  },
  nivelRowActive: { backgroundColor: C.selectedBg, borderColor: C.green },
  nivelDot: {
    width: 18, height: 18, borderRadius: 999, flexShrink: 0,
    borderWidth: 2, borderColor: '#3A4139', backgroundColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  nivelDotActive: { borderColor: C.green, backgroundColor: C.green },
  // Punto interior más oscuro: imita el box-shadow inset del handoff (un
  // aro verde con el centro del color de la tarjeta seleccionada).
  nivelDotInner: { width: 8, height: 8, borderRadius: 999, backgroundColor: C.selectedBg },
  nivelLabel: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 13.5 },
  nivelSub: { fontFamily: F.medium, color: C.textSecondary, fontSize: 11.5, marginTop: 2 },

  textarea: {
    height: 104, padding: 13, borderRadius: R.row, backgroundColor: C.surfaceAlt,
    borderWidth: 1, borderColor: C.border, color: C.textPrimary, fontFamily: F.medium, fontSize: 13.5, lineHeight: 20,
  },
  charCount: { fontFamily: F.semiBold, color: C.textMuted, fontSize: 11, textAlign: 'right', marginTop: 7 },

  locationHint: { fontFamily: F.medium, color: C.textSecondary, fontSize: 11.5, lineHeight: 17 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, marginTop: 9,
    paddingHorizontal: 14, borderRadius: R.iconBtn, backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
  },
  pickerText: { flex: 1, fontFamily: F.bold, color: C.textPrimary, fontSize: 14 },
  pickerList: {
    marginTop: 6, backgroundColor: C.bg, borderRadius: R.iconBtn, borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  pickerOption: { paddingVertical: 10, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: C.dividerInner },
  pickerOptionActive: { backgroundColor: C.selectedBg },
  pickerOptionText: { fontFamily: F.medium, color: C.textPrimary, fontSize: 13 },
  pickerOptionTextActive: { fontFamily: F.bold, color: C.green },

  galleryCount: { fontFamily: F.semiBold, color: C.textMuted, fontSize: 11.5 },

  footerSpace: { height: 4 },
  footer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, backgroundColor: C.bg },
});

// Constantes y estilos para la galería de edición
const EDIT_SCREEN_W = Dimensions.get('window').width;
// scroll paddingHorizontal: 16 → card padding: 16 → útil = screenW - 32 - 32
// 2 columnas con gap de 10, más la tarjeta "Añadir foto"
const EDIT_THUMB = Math.floor((EDIT_SCREEN_W - 32 - 32 - 10) / 2);

const editGalleryStyles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumbWrap: {
    width: EDIT_THUMB, height: EDIT_THUMB, borderRadius: 16, overflow: 'hidden',
    backgroundColor: C.surfaceAlt, position: 'relative', borderWidth: 1, borderColor: C.border,
  },
  thumb: { width: '100%', height: '100%' },
  deleteBtn: {
    position: 'absolute', top: 7, right: 7, width: 24, height: 24, borderRadius: 999,
    backgroundColor: 'rgba(8,10,8,0.85)', borderWidth: 1, borderColor: '#3A4139',
    alignItems: 'center', justifyContent: 'center',
  },
  addTile: {
    width: EDIT_THUMB, height: EDIT_THUMB, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed',
    borderColor: '#3A4139', alignItems: 'center', justifyContent: 'center', gap: 7,
  },
  addLabel: { fontFamily: F.bold, color: C.green, fontSize: 12 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  emptyText: { fontFamily: F.medium, color: C.textMuted, fontSize: 12 },
});
