# Calidad: lint y errores de render

Última revisión: 2026-08-11

## Propósito

Dejar por escrito las dos redes que atrapan los fallos que antes solo
aparecían como una pantalla en blanco: el lint y el error boundary.

## ESLint

`eslint.config.mjs`, flat config, con `npm run lint` y `npm run verify`
(lint + pruebas). Se ejecuta también desde «Al terminar» de `CLAUDE.md`.

La configuración es **corta a propósito**. Un preset completo sobre este
código escupía miles de avisos preexistentes; una regla que nadie mira no
protege nada. Solo entran reglas que marcan fallos reales y que el
repositorio pasa limpio hoy, así que **un error de lint es un fallo de
verdad** y la puerta significa algo.

- `no-undef` es la razón de existir de todo esto. Babel y Metro resuelven
  los identificadores en tiempo de ejecución, así que un nombre mal escrito
  solo revienta cuando esa rama corre. Costó una sesión entera de
  diagnóstico (ver [decisión](../decisiones/2026-08-11-contexto-cta-desafio.md)).
- `react-hooks/rules-of-hooks` en error; `exhaustive-deps` en aviso, porque
  hay dependencias omitidas a propósito y revisarlas es trabajo aparte.
- `react/jsx-uses-vars` y `jsx-uses-react` no detectan fallos: existen para
  que `no-unused-vars` no marque como muerto todo componente usado dentro
  del JSX. Sin ellas eran ~2.400 avisos falsos.
- Ignorados con `**/`: hay bundles compilados dentro de `.worktrees/`, y sin
  eso entraban al análisis con miles de falsos positivos del empaquetador.

Estado actual: **0 errores, 25 avisos** (importaciones muertas y
dependencias de efectos). Los avisos son deuda conocida, no bloquean.

## Error boundary

`src/components/ErrorBoundary.js`, aplicado **por pantalla** vía
`src/navigation/withErrorBoundary.js`, y en la raíz desde `App.js`.

Por pantalla y no solo en la raíz: un boundary único arriba atrapa el error
pero reemplaza la app entera —navegación incluida— y deja al usuario
encerrado. Por pantalla se cae solo la que falló, las pestañas siguen vivas
y se puede volver atrás.

- Las rutas privadas lo reciben dentro de `withAuthGuard`, en un solo lugar
  para las ~25 pantallas del stack.
- Las de onboarding (Splash, Welcome, Login, Verification,
  LocationPermission, Terms, Success) no pasan por el guard y se envuelven a
  mano en `AppNavigator`.
- En `__DEV__` muestra mensaje, stack y árbol de componentes; en producción
  solo «Reintentar» y «Volver». El `console.error` sale siempre: es la única
  traza si el fallo ocurre en el teléfono de otra persona.

No hay pruebas automáticas del boundary: el proyecto no tiene arnés de
render (decisión C8 del plan de desafíos), así que se comprueba a mano.

## Notas relacionadas

- [Pruebas](pruebas.md)
- [Chat](../funcionalidades/chat.md)
- [Contexto de la acción del desafío](../decisiones/2026-08-11-contexto-cta-desafio.md)
