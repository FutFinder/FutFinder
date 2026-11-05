import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ShieldAlert } from 'lucide-react-native';

import { paleta as C, radios as R, fuentes as F } from '../theme/colors';
import { miRequisitoMfa } from '../services/mfa';

/**
 * Aviso para el personal (moderadores y administradores de recinto) a quien el
 * servidor ya le exige la verificación en dos pasos y todavía no la cumple.
 *
 * Existe porque, con la bandera `mfa_obligatoria_staff` encendida (migración
 * 167), una sesión sin el código deja de ver el panel del recinto y la
 * moderación: sin este aviso esa persona vería desaparecer sus secciones sin
 * ninguna explicación. Para el resto de la gente no renderiza nada, y mientras
 * la bandera esté apagada tampoco.
 */
export default function AvisoMfaPersonal({ navigation }) {
  const [pendiente, setPendiente] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      miRequisitoMfa().then(({ data }) => {
        if (vivo) setPendiente(Boolean(data?.requerida && !data?.cumple));
      });
      return () => {
        vivo = false;
      };
    }, [])
  );

  if (!pendiente) return null;

  return (
    <View style={styles.caja}>
      <ShieldAlert color={C.textAmber} size={20} strokeWidth={2} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.titulo}>Activa la verificación en dos pasos</Text>
        <Text style={styles.texto}>
          Para administrar un recinto o moderar necesitas un segundo paso al iniciar sesión. Mientras no lo actives, esas secciones no se muestran.
        </Text>
        <Pressable
          onPress={() => navigation.navigate('MfaSetup')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.boton, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.botonTexto}>Activarla ahora</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  caja: {
    flexDirection: 'row', gap: 12, marginHorizontal: 18, marginBottom: 8, padding: 14,
    borderRadius: R.row, backgroundColor: C.amberSoft, borderWidth: 1, borderColor: C.amberBorder,
  },
  titulo: { fontFamily: F.extraBold, fontSize: 14, color: C.textAmber, marginBottom: 4 },
  texto: { fontFamily: F.medium, fontSize: 12.5, lineHeight: 18, color: C.textAmber },
  boton: {
    alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 14, height: 34, borderRadius: 999,
    backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center',
  },
  botonTexto: { fontFamily: F.extraBold, fontSize: 12.5, color: '#1A1400' },
});
