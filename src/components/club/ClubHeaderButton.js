import React, { useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Check, Plus } from 'lucide-react-native';

import ClubLogo from './ClubLogo';
import { temaDeClub, temaClub } from '../../theme/clubThemes';
import {
  paleta as C,
  radios as R,
  medidas as S,
  fuentes as F,
  alfa,
} from '../../theme/colors';
import { useClubsHome } from '../../contexts/ClubsHomeContext';

/**
 * El club activo, en la cabecera de todas las pestañas.
 *
 * POR QUÉ UN BOTÓN Y NO LA FILA DE CHIPS. `ClubSwitcher` es una fila
 * horizontal de 42 px de alto: cabe en una portada, no en una cabecera que ya
 * lleva la marca, la billetera y la campana. Acá el control ocupa lo mismo que
 * la campana —`S.iconBtn`— y lo que hace de selector es la hoja que abre.
 *
 * NO SE DIBUJA CON UN SOLO CLUB. Es la misma regla que la portada de Clubes y
 * que Inicio: sin un segundo club no hay nada que elegir, y un botón que abre
 * una lista de uno es ruido en seis cabeceras a la vez.
 *
 * EL BORDE ES DEL CLUB ACTIVO, no del verde de la app. Es lo único que dice,
 * de un vistazo y sin abrir nada, en nombre de qué club estás mirando la
 * pantalla — que es justo lo que se perdía al cambiar de pestaña.
 *
 * Toca el mismo `setActiveClub()` del contexto que la fila de chips y el
 * carrusel, así que el cambio es inmediato y los tres selectores quedan
 * sincronizados sin que ninguno sepa de los otros.
 */
export default function ClubHeaderButton() {
  const navigation = useNavigation();
  const { clubs, activeClubId, club, setActiveClub } = useClubsHome();
  const [abierta, setAbierta] = useState(false);

  const lista = (clubs || []).filter((m) => m?.club?.id);
  if (lista.length < 2) return null;

  const tema = club ? temaDeClub(club) : temaClub('green');

  const elegir = (id) => {
    setAbierta(false);
    if (id !== activeClubId) setActiveClub(id);
  };

  return (
    <>
      <Pressable
        onPress={() => setAbierta(true)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={
          club?.nombre ? `Club activo: ${club.nombre}. Cambiar de club` : 'Cambiar de club'
        }
        style={({ pressed }) => [
          styles.boton,
          { borderColor: tema.border },
          pressed && { opacity: 0.7 },
        ]}
      >
        <ClubLogo uri={club?.foto_url} size={26} borderRadius={9} tema={tema} />
      </Pressable>

      <Modal
        visible={abierta}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setAbierta(false)}
      >
        <Pressable style={styles.fondo} onPress={() => setAbierta(false)}>
          <Pressable style={styles.hoja} onPress={() => {}}>
            <View style={styles.asa} />
            <Text style={styles.titulo}>Cambiar de club</Text>
            <Text style={styles.bajada}>
              Lo que ves en el resto de la app es del club que elijas acá
            </Text>

            {/* Con tres clubes no hace falta, pero el plan permite hasta
                tres y la lista no tiene por qué saberlo: si algún día son
                más, se desplaza en vez de salirse de la pantalla. */}
            <ScrollView style={styles.lista} bounces={false}>
              {lista.map(({ club: c, miRol }) => {
                const activo = c.id === activeClubId;
                const suTema = temaDeClub(c);
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => elegir(c.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: activo }}
                    accessibilityLabel={activo ? `${c.nombre}, club activo` : `Cambiar a ${c.nombre}`}
                    style={({ pressed }) => [
                      styles.fila,
                      activo && { backgroundColor: suTema.soft, borderColor: suTema.border },
                      pressed && { opacity: 0.75 },
                    ]}
                  >
                    <ClubLogo uri={c.foto_url} size={34} borderRadius={11} tema={suTema} />
                    <View style={styles.filaTextos}>
                      <Text style={styles.filaNombre} numberOfLines={1}>
                        {c.nombre}
                      </Text>
                      <Text style={styles.filaRol}>
                        {miRol === 'admin' ? 'Administrador' : 'Integrante'}
                      </Text>
                    </View>
                    {activo ? <Check size={18} color={suTema.main} strokeWidth={2.6} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable
              onPress={() => {
                setAbierta(false);
                navigation.navigate('ExploreClubs');
              }}
              accessibilityRole="button"
              accessibilityLabel="Explorar clubes"
              style={({ pressed }) => [styles.explorar, pressed && { opacity: 0.7 }]}
            >
              <Plus size={16} color={C.textDim} strokeWidth={2.2} />
              <Text style={styles.explorarTexto}>Explorar clubes</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  boton: {
    width: S.iconBtn,
    height: S.iconBtn,
    borderRadius: R.iconBtn,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(25,29,26,0.8)',
    borderWidth: 1,
  },

  fondo: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.6)', justifyContent: 'flex-end' },
  hoja: {
    backgroundColor: C.surface,
    borderTopLeftRadius: R.hero,
    borderTopRightRadius: R.hero,
    borderTopWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 30,
  },
  asa: {
    width: 40,
    height: 4,
    borderRadius: 3,
    backgroundColor: alfa(C.tinta, 0.2),
    alignSelf: 'center',
    marginBottom: 14,
  },
  titulo: { color: C.textPrimary, fontSize: 18, fontFamily: F.extraBold, letterSpacing: -0.3 },
  bajada: { color: C.textSecondary, fontSize: 12.5, marginTop: 4 },

  lista: { marginTop: 14, maxHeight: 300 },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: alfa(C.tinta, 0.09),
    backgroundColor: C.chip,
  },
  filaTextos: { flex: 1, minWidth: 0 },
  filaNombre: { color: C.textPrimary, fontSize: 15, fontFamily: F.bold },
  filaRol: { color: C.textMuted, fontSize: 11.5, marginTop: 1 },

  explorar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 46,
    marginTop: 4,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: alfa(C.tinta, 0.16),
  },
  explorarTexto: { color: C.textDim, fontSize: 14, fontFamily: F.semiBold },
});
