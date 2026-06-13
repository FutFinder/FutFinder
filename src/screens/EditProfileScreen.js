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
  User as UserIcon,
  Camera,
  Save,
  Plus,
  X as XIcon,
  Images,
} from 'lucide-react-native';

import Logo from '../components/Logo';
import Button from '../components/Button';
import Banner from '../components/Banner';
import { colors, radius } from '../theme/colors';
import { getMyProfile, updateMyProfile } from '../services/profile';
import { pickImage, uploadAvatar } from '../services/storage';
import {
  getProfilePhotos,
  uploadGalleryPhoto,
  deleteProfilePhoto,
  MAX_PHOTOS,
} from '../services/gallery';
import { isSupabaseConfigured } from '../services/supabase';
import { REGIONES, getComunasOfRegion } from '../data/regiones-chile';

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
  { value: 'derecho', label: 'Derecho' },
  { value: 'izquierdo', label: 'Izquierdo' },
  { value: 'ambos', label: 'Ambos' },
];

export default function EditProfileScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
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
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [regionOpen, setRegionOpen] = useState(false);
  const [comunaOpen, setComunaOpen] = useState(false);

  // Galería
  const [userId, setUserId] = useState(null);
  const [galleryPhotos, setGalleryPhotos] = useState([]);
  const [uploadingGallery, setUploadingGallery] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await getMyProfile();
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

        // Cargar galería
        const { data: photos } = await getProfilePhotos(p.id);
        setGalleryPhotos(photos || []);
      }
      setLoading(false);
    })();
  }, []);

  // ---- Subida de foto de perfil ----
  const handlePickAvatar = async () => {
    if (uploadingPhoto) return;
    const { ok, asset, reason } = await pickImage({ aspect: [1, 1], quality: 0.7 });
    if (!ok) {
      if (reason && reason !== 'Cancelado') {
        setBanner({ type: 'error', title: 'No pude abrir tus fotos', message: reason });
      }
      return;
    }
    setUploadingPhoto(true);
    const { url, error } = await uploadAvatar(asset);
    setUploadingPhoto(false);
    if (error) {
      setBanner({ type: 'error', title: 'No pude subir la foto', message: error.message || '' });
      return;
    }
    setFotoUrl(url);
    setBanner({ type: 'success', title: 'Foto actualizada', message: 'Tu nueva foto de perfil ya está guardada.' });
    setTimeout(() => setBanner(null), 3000);
  };

  // ---- Galería ----
  const handleAddGalleryPhoto = async () => {
    if (uploadingGallery || !userId) return;
    if (galleryPhotos.length >= MAX_PHOTOS) {
      setBanner({ type: 'info', title: 'Límite alcanzado', message: `Máximo ${MAX_PHOTOS} fotos por perfil.` });
      return;
    }
    const { ok, asset, reason } = await pickImage({ aspect: [1, 1], quality: 0.8 });
    if (!ok) {
      if (reason && reason !== 'Cancelado') {
        setBanner({ type: 'error', title: 'No pude abrir tus fotos', message: reason });
      }
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
    const { error } = await updateMyProfile({
      username: username.trim(),
      edad: edad ? parseInt(edad, 10) : null,
      bio: bio.trim() || null,
      posicion_preferida: posiciones,
      flanco,
      region: region || null,
      comuna: comuna || null,
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
      setBanner({ type: 'error', title: 'No pudimos guardar', message: userMsg });
      return;
    }

    setBanner({
      type: 'success',
      title: '¡Perfil actualizado!',
      message: 'Tus cambios quedaron guardados.',
    });
    setTimeout(() => navigation.goBack(), 800);
  };

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
          {/* Header */}
          <View style={styles.header}>
            <Pressable
              onPress={() => navigation.goBack()}
              hitSlop={12}
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            >
              <ArrowLeft color={colors.textPrimary} size={20} />
            </Pressable>
            <Logo size={26} />
            <View style={{ width: 40 }} />
          </View>

          {banner && (
            <Banner
              type={banner.type}
              title={banner.title}
              message={banner.message}
              onClose={() => setBanner(null)}
            />
          )}

          <Text style={styles.title}>Editar perfil</Text>
          <Text style={styles.subtitle}>
            Mantén tu información al día — otros jugadores la ven al inscribirse
            contigo.
          </Text>

          {/* Card 1: Identidad */}
          <View style={styles.card}>
            <Pressable
              onPress={handlePickAvatar}
              disabled={uploadingPhoto}
              style={({ pressed }) => [
                styles.avatarBig,
                pressed && { opacity: 0.85 },
              ]}
            >
              {fotoUrl ? (
                <Image source={{ uri: fotoUrl }} style={styles.avatarImage} />
              ) : (
                <UserIcon color={colors.primary} size={42} strokeWidth={1.5} />
              )}
              <View style={styles.avatarEditBtn}>
                {uploadingPhoto ? (
                  <ActivityIndicator color="#0E0E0D" size="small" />
                ) : (
                  <Camera color="#0E0E0D" size={14} strokeWidth={2.2} />
                )}
              </View>
            </Pressable>
            <Text style={styles.avatarHint}>
              {uploadingPhoto ? 'Subiendo foto…' : 'Toca el avatar para cambiar tu foto'}
            </Text>

            <Label>@username</Label>
            <TextInput
              style={styles.input}
              placeholder="ej: CarlosMendez_10"
              placeholderTextColor={colors.textMuted}
              value={username}
              onChangeText={(v) => setUsername(v.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20))}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
            />
            <Text style={styles.fieldHint}>
              Letras (mayús/minús), números y guión bajo. No es sensible a
              mayúsculas para detectar duplicados.
            </Text>

            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Label>Edad</Label>
                <TextInput
                  style={styles.input}
                  placeholder="24"
                  placeholderTextColor={colors.textMuted}
                  value={edad}
                  onChangeText={(v) => setEdad(v.replace(/\D/g, '').slice(0, 2))}
                  keyboardType="number-pad"
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 2 }}>
                <Label>Flanco preferido</Label>
                <Segmented
                  options={FLANCOS}
                  value={flanco}
                  onChange={setFlanco}
                />
              </View>
            </View>

            <Label>Posiciones preferidas (puedes elegir varias)</Label>
            <View style={styles.posGrid}>
              {POSICIONES.map((p) => {
                const selected = posiciones.includes(p.value);
                return (
                  <Pressable
                    key={p.value}
                    onPress={() => togglePosicion(p.value)}
                    style={[styles.posChip, selected && styles.posChipActive]}
                  >
                    <Text
                      style={[
                        styles.posChipLabel,
                        selected && styles.posChipLabelActive,
                      ]}
                    >
                      {selected ? '✓ ' : ''}{p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.fieldHint}>
              Seleccionadas: {posiciones.length} · máx. 4
            </Text>

            <Label>Descripción (bio)</Label>
            <TextInput
              style={[styles.input, styles.textarea]}
              placeholder="Cuenta tu trayectoria, en qué ligas jugaste, qué buscas en un partido…"
              placeholderTextColor={colors.textMuted}
              value={bio}
              onChangeText={setBio}
              multiline
              numberOfLines={4}
              maxLength={400}
              textAlignVertical="top"
            />
            <Text style={styles.charCount}>{bio.length}/400</Text>
          </View>

          {/* Card 2: Ubicación */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Ubicación habitual</Text>
            <Text style={styles.sectionSub}>
              Te ayuda a encontrar partidos cerca de donde sueles jugar.
            </Text>

            <Label>Región</Label>
            <Pressable
              onPress={() => {
                setRegionOpen(!regionOpen);
                setComunaOpen(false);
              }}
              style={styles.input}
            >
              <Text style={styles.pickerText} numberOfLines={1}>
                {region || 'Selecciona una región'}
              </Text>
            </Pressable>
            {regionOpen && (
              <View style={styles.picker}>
                <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
                  {REGIONES.map((r) => (
                    <Pressable
                      key={r.nombre}
                      onPress={() => {
                        setRegion(r.nombre);
                        if (!r.comunas.includes(comuna)) setComuna('');
                        setRegionOpen(false);
                      }}
                      style={[
                        styles.pickerOption,
                        r.nombre === region && styles.pickerOptionActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.pickerOptionText,
                          r.nombre === region && styles.pickerOptionTextActive,
                        ]}
                        numberOfLines={1}
                      >
                        {r.nombre} ({r.codigo})
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            <Label>Comuna</Label>
            <Pressable
              onPress={() => {
                if (!region) return;
                setComunaOpen(!comunaOpen);
                setRegionOpen(false);
              }}
              style={[styles.input, !region && { opacity: 0.5 }]}
            >
              <Text style={styles.pickerText}>
                {comuna || (region ? 'Selecciona una comuna' : 'Primero elige una región')}
              </Text>
            </Pressable>
            {comunaOpen && region && (
              <View style={styles.picker}>
                <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
                  {comunasOfRegion.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => {
                        setComuna(c);
                        setComunaOpen(false);
                      }}
                      style={[
                        styles.pickerOption,
                        c === comuna && styles.pickerOptionActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.pickerOptionText,
                          c === comuna && styles.pickerOptionTextActive,
                        ]}
                      >
                        {c}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          {/* Card 3: Galería de fotos */}
          <View style={styles.card}>
            <View style={editGalleryStyles.header}>
              <Images color={colors.primary} size={16} />
              <Text style={styles.sectionTitle}>Galería de fotos</Text>
            </View>
            <Text style={styles.sectionSub}>
              Hasta {MAX_PHOTOS} fotos · {galleryPhotos.length}/{MAX_PHOTOS} usadas
            </Text>

            {/* Grid de fotos existentes */}
            {galleryPhotos.length > 0 && (
              <View style={editGalleryStyles.grid}>
                {galleryPhotos.map((photo) => (
                  <View key={photo.id} style={editGalleryStyles.thumbWrap}>
                    <Image
                      source={{ uri: photo.photo_url }}
                      style={editGalleryStyles.thumb}
                      resizeMode="cover"
                    />
                    <Pressable
                      onPress={() => handleDeleteGalleryPhoto(photo)}
                      style={editGalleryStyles.deleteBtn}
                      hitSlop={4}
                    >
                      <XIcon color="#fff" size={12} strokeWidth={2.8} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {/* Botón añadir */}
            {galleryPhotos.length < MAX_PHOTOS ? (
              <Pressable
                onPress={handleAddGalleryPhoto}
                disabled={uploadingGallery}
                style={({ pressed }) => [
                  editGalleryStyles.addBtn,
                  pressed && { opacity: 0.7 },
                  uploadingGallery && { opacity: 0.5 },
                ]}
              >
                {uploadingGallery ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <Plus color={colors.primary} size={18} />
                )}
                <Text style={editGalleryStyles.addLabel}>
                  {uploadingGallery ? 'Subiendo…' : 'Añadir foto'}
                </Text>
              </Pressable>
            ) : (
              <Text style={editGalleryStyles.limitMsg}>
                Límite de {MAX_PHOTOS} fotos alcanzado
              </Text>
            )}
          </View>

          {/* Save */}
          <Button
            label={saving ? 'Guardando…' : 'Guardar cambios'}
            variant="primary"
            onPress={handleSave}
            loading={saving}
            disabled={saving || loading}
          />

          <View style={{ height: 32 }} />
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function Label({ children }) {
  return <Text style={styles.label}>{children}</Text>;
}

function Segmented({ options, value, onChange }) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          style={[
            styles.segmentBtn,
            value === o.value && styles.segmentBtnActive,
          ]}
        >
          <Text
            style={[
              styles.segmentLabel,
              value === o.value && styles.segmentLabelActive,
            ]}
          >
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 20, paddingBottom: 32, flexGrow: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginBottom: 14,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  sectionSub: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: 14,
  },

  avatarBig: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.primarySoft,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarEditBtn: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.surfaceAlt,
  },
  avatarHint: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 18,
  },

  label: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 6,
    marginTop: 6,
  },
  input: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    color: colors.textPrimary,
    fontSize: 14,
    justifyContent: 'center',
  },
  textarea: {
    height: 110,
    paddingTop: 12,
    paddingBottom: 12,
  },
  charCount: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'right',
    marginTop: 4,
  },
  fieldHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
    lineHeight: 15,
  },
  row2: { flexDirection: 'row' },

  posGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  posChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  posChipActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  posChipLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  posChipLabelActive: {
    color: colors.primary,
    fontWeight: '800',
  },

  segmented: {
    flexDirection: 'row',
    gap: 6,
    height: 48,
  },
  segmentBtn: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  segmentLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  segmentLabelActive: {
    color: colors.primary,
    fontWeight: '800',
  },

  pickerText: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  picker: {
    marginTop: 6,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  pickerOption: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  pickerOptionActive: {
    backgroundColor: colors.primarySoft,
  },
  pickerOptionText: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  pickerOptionTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
});

// Constantes y estilos para la galería de edición
const EDIT_SCREEN_W = Dimensions.get('window').width;
// scroll paddingHorizontal: 20 → card padding: 18 → útil = screenW - 40 - 36
// 3 columnas con gap de 6
const EDIT_THUMB = Math.floor((EDIT_SCREEN_W - 40 - 36 - 6 * 2) / 3);

const editGalleryStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
    marginTop: 8,
  },
  thumbWrap: {
    width: EDIT_THUMB,
    height: EDIT_THUMB,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.background,
    position: 'relative',
  },
  thumb: { width: '100%', height: '100%' },
  deleteBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    backgroundColor: colors.primarySoft,
  },
  addLabel: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  limitMsg: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 8,
  },
});
