# 2026-08-13 — La funcionalidad completa va antes que el rediseño visual

## Contexto

Al cerrar U3 de los desafíos entre clubes, la nómina quedó comprobada con dos
sesiones autenticadas, en web a 904 px y a 390 × 845, con el arnés SQL
`45_inscripcion_por_club_test.sql` en 14/14. La interfaz resultante funciona:
las nóminas se apilan bien, los conteos son correctos, los botones son
alcanzables. Pero no es la interfaz definitiva, y tratarla como si lo fuera
llevaría a pulir pantallas que todavía van a cambiar de forma.

El ciclo de U3 dejó además una lección concreta sobre dónde aparecen los
fallos: el arnés SQL llevaba 14/14 desde el despliegue mientras la nómina se
veía vacía en las dos cuentas, porque el `select` del cliente pedía una columna
inexistente. Los fallos que importan ahora están en lógica, permisos, estados y
flujos, no en el aspecto.

## Decisión

Se prioriza completar lógica, permisos, estados y flujos antes de renovar el
diseño visual. La interfaz actual se acepta como **funcional pero no
definitiva**: se mantiene usable y coherente, y no se invierte en rediseño
mientras queden fases de comportamiento sin terminar.

El rediseño visual es un trabajo posterior y explícito. No se adelanta por
tramos ni se cuela dentro de tareas de comportamiento.

## Consecuencias

- Las tareas siguientes —U4 en adelante— se juzgan por comportamiento
  verificado, no por acabado visual. Una pantalla correcta y sobria está
  terminada.
- No se abren tareas de rediseño ni se aceptan cambios visuales de alcance
  amplio hasta que el comportamiento esté completo. Sí se corrige lo que
  impide usar la pantalla: texto cortado, algo inalcanzable, un estado que no
  se distingue de otro.
- El objetivo declarado es que el trabajo visual posterior sea
  **principalmente de interfaz** y no obligue a rehacer funcionalidad. Eso
  exige que las reglas vivan en el servidor y en módulos puros
  —`clubMatchRules.js`, `nominaQuery.js`— y no dentro de los componentes, para
  que cambiar el aspecto no toque la lógica.
- Ninguna fase se cierra sólo con pruebas SQL en verde: hace falta la
  comprobación manual autenticada de las pantallas afectadas.

## Documentos relacionados

- [Clubes](../funcionalidades/clubes.md)
- [Pruebas](../operacion/pruebas.md)
- [Sistema visual](../diseno/sistema-visual.md)
- [Estado actual](../operacion/estado-actual.md)
