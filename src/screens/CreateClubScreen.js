import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Shield, ChevronDown, Camera } from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  medidas as S,
  fuentes as F,
} from '../theme/colors';
import Banner from '../components/Banner';
import { Button, IconButton, Chip } from '../components/reservas/ui';
import { FieldLabel, TextField } from '../components/reservas/recintoUi';
import { createClub } from '../services/clubs';
import { pickImage, uploadClubLogo } from '../services/storage';
import { NOMBRES_REGIONES, getComunasOfRegion } from '../data/regiones-chile';
import { OPCIONES_MODALIDAD } from '../utils/clubMeta';

/**
 * Crear un club nuevo (modal sobre las tabs, como CreateMatch).
 * El creador queda automáticamente como administrador.
 */
export default function CreateClubScreen({ navigation }) {
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [region, setRegion] = useState(null);
  const [comuna, setComuna] = useState(null);
  const [modalidad, setModalidad] = useState(null);
  const [showRegiones, setShowRegiones] = useState(false);
  const [showComunas, setShowComunas] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);
  const [logoAsset, setLogoAsset] = useState(null);

  const comunas = region ? getComunasOfRegion(region) : [];

  const handlePickLogo = async () => {
    const result = await pickImage({ aspect: [1, 1], quality: 0.8 });
    if (result.ok) {
      setLogoAsset(result.asset);
    } else if (result.reason !== 'Cancelado') {
      setBanner({ type: 'error', title: 'No se pudo abrir la galería', message: result.reason });
    }
  };

  const handleCreate = async () => {
    if (nombre.trim().length < 3) {
      setBanner({
        type: 'error',
        title: 'Nombre muy corto',
        message: 'El nombre del club debe tener al menos 3 caracteres.',
      });
      return;
    }
    setSaving(true);
    const { data, error } = await createClub({ nombre, descripcion, region, comuna, modalidad });

    if (error) {
      setSaving(false);
      setBanner({ type: 'error', title: 'No se pudo crear el club', message: error.message });
      return;
    }

    if (logoAsset && data?.id) {
      const { error: logoErr } = await uploadClubLogo(data.id, logoAsset);
      if (logoErr) {
        setBanner({ type: 'error', title: 'Club creado, pero falló el logo', message: logoErr.message });
        setSaving(false);
        navigation.goBack();
        return;
      }
    }

    setSaving(false);
    // Volvemos al tab Clubes: el useFocusEffect recarga y muestra el club nuevo
    navigation.goBack();
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Crear club</Text>
          <Text style={styles.headerSubtitle}>Quedarás como administrador</Text>
        </View>
        <IconButton icon={X} onPress={() => navigation.goBack()} accessibilityLabel="Cerrar" />
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
            onPress={handlePickLogo}
            accessibilityRole="button"
            accessibilityLabel={logoAsset ? 'Cambiar el logo del club' : 'Subir el logo del club'}
            style={({ pressed }) => [styles.logoTap, pressed && { opacity: 0.8 }]}
          >
            {logoAsset ? (
              <Image source={{ uri: logoAsset.uri }} style={styles.logoImg} />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Shield color={C.green} size={40} strokeWidth={1.5} />
              </View>
            )}
            <View style={styles.logoHintRow}>
              <Camera color={C.textSecondary} size={14} strokeWidth={2} />
              <Text style={styles.logoHint}>
                {logoAsset ? 'Cambiar logo' : 'Subir logo (opcional)'}
              </Text>
            </View>
          </Pressable>

          <View style={styles.grupo}>
            <FieldLabel>Nombre del club</FieldLabel>
            <TextField
              placeholder="Ej: Atlético La Reina"
              value={nombre}
              onChangeText={setNombre}
              maxLength={40}
            />
          </View>

          <View style={styles.grupo}>
            <FieldLabel marca="opcional">Descripción</FieldLabel>
            <TextField
              placeholder="Cuenta de qué se trata tu club, dónde juegan, qué buscan..."
              value={descripcion}
              onChangeText={setDescripcion}
              multiline
              maxLength={500}
            />
          </View>

          <View style={styles.grupo}>
            <FieldLabel marca="opcional">Modalidad</FieldLabel>
            <View style={styles.modalidadRow}>
              {OPCIONES_MODALIDAD.map((op) => {
                const activa = modalidad === op.value;
                return (
                  <Chip
                    key={op.value}
                    label={op.label}
                    active={activa}
                    // Volver a tocar la opción activa la deselecciona.
                    onPress={() => setModalidad(activa ? null : op.value)}
                    style={styles.modalidadChip}
                  />
                );
              })}
            </View>
          </View>

          <View style={styles.grupo}>
            <FieldLabel marca="opcional">Región</FieldLabel>
            <Pressable
              onPress={() => {
                setShowRegiones((v) => !v);
                setShowComunas(false);
              }}
              accessibilityRole="button"
              accessibilityLabel="Elegir región"
              style={({ pressed }) => [styles.select, pressed && { opacity: 0.85 }]}
            >
              <Text style={region ? styles.selectValue : styles.selectPlaceholder}>
                {region || 'Selecciona una región'}
              </Text>
              <ChevronDown color={C.textSecondary} size={18} strokeWidth={2} />
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
                    accessibilityRole="button"
                    accessibilityState={{ selected: r === region }}
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
          </View>

          {region && (
            <View style={styles.grupo}>
              <FieldLabel marca="opcional">Comuna</FieldLabel>
              <Pressable
                onPress={() => {
                  setShowComunas((v) => !v);
                  setShowRegiones(false);
                }}
                accessibilityRole="button"
                accessibilityLabel="Elegir comuna"
                style={({ pressed }) => [styles.select, pressed && { opacity: 0.85 }]}
              >
                <Text style={comuna ? styles.selectValue : styles.selectPlaceholder}>
                  {comuna || 'Selecciona una comuna'}
                </Text>
                <ChevronDown color={C.textSecondary} size={18} strokeWidth={2} />
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
                      accessibilityRole="button"
                      accessibilityState={{ selected: c === comuna }}
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
            </View>
          )}

          <Button
            label="Crear club"
            onPress={handleCreate}
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
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: S.screenPadding,
    paddingTop: 6,
    paddingBottom: 12,
  },
  headerCenter: { flex: 1 },
  headerTitle: { fontFamily: F.extraBold, fontSize: 20, color: C.textPrimary, letterSpacing: -0.3 },
  headerSubtitle: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 2 },

  content: { paddingHorizontal: S.screenPadding, paddingBottom: 40 },
  grupo: { marginTop: 16 },

  logoTap: { alignItems: 'center', marginBottom: 4 },
  logoPlaceholder: {
    width: 84,
    height: 84,
    borderRadius: R.cardSm,
    backgroundColor: C.shieldBg,
    borderWidth: 1.5,
    borderColor: C.greenDeepBorder,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 9,
  },
  logoImg: {
    width: 84,
    height: 84,
    borderRadius: R.cardSm,
    marginBottom: 9,
    borderWidth: 1,
    borderColor: C.border,
  },
  logoHintRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  logoHint: { fontFamily: F.semiBold, fontSize: 12, color: C.textSecondary },

  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: R.row,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  selectValue: { fontFamily: F.semiBold, fontSize: 14.5, color: C.textPrimary },
  selectPlaceholder: { fontFamily: F.medium, fontSize: 14.5, color: C.textSecondary },

  optionsBox: {
    marginTop: 8,
    borderRadius: R.row,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceAlt,
    overflow: 'hidden',
  },
  option: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.dividerInner,
  },
  optionActive: { backgroundColor: C.shieldBg },
  optionText: { fontFamily: F.medium, fontSize: 14, color: C.textPrimary },
  optionTextActive: { fontFamily: F.extraBold, color: C.green },

  modalidadRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // El kit dibuja el chip a 33 de alto porque allá son filtros; acá son la
  // única forma de elegir modalidad, así que suben al mínimo táctil.
  modalidadChip: { minHeight: 44, paddingHorizontal: 15 },

  submitBtn: { marginTop: 24 },
});
