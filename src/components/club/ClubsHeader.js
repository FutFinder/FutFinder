import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Search, Bell } from 'lucide-react-native';

import { temaClub } from '../../theme/clubThemes';
import { clubSuperficies } from '../../theme/colors';

/**
 * Cabecera fija de la portada de Clubes.
 *
 * El subtítulo es el que dice en qué situación está el usuario —un club, el
 * activo de varios, una solicitud esperando, o ninguno— y lo redacta el
 * llamador: acá no se adivina, porque esa frase depende de `membership` y de
 * cuántos clubes hay, dos datos que la portada ya tiene resueltos.
 *
 * El punto de pendientes va sobre la campana y no sobre la lupa: los avisos
 * son lo que puede tener algo sin leer. Lleva un borde del color del fondo
 * del botón para que se recorte contra el icono en vez de mancharlo.
 *
 * @param {string} [titulo='Clubes']
 * @param {string} [subtitulo]
 * @param {object} [tema]           Escala de `theme/clubThemes.js`.
 * @param {boolean} [hayPendientes] Pinta el punto sobre la campana.
 * @param {Function} [onBuscar]
 * @param {Function} [onAvisos]
 */
export default function ClubsHeader({
  titulo = 'Clubes',
  subtitulo,
  tema,
  hayPendientes = false,
  onBuscar,
  onAvisos,
}) {
  const escala = tema || temaClub('green');

  return (
    <View style={styles.barra}>
      <View style={styles.textos}>
        <Text style={styles.titulo} numberOfLines={1}>
          {titulo}
        </Text>
        {subtitulo ? (
          <Text style={styles.subtitulo} numberOfLines={1}>
            {subtitulo}
          </Text>
        ) : null}
      </View>

      <View style={styles.acciones}>
        <BotonIcono
          Icono={Search}
          etiqueta="Buscar clubes"
          onPress={onBuscar}
        />
        <BotonIcono
          Icono={Bell}
          etiqueta={hayPendientes ? 'Avisos, tienes pendientes' : 'Avisos'}
          onPress={onAvisos}
          punto={hayPendientes ? escala.main : null}
        />
      </View>
    </View>
  );
}

function BotonIcono({ Icono, etiqueta, onPress, punto }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      style={({ pressed }) => [styles.boton, pressed && styles.botonPress]}
    >
      <Icono size={19} color="#FFFFFF" strokeWidth={2} />
      {punto ? <View style={[styles.punto, { backgroundColor: punto }]} /> : null}
    </Pressable>
  );
}

const FONDO_BOTON = '#141416';

const styles = StyleSheet.create({
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: clubSuperficies.header,
  },
  textos: { flex: 1, minWidth: 0 },
  titulo: {
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.7,
    color: '#FFFFFF',
  },
  subtitulo: {
    marginTop: 2,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  acciones: { flexDirection: 'row', gap: 9 },
  boton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FONDO_BOTON,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.09)',
  },
  botonPress: { opacity: 0.7 },
  punto: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: FONDO_BOTON,
  },
});
