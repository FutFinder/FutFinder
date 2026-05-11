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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  User as UserIcon,
  Edit3,
  Save,
} from 'lucide-react-native';

import Logo from '../components/Logo';
import Button from '../components/Button';
import Banner from '../components/Banner';
import { colors, radius } from '../theme/colors';
import { getMyProfile, updateMyProfile } from '../services/profile';
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
  const [posicion, setPosicion] = useState('sin_definir');
  const [flanco, setFlanco] = useState('derecho');
  const [region, setRegion] = useState('');
  const [comuna, setComuna] = useState('');

  const [regionOpen, setRegionOpen] = useState(false);
  const [comunaOpen, setComunaOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await getMyProfile();
      if (p) {
        setUsername(p.username || '');
        setEdad(p.edad ? String(p.edad) : '');
        setBio(p.bio || '');
        setPosicion(p.posicion_preferida || 'sin_definir');
        setFlanco(p.flanco || 'derecho');
        setRegion(p.region || '');
        setComuna(p.comuna || '');
      }
      setLoading(false);
    })();
  }, []);

  const comunasOfRegion = region ? getComunasOfRegion(region) : [];

  const validate = () => {
    if (!username.trim()) return 'El @username no puede estar vacío';
    if (username.length < 3) return '@username debe tener al menos 3 caracteres';
    if (!/^[a-zA-Z0-9_]+$/.test(username))
      return '@username solo puede tener letras, números y guión bajo';
    if (edad) {
      const n = parseInt(edad, 10);
      if (Number.isNaN(n) || n < 12 || n > 99) return 'La edad debe estar entre 12 y 99';
    }
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
      posicion_preferida: posicion,
      flanco,
      region: region || null,
      comuna: comuna || null,
    });
    setSaving(false);

    if (error) {
      const msg = error.message?.includes('duplicate')
        ? 'Ese @username ya está tomado, prueba otro.'
        : error.message || 'No pudimos guardar';
      setBanner({ type: 'error', title: 'No pudimos guardar', message: msg });
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
            <View style={styles.avatarBig}>
              <UserIcon color={colors.primary} size={42} strokeWidth={1.5} />
              <Pressable
                style={styles.avatarEditBtn}
                onPress={() =>
                  setBanner({
                    type: 'info',
                    title: 'Próximamente',
                    message: 'Subir foto desde tu dispositivo se habilita pronto.',
                  })
                }
              >
                <Edit3 color="#0E0E0D" size={12} />
              </Pressable>
            </View>

            <Label>@username</Label>
            <TextInput
              style={styles.input}
              placeholder="ej: carlosmendez_10"
              placeholderTextColor={colors.textMuted}
              value={username}
              onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              autoCapitalize="none"
              autoCorrect={false}
            />

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

            <Label>Posición preferida</Label>
            <View style={styles.posGrid}>
              {POSICIONES.map((p) => (
                <Pressable
                  key={p.value}
                  onPress={() => setPosicion(p.value)}
                  style={[
                    styles.posChip,
                    posicion === p.value && styles.posChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.posChipLabel,
                      posicion === p.value && styles.posChipLabelActive,
                    ]}
                  >
                    {p.label}
                  </Text>
                </Pressable>
              ))}
            </View>

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
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primarySoft,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 18,
    position: 'relative',
  },
  avatarEditBtn: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surfaceAlt,
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
