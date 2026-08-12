# El contexto de la acción del desafío se arma en una función pura

Fecha: 2026-08-11

## Qué pasó

El chat de negociación (`challenge:<id>`) quedaba **en blanco**: no cargaba,
no mostraba error y se llevaba por delante toda la app.

La causa fue un `ReferenceError: myClubId is not defined` dentro de un
`useMemo` de `ChatThreadScreen`. La variable local se llamaba `miClubId`
—siguiendo el estilo en español del repositorio— pero el contrato de
`getChallengeCta` usa la clave en inglés `myClubId`, y el objeto se armaba
con la forma abreviada:

```js
const miClubId = …;
return getChallengeCta({ challenge, myClubId, … });  // identificador inexistente
```

Con la forma abreviada, un desajuste de nombres no produce una clave mal
puesta —que sería un fallo silencioso y acotado— sino una referencia a un
identificador que no existe: excepción en cada render.

## Por qué no lo atrapó nada

- No hay ESLint en el proyecto, así que no había `no-undef`.
- Babel y Metro no fallan por identificadores no definidos: se resuelven en
  tiempo de ejecución.
- No hay pruebas de render (decisión C8: solo funciones puras con `node:test`).
- No hay ningún error boundary, así que React desmontaba la raíz entera y
  la página quedaba **blanca**, sin mensaje. Cuesta mucho más diagnosticar
  una pantalla en blanco que un error visible.

## Decisión

El contexto que consume `getChallengeCta` se arma en
`challengeCtaContext()` (`src/utils/challengeThread.js`), función pura y
cubierta por pruebas que fijan **el nombre de la clave**, no solo su valor.
La traducción entre el nombre local en español y la clave del contrato
ocurre en un único lugar.

Regla general: cuando un valor cruce hacia un contrato con nombres en otro
idioma, escribir la clave explícita (`myClubId: miClubId`) en vez de usar
la forma abreviada.

## Pendientes que dejó

- **No hay ESLint.** Es la herramienta que habría atrapado esto en un
  segundo. Mientras no exista, pasar `npx eslint --no-config-lookup` con
  `no-undef` sobre lo modificado antes de dar por terminado un cambio de
  interfaz. Al hacerlo apareció además `messagesChannelSeq`, otro
  identificador inexistente en `subscribeToClubMessages()`: función muerta,
  sin llamadores, eliminada.
- **No hay error boundary.** Cualquier excepción de render deja la app en
  blanco. Vale la pena uno permanente, pero es trabajo aparte.

## Notas relacionadas

- [Chat](../funcionalidades/chat.md)
- [Clubes](../funcionalidades/clubes.md)
