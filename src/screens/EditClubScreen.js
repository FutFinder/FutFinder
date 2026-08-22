import React, { useCallback, useEffect, useState } from 'react';
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
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, ChevronDown, Shield, Camera, Lock, Check } from 'lucide-react-native';

import { clubColors, clubRadius, clubSizes } from '../theme/colors';
import { temaClub, TEMA_CLUB_POR_DEFECTO } from '../theme/clubThemes';
import Banner from '../components/Banner';
import ClubThemePicker from '../components/club/ClubThemePicker';
import { updateClub, getMisClubesAdmin } from '../services/clubs';
import { pickImage, uploadClubLogo, uploadClubBanner } from '../services/storage';
import { NOMBRES_REGIONES, getComunasOfRegion } from '../data/regiones-chile';
import { OPCIONES_MODALIDAD } from '../utils/clubMeta';
import { getEditClubStatus, NOMBRE_MIN } from '../utils/clubEdit';

/**
 * Editar los datos del club (modal sobre las tabs, como CreateClub).
 *
 * MISMA ESTÉTICA QUE «MI CLUB». Usa los tokens de `clubColors`/`clubRadius`
 * —fondo casi negro, tarjetas #141715, bordes de un blanco muy tenue— en vez
 * de la paleta global antigua: entrar a editar no debería sentirse como
 * cambiar de aplicación.
 *
 * SOLO ADMINISTRADORES, Y SE COMPRUEBA. El botón de entrada vive en
 * ClubDetail y solo lo ven los administradores, pero la pantalla vuelve a
 * preguntar por su cuenta (`getMisClubesAdmin`) para que llegar acá por otro
 * camino no muestre un formulario que el servidor va a rechazar. La garantía
 * de verdad es la policy `clubs_update` (migración 20): sin ella, esconder
 * el formulario no protegería nada.
 *
 * EL TEMA SE PREVISUALIZA, PERO SE APLICA AL GUARDAR. Elegir un color
 * repinta los estados seleccionados y el botón de esta pantalla; el club no
 * cambia hasta que la base de datos confirma. Si el guardado falla, no queda
 * ningún color aplicado «solo acá».
 */
export default function EditClubScreen({ navigation, route }) {
  const { club } = route.params || {};

  const [nombre, setNombre] = useState(club?.nombre || '');
  const [descripcion, setDescripcion] = useState(club?.descripcion || '');
  const [region, setRegion] = useState(club?.region || null);
  const [comuna, setComuna] = useState(club?.comuna || null);
  const [modalidad, setModalidad] = useState(club?.modalidad || null);
  const [tema, setTema] = useState(club?.tema || TEMA_CLUB_POR_DEFECTO);
  const [showRegiones, setShowRegiones] = useState(false);
  const [showComunas, setShowComunas] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);
  const [newLogoAsset, setNewLogoAsset] = useState(null);
  const [newBannerAsset, setNewBannerAsset] = useState(null);

  // Permiso: `null` es «todavía no se sabe / no se pudo averiguar», que no es
  // lo mismo que `[]` («no administro ninguno»). Ver utils/clubEdit.js.
  const [clubesAdmin, setClubesAdmin] = useState(null);
  const [checkingPermiso, setCheckingPermiso] = useState(true);

  const comunas = region ? getComunasOfRegion(region) : [];
  // Previsualización: todo lo que se pinta acá usa el tema ELEGIDO, no el
  // guardado. Es lo único que cambia antes de tocar la base de datos.
  const t = temaClub(tema);
  const status = getEditClubStatus({
    loading: checkingPermiso,
    clubesAdmin,
    clubId: club?.id,
  });
  const nombreValido = nombre.trim().length >= NOMBRE_MIN;

  const comprobarPermiso = useCallback(async () => {
    setCheckingPermiso(true);
    const { data } = await getMisClubesAdmin();
    setClubesAdmin(data);
    setCheckingPermiso(false);
  }, []);

  useEffect(() => {
    comprobarPermiso();
  }, [comprobarPermiso]);

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
    if (!nombreValido) {
      setBanner({
        type: 'error',
        title: 'Nombre muy corto',
        message: `El nombre del club debe tener al menos ${NOMBRE_MIN} caracteres.`,
      });
      return;
    }
    setSaving(true);
    setBanner(null);

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

    const { error, temaOmitido } = await updateClub(club.id, {
      nombre,
      descripcion,
      region,
      comuna,
      modalidad,
      tema,
    });
    setSaving(false);

    if (error) {
      // El color elegido se queda como previsualización y nada más: el club
      // sigue con el que tenía guardado.
      setBanner({ type: 'error', title: 'No se pudo guardar', message: error.message });
      return;
    }

    if (temaOmitido) {
      // Se guardó todo menos el color, porque este entorno todavía no tiene
      // la columna. Decirlo es mejor que dejar creer que el tema cambió.
      setBanner({
        type: 'error',
        title: 'El color no se guardó',
        message: 'El resto de los cambios sí. Falta aplicar la migración del tema del club.',
      });
      return;
    }

    // Volvemos al detalle: su useFocusEffect recarga con los datos nuevos,
    // así el color se ve al instante y sin recargar la app.
    navigation.goBack();
  };

  const cerrar = () => navigation.goBack();

  const cabecera = (
    <View style={styles.header}>
      <View style={styles.headerCenter}>
        <Text style={styles.headerTitle}>Editar club</Text>
        <Text style={styles.headerSubtitle}>Solo administradores</Text>
      </View>
      <Pressable
        onPress={cerrar}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Cerrar"
        style={({ pressed }) => [styles.closeBtn, pressed && styles.pressedChip]}
      >
        <X color={clubColors.textPrimary} size={19} strokeWidth={2.2} />
      </Pressable>
    </View>
  );

  // ── Estados que no son el formulario ───────────────────────────────
  if (status !== 'ready') {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
        {cabecera}
        <View style={styles.centerBox}>
          {status === 'loading' ? (
            <ActivityIndicator color={t.main} />
          ) : (
            <View style={styles.centerCard}>
              <View style={[styles.centerIcon, { backgroundColor: t.soft }]}>
                <Lock color={t.main} size={20} strokeWidth={2} />
              </View>
              <Text style={styles.centerTitle}>
                {status === 'error'
                  ? 'No se pudo comprobar tu permiso'
                  : 'Solo los administradores pueden editar el club'}
              </Text>
              <Text style={styles.centerSub}>
                {status === 'error'
                  ? 'Revisa tu conexión y vuelve a intentarlo.'
                  : 'Pídele a un administrador que haga el cambio.'}
              </Text>
              <Pressable
                onPress={status === 'error' ? comprobarPermiso : cerrar}
                accessibilityRole="button"
                accessibilityLabel={status === 'error' ? 'Reintentar' : 'Volver'}
                style={({ pressed }) => [
                  styles.centerBtn,
                  { borderColor: t.border, backgroundColor: t.soft },
                  pressed && { backgroundColor: t.softStrong },
                ]}
              >
                <Text style={[styles.centerBtnText, { color: t.main }]}>
                  {status === 'error' ? 'Reintentar' : 'Volver'}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ── Formulario ─────────────────────────────────────────────────────
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      {cabecera}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

          {/* ── Imágenes ── */}
          <View style={styles.card}>
            <Pressable
              onPress={handlePickBanner}
              accessibilityRole="button"
              accessibilityLabel={
                newBannerAsset || club?.banner_url ? 'Cambiar banner del club' : 'Subir banner del club'
              }
              style={({ pressed }) => [styles.bannerTap, pressed && { opacity: 0.85 }]}
            >
              {newBannerAsset ? (
                <Image source={{ uri: newBannerAsset.uri }} style={styles.bannerImg} resizeMode="cover" />
              ) : club?.banner_url ? (
                <Image source={{ uri: club.banner_url }} style={styles.bannerImg} resizeMode="cover" />
              ) : (
                <View style={styles.bannerPlaceholder}>
                  <Camera color={clubColors.textMuted} size={20} strokeWidth={2} />
                  <Text style={styles.bannerHint}>Subir banner (opcional)</Text>
                </View>
              )}
              {(newBannerAsset || club?.banner_url) && (
                <View style={styles.bannerEditChip}>
                  <Camera color={clubColors.textPrimary} size={13} strokeWidth={2} />
                  <Text style={styles.bannerEditChipText}>Cambiar banner</Text>
                </View>
              )}
            </Pressable>

            <Pressable
              onPress={handlePickLogo}
              accessibilityRole="button"
              accessibilityLabel={
                newLogoAsset || club?.foto_url ? 'Cambiar logo del club' : 'Subir logo del club'
              }
              style={({ pressed }) => [styles.logoTap, pressed && { opacity: 0.8 }]}
            >
              {newLogoAsset ? (
                <Image source={{ uri: newLogoAsset.uri }} style={styles.logoImg} />
              ) : club?.foto_url ? (
                <Image source={{ uri: club.foto_url }} style={styles.logoImg} />
              ) : (
                // Escudo provisional: es identidad, así que previsualiza el tema.
                <View
                  style={[
                    styles.logoPlaceholder,
                    { backgroundColor: t.soft, borderColor: t.border },
                  ]}
                >
                  <Shield color={t.main} size={38} strokeWidth={1.6} />
                </View>
              )}
              <View style={styles.logoHintRow}>
                <Camera color={clubColors.textMuted} size={14} strokeWidth={2} />
                <Text style={styles.logoHint}>
                  {newLogoAsset || club?.foto_url ? 'Cambiar logo' : 'Subir logo (opcional)'}
                </Text>
              </View>
            </Pressable>
          </View>

          {/* ── Datos ── */}
          <View style={styles.card}>
            <Text style={styles.label}>Nombre del club</Text>
            <TextInput
              style={styles.input}
              placeholder="Ej: Atlético La Reina"
              placeholderTextColor={clubColors.textFaint}
              value={nombre}
              onChangeText={setNombre}
              maxLength={40}
              accessibilityLabel="Nombre del club"
              returnKeyType="done"
            />
            {!nombreValido && nombre.length > 0 && (
              <Text style={styles.inputError}>
                El nombre necesita al menos {NOMBRE_MIN} caracteres.
              </Text>
            )}

            <Text style={[styles.label, styles.labelSpaced]}>Descripción (opcional)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="Cuenta de qué se trata tu club, dónde juegan, qué buscan..."
              placeholderTextColor={clubColors.textFaint}
              value={descripcion}
              onChangeText={setDescripcion}
              multiline
              maxLength={500}
              accessibilityLabel="Descripción del club"
            />
            <Text style={styles.counter}>{descripcion.length}/500</Text>
          </View>

          {/* ── Modalidad ── */}
          <View style={styles.card}>
            <Text style={styles.label}>Modalidad (opcional)</Text>
            <View style={styles.chipRow}>
              {OPCIONES_MODALIDAD.map((op) => {
                const activa = modalidad === op.value;
                return (
                  <Pressable
                    key={op.value}
                    // Volver a tocar la opción activa la deselecciona.
                    onPress={() => setModalidad(activa ? null : op.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: activa }}
                    accessibilityLabel={`Modalidad ${op.label}`}
                    style={({ pressed }) => [
                      styles.chip,
                      activa && { borderColor: t.main, backgroundColor: t.soft },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <Text style={[styles.chipText, activa && { color: t.main, fontWeight: '700' }]}>
                      {op.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* ── Ubicación ── */}
          <View style={styles.card}>
            <Text style={styles.label}>Región (opcional)</Text>
            <Pressable
              onPress={() => {
                setShowRegiones((v) => !v);
                setShowComunas(false);
              }}
              accessibilityRole="button"
              accessibilityState={{ expanded: showRegiones }}
              accessibilityLabel="Elegir región"
              style={({ pressed }) => [styles.select, pressed && { opacity: 0.85 }]}
            >
              <Text style={region ? styles.selectValue : styles.selectPlaceholder}>
                {region || 'Selecciona una región'}
              </Text>
              <ChevronDown color={clubColors.textMuted} size={18} strokeWidth={2} />
            </Pressable>
            {showRegiones && (
              <View style={styles.optionsBox}>
                {NOMBRES_REGIONES.map((r) => {
                  const activa = r === region;
                  return (
                    <Pressable
                      key={r}
                      onPress={() => {
                        setRegion(r);
                        setComuna(null);
                        setShowRegiones(false);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: activa }}
                      style={({ pressed }) => [
                        styles.option,
                        activa && { backgroundColor: t.soft },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text
                        style={[styles.optionText, activa && { color: t.main, fontWeight: '700' }]}
                      >
                        {r}
                      </Text>
                      {activa && <Check color={t.main} size={16} strokeWidth={2.6} />}
                    </Pressable>
                  );
                })}
              </View>
            )}

            {region && (
              <>
                <Text style={[styles.label, styles.labelSpaced]}>Comuna (opcional)</Text>
                <Pressable
                  onPress={() => {
                    setShowComunas((v) => !v);
                    setShowRegiones(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showComunas }}
                  accessibilityLabel="Elegir comuna"
                  style={({ pressed }) => [styles.select, pressed && { opacity: 0.85 }]}
                >
                  <Text style={comuna ? styles.selectValue : styles.selectPlaceholder}>
                    {comuna || 'Selecciona una comuna'}
                  </Text>
                  <ChevronDown color={clubColors.textMuted} size={18} strokeWidth={2} />
                </Pressable>
                {showComunas && (
                  <View style={styles.optionsBox}>
                    {comunas.map((c) => {
                      const activa = c === comuna;
                      return (
                        <Pressable
                          key={c}
                          onPress={() => {
                            setComuna(c);
                            setShowComunas(false);
                          }}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: activa }}
                          style={({ pressed }) => [
                            styles.option,
                            activa && { backgroundColor: t.soft },
                            pressed && { opacity: 0.7 },
                          ]}
                        >
                          <Text
                            style={[
                              styles.optionText,
                              activa && { color: t.main, fontWeight: '700' },
                            ]}
                          >
                            {c}
                          </Text>
                          {activa && <Check color={t.main} size={16} strokeWidth={2.6} />}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </View>

          {/* ── Tema del club ── */}
          <View style={styles.card}>
            <Text style={styles.label}>Tema del club</Text>
            <Text style={styles.help}>
              Pinta el banner, el escudo y los botones del club. Los resultados de los
              partidos y los avisos conservan sus colores.
            </Text>
            <ClubThemePicker value={tema} onChange={setTema} disabled={saving} />
          </View>

          {/* ── Guardar ── */}
          <Pressable
            onPress={handleSave}
            disabled={!nombreValido || saving}
            accessibilityRole="button"
            accessibilityLabel="Guardar cambios"
            accessibilityState={{ disabled: !nombreValido || saving, busy: saving }}
            style={({ pressed }) => [
              styles.submitBtn,
              { backgroundColor: t.main, shadowColor: t.main },
              (!nombreValido || saving) && styles.submitDisabled,
              pressed && nombreValido && !saving && { backgroundColor: t.pressed },
            ]}
          >
            {saving ? (
              <ActivityIndicator color={t.ink} />
            ) : (
              <Text style={[styles.submitLabel, { color: t.ink }]}>Guardar cambios</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Ancho máximo del formulario en web: más allá, los campos se ven absurdos. */
const ANCHO_FORMULARIO = 600;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: clubColors.background },

  // ── Cabecera ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: clubSizes.gutter,
    paddingTop: 6,
    paddingBottom: 14,
    width: '100%',
    maxWidth: ANCHO_FORMULARIO,
    alignSelf: 'center',
  },
  headerCenter: { flex: 1, minWidth: 0 },
  headerTitle: {
    color: clubColors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    color: clubColors.textSecondary,
    fontSize: 12.5,
    marginTop: 3,
  },
  closeBtn: {
    width: clubSizes.iconBtn,
    height: clubSizes.iconBtn,
    borderRadius: clubSizes.iconBtn / 2,
    borderWidth: 1,
    borderColor: clubColors.border,
    backgroundColor: clubColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressedChip: { backgroundColor: clubColors.chipStrong },

  // ── Estados sin formulario ──
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: clubSizes.gutter },
  centerCard: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    backgroundColor: clubColors.surface,
    borderRadius: clubRadius.xl,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    padding: 22,
  },
  centerIcon: {
    width: 44,
    height: 44,
    borderRadius: clubRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  centerTitle: {
    color: clubColors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  centerSub: {
    color: clubColors.textSecondary,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 6,
  },
  centerBtn: {
    height: 44,
    minWidth: 150,
    paddingHorizontal: 18,
    marginTop: 16,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBtnText: { fontSize: 13.5, fontWeight: '700' },

  // ── Contenido ──
  content: {
    padding: clubSizes.gutter,
    paddingTop: 0,
    paddingBottom: 40,
    gap: 12,
    width: '100%',
    maxWidth: ANCHO_FORMULARIO,
    alignSelf: 'center',
  },
  card: {
    backgroundColor: clubColors.surface,
    borderRadius: clubRadius.xl,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    padding: 14,
  },

  // ── Imágenes ──
  bannerTap: {
    width: '100%',
    height: 132,
    borderRadius: clubRadius.lg,
    overflow: 'hidden',
  },
  bannerImg: { width: '100%', height: '100%' },
  // El recuadro del banner queda neutro: la portada es una foto, no un
  // acento del club. El color se previsualiza en el escudo y en los botones.
  bannerPlaceholder: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: clubColors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: clubColors.border,
    borderStyle: 'dashed',
    borderRadius: clubRadius.lg,
  },
  bannerHint: { color: clubColors.textMuted, fontSize: 13 },
  bannerEditChip: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  bannerEditChipText: { color: clubColors.textPrimary, fontSize: 12, fontWeight: '600' },
  logoTap: { alignItems: 'center', marginTop: 14 },
  logoPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: clubRadius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  logoImg: {
    width: 80,
    height: 80,
    borderRadius: clubRadius.lg,
    marginBottom: 8,
  },
  logoHintRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  logoHint: { color: clubColors.textMuted, fontSize: 12 },

  // ── Campos ──
  label: {
    color: clubColors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 9,
  },
  labelSpaced: { marginTop: 16 },
  help: {
    color: clubColors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: -4,
    marginBottom: 12,
  },
  input: {
    backgroundColor: clubColors.surfaceAlt,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    color: clubColors.textPrimary,
    fontSize: 15,
    paddingHorizontal: 14,
    height: 52,
  },
  inputMultiline: {
    height: 110,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  inputError: { color: clubColors.loss, fontSize: 11.5, marginTop: 6 },
  counter: {
    color: clubColors.textFaint,
    fontSize: 11,
    textAlign: 'right',
    marginTop: 6,
  },

  // ── Chips de modalidad ──
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: clubRadius.md,
    borderWidth: 1.5,
    borderColor: clubColors.borderSoft,
    backgroundColor: clubColors.surfaceAlt,
  },
  chipText: { color: clubColors.textSecondary, fontSize: 13.5, fontWeight: '600' },

  // ── Selectores ──
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: clubColors.surfaceAlt,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    paddingHorizontal: 14,
    height: 52,
  },
  selectValue: { color: clubColors.textPrimary, fontSize: 15, flexShrink: 1 },
  selectPlaceholder: { color: clubColors.textFaint, fontSize: 15, flexShrink: 1 },
  optionsBox: {
    backgroundColor: clubColors.surfaceAlt,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    marginTop: 8,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: clubColors.divider,
  },
  optionText: { color: clubColors.textPrimary, fontSize: 14, flexShrink: 1 },

  // ── Guardar ──
  submitBtn: {
    height: 54,
    marginTop: 4,
    borderRadius: clubRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    // Resplandor discreto del color elegido.
    shadowOpacity: 0.26,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  submitDisabled: { opacity: 0.45, shadowOpacity: 0, elevation: 0 },
  submitLabel: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
});
