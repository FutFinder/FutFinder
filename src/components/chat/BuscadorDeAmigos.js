import React from 'react';
import { View, TextInput, Pressable, StyleSheet, Platform } from 'react-native';
import { Search, X } from 'lucide-react-native';

import { paleta as C, radios as R, fuentes as F } from '../../theme/colors';

/**
 * Buscador del filtro «Amigos» de la bandeja. Filtra en el cliente por
 * nombre de usuario (sin tildes ni mayúsculas, ver `utils/amigosDelChat`):
 * la lista de amigos ya está entera en memoria, así que no consulta nada.
 * Mismo aspecto que el buscador de miembros del club.
 */
export default function BuscadorDeAmigos({ value, onChange }) {
  return (
    <View style={styles.box}>
      <Search color={C.textSecondary} size={18} strokeWidth={2} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Buscar entre tus amigos"
        placeholderTextColor={C.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Buscar entre tus amigos"
        style={styles.input}
      />
      {value.length > 0 && (
        <Pressable
          onPress={() => onChange('')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Borrar la búsqueda"
          style={styles.clear}
        >
          <X color={C.textSecondary} size={14} strokeWidth={2.4} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.iconBtn,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    color: C.textPrimary,
    fontSize: 14,
    fontFamily: F.semiBold,
    // El borde de la caja ya marca el campo; el contorno del navegador no.
    ...Platform.select({ web: { outlineStyle: 'none' } }),
  },
  clear: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
