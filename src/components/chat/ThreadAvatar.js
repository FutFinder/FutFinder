import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Shield, Video } from 'lucide-react-native';

import { chatColors } from '../../theme/colors';
import { initialOf } from '../../utils/chatMeta';

/**
 * Avatar de una conversación. Tres identidades distintas, como en el diseño:
 *
 *   club   → escudo sobre degradado verde (es la conversación destacada)
 *   match  → icono de cancha sobre superficie verde tenue
 *   dm     → foto del jugador o su inicial
 *
 * `muted` (una conversación silenciada) NO cambia el avatar: el estado se
 * comunica con la campana tachada de la tarjeta, para no depender del color.
 */
export default function ThreadAvatar({ type, fotoUrl, name, size = 46, radius = 15 }) {
  const box = { width: size, height: size, borderRadius: radius };
  const iconSize = Math.round(size * 0.47);

  if (fotoUrl) {
    return (
      <View style={[styles.base, box, styles.neutral]}>
        <Image source={{ uri: fotoUrl }} style={styles.img} accessibilityIgnoresInvertColors />
      </View>
    );
  }

  if (type === 'club') {
    return (
      <LinearGradient
        colors={chatColors.clubShield}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[styles.base, box, styles.clubShield]}
      >
        <Shield color={chatColors.inkOnGreen} size={iconSize} strokeWidth={2.2} />
      </LinearGradient>
    );
  }

  if (type === 'match') {
    return (
      <View style={[styles.base, box, styles.green]}>
        <Video color={chatColors.green} size={iconSize} strokeWidth={1.7} />
      </View>
    );
  }

  return (
    <View style={[styles.base, box, styles.green]}>
      <Text style={[styles.initial, { fontSize: Math.round(size * 0.37) }]}>
        {initialOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
  },
  img: { width: '100%', height: '100%' },
  green: {
    backgroundColor: chatColors.avatarGreenBg,
    borderColor: chatColors.avatarGreenBorder,
  },
  neutral: {
    backgroundColor: chatColors.avatarNeutralBg,
    borderColor: chatColors.avatarNeutralBorder,
  },
  clubShield: {
    borderColor: 'rgba(90,224,106,0.5)',
    shadowColor: chatColors.green,
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  initial: { color: chatColors.green, fontWeight: '800' },
});
