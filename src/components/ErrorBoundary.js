import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { TriangleAlert, RotateCcw, ArrowLeft } from 'lucide-react-native';

import { colors, radius } from '../theme/colors';

/**
 * Red de seguridad para una excepción durante el render.
 *
 * POR QUÉ EXISTE: sin un boundary, React desmonta el árbol ENTERO ante
 * cualquier error de render. La app no muestra un fallo: muestra una
 * pantalla en blanco, sin texto ni pista alguna. Diagnosticar eso costó una
 * sesión completa con el chat de desafíos (ver
 * docs/memoria/decisiones/2026-08-11-contexto-cta-desafio.md). Un error
 * visible se arregla en minutos; una pantalla en blanco, no.
 *
 * Se aplica POR PANTALLA (ver `withErrorBoundary`) y no solo en la raíz:
 * así una pantalla que revienta no se lleva por delante la navegación, y
 * el usuario puede volver atrás y seguir usando el resto de la app.
 *
 * En desarrollo muestra el mensaje y el stack, que es lo que hace falta
 * para arreglarlo. En producción no: ahí solo se ofrece reintentar y
 * volver, porque un stack no le sirve de nada a un jugador.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Queda en la consola siempre: es la única traza que tendremos si el
    // fallo aparece en el teléfono de alguien más.
    console.error(`[FutFinder] Error en ${this.props.nombre || 'la pantalla'}:`, error);
  }

  reintentar = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const { onVolver } = this.props;

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.icono}>
            <TriangleAlert color={colors.error} size={26} strokeWidth={2} />
          </View>

          <Text style={styles.titulo}>Algo se rompió en esta pantalla</Text>
          <Text style={styles.mensaje}>
            El resto de la app sigue funcionando. Puedes reintentar o volver atrás.
          </Text>

          <View style={styles.acciones}>
            <Pressable
              onPress={this.reintentar}
              accessibilityRole="button"
              accessibilityLabel="Reintentar"
              style={({ pressed }) => [styles.btnPrimario, pressed && { opacity: 0.85 }]}
            >
              <RotateCcw color="#0B0D0B" size={17} strokeWidth={2.3} />
              <Text style={styles.btnPrimarioTexto}>Reintentar</Text>
            </Pressable>

            {!!onVolver && (
              <Pressable
                onPress={onVolver}
                accessibilityRole="button"
                accessibilityLabel="Volver atrás"
                style={({ pressed }) => [styles.btnSecundario, pressed && { opacity: 0.7 }]}
              >
                <ArrowLeft color={colors.textSecondary} size={17} strokeWidth={2.1} />
                <Text style={styles.btnSecundarioTexto}>Volver</Text>
              </Pressable>
            )}
          </View>

          {/* El detalle técnico solo en desarrollo. */}
          {__DEV__ && (
            <View style={styles.detalle}>
              <Text style={styles.detalleTitulo}>{String(error?.message || error)}</Text>
              {!!error?.stack && <Text style={styles.stack}>{String(error.stack)}</Text>}
              {!!info?.componentStack && (
                <>
                  <Text style={styles.detalleTitulo}>Árbol de componentes</Text>
                  <Text style={styles.stack}>{String(info.componentStack)}</Text>
                </>
              )}
            </View>
          )}
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingTop: 64, gap: 12 },

  icono: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,107,107,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.28)',
  },

  titulo: { color: colors.textPrimary, fontSize: 19, fontWeight: '800' },
  mensaje: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },

  acciones: { flexDirection: 'row', gap: 10, marginTop: 8 },
  btnPrimario: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  btnPrimarioTexto: { color: '#0B0D0B', fontSize: 14, fontWeight: '800' },
  btnSecundario: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnSecundarioTexto: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },

  detalle: {
    marginTop: 18,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  detalleTitulo: { color: colors.error, fontSize: 12, fontWeight: '800' },
  stack: { color: colors.textSecondary, fontSize: 10, lineHeight: 15 },
});
