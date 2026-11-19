# Por probar al final

Última revisión: 2026-11-18

## Qué es esta nota

La lista de lo que se **cambió y no se pudo probar** en su momento, para
recorrerla de una vez al final, antes de lanzar. Pedido explícito: lo que no
se prueba al hacerlo se anota acá y se prueba al final, todo junto.

Cada ítem dice **qué se cambió**, **qué sí se comprobó** y **qué falta y
cómo**. Cuando un ítem queda probado, se borra de acá y el resultado se anota
en la nota del dominio (o en [Pruebas](pruebas.md)). Lo que es trabajo por
hacer —no por probar— vive en [Pendientes](pendientes.md).

## Recorrido del 2026-11-18 (lo que se pudo probar sin cuentas)

Contra producción, sin crear ni borrar nada: los 14 cron de `futfinder-*` terminan en `succeeded`, incluido `futfinder-push-receipts`; `eliminar-cuenta`, `pagar-reserva` y `send-push` responden 401 sin sesión, y `flow-confirmacion` 503 «sin configurar», porque Flow todavía no tiene claves. En www.futfinder.cl (despliegue `559644c`): `/eliminar-cuenta` abre sin sesión; Términos y Privacidad muestran FutFinder SpA, el RUT y el domicilio; `/ui-reservas` ya no existe en producción, sino que vuelve al inicio; el registro rechaza 13 años («Debes tener entre 14 y 99 años») y deja pasar 14 recién cumplidos (probado con el correo vacío, sin enviar nada).

**Encontrado en el recorrido:**
- La **migración 190 no está aplicada y `conciliar-pagos` no está desplegada** (responde 404). Ya figuraba en [Pendientes](pendientes.md) como «sin aplicar ni desplegar»; hay que hacerlo antes de abrir pagos.
- `/.well-known/apple-app-site-association` y `assetlinks.json` devuelven la página web y no el archivo: esperan el Team ID y la huella SHA-256.
- Hay **2 reportes pendientes con más de 24 horas**: resolverlos desde Ajustes → Moderación sirve además como la prueba 6i.
- `aceptaciones_legales` está vacía: no hay cuentas nuevas desde la 181. Se prueba con la primera cuenta que se cree.
- En el registro, «Continuar con Google» y «Continuar con Apple» sólo decían «Muy pronto»: **quitados el mismo día** y comprobado en la web local. También se quitó la fila «Ñuñoa, Santiago · cambiar» (Reservas), y «Cómo llegar» de la ficha del recinto ahora abre Apple Maps en iPhone y Google Maps en Android y la web. *Comprobado:* 6 pruebas de `enlaceComoLlegar`, y los dos enlaces armados para MaiClub abren la ruta al recinto en Google Maps y en Mapas de Apple (web). Desde el mismo día también Mis reservas, el detalle del partido y «Mi cupo» usan esa función (los de partido, sólo con la ubicación exacta). *Falta:* con sesión, ver Reservas y la ficha del recinto, y tocar los cuatro «Cómo llegar» en un iPhone (abre la app Mapas) y en un Android (abre Google Maps).
- La bandera `asientos_por_nombre` vence el 2026-12-30.

## Lo que hace falta para probar casi todo

- **Un build nativo** (EAS, Android e iOS) con lo que hay en `main`: íconos,
  permisos, recuperar contraseña, borrar cuenta, edad fija, push tras el
  segundo paso y el aviso de modo de prueba en el pago. Esta Mac no tiene
  Xcode ni el SDK de Android: el build sale por EAS (`npm run build:android`
  / `build:ios`) y se prueba en un teléfono.
- **Dos o tres cuentas de prueba desechables** en producción, una con fotos
  subidas (avatar y galería), otra con una app de autenticación (TOTP).
- **Claves de Flow en modo sandbox** cargadas en Supabase → Edge Functions →
  Secrets: `FLOW_API_KEY`, `FLOW_SECRET_KEY` y `FLOW_AMBIENTE=sandbox`
  (obligatoria desde el 2026-11-13).

## 1. Cuentas (2026-11-13, commits 87e0881 y 75b1c89)

- **Borrar la cuenta de punta a punta.** Comprobado: migración 176 con arnés
  17/17 y control negativo contra producción; `eliminar-cuenta` v1 responde
  401/405 sin sesión. **Falta:** con una cuenta desechable que tenga avatar,
  galería, un club fundado con otro integrante, un partido por jugar y otro
  jugado: borrarla desde Ajustes y mirar que (a) la sesión se cierra, (b) el
  club sigue y el otro integrante quedó admin con aviso, (c) el partido por
  jugar se canceló con aviso, (d) las carpetas de la cuenta en `avatars` y
  `profile-gallery` quedaron vacías y `cuentas_por_limpiar` la marca limpia.
  Y un caso bloqueado (con saldo, o única admin de un recinto): el mensaje se
  ve en español y la cuenta sigue.
- **Recuperar la contraseña.** Comprobado: 14 pruebas de Node de
  `recuperacionPolicy`, y en el navegador la pantalla abre con el correo ya
  escrito y sin el correo en la URL. **Falta:** con un correo real: que llegue
  el código, que «Reenviar código» funcione, que con TOTP pida el segundo
  código, que la contraseña nueva sirva para entrar, que la vieja ya no, y que
  otra sesión abierta (otro navegador) quede cerrada. Desde Iniciar sesión y
  desde Ajustes. En web y en el teléfono.
- **Eliminar mi cuenta en una app ya instalada** (build anterior, que llama la
  RPC directo): los datos se borran y los archivos quedan en la cola; la
  primera vez que alguien borre su cuenta con el build nuevo, la función
  limpia la cola. Mirar `cuentas_por_limpiar` después.

## 2. Tiendas (2026-11-13, commit 87e0881)

- **Íconos, splash y permisos.** Comprobado: `expo config --type introspect`
  (iOS sólo pide ubicación «mientras se usa» y fotos, en español; Android
  quita micrófono, cámara, ubicación en segundo plano). **Falta:** verlos en
  un build (ícono en la pantalla de inicio de los dos sistemas, ícono
  adaptativo con máscara redonda, splash, ícono de notificación en Android) y
  que App Store Connect acepte el ícono sin canal alfa.
- **Que el build de tienda salga.** Desde el 2026-11-13 `eas.json` usa
  `appVersionSource: "remote"` (con la config dinámica, `"local"` hacía
  fallar el `autoIncrement`; ver [Despliegue y entornos](../arquitectura/despliegue-y-entornos.md)).
  Falta el primer build de `production` para verlo salir.

## 3. Seguridad con una cuenta normal (2026-11-13, migración 177, commit 2acfff2)

Comprobado: arnés de la 177 contra producción (todos los casos, con controles
de que lo legítimo sigue), y desde fuera la API anónima, los buckets sin
listado y las URL públicas. **Falta, en la app con cuentas reales:**

- **Uso normal sin regresiones:** publicar un partido normal; publicar el
  partido de un desafío aceptado (flujo antiguo de clubes); aceptar una
  solicitud de amistad; aceptar una invitación a club; retirar y deshacer una
  respuesta a un desafío abierto; cambiar avatar y portada (usan `upsert`),
  borrar una foto de la galería propia y del club, cambiar el escudo del club
  (`list` + `remove`). Todo eso depende de las políticas que cambió la 177.
- **Bloqueo:** bloquear a alguien y comprobar en su sesión que no puede
  escribir ni leer el DM, tampoco en tiempo real.
- **Editar perfil con la edad ya puesta:** el campo se ve fijo y guardar el
  resto funciona. **Ajustes de un menor:** encender «Visible en búsquedas»
  muestra el mensaje y vuelve el interruptor.
- **Verificación en dos pasos de punta a punta:** activar TOTP en una cuenta;
  cerrar sesión; entrar con la contraseña y, ANTES del código, comprobar que
  la API rechaza (403 `MFA_REQUERIDA`) y que no se registró el token de push;
  después del código, que todo vuelve y el push se registra. El pre-request de
  PostgREST sólo se probó por SQL y con la clave anónima, **nunca con un JWT
  real de usuario**.

## 4. Personal: dos pasos obligatorios (migración 167, aplicada apagada)

Comprobado: arnés 16/16 contra producción con la bandera encendida y apagada
dentro de la transacción. **Falta:** con el build que trae `MfaSetupScreen`,
que cada moderador y administrador de recinto active su código; recién
entonces `update feature_flags set activo = true where nombre =
'mfa_obligatoria_staff'`, y comprobar con una cuenta de personal que sin el
código pierde el panel y con el código lo recupera. Confirmar antes en el
panel de Supabase que *MFA → TOTP* está habilitado.

## 5. Pagos con Flow (2026-11-13, migración 178, funciones v4, commits eddadb4 y d3fa7b4)

Comprobado: arnés de la 178 15/15 contra producción; 75 pruebas de Deno
(lógica de reintento y de cobros); desde fuera, `flow-confirmacion` 405/503 y
`pagar-reserva` `configurada: false`. **Falta, con claves de sandbox:**

- Pagar una reserva completa y una dividida (cada parte), y ver que se
  confirman.
- Tocar «pagar», cerrar la ventana sin pagar y volver a tocar: tiene que abrir
  **el mismo enlace**. Cambiar la cuota (pago dividido) y volver a pagar: tiene
  que ser una orden nueva.
- Pagar el enlace viejo después de que se armó uno nuevo: el pago queda
  `reversar` con su motivo y llega el aviso «Te devolveremos un pago».
- Pagar y volver a tocar «pagar» antes de que llegue el aviso de Flow: la app
  entra a esperar y la reserva aparece confirmada (`yaPagado`).
- La pantalla de pago muestra «modo de prueba».
- `flow-confirmacion` con un token inventado con forma: 400 (Flow no lo
  conoce). Más de 120 avisos por minuto desde una IP: 429.
- Antes de los pagos reales: cambiar a `FLOW_AMBIENTE=produccion` con las
  claves de la empresa y hacer un pago real chico y su devolución.

## 6. Saldo (migración 178)

Los candados contra el doble gasto y la doble devolución sólo se comprobaron
por presencia (el arnés corre en una sola transacción). **Falta:** la carrera
de verdad con dos sesiones (`scripts/carrera-dos-sesiones.sh` contra la base
local): dos reservas del mismo jugador confirmadas a la vez con saldo para una
sola, y dos cancelaciones del recinto a la vez. Sólo importa cuando exista la
carga de saldo.

## 6b. Asientos de partido (migración 182, 2026-11-14)

**Qué se cambió:** contador «10/14», armado de asientos al publicar, gestión de asientos, link de invitación y período de nombres. Ver [Partidos](../funcionalidades/partidos.md).

**Qué sí se comprobó:** el arnés SQL de la 182 (13 casos, con cambio de rol) contra producción en una transacción revertida; las pruebas de Node de `utils/asientos.js` y `rutasTrasEntrar`; lint en cero errores; el bundle web compila y carga.

**Qué falta, y cómo** (esta Mac no tiene base local ni sesión de prueba, así que **ninguna pantalla nueva se recorrió con una cuenta**):

- La 182 ya está aplicada (2026-11-14). **La bandera `asientos_por_nombre` vence el 2026-12-30**: si el lanzamiento se mueve, hay que mover `feature_flags.termina_at`.
- Con dos cuentas amigas y una tercera: publicar un partido de 14 con un amigo, dos nombres y seis reservas; ver «10/14» en la lista, en Inicio y en el detalle; abrir el link con la tercera cuenta y tomar un asiento; agotar las reservas y ver el mensaje; liberar un asiento y verlo libre; llenar el partido y verlo salir de la búsqueda.
- El link abierto **sin sesión**, entrando por login y por registro completo: tiene que volver al partido con el botón «Tomar mi asiento».
- El amigo asignado: recibe el aviso, ve costo 0 al salirse y el asiento queda libre.
- En el teléfono (build nativo): que `futfinder.cl/p/<id>?inv=…` abra la app con el parámetro, y la hoja de compartir del link.

## 6c. Fútbol 5 y publicar con 14 / falta 1 (migración 183, 2026-11-18)

**Qué se cambió:** la modalidad Fútbol 5 en publicar, editar, filtros, tarjetas y detalle; el formulario abre con 14 jugadores y falta 1; elegir Fútbol 5 sugiere «Cambiar a 10 jugadores». Ver [Partidos](../funcionalidades/partidos.md).

**Qué sí se comprobó:** el arnés de la 183 (6 casos, como `authenticated`) en la base local reconstruida, y su control negativo con el CHECK viejo; el de la 182 sigue 13/13; las pruebas de Node; y en la web local, con una cuenta: abre con 14 y 1, el «−» de faltan no baja de 1, Fútbol 5 aparece y su sugerencia pasa a 10, se publica («9/10»), el detalle y la tarjeta dicen «Fútbol 5» y el filtro lo encuentra (también a 375 px).

**Qué falta, y cómo:**

- ~~Aplicar la 183 en producción antes de subir el cliente~~: **aplicada el 2026-11-18 con el sí de Vicente** (versión `20261118165341`), después de ensayarla con su arnés contra producción en `begin … rollback` (6/6, sin restos). El cliente se subió después. Falta publicar un partido de Fútbol 5 en www.futfinder.cl.
- Editar un partido a Fútbol 5 desde `EditMatchScreen` (el arnés lo cubre por SQL, no por pantalla).
- En el teléfono (build nativo): los tres botones de modalidad y los cuatro del filtro en una pantalla angosta.

## 6d. Al publicar, cada confirmado tiene cuenta o nombre (migración 187, 2026-11-18)

**Qué se cambió:** pedido de Vicente: no publicar partidos con «Jugador reservado» repetido. Publicar bloquea si un confirmado no es amigo ni tiene nombre, marca las filas y lo explica; los nombres genéricos («Jugador 3», «Reservado», «X») se rechazan en cliente y en servidor (`NOMBRES_GENERICOS` en `src/utils/asientos.js` = `_asiento_nombre_generico` en la 187; una prueba de Node compara las dos). Reservar asientos para el link sigue permitido ya publicado, en «Gestionar partido». Se escribió como 185 y se renumeró a **187**: la otra Mac ya había subido su 185 y su 186.

**Qué sí se comprobó:** arnés de la 187 (8 casos, como `authenticated`) en la base local; control negativo con las funciones de la 182/183 en `begin … rollback`: falla en el caso 1 (se publicaban ocho reservados); arneses 182 (13) y 183 (6) siguen bien con la 187; `npm run verify`; y en la web local, publicar con 8 confirmados sin nombre bloquea («Falta 1 campo por corregir») y marca las 8 filas con su explicación. Que el rechazo no deja el partido creado lo comprueba el arnés.

**Qué falta, y cómo:**

- **Aplicada en producción el 2026-11-18 con el sí de Vicente** (versión `20261118165539`), después de la 183 y del cliente nuevo, y tras ensayarla con su arnés contra producción en `begin … rollback` (8/8, sin restos). Comprobado por catálogo: las dos funciones son las nuevas, `anon` no publica y `authenticated` no ejecuta `_asiento_nombre_generico`. Con la 187 aplicada y el cliente viejo, la web manda asientos `reservado` y publicar falla con ASIENTO_SIN_IDENTIFICAR. El cliente nuevo con la base sin la 187 no rompe nada (sólo manda amigos y nombres).
- En la web local no se llegó a probar el camino feliz con nombres ni un nombre genérico rechazado por pantalla (el límite de uso cortó la sesión): sólo el bloqueo.

## 6e. Tres arreglos del 2026-11-18 (perfil, bloqueados en el partido, invitación a club)

**Qué se cambió:** (1) «Mi perfil» abierto encima de otra pantalla (ruta `UserProfile`, p. ej. tocarte en Integrantes) trae flecha para volver, en lugar del pin y sin la campana; (2) en la lista de un partido —la hoja de vista previa y el partido completo— quien bloqueaste sale con «Bloqueado» en rojo y un aviso arriba; (3) migración 188: invitar a alguien a un club le manda un aviso `club_invite` con Aceptar y Rechazar. De paso, `Callout` sin `onPress` salía sin fondo ni borde (un `View` ignora el estilo-función): arreglado para todas las bandas.

**Qué sí se comprobó:** en la web local con cuentas `*_v188`: la marca y el aviso de bloqueado en la hoja y en el partido completo; volver desde «Mi perfil» regresa a Integrantes; invitar → al invitado le llega el aviso, Aceptar lo deja como jugador y al admin le llega «aceptó tu invitación». Arnés de la 188 5/5 con control negativo.

**Qué falta:** la 188 y `send-push` v13 ya están en producción (2026-11-18): falta invitar a alguien en www.futfinder.cl y ver que le llegue el push al teléfono; ver la barra de «Mi perfil» con flecha a 375 px.

## 6f. Reportar club, foto de club y partido (cliente de la 186, 2026-11-18)

**Qué sí se comprobó:** en la web local, con una cuenta que no es del club ni organiza el partido: la bandera aparece, la hoja de dos pasos envía, y el reporte del partido queda en `user_reports` contra el organizador con `elemento = partido:<id>`; el del club, «Reporte enviado»; la foto, desde el visor, con el aviso claro cuando ya hay uno pendiente contra la misma persona.

**Qué falta:** probarlo en www.futfinder.cl y en el teléfono (el visor de fotos y la bandera del partido a 375 px).

## 6g. Exportar mis datos y datos de la empresa (migración 192, 2026-11-18)

**Qué sí se comprobó:** arnés de la 192 contra producción revertido (3/3: trae lo propio de cada tabla, nada de otra persona, sin cuenta no); pruebas de Node de los textos legales.

**Qué falta:** con una cuenta real que tenga reservas, mensajes y un ticket, tocar «Exportar mis datos» en www.futfinder.cl y en el teléfono y revisar el archivo (que traiga las secciones nuevas y que no se corte al compartir un JSON grande en Android). *Probado el 2026-11-18:* Términos y Privacidad en www.futfinder.cl muestran la razón social, el RUT y el domicilio.

## 6h. Comprobantes de push (migración 193, 2026-11-18)

**Qué sí se comprobó:** arnés 5/5 contra producción revertido (pide, no repite, procesa la respuesta, borra el token muerto y no el vivo), con la respuesta de Expo simulada en `net._http_response`.

**Qué falta:** con el build y un teléfono real, mandar un push y a los 15–30 minutos ver en `push_tickets` el `receipt_status = 'ok'`; después desinstalar la app, mandar otro y ver que el token desaparece de `push_tokens`.

## 6i. Resolver reportes (migración 194, 2026-11-18)

**Qué sí se comprobó:** arnés 12/12 contra producción revertido (sólo el padrón resuelve, la cola trae los datos nuevos, quitar contenido borra la foto y avisa, suspender cierra los otros reportes y bloquea mensajes y fotos con la fecha, reportar sigue permitido, descartar no avisa, no se resuelve dos veces, días validados, tabla cerrada al cliente); pruebas de Node de las decisiones, los textos y el destino del aviso.

**Qué falta:** con la sesión de quien modera, abrir Ajustes → Moderación y ver una fila de reporte con descripción, reportado y previos; con una cuenta de prueba reportada por otra, probar Advertir, Quitar contenido (una foto de club) y Suspender 7 días, y ver el aviso «moderacion» en la bandeja y como push (al tocarlo abre Términos). Con la cuenta suspendida, intentar escribir en un chat y subir una foto: tiene que salir «Tu cuenta está suspendida hasta el …». Después levantar la suspensión con el `update` de [Revisión diaria](revision-diaria.md).

## 6j. Página pública para eliminar la cuenta (2026-11-18)

**Qué sí se comprobó:** `/eliminar-cuenta` se abre sin sesión en la web local y muestra el texto completo; la base borra en cascada todo lo que la página dice que se borra (perfil, fotos, teléfono, amistades, bloqueos, mensajes, avisos, inscripciones, tokens de push); pruebas de Node (ruta pública, los tres impedimentos de la 176, el nombre del botón).

**Qué falta:** que el aviso de moderación abra Términos (ya no el paso del registro). *Probado el 2026-11-18:* `https://www.futfinder.cl/eliminar-cuenta` abre sin sesión con el despliegue `559644c`.

## 7. Lo que ya estaba sin probar antes de esta tanda

- **Push en un teléfono físico** (el P1 de [Pendientes](pendientes.md)):
  permisos, token, una categoría permitida, una bloqueada por preferencia, y
  token inválido. Con el ícono de notificación nuevo.
- **La migración 175** (chat por Broadcast) está aplicada en producción y su
  archivo y los cambios del cliente se subieron el 2026-11-18: probar el chat
  en tiempo real con dos sesiones.

## Trabajo del 2026-11-14 (informe técnico)

- **Íconos en el build nativo** (plugin `lucidePorIcono`, commit de «peso del bundle»). *Comprobado:* en web cada pantalla abierta dibuja sus íconos y el bundle bajó de 7,19 a 5,50 MB; las pruebas del plugin. *Falta:* en un build de Android y de iOS, abrir Inicio, un partido, el chat y Ajustes y ver que no falte ningún ícono (el plugin corre igual para nativo, pero acá no hay cómo ejecutarlo). Si faltara alguno, quitar el plugin de `babel.config.js` devuelve todo a como estaba.
- **Alta por correo recuperable** (commit `c9938cc`). *Comprobado:* en web contra la base local, con fallos simulados: falla al guardar la edad → aviso → «Reintentar»; reenvío rechazado por frecuencia; contraseña rechazada → «Crea tu contraseña»; código pegado. *Falta:* en un teléfono, que el teclado ofrezca el código del correo (autocompletado) y que llene las seis casillas.
- **Pausa de pagos, columnas de `pagos` y aceptación de términos** (migraciones 179, 180 y 181, aplicadas el 2026-11-14). *Comprobado:* arneses en local (143/143) y en GitHub; en producción, por catálogo y desde fuera sin sesión. *Falta:* con Flow en sandbox, encender `pagos_en_pausa` y ver el aviso en el resumen y en la pantalla de pago; pagar una reserva y ver que la pantalla de pago sigue leyendo el estado (180); crear una cuenta y ver su fila en `aceptaciones_legales` (181).

## Trabajo subido el 2026-11-18 (lo que esperaba en una de las Macs)

- **Actualizaciones por aire** (`expo-updates`, `runtimeVersion` por `fingerprint`, canales en `eas.json`) y **sólo teléfono** (`supportsTablet: false`). *Comprobado:* nada más que lint y pruebas. *Falta:* un build de producción que reciba una actualización publicada con `eas update --channel production`.
- **Hoja de compartir:** el enlace sale de `utils/direccionPublica.js` (`https://www.futfinder.cl`) y los botones de WhatsApp y otros ya no preguntan `canOpenURL` antes de abrir. *Comprobado:* pruebas de Node; `www.futfinder.cl/p/<id>` responde 200. *Falta:* en un teléfono, cada botón de la hoja abre su app (o cae a compartir si no está).
- **185 aplicada** (2026-11-18; ver [Pendientes](pendientes.md)). *Falta:* en la web, rechazar y cancelar un desafío entre clubes y publicar el partido de un desafío aceptado (enlazarlo pasa ahora por el chequeo nuevo).
- **186 aplicada** (2026-11-18). *Probado el 2026-11-18 en www.futfinder.cl:* 13 años se rechaza y 14 pasa. *Falta:* registrarse de verdad con 14, y una cuenta vieja de 12 o 13 guardando su perfil.

## Notas relacionadas

- [Pendientes](pendientes.md)
- [Pruebas](pruebas.md)
- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
- [Base de datos](../arquitectura/base-de-datos.md)
