import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  AccessibilityInfo,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BrandMark from '../components/BrandMark';
import { clubsExplorer, tactical } from '../theme/colors';
import { getOnboardingState } from '../services/profile';
import { getInitialRouteName } from '../utils/routing';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export default function SplashScreen({ navigation }) {
  const { width, height } = useWindowDimensions();

  // Escala del logo hero: cabe con margen entre 320px (teléfono chico) y
  // pantallas anchas de tablet/web, sin desbordar ni verse minúsculo.
  const logoScaleBase = clamp(width * 0.0058, 1.7, 2.4);

  const haloBase = Math.min(width, height);
  const haloOuterSize = haloBase * 0.85;
  const haloInnerSize = haloBase * 0.45;
  const haloPulseSize = haloInnerSize * 1.15;

  const haloOpacity = useRef(new Animated.Value(0)).current;
  const pulseOpacity = useRef(new Animated.Value(0)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(1)).current;
  const logoTranslateY = useRef(new Animated.Value(0)).current;
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
        // Alternativa reducida: solo un fundido corto, sin escala ni pulso.
        await new Promise((resolve) => {
          Animated.timing(logoOpacity, {
            toValue: 1,
            duration: 250,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }).start(resolve);
        });
        return;
      }

      logoScale.setValue(0.86);
      logoTranslateY.setValue(8);

      await new Promise((resolve) => {
        Animated.sequence([
          Animated.parallel([
            Animated.timing(haloOpacity, {
              toValue: 1,
              duration: 280,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.sequence([
              Animated.delay(120),
              Animated.parallel([
                Animated.timing(logoOpacity, {
                  toValue: 1,
                  duration: 380,
                  easing: Easing.out(Easing.cubic),
                  useNativeDriver: true,
                }),
                Animated.timing(logoScale, {
                  toValue: 1,
                  duration: 380,
                  easing: Easing.out(Easing.cubic),
                  useNativeDriver: true,
                }),
                Animated.timing(logoTranslateY, {
                  toValue: 0,
                  duration: 380,
                  easing: Easing.out(Easing.cubic),
                  useNativeDriver: true,
                }),
              ]),
            ]),
          ]),
          // Pulso único de iluminación — ocurre una sola vez.
          Animated.sequence([
            Animated.timing(pulseOpacity, {
              toValue: 1,
              duration: 130,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(pulseOpacity, {
              toValue: 0,
              duration: 130,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
          Animated.delay(350),
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
      <Animated.View
        pointerEvents="none"
        style={[
          styles.haloCircle,
          {
            backgroundColor: tactical.neonSoft,
            width: haloOuterSize,
            height: haloOuterSize,
            borderRadius: haloOuterSize / 2,
            top: (height - haloOuterSize) / 2,
            left: (width - haloOuterSize) / 2,
            opacity: haloOpacity,
          },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.haloCircle,
          {
            backgroundColor: tactical.neonBorder,
            width: haloInnerSize,
            height: haloInnerSize,
            borderRadius: haloInnerSize / 2,
            top: (height - haloInnerSize) / 2,
            left: (width - haloInnerSize) / 2,
            opacity: haloOpacity,
          },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.haloCircle,
          {
            backgroundColor: tactical.neonBorder,
            width: haloPulseSize,
            height: haloPulseSize,
            borderRadius: haloPulseSize / 2,
            top: (height - haloPulseSize) / 2,
            left: (width - haloPulseSize) / 2,
            opacity: pulseOpacity,
          },
        ]}
      />
      <SafeAreaView style={styles.safeArea}>
        <Animated.View
          style={{
            opacity: logoOpacity,
            transform: [
              { scale: Animated.multiply(logoScale, logoScaleBase) },
              { translateY: logoTranslateY },
            ],
          }}
        >
          <BrandMark />
        </Animated.View>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: clubsExplorer.bg,
  },
  haloCircle: {
    position: 'absolute',
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
