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
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, ChevronDown, Shield, Camera, Lock, Check } from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  medidas as S,
  fuentes as F,
} from '../theme/colors';
import { temaClub, TEMA_CLUB_POR_DEFECTO } from '../theme/clubThemes';
import Banner from '../components/Banner';
import ClubThemePicker from '../components/club/ClubThemePicker';
import { updateClub } from '../services/clubs';
import { getMisClubesConPermiso } from '../services/clubPermissions';
import { pickImage, uploadClubLogo, uploadClubBanner } from '../services/storage';
import { NOMBRES_REGIONES, getComunasOfRegion } from '../data/regiones-chile';
import { OPCIONES_MODALIDAD } from '../utils/clubMeta';
import { getEditClubStatus, NOMBRE_MIN } from '../utils/clubEdit';

/**
 * Editar los datos del club (modal sobre las tabs, como CreateClub).
 *
 * MISMA ESTÉTICA QUE «MI CLUB». Usa los tokens de `reservas`/`reservasRadius`
 * —fondo casi negro, tarjetas #141715, bordes de un blanco muy tenue— en vez
 * de la paleta global antigua: entrar a editar no debería sentirse como
 * cambiar de aplicación.
 *
 * ADMIN, O QUIEN TENGA `editClub` CONCEDIDO — Y SE COMPRUEBA. El botón de
 * entrada vive en el lápiz de `ClubHeaderBar` y sólo lo ven quienes califican,
 * pero la pantalla vuelve a preguntar por su cuenta
 * (`getMisClubesConPermiso('editClub')`, migración 119) para que llegar acá
 * por otro camino no muestre un formulario que el servidor va a rechazar. La
 * garantía de verdad es la policy `clubs_update`: sin ella, esconder el
 * formulario no protegería nada.
 *
 * EL TEMA SE PREVISUALIZA, PERO SE APLICA AL GUARDAR. Elegir un color
 * repinta los estados seleccionados y el botón de esta pantalla; el club no
 * cambia hasta que la base de datos confirma. Si el guardado falla, no queda
 * ningún color aplicado «solo acá».
 *
 * DOS COLUMNAS EN PANTALLAS ANCHAS (≥860px, `useWindowDimensions`): en vez de
 * estirar un formulario angosto hasta verse absurdo, imágenes+datos van a la
 * izquierda y modalidad+ubicación+tema a la derecha, y el ancho máximo del
 * conjunto crece con el ancho de columna. Por debajo del umbral se apila
 * igual que en el celular.
 */
export default function EditClubScreen({ navigation, route }) {
  const { club } = route.params || {};
  const { width: anchoVentana } = useWindowDimensions();
  // A partir de acá sobra espacio para dos columnas; más abajo se apila.
  const esAncho = anchoVentana >= 860;
  const anchoMaximo = esAncho ? 1120 : ANCHO_FORMULARIO;

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
    const { data } = await getMisClubesConPermiso('editClub');
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
    <View style={[styles.header, { maxWidth: anchoMaximo }]}>
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
        <X color={C.textPrimary} size={19} strokeWidth={2.2} />
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
                  : 'No tienes permiso para editar este club'}
              </Text>
              <Text style={styles.centerSub}>
                {status === 'error'
                  ? 'Revisa tu conexión y vuelve a intentarlo.'
                  : 'Pídele a un administrador que haga el cambio, o que te dé el permiso desde Permisos de club.'}
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
          contentContainerStyle={[styles.content, { maxWidth: anchoMaximo }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

          <View style={esAncho ? styles.grid : styles.stack}>
          <View style={esAncho ? styles.col : styles.stack}>
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
                  <Camera color={C.textMuted} size={20} strokeWidth={2} />
                  <Text style={styles.bannerHint}>Subir banner (opcional)</Text>
                </View>
              )}
              {(newBannerAsset || club?.banner_url) && (
                <View style={styles.bannerEditChip}>
                  <Camera color={C.textPrimary} size={13} strokeWidth={2} />
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
                <Camera color={C.textMuted} size={14} strokeWidth={2} />
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
              placeholderTextColor={C.textFaint}
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
              placeholderTextColor={C.textFaint}
              value={descripcion}
              onChangeText={setDescripcion}
              multiline
              maxLength={500}
              accessibilityLabel="Descripción del club"
            />
            <Text style={styles.counter}>{descripcion.length}/500</Text>
          </View>
          </View>

          <View style={esAncho ? styles.col : styles.stack}>
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
                    <Text style={[styles.chipText, activa && { color: t.main, fontFamily: F.bold }]}>
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
              <ChevronDown color={C.textMuted} size={18} strokeWidth={2} />
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
                        style={[styles.optionText, activa && { color: t.main, fontFamily: F.bold }]}
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
                  <ChevronDown color={C.textMuted} size={18} strokeWidth={2} />
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
                              activa && { color: t.main, fontFamily: F.bold },
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
          </View>
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
  root: { flex: 1, backgroundColor: C.bg },

  // ── Cabecera ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.screenPadding,
    paddingTop: 6,
    paddingBottom: 14,
    width: '100%',
    maxWidth: ANCHO_FORMULARIO,
    alignSelf: 'center',
  },
  headerCenter: { flex: 1, minWidth: 0 },
  headerTitle: {
    color: C.textPrimary,
    fontSize: 22,
    fontFamily: F.extraBold,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    color: C.textSecondary,
    fontSize: 12.5,
    marginTop: 3,
  },
  closeBtn: {
    width: S.iconBtn,
    height: S.iconBtn,
    borderRadius: S.iconBtn / 2,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressedChip: { backgroundColor: C.chipStrong },

  // ── Estados sin formulario ──
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.screenPadding },
  centerCard: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: R.cardSm,
    borderWidth: 1,
    borderColor: C.borderSoft,
    padding: 22,
  },
  centerIcon: {
    width: 44,
    height: 44,
    borderRadius: R.chip,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  centerTitle: {
    color: C.textPrimary,
    fontSize: 15,
    fontFamily: F.bold,
    textAlign: 'center',
  },
  centerSub: {
    color: C.textSecondary,
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
    borderRadius: R.iconBtn,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBtnText: { fontSize: 13.5, fontFamily: F.bold },

  // ── Contenido ──
  content: {
    padding: S.screenPadding,
    paddingTop: 0,
    paddingBottom: 40,
    gap: 12,
    width: '100%',
    maxWidth: ANCHO_FORMULARIO,
    alignSelf: 'center',
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: R.cardSm,
    borderWidth: 1,
    borderColor: C.borderSoft,
    padding: 14,
  },

  // ── Dos columnas en pantallas anchas ──
  stack: { gap: 12 },
  grid: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  col: { flex: 1, gap: 12 },

  // ── Imágenes ──
  bannerTap: {
    width: '100%',
    height: 132,
    borderRadius: R.row,
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
    backgroundColor: C.surfaceAlt,
    borderWidth: 1.5,
    borderColor: C.border,
    borderStyle: 'dashed',
    borderRadius: R.row,
  },
  bannerHint: { color: C.textMuted, fontSize: 13 },
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
  bannerEditChipText: { color: C.textPrimary, fontSize: 12, fontFamily: F.semiBold },
  logoTap: { alignItems: 'center', marginTop: 14 },
  logoPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: R.row,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  logoImg: {
    width: 80,
    height: 80,
    borderRadius: R.row,
    marginBottom: 8,
  },
  logoHintRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  logoHint: { color: C.textMuted, fontSize: 12 },

  // ── Campos ──
  label: {
    color: C.textPrimary,
    fontSize: 13,
    fontFamily: F.bold,
    marginBottom: 9,
  },
  labelSpaced: { marginTop: 16 },
  help: {
    color: C.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: -4,
    marginBottom: 12,
  },
  input: {
    backgroundColor: C.surfaceAlt,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.borderSoft,
    color: C.textPrimary,
    fontSize: 15,
    paddingHorizontal: 14,
    height: 52,
  },
  inputMultiline: {
    height: 110,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  inputError: { color: C.loss, fontSize: 11.5, marginTop: 6 },
  counter: {
    color: C.textFaint,
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
    borderRadius: R.iconBtn,
    borderWidth: 1.5,
    borderColor: C.borderSoft,
    backgroundColor: C.surfaceAlt,
  },
  chipText: { color: C.textSecondary, fontSize: 13.5, fontFamily: F.semiBold },

  // ── Selectores ──
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surfaceAlt,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.borderSoft,
    paddingHorizontal: 14,
    height: 52,
  },
  selectValue: { color: C.textPrimary, fontSize: 15, flexShrink: 1 },
  selectPlaceholder: { color: C.textFaint, fontSize: 15, flexShrink: 1 },
  optionsBox: {
    backgroundColor: C.surfaceAlt,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.borderSoft,
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
    borderBottomColor: C.divider,
  },
  optionText: { color: C.textPrimary, fontSize: 14, flexShrink: 1 },

  // ── Guardar ──
  submitBtn: {
    height: 54,
    marginTop: 4,
    borderRadius: R.row,
    alignItems: 'center',
    justifyContent: 'center',
    // Resplandor discreto del color elegido.
    shadowOpacity: 0.26,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  submitDisabled: { opacity: 0.45, shadowOpacity: 0, elevation: 0 },
  submitLabel: { fontSize: 16, fontFamily: F.extraBold, letterSpacing: -0.2 },
});
