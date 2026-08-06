import React from 'react';
import { View, Text, Pressable, Image, StyleSheet } from 'react-native';
import { Shield, MapPin, Users, ChevronRight } from 'lucide-react-native';
import { clubsExplorer as CE, clubsExplorerRadius as CER } from '../../theme/colors';

/**
 * Tarjeta de club del explorador (handoff `Clubes.dc.html`): escudo o foto,
 * nombre, comuna e integrantes, con flecha o un accesorio custom a la derecha
 * (p.ej. el botón «Desafiar» para admins elegibles).
 */
export default function ClubExplorerCard({ club, totalMiembros, onPress, onPressMembers, rightAccessory }) {
  const miembros = totalMiembros ?? club.total_miembros ?? 0;

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
          <Shield color={CE.green} size={26} strokeWidth={2} />
        </View>
      )}

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {club.nombre}
        </Text>
        <View style={styles.metaRow}>
          {club.comuna ? (
            <View style={styles.metaItem}>
              <MapPin color={CE.textSecondary} size={13} strokeWidth={2} />
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
              accessibilityRole="button"
              accessibilityLabel={`Ver ${miembros} integrantes de ${club.nombre}`}
              style={({ pressed }) => [styles.metaItem, pressed && { opacity: 0.6 }]}
            >
              <Users color={CE.textSecondary} size={13} strokeWidth={2} />
              <Text style={[styles.metaText, styles.metaTextLink]}>{miembros} integrantes</Text>
            </Pressable>
          ) : (
            <View style={styles.metaItem}>
              <Users color={CE.textSecondary} size={13} strokeWidth={2} />
              <Text style={styles.metaText}>{miembros} integrantes</Text>
            </View>
          )}
        </View>
      </View>

      {rightAccessory !== undefined ? (
        rightAccessory
      ) : (
        <ChevronRight color={CE.textMuted} size={20} strokeWidth={2.2} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: CE.surface,
    borderWidth: 1,
    borderColor: CE.border,
    borderRadius: CER.card,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  cardPressed: { borderColor: CE.green },
  logo: {
    width: 56,
    height: 56,
    borderRadius: CER.icon,
    flexShrink: 0,
  },
  logoFallback: {
    backgroundColor: CE.shieldBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, minWidth: 0 },
  name: {
    color: CE.textPrimary,
    fontSize: 17,
    fontWeight: '700',
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
    color: CE.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  metaTextLink: {
    textDecorationLine: 'underline',
  },
});
