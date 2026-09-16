import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';

/**
 * ESLint de FutFinder.
 *
 * DELIBERADAMENTE CORTO. La tentación es activar un preset completo, pero
 * sobre un código ya maduro eso escupe cientos de avisos preexistentes, se
 * vuelve ruido y en dos semanas nadie lo mira. Acá solo entran reglas que
 * atrapan fallos REALES y que el repositorio pasa limpio hoy, para que
 * `npm run lint` sea una puerta de verdad: si sale rojo, algo está roto.
 *
 * Por qué estas y no otras:
 *
 *   no-undef — es la que faltaba. Un identificador mal escrito no lo
 *     detecta nadie más: Babel y Metro lo resuelven en tiempo de ejecución,
 *     así que solo revienta cuando esa rama corre. Costó una sesión entera
 *     de diagnóstico con el chat de desafíos en blanco
 *     (`ReferenceError: myClubId is not defined`). Ver
 *     docs/memoria/decisiones/2026-08-11-contexto-cta-desafio.md
 *
 *   react-hooks/rules-of-hooks — un hook dentro de una condición rompe la
 *     pantalla de formas que no se reproducen a mano.
 *
 *   no-restricted-imports — impide resucitar cualquiera de las seis paletas
 *     que se borraron al unificar la estética. Ver el bloque de la regla.
 *
 *   no-unsafe-optional-chaining, no-dupe-keys, no-unreachable y compañía
 *     vienen del preset recomendado y son fallos, no estilo.
 *
 * NO se activa `react-hooks/exhaustive-deps` como error: el código tiene
 * dependencias omitidas a propósito (con su `eslint-disable` documentado) y
 * convertirlo en error obligaría a una revisión de cada efecto, que es un
 * trabajo aparte. Queda en aviso para que se vea sin bloquear.
 *
 * Tampoco se activa `no-unused-vars` como error: hay parámetros de firma y
 * capturas `catch (e)` sin usar por todo el código. Queda en aviso.
 */
export default [
  {
    ignores: [
      // Código generado y dependencias. Los patrones llevan `**/` a
      // propósito: hay bundles compilados dentro de `.worktrees/`, y sin
      // eso entraban al análisis y ahogaban todo con miles de falsos
      // positivos del propio empaquetador.
      '**/dist/**',
      '**/node_modules/**',
      '**/.expo/**',
      // Las dos rutas: `git worktree` clásico y los que crea Claude Code.
      // Son copias de otra rama, con su propio historial; analizarlas mezcla
      // hallazgos de un trabajo que no es el de esta rama.
      '.worktrees/**',
      '.claude/worktrees/**',
      'supabase/functions/**', // Deno, con su propio runtime y sus tipos
    ],
  },

  {
    files: ['**/*.js', '**/*.jsx', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
        // React Native / Expo
        __DEV__: 'readonly',
        ErrorUtils: 'readonly',
        HermesInternal: 'readonly',
      },
    },
    plugins: { 'react-hooks': reactHooks, react },
    rules: {
      // Sin estas dos, `no-unused-vars` no ve que un componente se usa
      // DENTRO del JSX y marca como muerto medio archivo. Un aviso falso
      // repetido mil veces es lo que hace que se deje de mirar la
      // herramienta, así que van aunque no detecten fallos por sí solas.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',

      // ── Lo que de verdad rompe la app ──────────────────────────
      'no-undef': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-const-assign': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'valid-typeof': 'error',
      'use-isnan': 'error',
      'no-cond-assign': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-obj-calls': 'error',
      'no-sparse-arrays': 'error',
      'require-yield': 'error',
      'getter-return': 'error',

      // ── Una sola estética ──────────────────────────────────────
      // La app tuvo SIETE paletas conviviendo (`colors` olivo, `dsColors`,
      // `clubColors`, `chatColors`, `tactical` flúor, `partidos` y
      // `reservas`): cuatro verdes y tres fondos en un solo recorrido. Se
      // unificaron en `reservas` el 2026-09-16 y las otras seis se borraron.
      //
      // Hoy importar una de ellas ya falla al empaquetar, porque el export no
      // existe. Esta regla está para el caso que el empaquetador NO cubre:
      // que alguien vuelva a CREARLAS. Es error y no aviso porque acá un
      // error de lint significa que algo está roto.
      //
      // Va por PATRÓN y no por ruta exacta: el mismo módulo se importa como
      // `../theme/colors` desde `screens/` y como `../../theme/colors` desde
      // `components/club/`, y una regla que solo mire la primera deja fuera
      // media app.
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/theme/colors', '**/theme/colors.js', './colors.js'],
          importNames: [
            'colors', 'radius', 'spacing', 'fonts',
            'dsColors', 'dsRadius', 'dsSizes',
            'clubColors', 'clubRadius', 'clubSizes',
            'chatColors', 'tactical', 'partidos', 'partidosRadius',
            'clubsExplorer', 'clubsExplorerRadius',
          ],
          message:
            'La app tiene UNA paleta: `reservas`/`reservasRadius`/'
            + '`reservasSizes`/`reservasFonts`. Las familias viejas se '
            + 'borraron el 2026-09-16 — ver '
            + 'docs/superpowers/specs/2026-09-16-estetica-unica-design.md',
        }],
      }],

      // ── Señales útiles que no bloquean ─────────────────────────
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': [
        'warn',
        { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  {
    // Las pruebas corren con el runner de Node y usan CommonJS.
    files: ['**/__tests__/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
];
