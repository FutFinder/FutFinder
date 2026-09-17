import React from 'react';
import { View, Text, Pressable, Image, StyleSheet } from 'react-native';
import { Shield, MapPin, Users, ChevronRight } from 'lucide-react-native';
import {
  paleta as C,
  radios as R,
  fuentes as F,
} from '../../theme/colors';

/**
 * Tarjeta de club del explorador (handoff `Clubes.dc.html`): escudo o foto,
 * nombre, comuna e integrantes, con flecha o un accesorio custom a la derecha
 * (p.ej. el botón «Desafiar» para admins elegibles).
 *
 * LOS CONTROLES DE ADENTRO NO LLEVAN `accessibilityRole="button"`, y es a
 * propósito. La tarjeta entera SÍ es un botón, y en react-native-web ese rol
 * se traduce a un `<button>` de verdad: con el enlace de integrantes y el
 * accesorio marcados también como botón quedaban dos `<button>` anidados,
 * que es HTML inválido y rompía la hidratación en la web («<button> cannot be
 * a descendant of <button>»). Sin el rol, react-native-web los dibuja como
 * `<div>`, que sí puede vivir dentro de un botón, y el toque sigue
 * funcionando igual. `accessible` y `accessibilityLabel` se conservan para
 * que en el móvil se sigan anunciando.
 */
export default function ClubExplorerCard({ club, totalMiembros, onPress, onPressMembers, rightAccessory }) {
  const miembros = totalMiembros ?? club.total_miembros ?? 0;
  // Un club recién creado tiene UN integrante, no «1 integrantes».
  const etiquetaMiembros = `${miembros} ${miembros === 1 ? 'integrante' : 'integrantes'}`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={club.nombre}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {club.foto_url ? (
        <Image source={{ uri: club.foto_url }} style={styles.logo} />
      ) : (
        <View style={[styles.logo, styles.logoFallback]}>
          <Shield color={C.green} size={26} strokeWidth={2} />
        </View>
      )}

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {club.nombre}
        </Text>
        <View style={styles.metaRow}>
          {club.comuna ? (
            <View style={styles.metaItem}>
              <MapPin color={C.textSecondary} size={13} strokeWidth={2} />
              <Text style={styles.metaText} numberOfLines={1}>
                {club.comuna}
              </Text>
            </View>
          ) : null}
          {onPressMembers ? (
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                onPressMembers();
              }}
              hitSlop={6}
              accessible
              accessibilityLabel={`Ver ${etiquetaMiembros} de ${club.nombre}`}
              style={({ pressed }) => [styles.metaItem, pressed && { opacity: 0.6 }]}
            >
              <Users color={C.textSecondary} size={13} strokeWidth={2} />
              <Text style={[styles.metaText, styles.metaTextLink]}>{etiquetaMiembros}</Text>
            </Pressable>
          ) : (
            <View style={styles.metaItem}>
              <Users color={C.textSecondary} size={13} strokeWidth={2} />
              <Text style={styles.metaText}>{etiquetaMiembros}</Text>
            </View>
          )}
        </View>
      </View>

      {rightAccessory !== undefined ? (
        rightAccessory
      ) : (
        <ChevronRight color={C.textMuted} size={20} strokeWidth={2.2} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.card,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  cardPressed: { borderColor: C.green },
  logo: {
    width: 56,
    height: 56,
    borderRadius: R.ctaSecondary,
    flexShrink: 0,
  },
  logoFallback: {
    backgroundColor: C.shieldBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, minWidth: 0 },
  name: {
    color: C.textPrimary,
    fontSize: 17,
    fontFamily: F.bold,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: C.textSecondary,
    fontSize: 13,
    fontFamily: F.medium,
  },
  metaTextLink: {
    textDecorationLine: 'underline',
  },
});
