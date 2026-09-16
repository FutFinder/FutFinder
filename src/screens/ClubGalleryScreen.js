import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  FlatList,
  Modal,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  Plus,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
} from 'lucide-react-native';

import {
  reservas as C,
  reservasRadius as R,
  reservasSizes as S,
  reservasFonts as F,
} from '../theme/colors';
import Banner from '../components/Banner';
import { IconButton } from '../components/reservas/ui';
import { getCurrentUser } from '../services/auth';
import { listMembers } from '../services/clubs';
import { pickImages } from '../services/storage';
import {
  getClubPhotos,
  uploadClubPhoto,
  deleteClubPhoto,
  MAX_PHOTOS,
} from '../services/clubGallery';
import useConfirmacion from '../components/useConfirmacion';

const SCREEN_W = Dimensions.get('window').width;
const GRID_GAP = 4;
// El ancho útil es la pantalla menos los dos márgenes laterales; los dos
// huecos entre columnas salen del resto.
const THUMB = Math.floor((SCREEN_W - S.screenPadding * 2 - GRID_GAP * 2) / 3);

/**
 * Galería completa de fotos de un club. Cualquiera la ve; solo los admins
 * pueden agregar o borrar (la RLS lo garantiza de todos modos).
 */
export default function ClubGalleryScreen({ navigation, route }) {
  // `window.confirm` no abre nada en web: devuelve false al instante y la
  // acción no se ejecutaba nunca, sin decir por qué. Diálogo propio.
  const { confirmar, dialogo } = useConfirmacion();
  const { clubId } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [photos, setPhotos] = useState([]);
  const [soyAdmin, setSoyAdmin] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(null); // null = cerrado
  const [banner, setBanner] = useState(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    const myId = user?.id || null;

    const [{ data: ph }, { data: ms }] = await Promise.all([
      getClubPhotos(clubId),
      listMembers(clubId),
    ]);
    setPhotos(ph || []);
    setSoyAdmin((ms || []).some((m) => m.user_id === myId && m.rol === 'admin'));
    setLoading(false);
  }, [clubId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleAdd = async () => {
    const restantes = MAX_PHOTOS - photos.length;
    if (restantes <= 0) {
      setBanner({
        type: 'info',
        title: 'Límite alcanzado',
        message: `La galería del club admite hasta ${MAX_PHOTOS} fotos.`,
      });
      return;
    }

    const result = await pickImages({ quality: 0.8, selectionLimit: restantes });
    if (!result.ok) {
      if (result.reason !== 'Cancelado') {
        setBanner({ type: 'error', title: 'No se pudo abrir la galería', message: result.reason });
      }
      return;
    }

    // Respetamos el tope aunque la plataforma no aplique selectionLimit.
    const seleccionadas = result.assets.slice(0, restantes);
    const excedente = result.assets.length - seleccionadas.length;

    setUploading(true);
    let subidas = 0;
    let fallo = null;
    for (const asset of seleccionadas) {
      const { error } = await uploadClubPhoto(asset, clubId);
      if (error) {
        fallo = error;
        break;
      }
      subidas += 1;
    }
    setUploading(false);
    await load();

    if (fallo) {
      setBanner({
        type: 'error',
        title: subidas > 0 ? `Se subieron ${subidas}, pero una falló` : 'No se pudo subir',
        message: fallo.message,
      });
      return;
    }
    if (subidas > 0) {
      setBanner({
        type: 'success',
        title: subidas === 1 ? 'Foto agregada' : `${subidas} fotos agregadas`,
        message: excedente > 0
          ? `Se omitieron ${excedente} porque superaban el límite de ${MAX_PHOTOS}.`
          : undefined,
      });
    }
  };

  const handleDelete = (photo) => {
    confirmar('¿Eliminar esta foto?', 'Se quitará de la galería del club.', async () => {
      const { error } = await deleteClubPhoto(photo.id, photo.photo_url, clubId);
      if (error) {
        setBanner({ type: 'error', title: 'No se pudo eliminar', message: error.message });
        return;
      }
      setViewerIndex(null);
      await load();
    });
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <Header navigation={navigation} canAdd={false} />
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.green} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <Header
        navigation={navigation}
        canAdd={soyAdmin && photos.length < MAX_PHOTOS}
        uploading={uploading}
        onAdd={handleAdd}
      />

      {banner && (
        <View style={styles.bannerWrap}>
          <Banner {...banner} onClose={() => setBanner(null)} />
        </View>
      )}

      {photos.length === 0 ? (
        <View style={styles.emptyBox}>
          <ImagePlus color={C.textMuted} size={36} strokeWidth={1.5} />
          <Text style={styles.emptyText}>
            {soyAdmin
              ? 'Aún no hay fotos. Toca + para subir la primera.'
              : 'Este club todavía no tiene fotos.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={(item) => item.id}
          numColumns={3}
          columnWrapperStyle={{ gap: GRID_GAP }}
          contentContainerStyle={styles.gridContent}
          renderItem={({ item, index }) => (
            <Pressable
              onPress={() => setViewerIndex(index)}
              onLongPress={soyAdmin ? () => handleDelete(item) : undefined}
              style={({ pressed }) => [styles.thumb, pressed && { opacity: 0.82 }]}
            >
              <Image source={{ uri: item.photo_url }} style={styles.thumbImg} resizeMode="cover" />
            </Pressable>
          )}
        />
      )}

      {/* Visor a pantalla completa */}
      <Modal
        visible={viewerIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerIndex(null)}
      >
        <View style={styles.viewer}>
          <Pressable
            onPress={() => setViewerIndex(null)}
            hitSlop={12}
            style={styles.viewerClose}
          >
            <X color={C.textPrimary} size={24} />
          </Pressable>

          {viewerIndex !== null && photos[viewerIndex] && (
            <Image
              source={{ uri: photos[viewerIndex].photo_url }}
              style={styles.viewerImg}
              resizeMode="contain"
            />
          )}

          {photos.length > 1 && viewerIndex !== null && (
            <Text style={styles.viewerCount}>
              {viewerIndex + 1} / {photos.length}
            </Text>
          )}

          {viewerIndex !== null && (
            <>
              <Pressable
                onPress={() => setViewerIndex((i) => Math.max(0, i - 1))}
                disabled={viewerIndex === 0}
                style={[styles.viewerNav, styles.viewerNavLeft, viewerIndex === 0 && { opacity: 0 }]}
              >
                <ChevronLeft color={C.textPrimary} size={28} />
              </Pressable>
              <Pressable
                onPress={() => setViewerIndex((i) => Math.min(photos.length - 1, i + 1))}
                disabled={viewerIndex === photos.length - 1}
                style={[
                  styles.viewerNav,
                  styles.viewerNavRight,
                  viewerIndex === photos.length - 1 && { opacity: 0 },
                ]}
              >
                <ChevronRight color={C.textPrimary} size={28} />
              </Pressable>
            </>
          )}

          {soyAdmin && viewerIndex !== null && photos[viewerIndex] && (
            <Pressable
              onPress={() => handleDelete(photos[viewerIndex])}
              style={({ pressed }) => [styles.viewerDelete, pressed && { opacity: 0.7 }]}
            >
              <Trash2 color={C.red} size={18} strokeWidth={2.2} />
              <Text style={styles.viewerDeleteText}>Eliminar</Text>
            </Pressable>
          )}
        </View>
      </Modal>

      {dialogo}
    </SafeAreaView>
  );
}

function Header({ navigation, canAdd, uploading, onAdd }) {
  return (
    <View style={styles.header}>
      <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
      <Text style={styles.headerTitle}>Fotos del club</Text>
      {canAdd ? (
        <Pressable
          onPress={onAdd}
          disabled={uploading}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Agregar fotos"
          style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.6 }]}
        >
          {uploading ? (
            <ActivityIndicator color={C.green} size="small" />
          ) : (
            <Plus color={C.green} size={20} strokeWidth={2.4} />
          )}
        </Pressable>
      ) : (
        <View style={styles.iconBtnHueco} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bannerWrap: { paddingHorizontal: S.screenPadding },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: S.screenPadding,
    paddingTop: 6,
    paddingBottom: 12,
  },
  // El hueco que deja el botón de agregar cuando no eres administrador: sin
  // él el título se corre y la pantalla se ve distinta según el rol.
  iconBtnHueco: { width: S.iconBtn, height: S.iconBtn },
  headerTitle: {
    flex: 1,
    fontFamily: F.extraBold,
    fontSize: 19,
    color: C.textPrimary,
    letterSpacing: -0.3,
  },
  addBtn: {
    width: S.iconBtn,
    height: S.iconBtn,
    borderRadius: R.iconBtn,
    backgroundColor: C.shieldBg,
    borderWidth: 1,
    borderColor: C.greenDeepBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },

  gridContent: { padding: S.screenPadding, gap: GRID_GAP },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: R.chip,
    overflow: 'hidden',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  thumbImg: { width: '100%', height: '100%' },

  emptyBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyText: {
    fontFamily: F.medium,
    fontSize: 14,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  viewer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 2,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImg: { width: '100%', height: '78%' },
  viewerCount: {
    position: 'absolute',
    top: 58,
    alignSelf: 'center',
    fontFamily: F.bold,
    fontSize: 14,
    color: C.textPrimary,
  },
  viewerNav: {
    position: 'absolute',
    top: '45%',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerNavLeft: { left: 16 },
  viewerNavRight: { right: 16 },
  viewerDelete: {
    position: 'absolute',
    bottom: 50,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: 'rgba(237,107,118,0.4)',
    backgroundColor: 'rgba(237,107,118,0.14)',
  },
  viewerDeleteText: { fontFamily: F.bold, fontSize: 14, color: C.red },
});
