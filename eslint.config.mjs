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
      '.worktrees/**',
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
