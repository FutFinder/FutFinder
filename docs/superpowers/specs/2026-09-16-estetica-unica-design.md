# Una sola estética para toda la app

Fecha: 2026-09-16
Estado: **terminado el 2026-09-16**. Las tres fases están en `main`.

## El problema

`src/theme/colors.js` exporta **siete familias de tokens** y la app usa todas.
Un mismo recorrido cruza cuatro verdes, tres fondos, dos tipografías y cuatro
escalas de radios.

| Familia | Archivos | Verde | Dónde vive |
|---|---|---|---|
| `colors` | 18 | `#71B533` olivo | Onboarding, Términos, Bloqueados, `Banner`, `Button`, `Logo` |
| `dsColors` | 19 | `#5AE06A` | Perfil de jugador, `components/ds/` |
| `clubColors` | 17 | `#5AE06A` | Mi club, Historial, Integrantes, Alineación |
| `chatColors` | 20 | `#5AE06A` | Chat, Amigos, barras de desafío |
| `tactical` | 10 | `#00FF66` flúor | Inicio, Splash, Avisos, `BrandMark` |
| `partidos` | 18 | `#5AE06A` | Módulo Partidos completo |
| `reservas` + `clubsExplorer` | 43 | `#55DF69` | Reservas, Clubes, Ajustes, Desafíos |

## La decisión

**Una sola familia: `reservas` (`#55DF69` + Manrope).** Las otras seis
desaparecen. Decidido con Vicente el 2026-09-16, incluyendo los dos casos con
filo:

- **Inicio y el logo entran.** `tactical` era deliberadamente distinta —el
  código la justifica como «cancha nocturna»— y de ella salía el neón del
  wordmark futfinder. Se unifica igual: el logo pasa a `#55DF69`.
- **Manrope también.** Son ~523 `fontWeight` en 103 archivos. Van junto con el
  color de su módulo, nunca por separado.

**El verde no se expande, solo cambia de tono.** El mapeo es por rol: lo que
hoy es verde pasa a verde nuevo, y el texto blanco sigue blanco. De los seis
roles de la paleta, uno solo es verde.

## Lo que hay que entender antes de tocar nada

Al extraer las claves que el código referencia de verdad (no las que el theme
declara), aparecen tres grupos, y **solo el primero es estética**:

1. **Neutros que a `reservas` le faltan.** `partidos` usa ocho escalones de
   texto; `reservas` tiene tres. Faltan superficies de chip, divisores,
   `track`, `grip`, `scrim`.

2. **Semánticos, que son significado y no estética.** Victoria/empate/derrota,
   el dorado Premium, el ámbar de pendiente, el rojo de error, y el `#FF2D55`
   del desafío recién aceptado. **Se conservan.** Lo que sí se arregla es que
   hoy el rojo existe cinco veces con cinco valores (`error`, `loss`, `coral`,
   `danger`, `red`).

3. **Degradados.** `hero`, `heroNeutral`, `avatar`, `metal`, `headerGradient`,
   `clubShield`, `challengeShield`. `reservas` no tiene ninguno, y es la razón
   por la que `tactical` no se puede aliasear sola.

## Fase 1 — el alias (un commit)

`reservas` crece hasta cubrir el vocabulario completo, y las seis familias
viejas dejan de tener valores propios: pasan a derivarse de ella, clave por
clave. **Ninguna pantalla se toca.** La app entera queda del mismo verde en un
commit chico y reversible.

Inicio y Splash necesitan decisiones a mano por los degradados y el negro puro.

### La red de seguridad

Un token que no existe no avisa en React Native: `undefined` pinta transparente
o negro, y solo se ve abriendo la pantalla. Por eso la fase 1 lleva una prueba
que **extrae del código las claves que cada familia usa de verdad** y falla si
alguna queda sin valor después del alias. Es la única forma de cubrir 100
pantallas sin abrirlas una por una.

### Lo que la fase 1 NO toca, y por qué

- **Los radios.** `radius`, `dsRadius`, `partidosRadius` y `clubsExplorerRadius`
  siguen intactos. Cambiarlos mueve la geometría de cada esquina de la app; eso
  se mira módulo por módulo, con la pantalla delante.
- **La tipografía.** Va con el módulo, en la fase 2.
- **`clubTonos` y `clubSuperficies`.** Sus valores están MEDIDOS:
  `clubThemes.test.js` exige distancia de color entre el peligro y el tema rojo
  del club. Cambiarlos es volver a medir, no reemplazar un token.
- **`premiumGold` de `PremiumBadge`** (`#D4A437`), que no vive en el theme.
  `reservas.gold` quedó en `#F0C85A`, que es el que ya usaban tres de las
  cuatro familias. Se unifican cuando migre Clubes.

## Fase 2 — la migración real (un commit por módulo)

De menor a mayor riesgo. Cada módulo pasa a los nombres nuevos y a Manrope, y
borra su alias al terminar:

1. Onboarding y compartidos (`colors`, 18 archivos)
2. Perfil (`dsColors`, 19)
3. Clubes restantes (`clubColors`, 17)
4. Chat (`chatColors`, 20)
5. Partidos (`partidos`, 18)
6. Inicio (`tactical`, 10)

## Fase 3 — el candado

Lo que impide volver atrás no es documentación: es que **el export deje de
existir**. Al terminar la fase 2 se borran las seis familias de
`theme/colors.js`. Encima va una regla `no-restricted-imports` en
`eslint.config.mjs` nombrando esos seis, **como error**. Entra al final: antes
dejaría el lint rojo de forma permanente, y este repositorio trata un error de
lint como un fallo de verdad.

Además hay que reescribir `docs/memoria/diseno/sistema-visual.md`, que hoy dice
lo contrario: *«No se debe sustituir la paleta global por una de estas familias
de manera masiva»*.

## Verificación por commit

- `npm run verify` — 0 errores de lint, todas las pruebas
- `npx expo export --platform web` — salida 0, caza los imports rotos
- El chequeo de que todo `styles.X` usado existe
- La prueba de cobertura de tokens de la fase 1

## Fase 4 — el renombre (hecho el 2026-09-17)

El nombre `reservas` para la paleta de toda la app venía del handoff de un
vertical. Se esperó a que no quedara ninguna familia vieja para no mezclar un
renombre con una migración:

| Antes | Ahora |
|---|---|
| `reservas` | `paleta` |
| `reservasRadius` | `radios` |
| `reservasSizes` | `medidas` |
| `reservasFonts` | `fuentes` |

Los 168 archivos que la importan lo hacen con alias (`paleta as C`, `radios as
R`…), así que fue una línea por archivo. `tema` se descartó: ya son las escalas
de identidad de club (`temaDeClub`, prop `tema`), 309 usos.

**Lo que NO se renombró**: la tabla `reservas` de la base, el módulo de
producto (`services/reservas.js`, `components/reservas/`, las pantallas) y los
textos. El renombre era del token, no de la palabra.
