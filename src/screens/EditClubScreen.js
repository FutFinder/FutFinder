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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, ChevronDown } from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import Banner from '../components/Banner';
import Button from '../components/Button';
import { updateClub } from '../services/clubs';
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

  const comunas = region ? getComunasOfRegion(region) : [];

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
    const { error } = await updateClub(club.id, {
      nombre,
      descripcion,
      region,
      comuna,
    });
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
