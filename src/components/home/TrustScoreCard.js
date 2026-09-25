import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  paleta as C,
} from '../../theme/colors';

/**
 * La reputación del jugador en la portada.
 *
 * `score` puede ser null —el perfil no llegó, o su carga falló—. Ese caso se
 * dibuja como hueco: «N.A.», barra vacía y sin etiqueta de nivel. Antes la
 * pantalla lo tapaba con un 100 y la tarjeta lo pintaba como reputación
 * perfecta; un dato que falta no es la mejor nota posible.
 *
 * El nombre y la etiqueta los decide quien llama, porque dependen de si
 * TrueScore está activo y de la tabla de niveles del servidor.
 */
export default function TrustScoreCard({
  score, max = 100, nombre = 'Tu Trust Score', matchesPlayed, reports = 0, tierLabel, onPress,
}) {
  const n = Number(score);
  const hay = score !== null && score !== undefined && Number.isFinite(n);
  const pct = hay ? Math.max(0, Math.min(100, (n / max) * 100)) : 0;
  return (
    <Pressable onPress={onPress}>
      <LinearGradient
        colors={C.metal}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="overflow-hidden rounded-[20px] border border-white/10 p-4"
      >
        <View>
          <Text className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-white/50">{nombre}</Text>
          <View className="mt-1 flex-row items-end gap-1">
            <Text
              className={`text-[42px] font-black leading-none tracking-tighter ${hay ? 'text-white' : 'text-white/35'}`}
            >
              {hay ? n : 'N.A.'}
            </Text>
            {hay ? (
              <Text className="mb-1.5 text-[17px] font-semibold text-white/35">/ {max}</Text>
            ) : null}
          </View>
        </View>

        <View className="mt-4 h-[7px] overflow-hidden rounded-full bg-white/8">
          {hay ? (
            <LinearGradient
              colors={['#0A7A3C', C.green]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ width: `${pct}%`, height: '100%', borderRadius: 999 }}
            />
          ) : null}
        </View>

        <View className="mt-3 flex-row items-center justify-between">
          <Text className="text-[12.5px] text-white/45">
            {hay
              ? `${matchesPlayed} partidos jugados · ${reports} reportes`
              : 'No pudimos cargar tu reputación'}
          </Text>
          {tierLabel ? (
            <Text className="text-[10.5px] font-bold tracking-[0.15em] text-verde">{tierLabel}</Text>
          ) : null}
        </View>
      </LinearGradient>
    </Pressable>
  );
}
