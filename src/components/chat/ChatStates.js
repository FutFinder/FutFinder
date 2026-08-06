import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { MessageSquare, RotateCw, TriangleAlert, WifiOff, Video, UserPlus } from 'lucide-react-native';

import { chatColors, dsRadius, dsSizes } from '../../theme/colors';

/**
 * Estados de sistema de la bandeja: cargando, vacía, error, sin conexión y
 * «nada en este filtro».
 *
 * Van juntos en un archivo porque comparten la misma caja centrada y siempre
 * se editan a la vez; separarlos en cinco archivos de 30 líneas solo
 * dispersaría la misma decisión de diseño.
 */

// ── Cargando: esqueleto de tres filas + texto ───────────────────
export function InboxSkeleton() {
  return (
    <View style={styles.skelWrap} accessibilityLabel="Cargando conversaciones">
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.skelCard}>
          <View style={styles.skelAvatar} />
          <View style={{ flex: 1, paddingTop: 4 }}>
            <View style={[styles.skelLine, { width: `${52 - i * 6}%`, height: 13 }]} />
            <View
              style={[styles.skelLine, { width: `${78 - i * 12}%`, height: 11, marginTop: 9, opacity: 0.7 }]}
            />
            {i < 2 && (
              <View
                style={[styles.skelLine, { width: '34%', height: 9, marginTop: 10, opacity: 0.5 }]}
              />
            )}
          </View>
        </View>
      ))}
      <View style={styles.skelFooter}>
        <ActivityIndicator color={chatColors.green} size="small" />
        <Text style={styles.skelFooterText}>Cargando conversaciones…</Text>
      </View>
    </View>
  );
}

// ── Bandeja vacía: cuenta nueva ─────────────────────────────────
export function InboxEmpty({ onSearchPlayers, onSearchMatches }) {
  return (
    <View style={styles.centered}>
      <View style={styles.bigIcon}>
        <MessageSquare color={chatColors.green} size={32} strokeWidth={1.6} />
      </View>
      <Text style={styles.bigTitle}>Aún no tienes conversaciones</Text>
      <Text style={styles.bigText}>
        Los chats aparecerán cuando te inscribas en un partido, te unas a un club o
        agregues amigos.
      </Text>

      <View style={styles.ctaColumn}>
        <Pressable
          onPress={onSearchPlayers}
          accessibilityRole="button"
          accessibilityLabel="Buscar jugadores"
          style={({ pressed }) => [styles.ctaPrimary, pressed && { opacity: 0.85 }]}
        >
          <UserPlus color={chatColors.inkOnGreen} size={18} strokeWidth={2} />
          <Text style={styles.ctaPrimaryText}>Buscar jugadores</Text>
        </Pressable>
        <Pressable
          onPress={onSearchMatches}
          accessibilityRole="button"
          accessibilityLabel="Buscar partidos"
          style={({ pressed }) => [styles.ctaOutline, pressed && { opacity: 0.8 }]}
        >
          <Video color={chatColors.green} size={18} strokeWidth={1.9} />
          <Text style={styles.ctaOutlineText}>Buscar partidos</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Error con reintento ─────────────────────────────────────────
export function InboxError({ code, onRetry }) {
  return (
    <View style={styles.centered}>
      <View style={[styles.bigIcon, styles.bigIconDanger]}>
        <TriangleAlert color={chatColors.danger} size={30} strokeWidth={1.7} />
      </View>
      <Text style={styles.bigTitle}>No pudimos cargar tus chats</Text>
      <Text style={styles.bigText}>Algo falló de nuestro lado. Tus mensajes están a salvo.</Text>

      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Reintentar la carga de conversaciones"
        style={({ pressed }) => [styles.ctaPrimary, styles.ctaStretch, pressed && { opacity: 0.85 }]}
      >
        <RotateCw color={chatColors.inkOnGreen} size={18} strokeWidth={2.2} />
        <Text style={styles.ctaPrimaryText}>Reintentar</Text>
      </Pressable>

      {!!code && <Text style={styles.errorCode}>Código {code}</Text>}
    </View>
  );
}

// ── Sin conexión: banner persistente sobre la lista ─────────────
export function OfflineBanner() {
  return (
    <View style={styles.offline} accessibilityRole="alert">
      <WifiOff color={chatColors.warn} size={17} strokeWidth={1.9} />
      <View style={{ flex: 1 }}>
        <Text style={styles.offlineTitle}>Sin conexión</Text>
        <Text style={styles.offlineText}>Estás viendo los últimos mensajes guardados.</Text>
      </View>
    </View>
  );
}

// ── Filtro sin resultados ───────────────────────────────────────
export function FilterEmpty({ filter, onExploreClubs }) {
  const copy = {
    partidos: {
      title: 'Todavía sin chats de partido',
      text: 'Inscríbete en un partido y su chat grupal aparecerá aquí.',
    },
    clubes: {
      title: 'Solo ves los clubes a los que perteneces',
      text: 'Únete a un club para tener su chat aquí.',
      action: 'Explorar clubes',
    },
    amigos: {
      title: 'Todavía no tienes chats con amigos',
      text: 'Agrega jugadores para hablar sin compartir tu número.',
    },
    todos: {
      title: 'Nada en este filtro',
      text: 'Prueba con otra categoría.',
    },
  }[filter] || { title: 'Nada en este filtro', text: 'Prueba con otra categoría.' };

  return (
    <View style={styles.dashed}>
      <Text style={styles.dashedTitle}>{copy.title}</Text>
      <Text style={styles.dashedText}>{copy.text}</Text>
      {copy.action && onExploreClubs && (
        <Pressable
          onPress={onExploreClubs}
          accessibilityRole="button"
          accessibilityLabel={copy.action}
          style={({ pressed }) => [styles.dashedBtn, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.dashedBtnText}>{copy.action}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Cargando
  skelWrap: { paddingHorizontal: dsSizes.gutter, gap: 8 },
  skelCard: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: dsRadius.xl,
    backgroundColor: '#0F110F',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  skelAvatar: { width: 46, height: 46, borderRadius: 15, backgroundColor: '#161916' },
  skelLine: { borderRadius: 7, backgroundColor: '#191C19' },
  skelFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 22,
  },
  skelFooterText: { color: 'rgba(255,255,255,0.4)', fontSize: 12.5, fontWeight: '700' },

  // Estados grandes centrados
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 38,
    paddingVertical: 40,
  },
  bigIcon: {
    width: 74,
    height: 74,
    borderRadius: 24,
    backgroundColor: 'rgba(90,224,106,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(90,224,106,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  bigIconDanger: {
    backgroundColor: chatColors.dangerSoft,
    borderColor: chatColors.dangerBorder,
  },
  bigTitle: {
    color: chatColors.textPrimary,
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  bigText: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13.5,
    lineHeight: 21,
    textAlign: 'center',
  },

  ctaColumn: { alignSelf: 'stretch', gap: 10, marginTop: 26 },
  ctaStretch: { alignSelf: 'stretch', marginTop: 24 },
  ctaPrimary: {
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: chatColors.green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  ctaPrimaryText: { color: chatColors.inkOnGreen, fontSize: 14, fontWeight: '800' },
  ctaOutline: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(90,224,106,0.45)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  ctaOutlineText: { color: chatColors.green, fontSize: 14, fontWeight: '800' },
  errorCode: {
    marginTop: 16,
    color: 'rgba(255,255,255,0.32)',
    fontSize: 11.5,
    fontWeight: '600',
  },

  // Sin conexión
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginHorizontal: dsSizes.gutter,
    marginBottom: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,190,90,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,190,90,0.32)',
  },
  offlineTitle: { color: chatColors.warn, fontSize: 12.5, fontWeight: '800' },
  offlineText: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11.5,
    fontWeight: '500',
  },

  // Filtro vacío
  dashed: {
    marginTop: 34,
    marginHorizontal: 10,
    padding: 16,
    borderRadius: dsRadius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: chatColors.border,
    alignItems: 'center',
  },
  dashedTitle: {
    color: chatColors.textPrimary,
    fontSize: 13.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  dashedText: {
    marginTop: 5,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  dashedBtn: {
    marginTop: 12,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(90,224,106,0.45)',
  },
  dashedBtnText: { color: chatColors.green, fontSize: 12.5, fontWeight: '800' },
});
