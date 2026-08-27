import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  AccessibilityInfo,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapPin } from 'lucide-react-native';
import { clubsExplorer, tactical } from '../theme/colors';
import { getOnboardingState } from '../services/profile';
import { getInitialRouteName } from '../utils/routing';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// El ícono y el wordmark reproducen exactamente los valores de
// BrandMark.js (pin + "fut...finder"): mismo ícono, mismo tamaño 26, mismo
// color tactical.neon, mismo estilo de texto. Se reconstruyen acá — en vez
// de renderizar <BrandMark /> — porque esta pantalla necesita animar el
// pin y el texto en momentos distintos (el pin se asienta, luego el texto
// se desliza a su derecha), algo que un <BrandMark /> fusionado no puede
// coreografiar. BrandMark.js no se modifica.
const ICON_SIZE = 26;

export default function SplashScreen({ navigation }) {
  const { width } = useWindowDimensions();

  // Escala del conjunto hero: cabe con margen entre 320px (teléfono chico)
  // y pantallas anchas de tablet/web, sin desbordar ni verse minúsculo.
  const heroScale = clamp(width * 0.0058, 1.7, 2.4);

  const iconOpacity = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(0.86)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateX = useRef(new Animated.Value(28)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;

  const destRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    // Chequeo de sesión en paralelo con la animación, igual que antes.
    const sessionPromise = (async () => {
      const state = await getOnboardingState();
      destRef.current = getInitialRouteName(state);
    })();

    const runAnimation = async () => {
      const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
      if (!isMounted) return;

      if (reduceMotion) {
        // Alternativa reducida: pin y texto ya en su lugar final, solo un
        // fundido conjunto corto — sin desliz, sin secuencia pin→texto.
        iconScale.setValue(1);
        textTranslateX.setValue(0);
        await new Promise((resolve) => {
          Animated.parallel([
            Animated.timing(iconOpacity, {
              toValue: 1,
              duration: 250,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(textOpacity, {
              toValue: 1,
              duration: 250,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
          ]).start(resolve);
        });
        return;
      }

      await new Promise((resolve) => {
        Animated.sequence([
          // 1. El pin se asienta primero.
          Animated.parallel([
            Animated.timing(iconOpacity, {
              toValue: 1,
              duration: 380,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(iconScale, {
              toValue: 1,
              duration: 380,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
          Animated.delay(120),
          // 2. El wordmark se desliza a su lugar (a la derecha del pin) y
          // se desvanece hacia dentro.
          Animated.parallel([
            Animated.timing(textOpacity, {
              toValue: 1,
              duration: 460,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(textTranslateX, {
              toValue: 0,
              duration: 460,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
          // 3. Hold breve con el logo completo, estático (nada se repite).
          Animated.delay(280),
        ]).start(resolve);
      });
    };

    const animationPromise = runAnimation();

    // Espera tanto la animación como la sesión: si la sesión tarda más, el
    // logo queda quieto en su estado final (nada se repite) hasta que
    // resuelva — recién ahí se desvanece la pantalla y se navega.
    Promise.all([animationPromise, sessionPromise]).then(() => {
      if (!isMounted) return;

      Animated.timing(screenOpacity, {
        toValue: 0,
        duration: 260,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        if (!isMounted) return;
        const dest = destRef.current || 'Welcome';
        if (dest === 'Main') {
          navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
        } else if (dest === 'LocationPermission') {
          navigation.reset({ index: 0, routes: [{ name: 'LocationPermission' }] });
        } else {
          navigation.replace('Welcome');
        }
      });
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <Animated.View style={[styles.root, { opacity: screenOpacity }]}>
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.row, { transform: [{ scale: heroScale }] }]}>
          <Animated.View
            style={{
              opacity: iconOpacity,
              transform: [{ scale: iconScale }],
            }}
          >
            <MapPin size={ICON_SIZE} color={tactical.neon} strokeWidth={2.2} />
          </Animated.View>
          <Animated.View
            style={{
              opacity: textOpacity,
              transform: [{ translateX: textTranslateX }],
            }}
          >
            <Text style={styles.word}>
              fut<Text style={styles.wordAccent}>finder</Text>
            </Text>
          </Animated.View>
        </View>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: clubsExplorer.bg,
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  word: {
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: tactical.text,
  },
  wordAccent: {
    color: tactical.neon,
  },
});
