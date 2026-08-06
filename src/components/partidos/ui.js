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

import { partidos as P, partidosRadius as R } from '../../theme/colors';

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
      style={({ pressed }) => [{ borderRadius: R.input, overflow: 'hidden' }, off && { opacity: 0.45 }, pressed && !off && { opacity: 0.9 }, style]}
    >
      <LinearGradient
        colors={[P.green, P.greenDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[s.btnBase, { height }]}
      >
        {loading ? (
          <ActivityIndicator color={P.greenInk} size="small" />
        ) : (
          <>
            {Icon && !iconRight ? <Icon color={P.greenInk} size={18} strokeWidth={2.2} /> : null}
            <Text style={[s.btnLabel, { color: P.greenInk }]}>{label}</Text>
            {Icon && iconRight ? <Icon color={P.greenInk} size={18} strokeWidth={2.2} /> : null}
          </>
        )}
      </LinearGradient>
    </Pressable>
  );
}

export function GhostButton({ label, icon: Icon, onPress, disabled, style, height = 48, tone = 'neutral' }) {
  const color = tone === 'danger' ? P.coral : P.textStrong;
  const borderColor = tone === 'danger' ? P.coralBorder : P.borderStrong;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.btnBase,
        { height, borderRadius: R.input, borderWidth: 1, borderColor },
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
          borderRadius: R.input,
          backgroundColor: P.surface,
          borderWidth: 1,
          borderColor: P.border,
        },
        disabled && { opacity: 0.45 },
        pressed && !disabled && { opacity: 0.8 },
        style,
      ]}
    >
      {Icon ? <Icon color={P.green} size={17} strokeWidth={2} /> : null}
      <Text style={[s.btnLabel, { color: P.textStrong, fontSize: 13.5 }]}>{label}</Text>
    </Pressable>
  );
}

/** Botón informativo, deshabilitado a propósito (estado, no acción). */
export function StatusButton({ label, icon: Icon, tone = 'muted', height = 52, style }) {
  const map = {
    muted: { bg: P.chip, border: P.hairline, fg: P.textGhost },
    green: { bg: P.greenSoft, border: P.greenBorder, fg: P.green },
    gold: { bg: P.goldSoft, border: P.goldBorder, fg: P.gold },
    danger: { bg: P.coralSoft, border: P.coralBorder, fg: P.coral },
  }[tone] || { bg: P.chip, border: P.hairline, fg: P.textGhost };
  return (
    <View
      style={[
        s.btnBase,
        {
          height,
          borderRadius: R.input,
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
  const bg = tone === 'glass' ? 'rgba(255,255,255,0.07)' : P.surface;
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
          borderColor: P.border,
          alignItems: 'center',
          justifyContent: 'center',
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Icon color={P.text} size={18} strokeWidth={2} />
    </Pressable>
  );
}

// --------------------------------------------------------------- pills

export function Pill({ label, active, onPress, icon: Icon, style, flex }) {
  const content = (
    <>
      {Icon ? (
        <Icon color={active ? P.green : P.textMuted} size={11} strokeWidth={2.2} />
      ) : null}
      <Text
        numberOfLines={1}
        style={{
          fontSize: 12,
          fontWeight: '700',
          color: active ? P.green : '#8D958D',
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
          borderRadius: R.control,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active ? P.greenSoftStrong : P.chipAlt,
          borderWidth: 1,
          borderColor: active ? P.greenBorder : P.border,
        },
        flex ? { flex: 1 } : null,
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      <Text
        numberOfLines={1}
        style={{ fontSize: 12.5, fontWeight: '700', color: active ? P.text : '#8D958D' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Badge pequeño de metadatos (modalidad, nivel, duración…). */
export function Tag({ label, tone = 'neutral' }) {
  const map = {
    neutral: { bg: P.chip, fg: P.textDim },
    green: { bg: P.greenSoft, fg: P.green },
    gold: { bg: 'rgba(240,200,90,0.14)', fg: P.gold },
    danger: { bg: 'rgba(232,115,123,0.13)', fg: P.coral },
    solid: { bg: 'rgba(255,255,255,0.10)', fg: P.text },
  }[tone];
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: R.chipSm, backgroundColor: map.bg }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: map.fg }}>{label}</Text>
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
      <AlertCircle color={P.coral} size={13} strokeWidth={2.2} />
      <Text style={{ flex: 1, fontSize: 11.5, fontWeight: '600', color: P.coral }}>{children}</Text>
    </View>
  );
}

export function Note({ children, icon: Icon = Info, tone = 'plain' }) {
  if (tone === 'card') {
    return (
      <View style={s.noteCard}>
        <Icon color={P.green} size={15} strokeWidth={2} />
        <Text style={s.noteCardText}>{children}</Text>
      </View>
    );
  }
  return <Text style={s.note}>{children}</Text>;
}

/** Banda de aviso (ámbar, coral o verde). */
export function Callout({ title, text, tone = 'gold', icon: Icon, onPress, style }) {
  const map = {
    gold: { bg: P.goldSoft, border: P.goldBorder, fg: P.gold },
    green: { bg: 'rgba(90,224,106,0.10)', border: P.greenBorder, fg: P.green },
    danger: { bg: 'rgba(232,115,123,0.09)', border: P.coralBorder, fg: P.coral },
    neutral: { bg: P.surface, border: P.border, fg: P.textStrong },
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
        <Text style={{ fontSize: 13, fontWeight: '700', color: map.fg }}>{title}</Text>
        {text ? (
          <Text style={{ fontSize: 11.5, lineHeight: 17, color: '#8D958D', marginTop: 2 }}>{text}</Text>
        ) : null}
      </View>
    </Wrapper>
  );
}

// -------------------------------------------------------------- inputs

export function Input({ value, onChangeText, placeholder, error, keyboardType, multiline, maxLength, style, prefix, suffix }) {
  const borderColor = error ? P.coral : P.border;
  const bg = error ? 'rgba(232,115,123,0.06)' : P.surface;
  if (prefix || suffix) {
    return (
      <View style={[s.inputRow, { borderColor, borderWidth: error ? 1.5 : 1, backgroundColor: bg }, style]}>
        {prefix ? <Text style={s.affix}>{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={P.textPlaceholder}
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
      placeholderTextColor={P.textPlaceholder}
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
  const borderColor = error ? P.coral : P.border;
  const bg = error ? 'rgba(232,115,123,0.06)' : P.surface;
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
        {Icon ? <Icon color={P.textMuted} size={15} strokeWidth={2} /> : null}
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '600', color: value ? P.text : P.textPlaceholder }}>
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
          borderColor: P.textMuted,
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
        backgroundColor: value ? P.greenDark : P.track,
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
          borderRadius: R.input,
          backgroundColor: error ? 'rgba(232,115,123,0.06)' : P.surface,
          borderWidth: error ? 1.5 : 1,
          borderColor: error ? P.coral : selected ? P.greenBorder : P.border,
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
          borderColor: selected ? P.green : P.grip,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
      >
        {selected ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: P.green }} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '700', color: P.text }}>{label}</Text>
        {desc ? (
          <Text style={{ fontSize: 11.5, lineHeight: 17, color: P.textFaint, marginTop: 2 }}>{desc}</Text>
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
          backgroundColor: checked ? P.greenSoftStrong : 'transparent',
          borderWidth: 1,
          borderColor: checked ? P.greenBorder : P.borderStrong,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Check color={P.green} size={13} strokeWidth={3} /> : null}
      </View>
      <Text style={{ flex: 1, fontSize: 12.5, color: P.textStrong }}>{label}</Text>
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
        borderRadius: R.input,
        borderWidth: error ? 1.5 : 0,
        borderColor: error ? P.coral : 'transparent',
        backgroundColor: error ? 'rgba(232,115,123,0.06)' : 'transparent',
      }}
    >
      <Pressable
        onPress={dec}
        disabled={value <= min}
        accessibilityRole="button"
        accessibilityLabel="Quitar un cupo"
        style={({ pressed }) => [s.stepBtn, value <= min && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
      >
        <Minus color={P.green} size={20} strokeWidth={2.4} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ fontSize: 32, fontWeight: '800', color: P.text, lineHeight: 36 }}>{value}</Text>
        <Text style={{ fontSize: 10.5, fontWeight: '600', color: P.textFaint, letterSpacing: 0.6 }}>
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
        <Plus color={P.green} size={20} strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}

// -------------------------------------------------------------- varios

export function Card({ children, style, radius = R.card, padded = true }) {
  return (
    <View
      style={[
        {
          backgroundColor: P.surface,
          borderWidth: 1,
          borderColor: P.border,
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
        backgroundColor: P.surface,
        borderWidth: 1,
        borderColor: highlight ? 'rgba(90,224,106,0.30)' : P.hairline,
        borderRadius: R.input,
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
          fontWeight: '800',
          color: highlight ? P.green : P.text,
          textAlign: 'center',
        }}
      >
        {value}
      </Text>
      <Text style={{ fontSize: 9.5, fontWeight: '600', color: P.textFaint, textAlign: 'center' }}>
        {label}
      </Text>
    </View>
  );
}

/** Fila etiqueta/valor de las tarjetas de detalle y resumen. */
export function DetailRow({ label, value, tone = 'default', last }) {
  const fg = tone === 'green' ? P.green : tone === 'gold' ? P.gold : P.text;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 11,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: P.divider,
      }}
    >
      <Text style={{ fontSize: 12.5, color: P.textMuted, flexShrink: 0 }}>{label}</Text>
      <Text style={{ fontSize: 12.5, fontWeight: '700', color: fg, textAlign: 'right', flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

export function ProgressBar({ ratio, height = 6 }) {
  const pct = Math.max(0, Math.min(1, ratio || 0));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: P.chip, overflow: 'hidden' }}>
      <LinearGradient
        colors={[P.greenDark, P.green]}
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
          borderColor: ring ? P.surface : P.border,
        }}
      />
    );
  }
  return (
    <LinearGradient
      colors={tone === 'green' ? P.avatar : [P.chip, P.surface]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: ring ? 2 : 1,
        borderColor: ring ? P.surface : P.border,
      }}
    >
      <Text style={{ fontSize: size * 0.32, fontWeight: '700', color: P.green }}>{initials}</Text>
    </LinearGradient>
  );
}

export function Divider({ style }) {
  return <View style={[{ height: 1, backgroundColor: P.hairline }, style]} />;
}

const s = StyleSheet.create({
  btnBase: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnLabel: { fontSize: 15.5, fontWeight: '700' },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: R.pill,
    borderWidth: 1,
  },
  pillActive: { backgroundColor: P.greenSoft, borderColor: P.greenBorderStrong },
  pillIdle: { backgroundColor: 'transparent', borderColor: P.borderStrong },

  sectionLabel: { fontSize: 10.5, fontWeight: '700', color: P.textGhost, letterSpacing: 0.9 },
  sectionRight: { fontSize: 11.5, fontWeight: '600', color: P.textMuted },
  fieldLabel: { fontSize: 11.5, fontWeight: '600', color: P.textMuted },
  fieldHint: { fontWeight: '500', color: P.textGhost },
  fieldRight: { fontSize: 11, fontWeight: '600', color: P.textGhost },
  note: { fontSize: 11, lineHeight: 16.5, color: P.textGhost },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.hairline,
    borderRadius: R.input,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  noteCardText: { flex: 1, fontSize: 11.5, lineHeight: 17, color: '#8D958D' },

  input: {
    height: 48,
    paddingHorizontal: 13,
    borderRadius: R.input,
    fontSize: 14,
    fontWeight: '600',
    color: P.text,
    ...({ outlineStyle: 'none' }),
  },
  textarea: {
    minHeight: 88,
    paddingHorizontal: 13,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: R.input,
    fontSize: 13,
    lineHeight: 19,
    color: P.text,
    textAlignVertical: 'top',
    ...({ outlineStyle: 'none' }),
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 48,
    paddingHorizontal: 13,
    borderRadius: R.input,
  },
  inputInner: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '700',
    color: P.text,
    ...({ outlineStyle: 'none' }),
  },
  affix: { fontSize: 15, fontWeight: '700', color: P.textMuted },
  affixSmall: { fontSize: 11.5, fontWeight: '600', color: P.textGhost },

  stepBtn: {
    width: 46,
    height: 46,
    borderRadius: R.input,
    backgroundColor: P.chip,
    borderWidth: 1,
    borderColor: P.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOn: {
    width: 46,
    height: 46,
    borderRadius: R.input,
    backgroundColor: 'rgba(90,224,106,0.14)',
    borderWidth: 1,
    borderColor: P.greenBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
