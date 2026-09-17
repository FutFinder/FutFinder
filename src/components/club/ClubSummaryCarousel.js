import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';

import { paleta as C, alfa, fuentes as F, clubTonos, clubSuperficies } from '../../theme/colors';
import { temaDeClub } from '../../theme/clubThemes';
import { cuposDelPlan } from '../../utils/clubsHomeTasks.js';
import { ratingLabel as formatearRating } from '../../utils/clubMeta';
import ClubSummaryCard from './ClubSummaryCard';

/** Igual que el trigger `check_user_club_limit` (migración 24): no se comprueba para bloquear nada, sólo para no ofrecer acá un botón que el servidor va a rechazar. */
const TOPE_CLUBES = 3;

/**
 * El resumen del club — deslizable entre los clubes del usuario y, al
 * final, una página para sumar uno más. Al soltar en una página de club
 * distinta, avisa con `onSelect(clubId)`: es la misma función que ya usa
 * `ClubSwitcher`, así que cambiar de página aquí dispara la misma recarga y
 * el resto de la portada (tema, tareas, próximo partido, accesos) se
 * actualiza solo — nadie más necesita enterarse de que existe un gesto.
 *
 * Si el club activo cambia por otra vía (los chips de `ClubSwitcher`), la
 * página sigue sin que el usuario tenga que volver a deslizar.
 *
 * SIEMPRE HAY AL MENOS DOS PÁGINAS, incluso con un solo club: la última es
 * «sumar otro club» (o el aviso de tope, con 3). Antes, con un solo club, la
 * tarjeta no era deslizable en absoluto porque no había a dónde ir; ahora sí
 * hay un destino, así que deja de ser un caso especial.
 *
 * LA PÁGINA QUE NO ES LA ACTIVA NO TIENE ESTADÍSTICAS. `club_estadisticas()`
 * sólo se pide para el club activo (`ClubsHomeContext`) — pedirla para los
 * hasta tres clubes en cada recarga por un dato que se ve un instante
 * mientras se suelta el dedo no vale el viaje de red. Esa tarjeta muestra
 * «N.A.» hasta que la recarga trae sus números reales: es el mismo estado
 * honesto que ya usa toda la pantalla, nunca un número inventado ni el de
 * otro club.
 */
export default function ClubSummaryCarousel({ clubs, activeClubId, tema, onSelect, onVerClub, onCrear, onUnirse }) {
  const scrollRef = useRef(null);
  const [pageWidth, setPageWidth] = useState(0);
  const lista = (clubs || []).filter((m) => m?.club?.id);
  const activeIndex = Math.max(0, lista.findIndex((m) => m.club.id === activeClubId));
  const [indiceMostrado, setIndiceMostrado] = useState(activeIndex);
  const totalPaginas = lista.length + 1; // +1: la página de «sumar club».

  // Contra qué comparar para no avisar dos veces la misma parada. No puede
  // ser `activeClubId`: ese prop tarda una recarga entera en actualizarse, y
  // en ese hueco el temporizador de abajo podría disparar de nuevo para la
  // misma página y avisar el mismo cambio dos veces.
  const ultimoAvisado = useRef(activeClubId);
  useEffect(() => {
    ultimoAvisado.current = activeClubId;
  }, [activeClubId]);

  useEffect(() => {
    if (activeIndex === indiceMostrado || !pageWidth) return;
    scrollRef.current?.scrollTo({ x: activeIndex * pageWidth, animated: true });
    setIndiceMostrado(activeIndex);
    // Sólo cuando el club activo cambia desde afuera (el selector de chips):
    // seguir `indiceMostrado` en las dependencias reengancharía este efecto
    // con su propio resultado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, pageWidth]);

  const onLayout = useCallback((e) => setPageWidth(e.nativeEvent.layout.width), []);

  // SE DETECTA LA PARADA CON `onScroll` + UN SILENCIO, NO CON
  // `onMomentumScrollEnd`. Ese evento no dispara cuando el usuario suelta
  // sin impulso —un arrastre lento y corto no dispara la física de
  // inercia—, y tampoco cuando el scroll lo mueve una rueda de mouse/trackpad
  // en vez de un dedo: con sólo ese evento esas soltadas dejaban la tarjeta
  // en el club nuevo pero `setActiveClub` nunca se llamaba, y el resto de la
  // portada seguía mostrando el club anterior. Un scroll que lleva ~150 ms
  // sin moverse ya se asentó, venga de donde venga.
  const timerAsentado = useRef(null);

  const onScroll = useCallback(
    (e) => {
      if (!pageWidth) return;
      const x = e.nativeEvent.contentOffset.x;
      const i = Math.max(0, Math.min(totalPaginas - 1, Math.round(x / pageWidth)));
      setIndiceMostrado(i);

      if (timerAsentado.current) clearTimeout(timerAsentado.current);
      timerAsentado.current = setTimeout(() => {
        // La última página («sumar club») no activa ningún club: no hay
        // nada que avisarle a `setActiveClub`.
        if (i >= lista.length) return;
        const clubDeLaPagina = lista[i]?.club;
        if (clubDeLaPagina && clubDeLaPagina.id !== ultimoAvisado.current) {
          ultimoAvisado.current = clubDeLaPagina.id;
          onSelect?.(clubDeLaPagina.id);
        }
      }, 150);
    },
    [lista, totalPaginas, pageWidth, onSelect]
  );

  useEffect(() => () => clearTimeout(timerAsentado.current), []);

  if (lista.length === 0) return null;

  return (
    <View onLayout={onLayout}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={32}
        scrollEnabled={pageWidth > 0}
      >
        {lista.map(({ club, miRol, totalMiembros }) => {
          const esActiva = club.id === activeClubId;
          const suTema = esActiva ? tema : temaDeClub(club);
          return (
            <View key={club.id} style={pageWidth ? { width: pageWidth } : styles.paginaSinMedir}>
              <ClubSummaryCard
                club={club}
                tema={suTema}
                rol={miRol}
                stats={esActiva ? club?.estadisticas : null}
                ratingLabel={formatearRating(club?.rating)}
                totalMiembros={totalMiembros}
                maxMiembros={cuposDelPlan({ plan: club?.plan, miembrosActivos: totalMiembros }).members.max}
                onVerClub={() => onVerClub?.(club.id)}
              />
            </View>
          );
        })}

        <View key="sumar-club" style={pageWidth ? { width: pageWidth } : styles.paginaSinMedir}>
          <PaginaSumarClub tope={lista.length >= TOPE_CLUBES} onCrear={onCrear} onUnirse={onUnirse} />
        </View>
      </ScrollView>

      <View style={styles.dots}>
        {Array.from({ length: totalPaginas }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                width: i === indiceMostrado ? 16 : 5,
                backgroundColor: i === indiceMostrado ? tema.main : alfa(C.tinta, 0.2),
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Última página del carrusel: sumar un club, o el aviso de tope con 3.
 *
 * NO SE VALIDA EL TOPE EN EL CLIENTE PARA BLOQUEAR NADA — lo aplica el
 * trigger `check_user_club_limit` (migración 24) — pero ofrecer acá
 * «Crear club» sabiendo que el servidor lo va a rechazar sería peor que no
 * ofrecerlo: es la misma regla que ya sigue `SinClub` en esta pantalla.
 */
function PaginaSumarClub({ tope, onCrear, onUnirse }) {
  return (
    <View style={styles.tarjetaSumar}>
      {tope ? (
        <>
          <Text style={styles.tituloSumar}>Llegaste al tope de 3 clubes</Text>
          <Text style={styles.textoSumar}>Sal de uno para poder sumar otro.</Text>
        </>
      ) : (
        <>
          <Text style={styles.tituloSumar}>¿Sumar otro club?</Text>
          <Text style={styles.textoSumar}>Puedes pertenecer hasta a 3 clubes a la vez.</Text>
          <Pressable
            onPress={onCrear}
            accessibilityRole="button"
            accessibilityLabel="Crear club"
            style={({ pressed }) => [styles.botonPrimario, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.botonPrimarioTexto}>Crear club</Text>
          </Pressable>
          <Pressable
            onPress={onUnirse}
            accessibilityRole="button"
            accessibilityLabel="Unirse a un club"
            style={({ pressed }) => [styles.botonSecundario, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.botonSecundarioTexto}>Unirse a un club</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Antes de la primera medición (`onLayout`) no hay ancho de página todavía
  // — flex:1 evita un salto visual de "una raya angosta" al primer pintado.
  paginaSinMedir: { flex: 1 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginTop: 10 },
  dot: { height: 5, borderRadius: 99 },

  tarjetaSumar: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: clubSuperficies.borde,
    backgroundColor: clubSuperficies.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  tituloSumar: { fontSize: 15, fontFamily: F.extraBold, color: C.textPrimary, textAlign: 'center' },
  textoSumar: { fontSize: 12.5, color: clubTonos.info.fg, opacity: 0.75, textAlign: 'center', lineHeight: 18 },
  botonPrimario: {
    marginTop: 6,
    minWidth: 170,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.green,
  },
  botonPrimarioTexto: { fontSize: 13.5, fontFamily: F.bold, color: '#04140A' },
  botonSecundario: {
    minWidth: 170,
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alfa(C.tinta, 0.06),
    borderWidth: 1,
    borderColor: alfa(C.tinta, 0.12),
  },
  botonSecundarioTexto: { fontSize: 12.5, fontFamily: F.bold, color: C.textPrimary },
});
