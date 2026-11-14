# Plan de trabajo autónomo a partir del «Informe técnico FutFinder» (2026-11-13)

> **Para la sesión que retome esto (Fable 5.2, después de compactar):** este
> archivo es lo único que necesitas leer del informe. El PDF original está en
> `~/Downloads/Informe_tecnico_FutFinder.pdf` (50 páginas; sólo las 1–13 son
> análisis, de la 14 a la 50 es inventario de archivos). Ya se leyó entero y
> se contrastó contra el código; lo que importa está aquí.
>
> **Cuando todo lo de la sección 2 esté hecho, borra este archivo** (regla
> del proyecto: informe cerrado se borra) y deja lo que siga vivo en
> `docs/memoria/operacion/pendientes.md`.

## 0. Contexto mínimo

- Vicente está durmiendo y quiere que se avance **sin pedirle autorizaciones
  ni que él tenga que tocar paneles o páginas**. Trabaja solo en código.
- Lee `CLAUDE.md` y respétalo: `git pull` antes de editar; español de Chile;
  `npm run verify` (lint 0 errores + Node + Deno) antes de cada commit;
  `git add` sólo de los archivos de cada tarea; commit descriptivo y `git
  push`; nunca push forzado; si hay conflicto o cambios ajenos, detente.
- **Hay otra Mac trabajando en el mismo repo** (autor Johan Sedini). Antes
  de cada tarea: `git pull` y `git log --oneline -15` para no repetir algo
  que ya se hizo (pasó varias veces hoy: muchas cosas del informe ya estaban
  cerradas). Verifica contra el código antes de tocar.
- **Producción: NO aplicar migraciones ni desplegar Edge Functions.** Un
  despliegue a producción pide el sí explícito de Vicente (y el clasificador
  del modo automático lo bloquea). Lo que necesite servidor se **prepara**:
  migración + arnés probados en la base local, Edge Function con pruebas de
  Deno y registrada en `supabase/functions/despliegues.json` como
  `pendiente` (con el sha256 exacto; ver `_lee_esto` de ese archivo). Y se
  deja anotado en `pendientes.md` qué falta aplicar.
- **Numerar migraciones:** producción tiene todo hasta la **178** salvo la
  149 (comprobado 2026-11-13 con `list_migrations`). Antes de crear una,
  mira `ls supabase/migrations | sort -V | tail` y el registro remoto
  (`list_migrations`, sólo lectura) y usa el siguiente número libre (179+).
  El orden lo fija `scripts/ordenMigraciones.js`.
- **Base local** (para migraciones y arneses): `colima start`; `cd
  ~/.futfinder-local && npx supabase start`; `cd ~/Desktop/FutFinder && node
  scripts/construir-base.mjs --sin-149` (sobre base vacía: antes `npx
  supabase stop --no-backup`); `node scripts/correr-arneses.mjs [prefijo]`.
  El 2026-11-13 dio **140/140**. Al terminar, `npx supabase stop` y `colima
  stop`. Los arneses cambian de rol (`set local role authenticated`) y
  prueban el código de error (42501), no «algo falló»; toda guarda nueva se
  prueba también con el arreglo revertido.
- **App web contra la base local:** `preview_start` con `futfinder-web-local`
  (o `npm run web:local`) y comprobar que el bundle no apunta a producción
  (ver memoria «Correr la app contra la base local»). Para llegar a pantallas
  sin escribir en producción se puede interceptar `fetch` en el navegador.
- Estado al escribir esto: `main` en `666b998`, árbol limpio, verify en
  verde (1988 Node + 75 Deno), lint con 9 avisos (todos `exhaustive-deps`).

## 1. Lo que el informe pide y NO se puede hacer solo (no lo intentes)

Requiere a Vicente, una cuenta, un pago o una decisión de producto:
encender «Confirm email» en el panel; Google y Apple (consolas y
credenciales; Apple Developer va a nombre de la empresa, recordatorio
programado para el 2026-11-14 10:00); comercio de Flow y cobro real;
entorno de staging (otro proyecto Supabase y otro sitio Vercel); respaldos y
restauración (plan Pro); fichas de tiendas, App Privacy / Data safety;
política de menores y edad mínima; estados y medidas de la moderación de
reportes; revocar el token de GitHub; encender `mfa_obligatoria_staff`;
build nativo y pruebas en teléfono; la **migración 175** (chat por
Broadcast) que está aplicada en producción pero cuyo archivo sigue sin
commitear **en la otra Mac** (no la recrees: avísalo); liquidación y
facturación (asesoría contable).

Ya resuelto hoy (no repetir): SMTP propio con Resend y plantillas con
código de 6 dígitos; dominio `futfinder.cl`; versionado remoto de EAS
(`666b998`); enlaces universales preparados (faltan Team ID y SHA-256);
arneses 140/140; las 4 Edge Functions comparadas con producción.

## 2. Lista de trabajo autónomo, en orden

Cada ítem: qué, por qué (página del informe), dónde, cómo se cierra.

### 2.1 Alta por correo recuperable — P0, sólo cliente (informe p. 6)
**Verificado en el código:** `src/screens/VerificationScreen.js` ignora el
resultado de `updateMyProfile({ edad })` (líneas ~81 y ~104) y de
`resendOtp` (~123); el temporizador de reenvío es de **42 s** (~43 y ~119)
mientras Auth exige **60 s** entre envíos (`max_frequency`; confirmar en
`supabase/config.toml` y en la doc de Supabase). La contraseña vive sólo en
memoria (`src/services/pendingSignUp.js`, a propósito: no la persistas),
así que si la app se recarga tras enviar el código, la persona queda con una
cuenta creada y sin contraseña.
**Hacer:** (a) que un fallo al guardar la edad o al reenviar se vea y deje
reintentar, con mensajes en español; (b) temporizador alineado al límite
real (60 s) y mensaje si Auth contesta por exceso de envíos; (c) camino de
retorno: si se pierde la contraseña en memoria (recarga), la pantalla debe
ofrecer terminar el alta por el flujo de **recuperar contraseña con código**
que ya existe (ver `docs/memoria/funcionalidades/autenticacion.md` y
`src/services/recuperacionPolicy.js`), sin guardar la contraseña en ningún
lado. Lógica pura en `src/utils/` con pruebas de Node; probar en web contra
la base local (Mailpit en `http://127.0.0.1:54324` recibe los códigos).
**Cierre:** pruebas nuevas en verde, recorrido en web local con recarga a
mitad del alta que termina bien, nota de Autenticación al día.

### 2.2 Integración continua en GitHub — P0 de proceso (p. 11)
No existe `.github/workflows`. Crear un workflow para cada push/PR a `main`:
`npm ci`, `npm run lint`, `npm test`, Deno **obligatorio** (instalar con
`denoland/setup-deno`; hoy `scripts/pruebas-edge.mjs` sale con 0 si falta
Deno: agregar una variable, p. ej. `EXIGIR_DENO=1`, que lo haga fallar en
CI sin cambiar el comportamiento local) y `npm run build:web`. Opcional en
un segundo job: los arneses SQL con la CLI de Supabase (si es viable sin
secretos; si no, déjalo anotado). Sin secretos en el workflow. Probar la
sintaxis localmente (p. ej. `npx --yes action-validator` o revisar con
cuidado) y confirmar el primer run con `gh run list` después del push.
**Cierre:** el run de GitHub en verde; nota en `operacion/pruebas.md` y
`calidad-y-lint.md`.

### 2.3 Textos que ya no dicen la verdad — P1 (p. 12)
**Verificado:** `src/data/legal.js` (~línea 63) dice que las capturas de
reportes «se guardan con un enlace público»; desde la migración 174 el
bucket `support-screenshots` es **privado** y el correo lleva enlace
firmado. Corregir sólo esa afirmación (las fotos de perfil, portada y
galerías siguen públicas: compruébalo en las migraciones antes de
escribir). Revisar `src/data/__tests__/legal.test.js` y la prueba
`terminosNoMiente`. En `docs/memoria/operacion/revision-diaria.md` (~línea
36) la nota «esta consulta no ve todo… reserva confirmada pagada» es
anterior a la **168**, que ya encola esas devoluciones en `reversar`:
alinearla. No cambies nada de edad/menores (decisión pendiente de Vicente).

### 2.4 Pagos: éxito de negocio al anotar la referencia — P0 (p. 9)
`supabase/functions/pagar-reserva/index.ts` (~263) sólo mira el error de
transporte de `anotar_referencia_pago`. Leer la función SQL vigente
(migración 178 o la última que la redefine): si devuelve algo como `{ok:
false}` o `null` cuando no encontró la orden, tratarlo como fallo (sin
crear otra orden en Flow: el reintento ya consulta el token anterior, ver
`queHacerConPendiente` en `_shared/flowPagos.ts`). Pruebas de Deno.
**Queda como `pendiente` en `despliegues.json`, sin desplegar.**

### 2.5 Pagos: interruptor para cortar nuevas órdenes — P1 (p. 13)
«Prever una bandera para cortar nuevas órdenes sin interrumpir callbacks ni
conciliación.» Hay `feature_flags` y `flag_activo()`. Preparar: migración
que crea la bandera (apagada = se puede pagar), `pagar-reserva` que la
consulta antes de crear la orden y responde un motivo claro, y la pantalla
de pago que muestra ese motivo (en español). `flow-confirmacion` NO la
mira. Arnés + pruebas Deno. **Sin aplicar ni desplegar**; anotarlo.

### 2.6 Pagos: vista acotada de `pagos` para el cliente — P1 (p. 9)
«Auditar el acceso a `pagos.datos`, que puede guardar datos del proveedor,
y exponer al cliente una vista acotada.» Revisar las políticas y grants
vigentes de `pagos` y qué lee el cliente (`src/services/pagos.js`). Si el
cliente puede leer `datos` completo, preparar migración que le quite esa
columna (grant por columna, mismo patrón de la 165/177) o una vista/RPC
acotada, ajustando el cliente para que no la necesite. Arnés con cambio de
rol. **Sin aplicar.**

### 2.7 Pagos: carrera de dos pagos por el mismo bloque — prueba (p. 5, 9)
«Con dos clientes y la misma hora, solo una reserva se confirma y el pago
restante queda identificable para devolución.» Hay arneses de concurrencia
`.cjs` en `supabase/tests/` (con `pg`, dos conexiones) y
`scripts/carrera-dos-sesiones.sh`. Escribir uno nuevo para `confirmar_pago`
de dos reservas sobre el mismo bloque, contra la base local. Si descubre un
fallo real, documentarlo y preparar la corrección (sin aplicar).

### 2.8 Aceptación de términos versionada — P0 (p. 6)
Hoy el alta acepta términos en la interfaz pero el servidor no guarda qué
versión ni cuándo. Preparar: migración (columnas en `profiles` o tabla
`aceptaciones_legales` con versión y fecha, escritura sólo por RPC),
constante de versión en `src/data/legal.js`, y el cliente la registra al
terminar el alta **tolerando que la RPC no exista** (producción no la tendrá
hasta aplicar la migración, y no hay OTA). Arnés. **Sin aplicar.**

### 2.9 Conciliación de pagos pendientes viejos — diseño (p. 9)
Proponer (no aplicar) una tarea programada que revise pagos `pendiente`
antiguos consultando a Flow por token y los resuelva con la misma lógica de
`flowPagos.ts`. Ojo: un enlace de Flow puede seguir pagable; no marcar como
rechazado sin preguntarle a Flow. Si el diseño depende de una decisión
(plazo de vencimiento, quién recibe la alerta), escríbelo en
`pendientes.md` como decisión para Vicente en vez de decidirlo.

### 2.10 Peso del bundle web — P2 (p. 11)
El informe midió 7,18 MB sin comprimir. Medir con `npx expo export
--platform web` (en el scratchpad), ver qué pesa más (íconos de
`lucide-react-native` importados enteros, mapas, emoji keyboard) y aplicar
sólo mejoras seguras y medibles. Anotar antes/después.

### 2.11 Los 9 avisos `react-hooks/exhaustive-deps` — P2
Sólo los que se puedan corregir sin cambiar cuándo se recarga una pantalla
(memoizar funciones con `useCallback`, por ejemplo). Si cambia el
comportamiento, déjalo y explica por qué.

## 3. Al terminar cada ítem

`npm run verify`, `git status`, commit sólo de esos archivos, `git push`.
Actualizar únicamente la nota de memoria afectada. Si algo quedó preparado
para producción, anotarlo en `pendientes.md` con el número de migración o
la función y la frase «falta el sí de Vicente para aplicar/desplegar».
Al final, un resumen corto para Vicente: qué se hizo, qué quedó preparado
sin aplicar y qué necesita de él.
