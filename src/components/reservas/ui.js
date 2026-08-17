import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Modal } from 'react-native';
import { Minus, Plus, Info, AlertTriangle, X as XIcon } from 'lucide-react-native';

import {
  reservas as C,
  reservasRadius as R,
  reservasSizes as S,
  reservasFonts as F,
} from '../../theme/colors';

/**
 * Primitivas visuales del handoff de Reservas (`Reservas.dc.html`, 33
 * pantallas). Mismo criterio que `src/components/partidos/ui.js`: todo lo
 * que el diseño repite entre pantallas vive acá, con los tokens y radios
 * propios de este handoff (`theme/colors.js`: `reservas`/`reservasRadius`).
 *
 * Fuente Manrope cargada en App.js (ver `reservasFonts`) — el resto de la
 * app sigue en `System`, esto no la toca.
 */

// ------------------------------------------------------------------ Card

/** Contenedor base de tarjeta. `selected` aplica el fondo/borde verde de selección. */
export function Card({ children, style, radius = R.card, padded = true, selected = false, onPress }) {
  const base = [
    styles.card,
    { borderRadius: radius },
    selected && styles.cardSelected,
    padded && styles.cardPadded,
    style,
  ];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [...base, pressed && { opacity: 0.9 }]}
    >
      {children}
    </Pressable>
  );
}

// ---------------------------------------------------------------- Button

/**
 * `variant`: 'primary' (verde, CTA principal) | 'secondary' (superficie
 * elevada, CTA secundario) | 'destructive' (rojo, acciones irreversibles).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon: Icon,
  style,
}) {
  const off = disabled || loading;
  const isPrimary = variant === 'primary';
  const isDestructive = variant === 'destructive';

  const bg = isPrimary ? C.green : isDestructive ? C.red : C.surfaceAlt;
  const fg = isPrimary ? C.textOnGreen : isDestructive ? C.textOnRed : C.textPrimary;
  const height = isPrimary ? S.ctaPrimary : S.ctaSecondary;
  const radius = isPrimary ? R.ctaPrimary : R.ctaSecondary;
  const fontSize = isPrimary ? 16 : 15;
  const fontWeight = isPrimary ? F.extraBold : F.bold;

  return (
    <Pressable
      onPress={off ? undefined : onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      style={({ pressed }) => [
        styles.btnBase,
        { height, borderRadius: radius, backgroundColor: bg },
        off && styles.disabled,
        pressed && !off && { opacity: 0.85 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {Icon ? <Icon color={fg} size={18} strokeWidth={2.2} /> : null}
          <Text style={{ fontFamily: fontWeight, fontSize, color: fg }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

// ------------------------------------------------------------ IconButton

export function IconButton({ icon: Icon, onPress, accessibilityLabel, size = S.iconBtn, style }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.iconBtn,
        { width: size, height: size, borderRadius: R.iconBtn },
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      <Icon color={C.textPrimary} size={19} strokeWidth={2} />
    </Pressable>
  );
}

// ----------------------------------------------------------------- Chip

export function Chip({ label, active, onPress, icon: Icon, style }) {
  const content = (
    <>
      {Icon ? <Icon color={active ? C.textOnGreen : C.textSecondary} size={14} strokeWidth={2.2} /> : null}
      <Text
        numberOfLines={1}
        style={{
          fontFamily: F.bold,
          fontSize: 12.5,
          color: active ? C.textOnGreen : C.textSecondary,
        }}
      >
        {label}
      </Text>
    </>
  );
  const base = [styles.chip, active ? styles.chipActive : styles.chipIdle, style];
  if (!onPress) return <View style={base}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [...base, pressed && { opacity: 0.8 }]}
    >
      {content}
    </Pressable>
  );
}

// ---------------------------------------------------------------- Badge

/** `tone`: 'green' | 'red' | 'amber' | 'neutral'. */
export function Badge({ label, tone = 'green' }) {
  const map = {
    green: { bg: C.shieldBg, border: C.greenDeepBorder, fg: C.green },
    red: { bg: 'rgba(237,107,118,0.14)', border: 'rgba(237,107,118,0.4)', fg: C.red },
    amber: { bg: C.amberSoft, border: C.amberBorder, fg: C.textAmber },
    neutral: { bg: C.surfaceAlt, border: C.border, fg: C.textSecondary },
  }[tone];
  return (
    <View
      style={{
        height: S.badge,
        paddingHorizontal: 9,
        borderRadius: R.pill,
        borderWidth: 1,
        borderColor: map.border,
        backgroundColor: map.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily: F.extraBold,
          fontSize: 10,
          letterSpacing: 0.8,
          color: map.fg,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

// -------------------------------------------------------------- ListRow

/** Fila genérica: icono opcional + título/subtítulo + valor/chevron a la derecha. */
export function ListRow({ icon: Icon, title, subtitle, right, onPress, last, style }) {
  const content = (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: 1, borderBottomColor: C.dividerInner },
        style,
      ]}
    >
      {Icon ? (
        <View style={styles.rowIconWrap}>
          <Icon color={C.textSecondary} size={17} strokeWidth={2} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.textPrimary }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 2 }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && { opacity: 0.8 }}>
      {content}
    </Pressable>
  );
}

// --------------------------------------------------------------- SectionLabel

export function SectionLabel({ children, right }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <Text style={styles.sectionLabel}>{String(children).toUpperCase()}</Text>
      {right ? (
        <Text style={{ fontFamily: F.semiBold, fontSize: 11.5, color: C.textSecondary }}>{right}</Text>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Sheet

/** Hoja modal desde abajo, radio 24 en las esquinas superiores. */
export function Sheet({ visible, onClose, title, children }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose} />
      <View style={styles.sheetContainer}>
        {title ? (
          <View style={styles.sheetHeader}>
            <Text style={{ fontFamily: F.extraBold, fontSize: 17, color: C.textPrimary }}>{title}</Text>
            <IconButton icon={XIcon} onPress={onClose} accessibilityLabel="Cerrar" size={36} />
          </View>
        ) : null}
        {children}
      </View>
    </Modal>
  );
}

// --------------------------------------------------------------- Stepper

export function Stepper({ value, onChange, min = 1, max = 99, unitLabel }) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  return (
    <View style={styles.stepperRow}>
      <Pressable
        onPress={dec}
        disabled={value <= min}
        accessibilityRole="button"
        accessibilityLabel="Restar"
        style={({ pressed }) => [
          styles.stepBtn,
          value <= min && styles.disabled,
          pressed && value > min && { opacity: 0.75 },
        ]}
      >
        <Minus color={C.green} size={18} strokeWidth={2.4} />
      </Pressable>
      <View style={{ alignItems: 'center', minWidth: 56 }}>
        <Text style={{ fontFamily: F.extraBold, fontSize: 28, color: C.textPrimary, lineHeight: 32 }}>{value}</Text>
        {unitLabel ? (
          <Text style={{ fontFamily: F.bold, fontSize: 10.5, letterSpacing: 0.6, color: C.textMuted }}>
            {unitLabel}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={inc}
        disabled={value >= max}
        accessibilityRole="button"
        accessibilityLabel="Sumar"
        style={({ pressed }) => [
          styles.stepBtnOn,
          value >= max && styles.disabled,
          pressed && value < max && { opacity: 0.75 },
        ]}
      >
        <Plus color={C.green} size={18} strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}

// ------------------------------------------------------------ NoticeCard

/**
 * `tone`: 'info' (borde punteado, neutro) | 'quote' (barra verde a la
 * izquierda, para avisos obligatorios de cobro) | 'warning' (ámbar).
 */
export function NoticeCard({ children, tone = 'info', icon }) {
  if (tone === 'quote') {
    return (
      <View style={styles.noticeQuote}>
        <Text style={{ flex: 1, fontFamily: F.medium, fontSize: 13, lineHeight: 20.8, color: C.textQuote }}>
          {children}
        </Text>
      </View>
    );
  }
  if (tone === 'warning') {
    const Icon = icon || AlertTriangle;
    return (
      <View style={styles.noticeWarning}>
        <Icon color={C.textAmber} size={17} strokeWidth={2} style={{ marginTop: 1 }} />
        <Text style={{ flex: 1, fontFamily: F.medium, fontSize: 13, lineHeight: 20.8, color: C.textAmber }}>
          {children}
        </Text>
      </View>
    );
  }
  const Icon = icon || Info;
  return (
    <View style={styles.noticeInfo}>
      <Icon color={C.textSecondary} size={17} strokeWidth={2} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, fontFamily: F.medium, fontSize: 13, lineHeight: 20.8, color: C.textSecondary }}>
        {children}
      </Text>
    </View>
  );
}

// ------------------------------------------------------------------ CTA sticky

/** Envoltorio para el CTA fijo al fondo, con el degradado del handoff. */
export function StickyFooter({ children }) {
  return <View style={styles.stickyFooter}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardPadded: { padding: 16 },
  cardSelected: {
    backgroundColor: C.selectedBg,
    borderColor: C.green,
  },

  btnBase: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  disabled: { opacity: 0.45 },

  iconBtn: {
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: S.chip,
    paddingHorizontal: 13,
    borderRadius: R.pill,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: C.green, borderColor: C.green },
  chipIdle: { backgroundColor: C.surfaceAlt, borderColor: C.border },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  rowIconWrap: {
    width: 36,
    height: 36,
    borderRadius: R.iconBtn,
    backgroundColor: C.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionLabel: {
    fontFamily: F.bold,
    fontSize: 10.5,
    letterSpacing: 1.5,
    color: C.textSecondary,
  },

  sheetOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheetContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '85%',
    backgroundColor: C.surface,
    borderTopLeftRadius: R.hero,
    borderTopRightRadius: R.hero,
    padding: 20,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },

  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: R.iconBtn,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOn: {
    width: 40,
    height: 40,
    borderRadius: R.iconBtn,
    backgroundColor: C.shieldBg,
    borderWidth: 1,
    borderColor: C.greenDeepBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },

  noticeInfo: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: R.row,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: C.dashedBorder,
    backgroundColor: C.surface,
  },
  noticeQuote: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: R.row,
    backgroundColor: C.surface,
    borderLeftWidth: 3,
    borderLeftColor: C.green,
  },
  noticeWarning: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: R.row,
    borderWidth: 1,
    borderColor: C.amberBorder,
    backgroundColor: C.amberSoft,
  },

  stickyFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 18,
  },
});
