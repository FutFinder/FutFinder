import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Share, Linking, Platform } from 'react-native';
import {
  MessageCircle,
  Instagram,
  Link2,
  Users,
  Share2,
  Send,
  Check,
  Trophy,
} from 'lucide-react-native';

import Sheet from './Sheet';
import { GhostButton, Note } from './ui';
import { partidos as P, partidosRadius as R } from '../../theme/colors';
import { formatFechaCorta } from './DateTimeSheets';
import { cuotaLabel } from '../../services/matchRules';

/**
 * Hoja de compartir del partido.
 *
 * Comparte solo el enlace público: título, cancha, comuna, fecha y cupos.
 * Nunca la ubicación del usuario ni datos personales de los jugadores.
 */

const BASE_URL = 'https://futfinder.cl/p/';

export function matchShareUrl(match) {
  return BASE_URL + (match?.id || '');
}

export function matchShareText(match) {
  if (!match) return '';
  const when = match.hora
    ? `${formatFechaCorta(match.hora)} ${new Date(match.hora)
        .toTimeString()
        .slice(0, 5)}`
    : '';
  const cupos =
    match.cupos_disponibles != null
      ? `${match.cupos_disponibles} ${match.cupos_disponibles === 1 ? 'cupo' : 'cupos'}`
      : '';
  const partes = [
    `${match.titulo}`,
    when,
    [match.cancha_nombre, match.comuna].filter(Boolean).join(' · '),
    [cupos, cuotaLabel(match.precio_cuota)].filter(Boolean).join(' · '),
    matchShareUrl(match),
  ].filter(Boolean);
  return partes.join('\n');
}

export default function ShareSheet({ visible, onClose, match, onShareInApp }) {
  const [copied, setCopied] = useState(false);
  const url = matchShareUrl(match);
  const text = matchShareText(match);

  const openUrl = async (target) => {
    try {
      const can = await Linking.canOpenURL(target);
      if (can) await Linking.openURL(target);
    } catch {}
  };

  const nativeShare = async () => {
    try {
      await Share.share(Platform.OS === 'ios' ? { message: text, url } : { message: text });
    } catch {}
  };

  const copy = async () => {
    // Sin `expo-clipboard` en el proyecto: en web usamos la API del navegador y
    // en nativo caemos a la hoja del sistema, que también permite copiar.
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      }
    } catch {}
    nativeShare();
  };

  const options = [
    {
      key: 'wa',
      label: 'WhatsApp',
      icon: MessageCircle,
      onPress: () => openUrl(`whatsapp://send?text=${encodeURIComponent(text)}`),
    },
    {
      key: 'ig',
      label: 'Instagram',
      icon: Instagram,
      onPress: () => openUrl('instagram://app'),
    },
    {
      key: 'copy',
      label: copied ? 'Copiado' : 'Copiar enlace',
      icon: copied ? Check : Link2,
      onPress: copy,
    },
    {
      key: 'app',
      label: 'En FutFinder',
      icon: Trophy,
      onPress: () => {
        onClose();
        onShareInApp?.();
      },
    },
    {
      key: 'sms',
      label: 'Mensaje',
      icon: Send,
      onPress: () => openUrl(`sms:?body=${encodeURIComponent(text)}`),
    },
    {
      key: 'friends',
      label: 'Amigos',
      icon: Users,
      onPress: () => {
        onClose();
        onShareInApp?.();
      },
    },
    { key: 'more', label: 'Más apps', icon: Share2, onPress: nativeShare },
  ];

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Compartir partido"
      maxHeightRatio={0.8}
      footer={<GhostButton label="Cancelar" onPress={onClose} height={48} style={{ flex: 1 }} />}
    >
      <View style={styles.preview}>
        <View style={styles.previewIcon}>
          <Trophy color={P.green} size={18} strokeWidth={2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={styles.previewTitle}>
            {match?.titulo || 'Partido'}
          </Text>
          <Text numberOfLines={1} style={styles.previewUrl}>
            {url.replace(/^https:\/\//, '')}
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        {options.map((o) => (
          <Pressable
            key={o.key}
            onPress={o.onPress}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            style={({ pressed }) => [styles.opt, pressed && { opacity: 0.75 }]}
          >
            <View style={styles.optIcon}>
              <o.icon color={P.green} size={20} strokeWidth={2} />
            </View>
            <Text numberOfLines={1} style={styles.optLabel}>
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Note>
        Compartimos el enlace público del partido: título, cancha, comuna, fecha y
        cupos. Nunca tu ubicación ni tus datos personales.
      </Note>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
    borderRadius: R.card,
    padding: 12,
    marginBottom: 14,
  },
  previewIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: P.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewTitle: { fontSize: 13, fontWeight: '700', color: P.text },
  previewUrl: { fontSize: 11, color: P.textFaint, marginTop: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  opt: { width: '22.5%', alignItems: 'center', gap: 6 },
  optIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: P.chip,
    borderWidth: 1,
    borderColor: P.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optLabel: { fontSize: 10.5, fontWeight: '600', color: P.textDim, textAlign: 'center' },
});
