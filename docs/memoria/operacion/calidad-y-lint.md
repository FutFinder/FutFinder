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

## Un doble que no se parece al entorno real no prueba nada

El sondeo del hilo de desafío tenía nueve pruebas en verde y reventaba en el navegador con `TypeError: Illegal invocation` la primera vez que alguien abría la pantalla, con Error Boundary incluido. Todas inyectaban temporizadores falsos, así que **el único camino que corre de verdad —el de por defecto— era el único sin cubrir**. La causa: guardar `{ setInterval, clearInterval }` en un objeto y llamarlos como método de ese objeto le cambia el receptor, y en el navegador esas funciones exigen que sea el global; Node no lo comprueba, y por eso las pruebas pasaban.

Dos reglas que salen de ahí. La primera: cuando algo se puede inyectar, **hay que probar también el valor por defecto**, porque es el que se usa en producción. La segunda: si el entorno real tiene una restricción que el de pruebas no tiene, se modela —acá, un doble de `setInterval` que lanza si el receptor no es el global reproduce el fallo exacto—. `npm test` corre en Node; la aplicación corre en un navegador y en Hermes, y esa diferencia hay que escribirla en la prueba o no existe.

## Notas relacionadas

- [Pruebas](pruebas.md)
- [Chat](../funcionalidades/chat.md)
- [Contexto de la acción del desafío](../decisiones/2026-08-11-contexto-cta-desafio.md)
