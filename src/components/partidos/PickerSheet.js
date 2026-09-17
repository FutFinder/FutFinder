import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { Check, Search } from 'lucide-react-native';

import Sheet from './Sheet';
import { GhostButton, PrimaryButton } from './ui';
import {
  paleta as C,
  radios as R,
  fuentes as F,
  alfa,
} from '../../theme/colors';

/**
 * Selector con búsqueda para listas largas (región, comuna, cancha…).
 *
 * `options` puede ser `string[]` o `{ value, label }[]`.
 * Confirma con «Aplicar» para que el usuario pueda cambiar de opinión sin
 * que el listado de atrás se recargue en cada toque.
 */
export default function PickerSheet({
  visible,
  onClose,
  onSelect,
  title,
  subtitle,
  options = [],
  value = null,
  searchPlaceholder = 'Buscar…',
  emptyText = 'Sin resultados',
  allowClear = false,
  clearLabel = 'Sin filtro',
}) {
  const [q, setQ] = useState('');
  const [temp, setTemp] = useState(value);

  // Al reabrir, partimos del valor vigente.
  React.useEffect(() => {
    if (visible) {
      setTemp(value);
      setQ('');
    }
  }, [visible, value]);

  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const list = useMemo(() => {
    const items = options.map((o) =>
      typeof o === 'string' ? { value: o, label: o } : o
    );
    const needle = norm(q.trim());
    if (!needle) return items;
    return items.filter((o) => norm(o.label).includes(needle));
  }, [options, q]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      maxHeightRatio={0.82}
      footer={
        <>
          <GhostButton label="Cancelar" onPress={onClose} height={46} style={{ flex: 1 }} />
          <PrimaryButton
            label="Aplicar"
            height={46}
            style={{ flex: 1.4 }}
            onPress={() => {
              onSelect(temp);
              onClose();
            }}
          />
        </>
      }
    >
      <View style={styles.search}>
        <Search color={C.textSecondary} size={15} strokeWidth={2} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={searchPlaceholder}
          placeholderTextColor={C.textPlaceholder}
          style={styles.searchInput}
          autoCorrect={false}
        />
      </View>

      {allowClear ? (
        <Row
          label={clearLabel}
          selected={temp == null}
          onPress={() => setTemp(null)}
        />
      ) : null}

      {list.length === 0 ? (
        <Text style={styles.empty}>{emptyText}</Text>
      ) : (
        list.map((o) => (
          <Row
            key={o.value}
            label={o.label}
            selected={temp === o.value}
            onPress={() => setTemp(o.value)}
          />
        ))
      )}
    </Sheet>
  );
}

function Row({ label, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.rowText, selected && { color: C.green, fontFamily: F.bold }]} numberOfLines={1}>
        {label}
      </Text>
      {selected ? <Check color={C.green} size={16} strokeWidth={2.6} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: C.chipAlt,
    borderWidth: 1,
    borderColor: alfa(C.tinta, 0.08),
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontFamily: F.medium,
    color: C.textPrimary,
    ...({ outlineStyle: 'none' }),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 12.5,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: C.divider,
    minHeight: 48,
  },
  rowText: { flex: 1, fontSize: 13.5, fontFamily: F.semiBold, color: C.textStrong },
  empty: { paddingVertical: 26, textAlign: 'center', fontSize: 12.5, color: C.textFaint },
});
