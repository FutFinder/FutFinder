import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, ChevronDown, Shield, Camera } from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import Banner from '../components/Banner';
import Button from '../components/Button';
import { updateClub } from '../services/clubs';
import { pickImage, uploadClubLogo, uploadClubBanner } from '../services/storage';
import { NOMBRES_REGIONES, getComunasOfRegion } from '../data/regiones-chile';

/**
 * Editar los datos del club (modal sobre las tabs, como CreateClub).
 * Solo accesible para admins: el botón de entrada vive en ClubDetail
 * y la RLS de la BD lo garantiza de todos modos.
 */
export default function EditClubScreen({ navigation, route }) {
  const { club } = route.params || {};

  const [nombre, setNombre] = useState(club?.nombre || '');
  const [descripcion, setDescripcion] = useState(club?.descripcion || '');
  const [region, setRegion] = useState(club?.region || null);
  const [comuna, setComuna] = useState(club?.comuna || null);
  const [showRegiones, setShowRegiones] = useState(false);
  const [showComunas, setShowComunas] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);
  const [newLogoAsset, setNewLogoAsset] = useState(null);
  const [newBannerAsset, setNewBannerAsset] = useState(null);

  const comunas = region ? getComunasOfRegion(region) : [];

  const handlePickLogo = async () => {
    const result = await pickImage({ aspect: [1, 1], quality: 0.8 });
    if (result.ok) {
      setNewLogoAsset(result.asset);
    } else if (result.reason !== 'Cancelado') {
      setBanner({ type: 'error', title: 'No se pudo abrir la galería', message: result.reason });
    }
  };

  const handlePickBanner = async () => {
    const result = await pickImage({ aspect: [16, 9], quality: 0.8 });
    if (result.ok) {
      setNewBannerAsset(result.asset);
    } else if (result.reason !== 'Cancelado') {
      setBanner({ type: 'error', title: 'No se pudo abrir la galería', message: result.reason });
    }
  };

  const handleSave = async () => {
    if (nombre.trim().length < 3) {
      setBanner({
        type: 'error',
        title: 'Nombre muy corto',
        message: 'El nombre del club debe tener al menos 3 caracteres.',
      });
      return;
    }
    setSaving(true);

    if (newLogoAsset) {
      const { error: logoErr } = await uploadClubLogo(club.id, newLogoAsset);
      if (logoErr) {
        setSaving(false);
        setBanner({ type: 'error', title: 'No se pudo subir el logo', message: logoErr.message });
        return;
      }
    }

    if (newBannerAsset) {
      const { error: bannerErr } = await uploadClubBanner(club.id, newBannerAsset);
      if (bannerErr) {
        setSaving(false);
        setBanner({ type: 'error', title: 'No se pudo subir el banner', message: bannerErr.message });
        return;
      }
    }

    const { error } = await updateClub(club.id, { nombre, descripcion, region, comuna });
    setSaving(false);

    if (error) {
      setBanner({ type: 'error', title: 'No se pudo guardar', message: error.message });
      return;
    }
    // Volvemos al detalle: el useFocusEffect recarga con los datos nuevos
    navigation.goBack();
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Editar club</Text>
          <Text style={styles.headerSubtitle}>Solo administradores</Text>
        </View>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
        >
          <X color={colors.textPrimary} size={20} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

          <Pressable
            onPress={handlePickBanner}
            style={({ pressed }) => [styles.bannerTap, pressed && { opacity: 0.85 }]}
          >
            {newBannerAsset ? (
              <Image source={{ uri: newBannerAsset.uri }} style={styles.bannerImg} resizeMode="cover" />
            ) : club?.banner_url ? (
              <Image source={{ uri: club.banner_url }} style={styles.bannerImg} resizeMode="cover" />
            ) : (
              <View style={styles.bannerPlaceholder}>
                <Camera color={colors.textMuted} size={20} />
                <Text style={styles.bannerHint}>Subir banner (opcional)</Text>
              </View>
            )}
            {(newBannerAsset || club?.banner_url) && (
              <View style={styles.bannerEditChip}>
                <Camera color={colors.textPrimary} size={13} />
                <Text style={styles.bannerEditChipText}>Cambiar banner</Text>
              </View>
            )}
          </Pressable>

          <Pressable
            onPress={handlePickLogo}
            style={({ pressed }) => [styles.logoTap, pressed && { opacity: 0.8 }]}
          >
            {newLogoAsset ? (
              <Image source={{ uri: newLogoAsset.uri }} style={styles.logoImg} />
            ) : club?.foto_url ? (
              <Image source={{ uri: club.foto_url }} style={styles.logoImg} />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Shield color={colors.primary} size={40} strokeWidth={1.5} />
              </View>
            )}
            <View style={styles.logoHintRow}>
              <Camera color={colors.textMuted} size={14} />
              <Text style={styles.logoHint}>
                {newLogoAsset || club?.foto_url ? 'Cambiar logo' : 'Subir logo (opcional)'}
              </Text>
            </View>
          </Pressable>

          <Text style={styles.label}>Nombre del club</Text>
          <TextInput
            style={styles.input}
            placeholder="Ej: Atlético La Reina"
            placeholderTextColor={colors.textMuted}
            value={nombre}
            onChangeText={setNombre}
            maxLength={40}
          />

          <Text style={styles.label}>Descripción (opcional)</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            placeholder="Cuenta de qué se trata tu club, dónde juegan, qué buscan..."
            placeholderTextColor={colors.textMuted}
            value={descripcion}
            onChangeText={setDescripcion}
            multiline
            maxLength={500}
          />

          <Text style={styles.label}>Región (opcional)</Text>
          <Pressable
            onPress={() => {
              setShowRegiones((v) => !v);
              setShowComunas(false);
            }}
            style={({ pressed }) => [styles.select, pressed && { opacity: 0.85 }]}
          >
            <Text style={region ? styles.selectValue : styles.selectPlaceholder}>
              {region || 'Selecciona una región'}
            </Text>
            <ChevronDown color={colors.textMuted} size={18} />
          </Pressable>
          {showRegiones && (
            <View style={styles.optionsBox}>
              {NOMBRES_REGIONES.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => {
                    setRegion(r);
                    setComuna(null);
                    setShowRegiones(false);
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    r === region && styles.optionActive,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      r === region && styles.optionTextActive,
                    ]}
                  >
                    {r}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {region && (
            <>
              <Text style={styles.label}>Comuna (opcional)</Text>
              <Pressable
                onPress={() => {
                  setShowComunas((v) => !v);
                  setShowRegiones(false);
                }}
                style={({ pressed }) => [styles.select, pressed && { opacity: 0.85 }]}
              >
                <Text style={comuna ? styles.selectValue : styles.selectPlaceholder}>
                  {comuna || 'Selecciona una comuna'}
                </Text>
                <ChevronDown color={colors.textMuted} size={18} />
              </Pressable>
              {showComunas && (
                <View style={styles.optionsBox}>
                  {comunas.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => {
                        setComuna(c);
                        setShowComunas(false);
                      }}
                      style={({ pressed }) => [
                        styles.option,
                        c === comuna && styles.optionActive,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          c === comuna && styles.optionTextActive,
                        ]}
                      >
                        {c}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}

          <Button
            label="Guardar cambios"
            onPress={handleSave}
            loading={saving}
            disabled={nombre.trim().length < 3}
            style={styles.submitBtn}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerCenter: { flex: 1 },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: 16, paddingBottom: 40 },
  bannerTap: {
    width: '100%',
    height: 130,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: 16,
  },
  bannerImg: {
    width: '100%',
    height: '100%',
  },
  bannerPlaceholder: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
  },
  bannerHint: { color: colors.textMuted, fontSize: 13 },
  bannerEditChip: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  bannerEditChipText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  logoTap: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  logoImg: {
    width: 80,
    height: 80,
    borderRadius: radius.lg,
    marginBottom: 8,
  },
  logoHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  logoHint: {
    color: colors.textMuted,
    fontSize: 12,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 4,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    color: colors.textPrimary,
    fontSize: 15,
    paddingHorizontal: 14,
    height: 52,
    marginBottom: 16,
  },
  inputMultiline: {
    height: 110,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingHorizontal: 14,
    height: 52,
    marginBottom: 16,
  },
  selectValue: { color: colors.textPrimary, fontSize: 15 },
  selectPlaceholder: { color: colors.textMuted, fontSize: 15 },
  optionsBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginTop: -10,
    marginBottom: 16,
  },
  option: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  optionActive: { backgroundColor: colors.primarySoft },
  optionText: { color: colors.textPrimary, fontSize: 14 },
  optionTextActive: { color: colors.primary, fontWeight: '700' },
  submitBtn: { marginTop: 8 },
});
