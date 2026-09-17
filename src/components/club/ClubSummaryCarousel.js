import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';

import { reservas as C, alfa } from '../../theme/colors';
import { temaDeClub } from '../../theme/clubThemes';
import { cuposDelPlan } from '../../utils/clubsHomeTasks.js';
import { ratingLabel as formatearRating } from '../../utils/clubMeta';
import ClubSummaryCard from './ClubSummaryCard';

/**
 * El resumen del club — deslizable entre los clubes del usuario cuando
 * pertenece a más de uno (`getMyClubs()`, máximo 3). Al soltar en una
 * página distinta, avisa con `onSelect(clubId)`: es la misma función que ya
 * usa `ClubSwitcher`, así que cambiar de página aquí dispara la misma
 * recarga y el resto de la portada (tema, tareas, próximo partido, accesos)
 * se actualiza solo — nadie más necesita enterarse de que existe un gesto.
 *
 * Si el club activo cambia por otra vía (los chips de `ClubSwitcher`), la
 * página sigue sin que el usuario tenga que volver a deslizar.
 *
 * LA PÁGINA QUE NO ES LA ACTIVA NO TIENE ESTADÍSTICAS. `club_estadisticas()`
 * sólo se pide para el club activo (`ClubsHomeContext`) — pedirla para los
 * hasta tres clubes en cada recarga por un dato que se ve un instante
 * mientras se suelta el dedo no vale el viaje de red. Esa tarjeta muestra
 * «N.A.» hasta que la recarga trae sus números reales: es el mismo estado
 * honesto que ya usa toda la pantalla, nunca un número inventado ni el de
 * otro club.
 */
export default function ClubSummaryCarousel({ clubs, activeClubId, tema, onSelect, onVerClub }) {
  const scrollRef = useRef(null);
  const [pageWidth, setPageWidth] = useState(0);
  const lista = (clubs || []).filter((m) => m?.club?.id);
  const activeIndex = Math.max(0, lista.findIndex((m) => m.club.id === activeClubId));
  const [indiceMostrado, setIndiceMostrado] = useState(activeIndex);

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
      const i = Math.max(0, Math.min(lista.length - 1, Math.round(x / pageWidth)));
      setIndiceMostrado(i);

      if (timerAsentado.current) clearTimeout(timerAsentado.current);
      timerAsentado.current = setTimeout(() => {
        const clubDeLaPagina = lista[i]?.club;
        if (clubDeLaPagina && clubDeLaPagina.id !== ultimoAvisado.current) {
          ultimoAvisado.current = clubDeLaPagina.id;
          onSelect?.(clubDeLaPagina.id);
        }
      }, 150);
    },
    [lista, pageWidth, onSelect]
  );

  useEffect(() => () => clearTimeout(timerAsentado.current), []);

  if (lista.length === 0) return null;

  if (lista.length === 1) {
    const { club, miRol, totalMiembros } = lista[0];
    return (
      <ClubSummaryCard
        club={club}
        tema={tema}
        rol={miRol}
        stats={club?.estadisticas}
        ratingLabel={formatearRating(club?.rating)}
        totalMiembros={totalMiembros}
        maxMiembros={cuposDelPlan({ plan: club?.plan, miembrosActivos: totalMiembros }).members.max}
        onVerClub={() => onVerClub?.(club.id)}
      />
    );
  }

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
      </ScrollView>

      <View style={styles.dots}>
        {lista.map((m, i) => (
          <View
            key={m.club.id}
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

const styles = StyleSheet.create({
  // Antes de la primera medición (`onLayout`) no hay ancho de página todavía
  // — flex:1 evita un salto visual de "una raya angosta" al primer pintado.
  paginaSinMedir: { flex: 1 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginTop: 10 },
  dot: { height: 5, borderRadius: 99 },
});
