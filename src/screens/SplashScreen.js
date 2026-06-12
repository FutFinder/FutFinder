import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { colors } from '../theme/colors';
import { getOnboardingState } from '../services/profile';

const ICON_SIZE = 56;

export default function SplashScreen({ navigation }) {
  const iconOpacity  = useRef(new Animated.Value(0)).current;
  const textOpacity  = useRef(new Animated.Value(0)).current;
  const textX        = useRef(new Animated.Value(70)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;

  const destRef = useRef(null);

  useEffect(() => {
    // Chequeo de sesión en paralelo con la animación
    (async () => {
      const state = await getOnboardingState();
      if (state === true)  destRef.current = 'Main';
      else if (state === false) destRef.current = 'LocationPermission';
      else destRef.current = 'Welcome';
    })();

    Animated.sequence([
      // 1. Ícono fade-in
      Animated.timing(iconOpacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      // 2. Pausa breve
      Animated.delay(80),
      // 3. Texto slide-in desde la derecha + fade-in
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 580,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(textX, {
          toValue: 0,
          duration: 580,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      // 4. Hold
      Animated.delay(480),
      // 5. Fade-out suave de toda la pantalla
      Animated.timing(screenOpacity, {
        toValue: 0,
        duration: 320,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      const dest = destRef.current || 'Welcome';
      if (dest === 'Main') {
        navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
      } else if (dest === 'LocationPermission') {
        navigation.reset({ index: 0, routes: [{ name: 'LocationPermission' }] });
      } else {
        navigation.replace('Welcome');
      }
    });
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: screenOpacity }]}>
      <View style={styles.logoRow}>
        {/* Ícono */}
        <Animated.View style={{ opacity: iconOpacity }}>
          <Svg
            width={ICON_SIZE}
            height={ICON_SIZE * 1.2}
            viewBox="0 0 100 120"
          >
            <Path
              d="M50 5 C25 5 8 22 8 47 C8 78 50 115 50 115 C50 115 92 78 92 47 C92 22 75 5 50 5 Z"
              fill="none"
              stroke={colors.primary}
              strokeWidth={6}
            />
            <G>
              <Circle cx={50} cy={47} r={22} fill={colors.background} stroke={colors.primary} strokeWidth={3} />
              <Path d="M50 35 L60 42 L56 53 L44 53 L40 42 Z" fill={colors.primary} />
              <Path d="M50 35 L50 28" stroke={colors.primary} strokeWidth={2.5} strokeLinecap="round" />
              <Path d="M60 42 L67 39" stroke={colors.primary} strokeWidth={2.5} strokeLinecap="round" />
              <Path d="M56 53 L60 60" stroke={colors.primary} strokeWidth={2.5} strokeLinecap="round" />
              <Path d="M44 53 L40 60" stroke={colors.primary} strokeWidth={2.5} strokeLinecap="round" />
              <Path d="M40 42 L33 39" stroke={colors.primary} strokeWidth={2.5} strokeLinecap="round" />
            </G>
          </Svg>
        </Animated.View>

        {/* Texto "futfinder" con slide desde la derecha */}
        <Animated.View
          style={{
            opacity: textOpacity,
            transform: [{ translateX: textX }],
          }}
        >
          <Text style={styles.text}>
            fut<Text style={styles.textGreen}>finder</Text>
          </Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  text: {
    color: '#FFFFFF',
    fontSize: ICON_SIZE * 0.78,
    fontWeight: '800',
    letterSpacing: -0.5,
    includeFontPadding: false,
  },
  textGreen: {
    color: colors.primary,
  },
});
