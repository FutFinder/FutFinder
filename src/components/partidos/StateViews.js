import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  CloudOff,
  MapPinOff,
  SearchX,
  ServerCrash,
  Trophy,
} from 'lucide-react-native';

import { GhostButton, PrimaryButton, SurfaceButton, Note } from './ui';
import { partidos as P, partidosRadius as R } from '../../theme/colors';
import { cacheAgeLabel } from '../../services/connectivity';

/**
 * Estados del sistema del módulo Partidos.
 *
 * Cada situación tiene su propio mensaje y su propia salida — nunca se
 * reutiliza un texto genérico para problemas distintos:
 *   · `LoadingList`   → skeletons mientras carga
 *   · `ErrorState`    → falló el servidor, con «Reintentar»
 *   · `OfflineNotice` → sin conexión, mostrando la copia en caché
 *   · `NoLocationState` → ubicación desactivada, con alternativa manual
 *   · `EmptyByFilters`  → hay partidos, pero los filtros los dejaron fuera
 *   · `EmptyByRegion`   → nadie ha publicado en esta zona
 */

export function LoadingList({ count = 3 }) {
  return (
    <View style={{ gap: 9 }} accessibilityLabel="Cargando partidos">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.skeleton}>
          <View style={[styles.bone, { width: 96, height: 22, borderRadius: 9 }]} />
          <View style={[styles.bone, { width: '72%', height: 18 }]} />
          <View style={[styles.bone, { width: '52%', height: 13 }]} />
          <View style={{ flexDirection: 'row', gap: 5 }}>
            <View style={[styles.bone, { width: 64, height: 20, borderRadius: 7 }]} />
            <View style={[styles.bone, { width: 76, height: 20, borderRadius: 7 }]} />
            <View style={[styles.bone, { width: 44, height: 20, borderRadius: 7 }]} />
          </View>
          <View style={[styles.bone, { width: '100%', height: 1, borderRadius: 0 }]} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={[styles.bone, { width: 118, height: 16 }]} />
            <View style={[styles.bone, { width: 88, height: 34, borderRadius: 11 }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function LoadingDetail() {
  return (
    <View style={{ gap: 12 }} accessibilityLabel="Cargando el partido">
      <View style={[styles.bone, { height: 168, borderRadius: 0 }]} />
      <View style={{ flexDirection: 'row', gap: 7, paddingHorizontal: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.bone, { flex: 1, height: 62, borderRadius: 14 }]} />
        ))}
      </View>
      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        <View style={[styles.bone, { height: 150, borderRadius: 20 }]} />
        <View style={[styles.bone, { height: 210, borderRadius: 20 }]} />
      </View>
    </View>
  );
}

export function ErrorState({
  onRetry,
  onOpenSaved,
  savedCount = 0,
  detail,
  /** Permite especializar el estado: un partido que ya no existe no es «no
   *  pudimos cargar», y ahí reintentar no sirve de nada. */
  title,
  icon: Icon = ServerCrash,
  actionLabel = 'Reintentar',
  onAction,
}) {
  const primary = onAction || onRetry;
  return (
    <View style={styles.box}>
      <View style={styles.icon}>
        <Icon color={P.textPlaceholder} size={26} strokeWidth={1.8} />
      </View>
      <Text style={styles.title}>{title || 'No pudimos cargar los partidos'}</Text>
      <Text style={styles.text}>
        {detail ||
          'El servidor no respondió. No es tu conexión: vuelve a intentarlo en unos segundos.'}
      </Text>
      {primary ? (
        <PrimaryButton label={actionLabel} onPress={primary} height={48} style={{ alignSelf: 'stretch', marginTop: 14 }} />
      ) : null}
      {savedCount > 0 && onOpenSaved ? (
        <GhostButton
          label={`Ver los ${savedCount} partidos guardados`}
          onPress={onOpenSaved}
          height={44}
          style={{ alignSelf: 'stretch', marginTop: 9 }}
        />
      ) : null}
    </View>
  );
}

/** Banda superior cuando estamos mostrando caché. */
export function OfflineNotice({ at, onRetry }) {
  return (
    <View style={styles.offline}>
      <CloudOff color={P.gold} size={16} strokeWidth={2} />
      <View style={{ flex: 1 }}>
        <Text style={styles.offlineTitle}>Sin conexión</Text>
        <Text style={styles.offlineText}>
          Estás viendo los partidos guardados {cacheAgeLabel(at)}. Las acciones que
          necesitan red están desactivadas.
        </Text>
      </View>
      {onRetry ? (
        <GhostButton label="Reintentar" onPress={onRetry} height={36} style={{ paddingHorizontal: 12 }} />
      ) : null}
    </View>
  );
}

export function NoLocationState({ onEnable, onPickManually, regionLabel }) {
  return (
    <View style={styles.box}>
      <View style={styles.icon}>
        <MapPinOff color={P.textPlaceholder} size={26} strokeWidth={1.8} />
      </View>
      <Text style={styles.title}>Ubicación desactivada</Text>
      <Text style={styles.text}>
        Sin ubicación no podemos calcular la distancia ni ordenar por cercanía. Puedes
        activarla o elegir tu zona a mano.
      </Text>
      <PrimaryButton
        label="Activar ubicación"
        onPress={onEnable}
        height={48}
        style={{ alignSelf: 'stretch', marginTop: 14 }}
      />
      <GhostButton
        label={regionLabel ? `Cambiar zona · ${regionLabel}` : 'Elegir región y comuna'}
        onPress={onPickManually}
        height={44}
        style={{ alignSelf: 'stretch', marginTop: 9 }}
      />
      <Note>Tu ubicación se usa solo en tu dispositivo. Nunca se comparte con otros usuarios.</Note>
    </View>
  );
}

export function EmptyByFilters({ suggestions = [], onClearFilters, onPublish }) {
  return (
    <View style={styles.box}>
      <View style={styles.icon}>
        <SearchX color={P.textPlaceholder} size={26} strokeWidth={1.8} />
      </View>
      <Text style={styles.title}>No encontramos partidos</Text>
      <Text style={styles.text}>
        Hay partidos publicados, pero ninguno cumple estos filtros. Prueba ampliando la
        distancia o el día.
      </Text>

      {suggestions.length > 0 ? (
        <View style={styles.suggestions}>
          <Text style={styles.suggestionsLabel}>SUGERENCIAS</Text>
          {suggestions.map((s, i) => (
            <View key={s.label}>
              {i > 0 ? <View style={styles.suggestionDivider} /> : null}
              <View style={styles.suggestionRow}>
                <Text style={styles.suggestionText}>{s.label}</Text>
                <Text style={styles.suggestionCount}>
                  {s.count} {s.count === 1 ? 'partido' : 'partidos'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <PrimaryButton
        label="Limpiar filtros"
        onPress={onClearFilters}
        height={48}
        style={{ alignSelf: 'stretch', marginTop: 14 }}
      />
      <GhostButton
        label="Publicar mi partido"
        onPress={onPublish}
        height={44}
        style={{ alignSelf: 'stretch', marginTop: 9 }}
      />
    </View>
  );
}

export function EmptyByRegion({ regionLabel, onPublish, onChangeRegion }) {
  return (
    <View style={styles.box}>
      <View style={styles.icon}>
        <Trophy color={P.textPlaceholder} size={26} strokeWidth={1.8} />
      </View>
      <Text style={styles.title}>Todavía no hay partidos aquí</Text>
      <Text style={styles.text}>
        Nadie ha publicado un partido abierto{regionLabel ? ` en ${regionLabel}` : ''}. Sé el
        primero: los jugadores cercanos lo verán al instante.
      </Text>
      <PrimaryButton
        label="Publicar mi partido"
        onPress={onPublish}
        height={48}
        style={{ alignSelf: 'stretch', marginTop: 14 }}
      />
      <GhostButton
        label="Cambiar de región"
        onPress={onChangeRegion}
        height={44}
        style={{ alignSelf: 'stretch', marginTop: 9 }}
      />
    </View>
  );
}

/** Estado vacío genérico para las listas internas (solicitudes, plantel…). */
export function InlineEmpty({ icon: Icon = SearchX, title, text, action, onAction }) {
  return (
    <View style={{ alignItems: 'center', gap: 8, paddingVertical: 38, paddingHorizontal: 20 }}>
      <View style={[styles.icon, { width: 58, height: 58, borderRadius: 20, marginBottom: 4 }]}>
        <Icon color={P.textPlaceholder} size={22} strokeWidth={1.8} />
      </View>
      <Text style={[styles.title, { fontSize: 16 }]}>{title}</Text>
      {text ? <Text style={styles.text}>{text}</Text> : null}
      {action ? (
        <SurfaceButton label={action} onPress={onAction} height={44} style={{ marginTop: 8, paddingHorizontal: 18 }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.hairline,
    borderRadius: R.list,
    padding: 13,
    gap: 9,
  },
  bone: { backgroundColor: P.chip, borderRadius: 6, opacity: 0.6 },

  box: {
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 30,
  },
  icon: {
    width: 66,
    height: 66,
    borderRadius: 22,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: P.text, textAlign: 'center' },
  text: {
    fontSize: 13,
    lineHeight: 20,
    color: P.textFaint,
    textAlign: 'center',
    marginTop: 6,
  },

  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: P.goldSoft,
    borderWidth: 1,
    borderColor: P.goldBorder,
    borderRadius: R.input,
    padding: 12,
  },
  offlineTitle: { fontSize: 12.5, fontWeight: '700', color: P.gold },
  offlineText: { fontSize: 11, lineHeight: 16, color: '#8D958D', marginTop: 1 },

  suggestions: {
    alignSelf: 'stretch',
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.hairline,
    borderRadius: 16,
    padding: 13,
    marginTop: 16,
    gap: 9,
  },
  suggestionsLabel: { fontSize: 10.5, fontWeight: '700', color: P.textGhost, letterSpacing: 0.9 },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  suggestionText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: P.textStrong },
  suggestionCount: { fontSize: 11.5, fontWeight: '700', color: P.green },
  suggestionDivider: { height: 1, backgroundColor: P.divider, marginVertical: 9 },
});
