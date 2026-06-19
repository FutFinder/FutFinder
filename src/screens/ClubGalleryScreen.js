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
  Platform,
  Alert,
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

import { colors, radius } from '../theme/colors';
import Banner from '../components/Banner';
import { getCurrentUser } from '../services/auth';
import { listMembers } from '../services/clubs';
import { pickImages } from '../services/storage';
import {
  getClubPhotos,
  uploadClubPhoto,
  deleteClubPhoto,
  MAX_PHOTOS,
} from '../services/clubGallery';

const SCREEN_W = Dimensions.get('window').width;
const GRID_GAP = 4;
const THUMB = Math.floor((SCREEN_W - 32 - GRID_GAP * 2) / 3);

/** Confirmación multiplataforma (web usa confirm, native usa Alert). */
function confirmAction(title, message, onConfirm) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n${message}`)) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Eliminar', style: 'destructive', onPress: onConfirm },
  ]);
}

/**
 * Galería completa de fotos de un club. Cualquiera la ve; solo los admins
 * pueden agregar o borrar (la RLS lo garantiza de todos modos).
 */
export default function ClubGalleryScreen({ navigation, route }) {
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
    confirmAction('¿Eliminar esta foto?', 'Se quitará de la galería del club.', async () => {
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
          <ActivityIndicator color={colors.primary} />
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
          <ImagePlus color={colors.textMuted} size={36} />
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
            <X color={colors.textPrimary} size={24} />
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
                <ChevronLeft color={colors.textPrimary} size={28} />
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
                <ChevronRight color={colors.textPrimary} size={28} />
              </Pressable>
            </>
          )}

          {soyAdmin && viewerIndex !== null && photos[viewerIndex] && (
            <Pressable
              onPress={() => handleDelete(photos[viewerIndex])}
              style={({ pressed }) => [styles.viewerDelete, pressed && { opacity: 0.7 }]}
            >
              <Trash2 color={colors.error} size={18} />
              <Text style={styles.viewerDeleteText}>Eliminar</Text>
            </Pressable>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Header({ navigation, canAdd, uploading, onAdd }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => navigation.goBack()}
        hitSlop={12}
        style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
      >
        <ArrowLeft color={colors.textPrimary} size={22} />
      </Pressable>
      <Text style={styles.headerTitle}>Fotos del club</Text>
      {canAdd ? (
        <Pressable
          onPress={onAdd}
          disabled={uploading}
          hitSlop={8}
          style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.6 }]}
        >
          {uploading ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <Plus color={colors.primary} size={20} strokeWidth={2.4} />
          )}
        </Pressable>
      ) : (
        <View style={styles.iconBtn} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bannerWrap: { paddingHorizontal: 16 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  gridContent: { padding: 16, gap: GRID_GAP },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
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
    color: colors.textMuted,
    fontSize: 14,
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
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
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
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorSoft,
  },
  viewerDeleteText: { color: colors.error, fontSize: 14, fontWeight: '700' },
});
