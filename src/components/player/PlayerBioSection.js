import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Pencil } from 'lucide-react-native';

import { dsColors, dsRadius, dsSizes } from '../../theme/colors';

/** A partir de cuántos caracteres ofrecemos "Ver más". */
const LIMITE_COLAPSADO = 150;

/**
 * "Sobre mí": biografía del jugador.
 *
 * Con bio → tarjeta con el texto recortado a 3 líneas y "Ver más" si es largo.
 * Sin bio → en el perfil propio, CTA discontinuo que lleva a editar; en un
 *           perfil ajeno no se renderiza nada (lo decide la pantalla).
 *
 * Nunca muestra un campo de formulario: editar siempre abre EditProfile.
 */
export default function PlayerBioSection({ bio, isOwnProfile, onEdit }) {
  const [expandida, setExpandida] = useState(false);
  const texto = (bio || '').trim();

  if (!texto) {
    if (!isOwnProfile) return null;
    return (
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel="Agrega una descripción sobre tu trayectoria"
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.8 }]}
      >
        <Pencil color={dsColors.green} size={16} strokeWidth={2} />
        <Text style={styles.ctaText}>Agrega una descripción sobre tu trayectoria</Text>
      </Pressable>
    );
  }

  const esLarga = texto.length > LIMITE_COLAPSADO;

  return (
    <View style={styles.card}>
      <Text style={styles.text} numberOfLines={expandida ? undefined : 3}>
        {texto}
      </Text>
      {esLarga && (
        <Pressable
          onPress={() => setExpandida((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={expandida ? 'Ver menos de la descripción' : 'Ver más de la descripción'}
          style={styles.more}
        >
          <Text style={styles.moreText}>{expandida ? 'Ver menos' : 'Ver más'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: dsSizes.gutter,
    backgroundColor: dsColors.surface,
    borderWidth: 1,
    borderColor: dsColors.borderSoft,
    borderRadius: dsRadius.lg,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  text: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 13.5,
    lineHeight: 20,
  },
  more: { marginTop: 7, alignSelf: 'flex-start' },
  moreText: { color: dsColors.green, fontSize: 12.5, fontWeight: '700' },

  cta: {
    marginHorizontal: dsSizes.gutter,
    minHeight: 52,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(90, 224, 106, 0.35)',
    backgroundColor: 'rgba(90, 224, 106, 0.06)',
    borderRadius: dsRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  ctaText: {
    color: dsColors.green,
    fontSize: 13.5,
    fontWeight: '700',
    flexShrink: 1,
  },
});
