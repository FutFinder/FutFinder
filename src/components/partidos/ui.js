import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Minus, Plus, AlertCircle, Info } from 'lucide-react-native';

import {
  reservas as C,
  reservasRadius as R,
  reservasFonts as F,
} from '../../theme/colors';

/**
 * Primitivas visuales del módulo Partidos (handoff `Partidos.dc.html`).
 *
 * Todo lo que el diseño repite entre pantallas vive acá: botones ≥48 px,
 * pills, celdas de resumen, labels de sección, radios, steppers y notas.
 * Las pantallas no vuelven a declarar estos estilos.
 */

// ------------------------------------------------------------- botones

export function PrimaryButton({ label, icon: Icon, iconRight, onPress, disabled, loading, style, height = 52 }) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      style={({ pressed }) => [{ borderRadius: R.row, overflow: 'hidden' }, off && { opacity: 0.45 }, pressed && !off && { opacity: 0.9 }, style]}
    >
      <LinearGradient
        colors={[C.green, C.greenDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[s.btnBase, { height }]}
      >
        {loading ? (
          <ActivityIndicator color={C.greenInk} size="small" />
        ) : (
          <>
            {Icon && !iconRight ? <Icon color={C.greenInk} size={18} strokeWidth={2.2} /> : null}
            <Text style={[s.btnLabel, { color: C.greenInk }]}>{label}</Text>
            {Icon && iconRight ? <Icon color={C.greenInk} size={18} strokeWidth={2.2} /> : null}
          </>
        )}
      </LinearGradient>
    </Pressable>
  );
}

export function GhostButton({ label, icon: Icon, onPress, disabled, style, height = 48, tone = 'neutral' }) {
  const color = tone === 'danger' ? C.red : C.textStrong;
  const borderColor = tone === 'danger' ? C.redBorder : C.borderStrong;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.btnBase,
        { height, borderRadius: R.row, borderWidth: 1, borderColor },
        disabled && { opacity: 0.45 },
        pressed && !disabled && { opacity: 0.75 },
        style,
      ]}
    >
      {Icon ? <Icon color={color} size={17} strokeWidth={2} /> : null}
      <Text style={[s.btnLabel, { color, fontSize: 14 }]}>{label}</Text>
    </Pressable>
  );
}

export function SurfaceButton({ label, icon: Icon, onPress, disabled, style, height = 48 }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.btnBase,
        {
          height,
          borderRadius: R.row,
          backgroundColor: C.surface,
          borderWidth: 1,
          borderColor: C.border,
        },
        disabled && { opacity: 0.45 },
        pressed && !disabled && { opacity: 0.8 },
        style,
      ]}
    >
      {Icon ? <Icon color={C.green} size={17} strokeWidth={2} /> : null}
      <Text style={[s.btnLabel, { color: C.textStrong, fontSize: 13.5 }]}>{label}</Text>
    </Pressable>
  );
}

/** Botón informativo, deshabilitado a propósito (estado, no acción). */
export function StatusButton({ label, icon: Icon, tone = 'muted', height = 52, style }) {
  const map = {
    muted: { bg: C.chip, border: C.hairline, fg: C.textGhost },
    green: { bg: C.greenSoft, border: C.greenBorder, fg: C.green },
    gold: { bg: C.goldSoft, border: C.goldBorder, fg: C.gold },
    danger: { bg: C.redSoft, border: C.redBorder, fg: C.red },
  }[tone] || { bg: C.chip, border: C.hairline, fg: C.textGhost };
  return (
    <View
      style={[
        s.btnBase,
        {
          height,
          borderRadius: R.row,
          backgroundColor: map.bg,
          borderWidth: 1,
          borderColor: map.border,
        },
        style,
      ]}
    >
      {Icon ? <Icon color={map.fg} size={17} strokeWidth={2} /> : null}
      <Text style={[s.btnLabel, { color: map.fg, fontSize: 15 }]}>{label}</Text>
    </View>
  );
}

/** Botón cuadrado de la barra superior. */
export function IconButton({ icon: Icon, onPress, tone = 'glass', size = 36, accessibilityLabel }) {
  const bg = tone === 'glass' ? 'rgba(255,255,255,0.07)' : C.surface;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: 12,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: C.border,
          alignItems: 'center',
          justifyContent: 'center',
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Icon color={C.textPrimary} size={18} strokeWidth={2} />
    </Pressable>
  );
}

// --------------------------------------------------------------- pills

export function Pill({ label, active, onPress, icon: Icon, style, flex }) {
  const content = (
    <>
      {Icon ? (
        <Icon color={active ? C.green : C.textSecondary} size={11} strokeWidth={2.2} />
      ) : null}
      <Text
        numberOfLines={1}
        style={{
          fontSize: 12,
          fontFamily: F.bold,
          color: active ? C.green : '#8D958D',
        }}
      >
        {label}
      </Text>
    </>
  );
  const base = [
    s.pill,
    active ? s.pillActive : s.pillIdle,
    flex ? { flex: 1, justifyContent: 'center' } : null,
    style,
  ];
  if (!onPress) return <View style={base}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [...base, pressed && { opacity: 0.75 }]}
    >
      {content}
    </Pressable>
  );
}

/** Chip cuadrado de opción (filtros, duraciones, presets). */
export function OptionChip({ label, active, onPress, flex, height = 40, style }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [
        {
          height,
          paddingHorizontal: 13,
          borderRadius: R.iconBtn,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active ? C.greenSoftStrong : C.chipAlt,
          borderWidth: 1,
          borderColor: active ? C.greenBorder : C.border,
        },
        flex ? { flex: 1 } : null,
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      <Text
        numberOfLines={1}
        style={{ fontSize: 12.5, fontFamily: F.bold, color: active ? C.textPrimary : '#8D958D' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Badge pequeño de metadatos (modalidad, nivel, duración…). */
export function Tag({ label, tone = 'neutral' }) {
  const map = {
    neutral: { bg: C.chip, fg: C.textDim },
    green: { bg: C.greenSoft, fg: C.green },
    gold: { bg: 'rgba(240,200,90,0.14)', fg: C.gold },
    danger: { bg: 'rgba(237,107,118,0.13)', fg: C.red },
    solid: { bg: 'rgba(255,255,255,0.10)', fg: C.textPrimary },
  }[tone];
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: R.chip, backgroundColor: map.bg }}>
      <Text style={{ fontSize: 11, fontFamily: F.bold, color: map.fg }}>{label}</Text>
    </View>
  );
}

// ------------------------------------------------------------ tipografía

export function SectionLabel({ children, right }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <Text style={s.sectionLabel}>{String(children).toUpperCase()}</Text>
      {right ? <Text style={s.sectionRight}>{right}</Text> : null}
    </View>
  );
}

export function FieldLabel({ children, hint, right }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <Text style={s.fieldLabel}>
        {children}
        {hint ? <Text style={s.fieldHint}>{` · ${hint}`}</Text> : null}
      </Text>
      {right ? <Text style={s.fieldRight}>{right}</Text> : null}
    </View>
  );
}

export function ErrorHint({ children }) {
  if (!children) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <AlertCircle color={C.red} size={13} strokeWidth={2.2} />
      <Text style={{ flex: 1, fontSize: 11.5, fontFamily: F.semiBold, color: C.red }}>{children}</Text>
    </View>
  );
}

export function Note({ children, icon: Icon = Info, tone = 'plain' }) {
  if (tone === 'card') {
    return (
      <View style={s.noteCard}>
        <Icon color={C.green} size={15} strokeWidth={2} />
        <Text style={s.noteCardText}>{children}</Text>
      </View>
    );
  }
  return <Text style={s.note}>{children}</Text>;
}

/** Banda de aviso (ámbar, coral o verde). */
export function Callout({ title, text, tone = 'gold', icon: Icon, onPress, style }) {
  const map = {
    gold: { bg: C.goldSoft, border: C.goldBorder, fg: C.gold },
    green: { bg: 'rgba(85,223,105,0.10)', border: C.greenBorder, fg: C.green },
    danger: { bg: 'rgba(237,107,118,0.09)', border: C.redBorder, fg: C.red },
    neutral: { bg: C.surface, border: C.border, fg: C.textStrong },
  }[tone];
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress}
      style={({ pressed } = {}) => [
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 10,
          backgroundColor: map.bg,
          borderWidth: 1,
          borderColor: map.border,
          borderRadius: 16,
          padding: 13,
        },
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      {Icon ? <Icon color={map.fg} size={17} strokeWidth={2} style={{ marginTop: 1 }} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontFamily: F.bold, color: map.fg }}>{title}</Text>
        {text ? (
          <Text style={{ fontSize: 11.5, lineHeight: 17, color: '#8D958D', marginTop: 2 }}>{text}</Text>
        ) : null}
      </View>
    </Wrapper>
  );
}

// -------------------------------------------------------------- inputs

export function Input({ value, onChangeText, placeholder, error, keyboardType, multiline, maxLength, style, prefix, suffix }) {
  const borderColor = error ? C.red : C.border;
  const bg = error ? 'rgba(237,107,118,0.06)' : C.surface;
  if (prefix || suffix) {
    return (
      <View style={[s.inputRow, { borderColor, borderWidth: error ? 1.5 : 1, backgroundColor: bg }, style]}>
        {prefix ? <Text style={s.affix}>{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={C.textPlaceholder}
          keyboardType={keyboardType}
          maxLength={maxLength}
          style={s.inputInner}
        />
        {suffix ? <Text style={s.affixSmall}>{suffix}</Text> : null}
      </View>
    );
  }
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={C.textPlaceholder}
      keyboardType={keyboardType}
      multiline={multiline}
      maxLength={maxLength}
      style={[
        multiline ? s.textarea : s.input,
        { borderColor, borderWidth: error ? 1.5 : 1, backgroundColor: bg },
        style,
      ]}
    />
  );
}

/** Campo que abre un selector (región, comuna, fecha, hora). */
export function SelectField({ value, placeholder, onPress, error, icon: Icon, chevron = true }) {
  const borderColor = error ? C.red : C.border;
  const bg = error ? 'rgba(237,107,118,0.06)' : C.surface;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.inputRow,
        { borderColor, borderWidth: error ? 1.5 : 1, backgroundColor: bg, justifyContent: 'space-between' },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
        {Icon ? <Icon color={C.textSecondary} size={15} strokeWidth={2} /> : null}
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: F.semiBold, color: value ? C.textPrimary : C.textPlaceholder }}>
          {value || placeholder}
        </Text>
      </View>
      {chevron ? <Chevron /> : null}
    </Pressable>
  );
}

function Chevron() {
  return (
    <View style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRightWidth: 1.8,
          borderBottomWidth: 1.8,
          borderColor: C.textSecondary,
          transform: [{ rotate: '45deg' }],
          marginTop: -3,
        }}
      />
    </View>
  );
}

export function Toggle({ value, onValueChange, accessibilityLabel }) {
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: !!value }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={{
        width: 42,
        height: 24,
        borderRadius: 12,
        backgroundColor: value ? C.greenDark : C.track,
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: '#FFFFFF',
          marginLeft: value ? 20 : 2,
        }}
      />
    </Pressable>
  );
}

export function RadioRow({ label, desc, selected, onPress, error }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 11,
          padding: 13,
          borderRadius: R.row,
          backgroundColor: error ? 'rgba(237,107,118,0.06)' : C.surface,
          borderWidth: error ? 1.5 : 1,
          borderColor: error ? C.red : selected ? C.greenBorder : C.border,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View
        style={{
          width: 19,
          height: 19,
          borderRadius: 10,
          borderWidth: 2,
          borderColor: selected ? C.green : C.grip,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
      >
        {selected ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: C.green }} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13.5, fontFamily: F.bold, color: C.textPrimary }}>{label}</Text>
        {desc ? (
          <Text style={{ fontSize: 11.5, lineHeight: 17, color: C.textFaint, marginTop: 2 }}>{desc}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function CheckRow({ label, checked, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!checked }}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          backgroundColor: checked ? C.greenSoftStrong : 'transparent',
          borderWidth: 1,
          borderColor: checked ? C.greenBorder : C.borderStrong,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Check color={C.green} size={13} strokeWidth={3} /> : null}
      </View>
      <Text style={{ flex: 1, fontSize: 12.5, color: C.textStrong }}>{label}</Text>
    </Pressable>
  );
}

export function Stepper({ value, onChange, min = 1, max = 30, error }) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: error ? 9 : 0,
        borderRadius: R.row,
        borderWidth: error ? 1.5 : 0,
        borderColor: error ? C.red : 'transparent',
        backgroundColor: error ? 'rgba(237,107,118,0.06)' : 'transparent',
      }}
    >
      <Pressable
        onPress={dec}
        disabled={value <= min}
        accessibilityRole="button"
        accessibilityLabel="Quitar un cupo"
        style={({ pressed }) => [s.stepBtn, value <= min && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
      >
        <Minus color={C.green} size={20} strokeWidth={2.4} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ fontSize: 32, fontFamily: F.extraBold, color: C.textPrimary, lineHeight: 36 }}>{value}</Text>
        <Text style={{ fontSize: 10.5, fontFamily: F.semiBold, color: C.textFaint, letterSpacing: 0.6 }}>
          {value === 1 ? 'CUPO' : 'CUPOS'}
        </Text>
      </View>
      <Pressable
        onPress={inc}
        disabled={value >= max}
        accessibilityRole="button"
        accessibilityLabel="Agregar un cupo"
        style={({ pressed }) => [s.stepBtnOn, value >= max && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
      >
        <Plus color={C.green} size={20} strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}

// -------------------------------------------------------------- varios

export function Card({ children, style, radius = R.cardSm, padded = true }) {
  return (
    <View
      style={[
        {
          backgroundColor: C.surface,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: radius,
        },
        padded && { padding: 13 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Celda del resumen de 4 columnas del detalle. */
export function StatCell({ value, label, highlight, small }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.surface,
        borderWidth: 1,
        borderColor: highlight ? 'rgba(85,223,105,0.30)' : C.hairline,
        borderRadius: R.row,
        paddingVertical: 10,
        paddingHorizontal: 6,
        alignItems: 'center',
        gap: 3,
      }}
    >
      <Text
        numberOfLines={2}
        style={{
          fontSize: small ? 12 : 15,
          fontFamily: F.extraBold,
          color: highlight ? C.green : C.textPrimary,
          textAlign: 'center',
        }}
      >
        {value}
      </Text>
      <Text style={{ fontSize: 9.5, fontFamily: F.semiBold, color: C.textFaint, textAlign: 'center' }}>
        {label}
      </Text>
    </View>
  );
}

/** Fila etiqueta/valor de las tarjetas de detalle y resumen. */
export function DetailRow({ label, value, tone = 'default', last }) {
  const fg = tone === 'green' ? C.green : tone === 'gold' ? C.gold : C.textPrimary;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 11,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: C.divider,
      }}
    >
      <Text style={{ fontSize: 12.5, color: C.textSecondary, flexShrink: 0 }}>{label}</Text>
      <Text style={{ fontSize: 12.5, fontFamily: F.bold, color: fg, textAlign: 'right', flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

export function ProgressBar({ ratio, height = 6 }) {
  const pct = Math.max(0, Math.min(1, ratio || 0));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: C.chip, overflow: 'hidden' }}>
      <LinearGradient
        colors={[C.greenDark, C.green]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ width: `${pct * 100}%`, height: '100%' }}
      />
    </View>
  );
}

export function Avatar({ url, name, size = 32, ring, tone = 'green' }) {
  const initials = (name || '?')
    .replace(/^@/, '')
    .split(/[\s._-]+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: ring ? 2 : 1,
          borderColor: ring ? C.surface : C.border,
        }}
      />
    );
  }
  return (
    <LinearGradient
      colors={tone === 'green' ? C.avatar : [C.chip, C.surface]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: ring ? 2 : 1,
        borderColor: ring ? C.surface : C.border,
      }}
    >
      <Text style={{ fontSize: size * 0.32, fontFamily: F.bold, color: C.green }}>{initials}</Text>
    </LinearGradient>
  );
}

export function Divider({ style }) {
  return <View style={[{ height: 1, backgroundColor: C.hairline }, style]} />;
}

const s = StyleSheet.create({
  btnBase: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnLabel: { fontSize: 15.5, fontFamily: F.bold },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: R.pill,
    borderWidth: 1,
  },
  pillActive: { backgroundColor: C.greenSoft, borderColor: C.greenBorderStrong },
  pillIdle: { backgroundColor: 'transparent', borderColor: C.borderStrong },

  sectionLabel: { fontSize: 10.5, fontFamily: F.bold, color: C.textGhost, letterSpacing: 0.9 },
  sectionRight: { fontSize: 11.5, fontFamily: F.semiBold, color: C.textSecondary },
  fieldLabel: { fontSize: 11.5, fontFamily: F.semiBold, color: C.textSecondary },
  fieldHint: { fontFamily: F.medium, color: C.textGhost },
  fieldRight: { fontSize: 11, fontFamily: F.semiBold, color: C.textGhost },
  note: { fontSize: 11, lineHeight: 16.5, color: C.textGhost },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.hairline,
    borderRadius: R.row,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  noteCardText: { flex: 1, fontSize: 11.5, lineHeight: 17, color: '#8D958D' },

  input: {
    height: 48,
    paddingHorizontal: 13,
    borderRadius: R.row,
    fontSize: 14,
    fontFamily: F.semiBold,
    color: C.textPrimary,
    ...({ outlineStyle: 'none' }),
  },
  textarea: {
    minHeight: 88,
    paddingHorizontal: 13,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: R.row,
    fontSize: 13,
    lineHeight: 19,
    color: C.textPrimary,
    textAlignVertical: 'top',
    ...({ outlineStyle: 'none' }),
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 48,
    paddingHorizontal: 13,
    borderRadius: R.row,
  },
  inputInner: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontFamily: F.bold,
    color: C.textPrimary,
    ...({ outlineStyle: 'none' }),
  },
  affix: { fontSize: 15, fontFamily: F.bold, color: C.textSecondary },
  affixSmall: { fontSize: 11.5, fontFamily: F.semiBold, color: C.textGhost },

  stepBtn: {
    width: 46,
    height: 46,
    borderRadius: R.row,
    backgroundColor: C.chip,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOn: {
    width: 46,
    height: 46,
    borderRadius: R.row,
    backgroundColor: 'rgba(85,223,105,0.14)',
    borderWidth: 1,
    borderColor: C.greenBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
