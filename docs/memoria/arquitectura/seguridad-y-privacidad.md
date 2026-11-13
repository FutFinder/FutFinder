# Seguridad y privacidad

Última revisión: 2026-11-09

## Propósito

Resumir qué límite aplica el backend y qué controles de interfaz sólo mejoran la experiencia.

## Estado verificado

Auth de Supabase define la identidad; `AuthProvider` y `withAuthGuard` evitan montar rutas operativas sin sesión, pero RLS y las RPC son la frontera de autorización. El cliente usa solamente variables públicas de configuración y debe mantener fuera del repositorio y de la aplicación las credenciales administrativas y los archivos de servicios de plataforma.

## Reglas aplicadas en backend

- **Reputación del perfil (migración 102, verificada el 2026-09-15):** `authenticated` solo puede actualizar los 25 campos editables que usa `updateMyProfile`, incluido `updated_at`; `anon` no tiene permisos de actualización. Trust Score, estadísticas, sanciones, identidad y fecha de creación quedan fuera. `profiles_update_self` limita además las filas al perfil propio. Las RPC `security definer` conservan la escritura necesaria para aplicar reputación; no se debe volver a conceder `UPDATE` sobre toda la tabla. La regresión `supabase/tests/profiles_reputacion_protegida_test.sql` verifica ambas restricciones y que una salida legítima siga descontando puntos.
- **Los permisos del club mueren con la membresía (migración 129, reproducido en producción el 2026-09-21):** `tiene_permiso_de_club` resolvía la excepción individual sin exigir membresía, y `club_member_permission_overrides` cuelga del club y de `auth.users`, no de `club_members`. Un expulsado con `editClub` delegado seguía editando el club. Ahora el ayudante devuelve `false` de entrada si la persona no está en `club_members` —eso protege a todas las políticas y RPC que lo usan— y un trigger borra sus excepciones al terminar la membresía, para que una reincorporación no las resucite en silencio.
- **Una política autoriza la FILA, no las columnas (migración 129).** `clubs_update` deja editar al que tiene `editClub`, pero `authenticated` tenía UPDATE sobre TODAS las columnas de `clubs`: un administrador se ponía `plan = 'premium'` y `verificado = true` (la columna `plan` se borró después, en la migración 152; `verificado` sigue protegido). Y en `club_join_requests` tenía UPDATE sobre `club_id`, así que el invitado del club A apuntaba su invitación al club B, la aceptaba y el trigger le creaba la membresía en B. Los dos se cerraron con privilegios POR COLUMNA: en `clubs` se conceden sólo las que escribe el formulario, el logo y el banner; en `club_join_requests`, `status` y `responded_at` para responder y `club_id`/`user_id`/`tipo` sólo al crearla. Ninguna función del esquema escribe esas dos tablas, así que los privilegios son la puerta completa.
- **La ubicación del jugador no vive en `profiles` (migración 139, aplicada el 2026-09-30).** `profiles` se lee con `using (true)` para todos los roles, anon incluido, y ahí estaba la posición GPS del teléfono con 7 decimales: cualquiera con la clave pública sacaba dónde estaba cada jugador. Ahora va a `perfil_ubicaciones`, sin privilegios para nadie, y la app lee sólo la suya con `mi_ubicacion()` (`getMyLocation()` en `src/services/profile.js`). No se usaron privilegios por columna porque `profiles` se lee con `select('*')` en varios servicios y quitar dos columnas hace fallar el `*` entero. Las columnas `latitud`, `longitud` y `location_updated_at` se quedan en `profiles` para no romper el guardado de las apps ya instaladas: `trg_perfil_guarda_ubicacion` desvía lo que llegue y las deja en null, y el CHECK `profiles_sin_coordenadas` hace fallar cualquier camino que se salte el trigger. **Lo que quedaba de ese mismo hallazgo se cerró el 2026-09-30 con la migración 143:** `profiles_read_all` (`to public using (true)`) pasó a lectura por relación —el propio, los descubribles y aquellos con quienes se comparte amistad, club, partido, desafío, lista de espera, bloqueo o la administración de un recinto— y **`anon` no lee ningún perfil**. Comprobado por HTTP con la clave publicable: la misma petición que devolvía las 32 filas ahora devuelve cero.
- **`create_notification` no la ejecuta nadie más que el servidor (migración 140).** La 98 se la dejó a `authenticated` creyendo que la necesitaban sus llamadores internos, pero los 11 son `security definer` con dueño `postgres` y la llaman como postgres. Con ese EXECUTE cualquier cuenta mandaba por RPC un aviso —y su push— con cualquier texto a cualquier usuario. Regla general: **una función `security definer` que sólo usan otras funciones `security definer` no necesita EXECUTE para ningún rol del cliente.**
- Perfiles, partidos, asistentes, clubes, membresías, solicitudes, galerías, reportes, lectura/silencio de chat y tickets de push tienen políticas versionadas. Los tickets no exponen políticas al cliente.
- Las solicitudes de amistad se rechazan en RLS si el destinatario eligió no recibirlas; la visibilidad en búsqueda se filtra desde la consulta de perfiles.
- Chat: los DM requieren amistad aceptada o la excepción de administradores de clubes con desafío aceptado; grupos de partido requieren asistencia inscrita o GPS confirmada y chats de club requieren membresía. Las funciones auxiliares son `SECURITY INVOKER`, con lo que no revelan relaciones a terceros.
- Los triggers de mensajes asignan hora/autores del servidor, bloquean editar contenido y limitan avisos importantes a administradores de club. `/todos` sólo se acepta en grupos y el servidor deriva a sus destinatarios.
- Desafíos entre clubes: la bitácora y las respuestas de prórroga las leen los administradores de los dos clubes; la propuesta oficial la lee cualquier integrante, porque dirección, cuota e instrucciones son lo que un jugador necesita para decidir si va. Ninguna de las tres tiene política de escritura: sólo escriben las RPC. Las de vencimientos están revocadas de todos los roles y corren por `cron`.
- **El partido entre clubes es PRIVADO hasta que termina** (migración 44d). Mientras no esté finalizado sólo existe para los integrantes de los dos clubes —integrantes, no sólo administradores: un jugador tiene que ver el partido de su club para poder ir—. Un externo o un anónimo no obtiene ninguna fila: ni por id, ni listando, ni en la nómina, ni en la lista de espera, ni en la ubicación. Tampoco aparece en Inicio, Partidos, mapa, filtros ni búsquedas, porque todas esas superficies leen `matches` y la RLS las filtra antes.
- El predicado está escrito una sola vez, en la política de `matches`: `challenge_proposal_id is null` (partido normal, público) **o** soy integrante de alguno de los dos clubes. `attendees` y `match_waitlist` se cuelgan de ella con un `exists` sobre `matches`, que ya viene filtrada: si el partido no se ve, sus inscritos y su cola tampoco.
- Las escrituras están cerradas del todo en los partidos de clubes: ni externos ni integrantes se inscriben a mano. Las RPC que inscriben son `security definer` y no pasan por RLS, así que la red es un TRIGGER sobre `attendees` y otro sobre `match_waitlist`: se disparan venga la fila de donde venga y no hay que acordarse de tapar cada función. El trigger deja pasar la fila que trae `club_id`, que es la puerta de `join_club_match()`.
- Desde el despliegue de 44e y 45 el 2026-08-13, también los partidos normales tienen cerrada la escritura directa: toda alta, cambio o baja pasa por una RPC. `approve_join`/`reject_join` no gestionan partidos de clubes, y `cupos_ocupados_club`/`mi_club_en_partido` son helpers internos sin EXECUTE para `authenticated`. La verificación posterior confirmó cero políticas o privilegios de escritura directa y las ACL esperadas.
- La ubicación exacta vive en `club_match_locations` con su propia RLS (migración 44b), y `matches` conserva sólo un punto aproximado de ~1 km marcado con `ubicacion_aproximada`, sin calle. Desde la 44d ninguna de las dos es pública; la aproximada es lo que llevan las listas —pedir la exacta sería una consulta por tarjeta— y queda como defensa en profundidad. La distancia mostrada desde ella puede errar hasta ~0,73 km, y la interfaz lo dice. «Cómo llegar» sólo se habilita con la exacta, y el GPS de asistencia usa exclusivamente la exacta y falla cerrado sin ella.
- Lo ÚNICO público de un partido de clubes es su resultado, y sólo cuando está finalizado: `historial_publico_club()` expone clubes, día (nunca la hora), marcador y V/E/D. Es una proyección `security definer`, no una ventana a la fila: elige las columnas y filtra el estado, así que un partido cancelado o no disputado no se publica, y nunca salen cancha, ubicación, cuota, cupos, nómina, asistencia, chat, propuestas ni cambios.
- El historial que muestra la aplicación es `historial_club()` (migración 49) y respeta ese mismo corte con una sola llamada para todos. Lo público suma dos cosas al día y el marcador: los ESCUDOS de los dos clubes —`clubs.foto_url` ya se lee sin restricción— y el TIPO de partido (recreativo/intermedio/competitivo), que no dice dónde ni cuándo juega nadie. La HORA EXACTA y la CANCHA siguen siendo dato operativo y sólo viajan si quien pregunta pertenece a uno de los dos clubes, el mismo grupo al que la RLS de `matches` ya le muestra la fila completa; para cualquier otro llegan en `null` y la tarjeta no dibuja esa línea. Además exige resultado `confirmado`, de modo que un partido que se cerró sin que nadie confirmara el marcador no se publica como jugado.
- **El encuentro entre clubes tiene una sola puerta para cerrarse y otra para cancelarse** (migración 50). `matches.id_organizador` de un partido nacido de una propuesta es el administrador que la aprobó, y con eso pasaba por dos RPC genéricas que no se pensaron para este flujo: `save_match_attendance()` marcaba la asistencia con −15 de Trust Score por ausente y ponía `finalizado` sin mirar `club_match_results`, y `cancel_match()` cancelaba con penalización personal y sin sanción de club. Las dos rechazan ahora `challenge_proposal_id is not null`. La interfaz ya no las ofrecía —`MatchDetailScreen` calcula `isOrganizer` con `&& !usaNominaClub`—, pero esconder un botón es cortesía y no autorización: es el mismo razonamiento con el que la 44e cerró la escritura directa de `attendees` y con el que la 48b cerró su propia puerta trasera.
- Responder una propuesta —aprobarla o rechazarla— pide dos condiciones, no una: ser administrador de un club del desafío distinto al proponente **y** no pertenecer al club proponente en ningún rol. La primera sola no basta: quien administra el club rival y además juega en el que propuso pasaba el filtro y se respondía a sí mismo. El trigger que impide crear un desafío entre clubes que comparten administrador no cubre esto, porque las membresías cambian después de creado el desafío; hay que volver a comprobarlo al responder. La interfaz espeja la regla (`getChallengeCta` devuelve `conflicto_pertenencia`) para no ofrecer un botón que el servidor va a rechazar, pero la protección es la del servidor.
- Un token de idempotencia que genera el cliente no es una credencial. La primera versión de `crear_propuesta_oficial()` resolvía el reintento por `client_token` antes de autorizar, así que acertar un token entregaba la propuesta a cualquiera; la 43b mueve esa resolución después de derivar el club desde `club_members` y la ata al desafío pedido. En una función `security definer`, todo `return` temprano tiene que estar después de la autorización.
- **Bloqueo de usuarios** (migración 51) vive en `blocked_users`, una tabla nueva, y NO reutiliza `friendships.status = 'blocked'` como fuente de verdad pese a que ese valor existe en el CHECK desde la migración 06 y `messages.js` ya sabía mostrar "Conversación no disponible" para él. El motivo: `friendships_delete` (migración 06) deja borrar la fila a cualquiera de los dos, así que si el bloqueo viviera solo ahí, la persona bloqueada podría desbloquearse a sí misma borrando la fila desde su propio cliente. `blocked_users` sólo se puede leer/crear/borrar como `blocker_id = auth.uid()`, así que la persona bloqueada nunca ve ni toca esa fila. `bloquear_usuario()`/`desbloquear_usuario()` (`security definer`) además escriben/limpian una fila de `friendships` en 'blocked' como EFECTO (no como registro) del bloqueo: eso basta para que `friendships_accepted()` (que sólo deja pasar 'accepted') corte el DM sin tocar la migración 36, y para heredar gratis el mensaje que `messages.js` ya tenía escrito. `friendships_insert` (migración 35) se extendió con `not is_blocked_pair(...)` para que un bloqueo también impida solicitudes de amistad nuevas en cualquier dirección; `is_blocked_pair()` es `security definer` a propósito (la RLS de `blocked_users` no deja ver la fila de la otra dirección) pero sólo devuelve un booleano, nunca revela quién bloqueó a quién.
- Alcance del bloqueo, explícito porque no está cubierto: no filtra a la persona bloqueada de búsquedas, partidos ni chats grupales/de club, sigue viéndose ahí. Si eso hace falta es un alcance nuevo.

## Privacidad y avisos

Las preferencias de solicitudes, descubribilidad, categorías de avisos y radio se guardan en `profiles`. Las preferencias bloquean sólo el push externo: la fila de aviso dentro de la app se conserva. Esas nueve columnas todavía las puede leer cualquier cuenta con sesión sobre los perfiles descubribles: la migración 148 dejó lista la puerta (`mis_ajustes()`) y la 149, que las cierra, **no está aplicada** a propósito hasta distribuir un build (ver [Pendientes](../operacion/pendientes.md)). La Edge Function procesa avisos con credenciales de plataforma, reclama cada envío de forma atómica y registra tickets/recibos sin publicar tokens.

## Limitaciones conocidas

Las políticas y pruebas versionadas no prueban por sí solas qué migraciones tiene aplicadas el proyecto Supabase desplegado; la última comparación documentada ([Estado actual](../operacion/estado-actual.md)) halló en producción todas salvo la 149, que espera un build. El Storage de avatares, galerías y capturas de "Reportar un problema" (`support-screenshots`, migración 52) es de lectura pública por política; no debe usarse para contenido que requiera confidencialidad.

## Fuentes principales

- `src/contexts/AuthContext.js`, `src/navigation/withAuthGuard.js` y `src/utils/buscarJugadoresParams.js`
- `supabase/migrations/35_privacy_friend_requests_rls.sql`, `36_chat_seguridad_rls.sql`, `37_chat_helpers_security_invoker.sql`, `39_chat_mencion_todos.sql` y `51_usuarios_bloqueados.sql`
- `supabase/functions/send-push/`, `supabase/tests/35_privacy_test.sql` y `supabase/tests/51_usuarios_bloqueados_test.sql`
- `src/services/blockedUsers.js`, `src/components/player/PlayerPublicActions.js` y `src/screens/BlockedUsersScreen.js`

## Revocar EXECUTE en una RPC: `public` **y** `anon`, las dos

PostgreSQL concede `EXECUTE` a `PUBLIC` en toda función nueva y `anon` lo hereda por ahí; además Supabase se lo concede a `anon` de forma **directa**. Son dos vías distintas y quitar una no quita la otra: hay que revocar de `public, anon` y volver a conceder a `authenticated`. La nota decía antes «de `public`, no de `anon`» y estaba a medias — la migración 114 midió las dos vías repartidas sobre 146 permisos. El advisor de Supabase («Public Can Execute SECURITY DEFINER Function») solo caza la primera.

## Los privilegios por defecto no cierran las funciones futuras (migración 115)

`alter default privileges ... revoke execute on functions from public` **no funciona**: queda anotado en `pg_default_acl` sin `=X`, pero al crear el objeto el motor parte del valor de fábrica —que para las funciones incluye `EXECUTE` a `PUBLIC`— y encima le aplica lo guardado. Medido el 2026-09-17 con la línea de la 114 ya aplicada: una función nueva nace igual con `{=X/postgres, ...}`. Para las **tablas** sí funciona, porque ahí el valor de fábrica no concede nada a `PUBLIC`.

Lo que sí cierra lo futuro es el disparador de eventos `anon_nace_sin_llaves` (migración 115), sobre `ddl_command_end`. **No lleva `security definer` a propósito**: así corre como quien lanzó el DDL, que es la única forma de retirar lo que concedieron los privilegios por defecto de `supabase_admin` —`postgres` no es miembro suyo y su `revoke` sobre lo ajeno falla en silencio, sin error y sin efecto—. Si alguien le pone `security definer` por costumbre, deja de servir.

Lo que el disparador **no** cubre: `create extension` y cualquier objeto fuera de `public`. El arnés `supabase/tests/115_que_nazcan_cerrados_test.sql` audita el esquema entero en C7 y fija la limitación en L1.

## Ningún secreto vive en el catálogo (migraciones 117 y 118)

El push lo disparaba un Database Webhook del panel que guardaba su `Authorization: Bearer <service_role>` **en claro dentro de `pg_trigger.tgargs`**. Ahora lo dispara `public.notificar_push()`, que saca el token de `vault.decrypted_secrets` al usarlo, y el token es la clave **publicable**, no la maestra. El detalle completo está en [Avisos y push](../funcionalidades/avisos-y-push.md).

Lo que hay que llevarse de acá: **antes de crear un webhook desde el panel, recordar que sus cabeceras quedan legibles en el catálogo**. Si hace falta una credencial, va en Vault y la lee una función nuestra.

## Las extensiones se instalan en `extensions`, nunca en `public` (migración 116)

`create extension foo;` sin `with schema` cae en el primer esquema del `search_path`, que para `postgres` es `public`. Ahí sus funciones nacen **ejecutables por anon** y quedan expuestas por REST. Y no se pueden arreglar después: supautils instala las 78 extensiones de su lista **como `supabase_admin`**, así que el otorgante es supabase_admin y el `revoke` de `postgres` corre sin error y sin efecto.

Tampoco hay disparador que lo cace: **supautils se salta los disparadores de eventos a propósito** —tiene una opción llamada `supautils.log_skipped_evtrigs`—. Medido con un espía sobre los dos eventos: `create extension unaccent with schema public` no produjo ni un disparo, mientras `create table` produjo `ddl_command_start` y `ddl_command_end`.

La palanca que sí funciona es `alter extension ... set schema extensions`, porque supautils también intercepta ese comando y lo corre como superusuario. El trabajo del cron `futfinder-extensiones-fuera-de-public` lo hace cada 5 minutos. Mover no es un apaño: es devolverla a donde ya viven las otras cuatro (`pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `pg_net`).

**Lo que no cubre, con números: 22 de las 78 extensiones no son reubicables**, y entre ellas está `postgis`. A ésas `alter extension ... set schema` responde `0A000: does not support SET SCHEMA`, y sacarlas exigiría `drop extension`, que arrastra en cascada. El barrido las avisa en el registro y las deja. La forma de no llegar ahí es escribir siempre `with schema extensions`.

## Informe de hardening (2026-11-05)

Revisión de cinco puntos que llegaron como una lista genérica. Se verificó cada uno contra el código y la base antes de actuar; **dos no eran lo que decían** (PHP, «admin en el frontend» como tal) y los otros tres sí tenían trabajo. Criterio de referencia: SOC 2 (seguridad, confidencialidad), ISO/IEC 27701 (privacidad) y buenas prácticas CIS/CISSP.

### 1. PHP, runtimes y dependencias

**No hay PHP en ningún lado**: ni `*.php`, ni `composer.json`, ni Dockerfile, ni `.htaccess` (la pila es Expo + Supabase + Edge Functions Deno, desplegada en Vercel). Lo que sí se revisó y se hizo:

- `npm audit fix` sin `--force`: **30 → 15 avisos, y los 12 altos y el crítico (`shell-quote`) pasan a 2 altos y 0 críticos**. Los que quedan (`postcss` anidado en `@expo/metro-config`, `brace-expansion`/`image-size` en herramientas de build, `glob`/`minimatch` de Expo CLI) sólo se arreglan bajando Expo a la SDK 52: **riesgo aceptado**, son herramientas de compilación que no se empaquetan en la app ni procesan entrada de usuarios.
- `@supabase/supabase-js` 2.105 → 2.119; `engines.node >= 20.19.4` en `package.json` (lo que pide Expo 54).
- Las 5 Edge Functions importaban `supabase-js@2` flotante desde esm.sh: se fijó en `@2.119.0` (es la versión que resuelve hoy, así que no cambia el comportamiento). **Pendiente de despliegue**, ver abajo.
- **Falta** (decisión de Vicente): subir a Expo 55+ cierra los avisos de build; no se tocó por ser un cambio mayor que exige build y regresión de las dos plataformas.

### 2. La sesión en localStorage (web)

`supabase-js` guarda el JWT y el refresh token en `localStorage` en web. El riesgo real es **XSS**: un script inyectado lee la sesión entera. **Cookies `httpOnly` no son viables** acá: la web es una SPA estática en Vercel sin servidor propio, y `@supabase/ssr` necesita un servidor que ponga y lea las cookies; hacerlo implica un backend nuevo que hoy no existe. Lo que se hizo para que el XSS no llegue a ocurrir y, si ocurre, no pueda sacar nada:

- **CSP estricta y cabeceras en `vercel.json`**: `script-src 'self' https://api.mapbox.com` (sin `unsafe-inline` ni `unsafe-eval`; el export de Expo es un único script externo), `connect-src` sólo a Supabase (HTTP y WebSocket), Mapbox, Nominatim y Sentry, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy` y `Permissions-Policy`. **Probada de verdad**: se sirvió `dist` con esas cabeceras y se comprobó en el navegador que cargan el mapa de Mapbox (con su worker), Supabase y las fuentes sin ninguna violación, y que un script ajeno y un `fetch` ajeno se bloquean.
- Guarda `scripts/__tests__/cabecerasSeguridad.test.js`: falla si alguien le pone `'unsafe-inline'` a `script-src`, abre `connect-src` a `*`, quita Supabase, o si el código web llama a un servidor que la CSP no permite (eso rompería producción sin avisar). También falla ante `dangerouslySetInnerHTML`, `innerHTML =`, `eval` o `new Function` en `src/`.
- `style-src` conserva `'unsafe-inline'`: React Native Web inyecta estilos en línea. Es un riesgo menor (no ejecuta código) y **aceptado**.
- **Falta en el panel de Supabase** (no se puede versionar ni cambiar por migración): confirmar *JWT expiry* en 3600 s (valor por omisión; más corto = más renovaciones), *Refresh token rotation* **activada** y *reuse interval* en 10 s, y bajar la vigencia del código OTP de correo de 3600 s a 900 s (`supabase/config.toml` ya lo documenta para el stack local). Los avisos de seguridad de Supabase hoy sólo marcan la protección de contraseñas filtradas (plan Pro).
- **Se ve en producción cuando Vercel despliegue este commit.** Si algo se rompiera en la web, la reversión es quitar el bloque `headers` de `vercel.json`.

### 3. «Admin en el frontend»

Las pantallas de moderación, el panel del recinto y los permisos del club ya decidían en el servidor (`es_moderador()`, `puede_en_complejo()`, `tiene_permiso_de_club()`, RPC `security definer`; el `AppNavigator` lo dice y las tres RPC de moderación lo comprueban). Esconder la entrada del menú es cosmético y así debe seguir. El problema real estaba **debajo**: políticas que autorizan la fila pero privilegios de UPDATE sobre todas las columnas, el mismo patrón de la migración 129. Todo se reprodujo con la API de tablas (clave pública + sesión) y se cerró con la **migración 165** (arnés de 29 casos; 19 fallan sin ella):

- `club_photos`: las políticas decían `m.club_id = m.club_id` (tautología): el admin de **cualquier** club subía y borraba fotos de **todos** los clubes.
- `ratings`: quien calificó podía reescribir a quién y con cuánto (saltándose la elegibilidad del INSERT). Ahora sólo `comentario`.
- `friendships`: una solicitud podía nacer `accepted` (amistad sin consentimiento, que abre el DM) y el destinatario podía cambiar `requester_id`. Ahora el INSERT exige `pending` y el UPDATE sólo `status`/`responded_at`.
- `club_challenges`: el club retador se daba solo la aceptación del desafío, o cambiaba el rival. Privilegio por columna + disparador que, sólo para el rol `authenticated`, deja pendiente→rechazado (club retado) y pendiente→cancelado (club retador). Las RPC (dueño `postgres`) no cambian.
- `matches`: el privilegio de UPDATE pasa a la lista cerrada que ya manda `updateMatch` (ya no se puede apuntar un partido a la reserva o al club de otro).
- `notifications`: el dueño sólo marca `read`.
- `count_reports_against`: la interfaz decía «sólo el dueño ve el detalle» pero la RPC se lo contaba a cualquiera. Ahora responde a la propia persona y a quien modera.
- `_sembrar_permisos_actuales`, `recalc_user_ratings` y `cuota_de_reserva` sólo las usan funciones `security definer`: sin EXECUTE para el cliente (mismo criterio de la 140).

Se verificó que no rompe las apps instaladas: cada escritura directa del cliente a esas tablas usa sólo las columnas que se conservan, y ninguna función `invoker` actualiza esas tablas. **Lección**: el arnés tiene que probar el código de error esperado (`42501`), no «algo falló».

### 4. Límites de tasa

No había ninguno: una cuenta nueva es gratis y podía mandar solicitudes de amistad (cada una dispara aviso y push), reportes, tickets, mensajes, solicitudes de recinto (cada una manda un correo), reservas (retienen la hora) o recorrer `buscar_jugadores`. `registrar_telefono` además contesta «ese número ya está registrado»: sin tope era un oráculo para saber qué celulares tienen cuenta. **Migración 166**: contador `rate_limit_hits` por (persona, cubo, ventana fija), disparadores BEFORE INSERT sobre las 10 tablas donde nace cada cosa (miran `auth.uid()`, no `current_user`, así que cubren también las RPC `security definer`) y el límite inyectado en `buscar_jugadores` (60 cada 5 min) y `registrar_telefono` (10 por hora). Topes a propósito generosos (30 amistades/h, 10 reportes/h, 60 mensajes/min…) y la lista completa en la cabecera de la migración. Arnés de 16 casos; `limite_correo_de_reporte()` topa los correos de «reportar un problema» (la Edge Function mandaba un correo por cada llamada con el mismo id).

Límites que **no** son de la base:

- **Endpoints de Supabase Auth** (login, OTP, registro, recuperar contraseña): sus límites viven en el panel (Authentication → Rate Limits), no se pueden versionar. `supabase/config.toml` deja los valores de referencia (30 por IP/5 min; un correo por minuto por dirección). **Hay que revisarlos en el panel**.
- **`flow-confirmacion`** (webhook público de Flow): no se limitó por IP, porque un tope mal puesto podría tirar la confirmación de un pago de verdad si Flow reintenta. La función no le cree al POST y consulta a Flow con una consulta firmada, así que abusarla cuesta una consulta a Flow. **Riesgo aceptado.**
- Ventana fija, no deslizante: en el borde se puede llegar a 2 × el tope.

### 5. Verificación en dos pasos (TOTP)

Hoy el registro usa OTP de correo pero el login era sólo contraseña. Se implementó **TOTP de Supabase Auth** (app de autenticación; el OTP por correo en cada login se descartó: es más fricción y no resiste que alguien tenga el correo):

- **Cliente** (necesita build, ver abajo): *Ajustes → Verificación en dos pasos* (`MfaSetupScreen`: QR, clave para teclear, confirmación con el primer código); `LoginScreen` pide el código tras la contraseña; `AuthContext` no da por autenticada una sesión `aal1` de quien activó el segundo paso (la manda a Login, directo al código). Textos en español de Chile; el error del servidor nunca se muestra en inglés. Probado en el navegador contra la base local con un TOTP calculado a mano (activar, código incorrecto, sesión de sólo contraseña mandada al código, entrar).
- **Un hallazgo**: `verifyPassword` (confirmar la contraseña en Ajustes) llamaba a `signInWithPassword` y **reemplazaba la sesión**: con MFA eso la dejaba en `aal1` y expulsaba a la persona de su propia cuenta. Ahora usa un cliente efímero (`crearClienteEfimero`).
- **Obligatoria para el personal** (moderadores y administradores de recinto): **migración 167**, `mfa_ok_para_staff()` pegada a `es_moderador`, `es_admin_complejo/cancha/de_reserva`, `puede_en_complejo`, `admin_mis_complejos` y las cinco RPC de dueño (exigen `aal2` en el JWT). **Nace apagada** (`feature_flags.mfa_obligatoria_staff = false`): sin actualizaciones por aire, encenderla antes de que el personal tenga la pantalla los dejaría sin panel. Con la bandera apagada nada cambia (lo prueba el arnés de 16 casos). `AvisoMfaPersonal` en Inicio les explica por qué desaparecen sus secciones.
- **Sin códigos de recuperación**: Supabase no los trae. Quien pierda su app de autenticación debe pedir al equipo que le quiten el factor (`delete from auth.mfa_factors where user_id = …` desde el panel). **Falta definir el canal de soporte** y ponerlo en el texto de la pantalla (hoy dice «escríbenos desde el correo de tu cuenta» sin dirección).

### Qué falta aplicar o desplegar (lo que sigue pendiente)

1. **Migraciones 165 y 166: aplicadas en producción el 2026-11-05** con autorización de Vicente y verificadas por catálogo después (privilegios por columna, políticas de `club_photos`, 11 disparadores de límite, límite inyectado en `buscar_jugadores` y `registrar_telefono`, cron de limpieza a las 03:15). No se corrió el arnés contra producción. **La 167 sigue sólo en la base local** (espera el build de MFA). La 149 sigue sin aplicar a propósito.
2. **Edge Functions: desplegadas.** `send-push` salió como v11 el 2026-11-05 y las otras cuatro el 2026-11-09, con autorización de Vicente: `reportar-problema` v2 (con el tope de correo de la 166), `solicitud-recinto` v8, `pagar-reserva` v3 y `flow-confirmacion` v3 (ésta con `verify_jwt = false`, como antes), las cuatro con `supabase-js` fijado en 2.119.0. Antes: hash del repositorio igual al `pendiente` de `despliegues.json`, los `_shared` sin cambios y `deno check` limpio. Después, prueba desde fuera sin escribir nada: sin cabecera de autorización las tres con JWT responden 401; `pagar-reserva` contesta `configurada: false`; `flow-confirmacion` contesta 503 «sin configurar» (no hay credenciales de Flow); un cuerpo inválido o sin id da 400. `despliegues.json` ya no tiene ningún `pendiente`; las cuatro quedan con `comparada: null` porque la copia desplegada no se comparó por hash.
3. **Vercel**: las cabeceras de `vercel.json` salen con el próximo despliegue de la web.
4. **Build** de la app con las pantallas de MFA (iOS y Android; esta Mac no tiene SDK nativo, sólo se probó en web). Recién después: que cada administrador y moderador active su código, y recién entonces `update feature_flags set activo = true where nombre = 'mfa_obligatoria_staff'`.
5. **Panel de Supabase**: confirmar que *MFA → TOTP* está habilitado (enroll y verify), límites de Auth, *JWT expiry*, rotación del refresh token y OTP a 900 s.

Arneses al 2026-11-05: 126 de 130 pasan; los cuatro que fallan **ya fallaban antes** de estas migraciones (se comprobó): `134` (datos locales), `83` (un caso) y `157` y `44d`, que son intermitentes. Los de las migraciones 40, 98, 119, 136, 141 y 155 se ajustaron porque asumían privilegios de tabla completa o apagaban/necesitaban el límite; cada ajuste lo explica un comentario en el propio arnés.

### Mapeo aproximado a controles

| Control | Qué lo cubre |
|---|---|
| SOC 2 CC6.1 (acceso lógico) | 165 (privilegios por columna, RLS corregida), 167 (`aal2` para el personal) |
| SOC 2 CC6.6 (límites del sistema) | CSP y cabeceras (`vercel.json`), 166 (límites de tasa) |
| SOC 2 CC6.8 (software malicioso / cadena) | `npm audit fix`, `supabase-js` fijado, guarda contra HTML inyectado |
| SOC 2 CC7.1–CC7.2 (detección) | los arneses de 165/166/167 y la guarda de cabeceras fallan ante una regresión |
| SOC 2 CC8.1 (cambios) | `despliegues.json` con `pendiente` por hash: lo escrito y no desplegado queda visible |
| SOC 2 A1.2 / disponibilidad | 166 (abuso de endpoints sin tope) |
| ISO 27701 7.4.x (minimización y acceso a datos personales) | `count_reports_against`, `notifications`, `friendships`; el teléfono ya no es sondeable sin tope |
| ISO 27701 / 27001 A.8.5 (autenticación segura) | TOTP opcional para todos, obligatorio para el personal |
| ISO 27001 A.8.24 / A.8.20 (red y criptografía) | HSTS, CSP `connect-src` cerrada, `upgrade-insecure-requests` |

### Riesgos que quedan, sin maquillar

- La sesión sigue en `localStorage` (sin servidor propio no hay cookie `httpOnly`); la CSP reduce la probabilidad de XSS y el TOTP reduce el daño de una contraseña robada, pero **un XSS que ocurriera igual se llevaría la sesión**.
- Los límites de Auth y la rotación del refresh token dependen del panel y nadie los ha leído desde el repositorio.
- Sin códigos de recuperación de TOTP, hay un riesgo de bloqueo de cuentas que se resuelve a mano.
- La 165 ya está en producción (2026-11-05): los siete problemas de autorización de arriba quedaron cerrados allá. No se corrió el arnés contra producción; se verificó por catálogo.

## Segunda pasada (2026-11-09): lo que se lee sin cuenta y lo que una función contesta de más

Auditoría sobre producción después de la 165–170, con tres fuentes: los avisos de seguridad de Supabase, el catálogo (`pg_policies`, `pg_proc`, `storage.buckets`) y una prueba **desde fuera**, con la clave pública y sin sesión, contra `/rest/v1/<tabla>`. La prueba desde fuera es la que manda: dice lo que de verdad responde la API, no lo que uno cree que dicen las políticas.

**Lo que está bien, comprobado ese día:** `anon` no ejecuta ninguna función de `public` (0), ninguna tabla está sin RLS, ninguna política de escritura es `true`, toda función `security definer` fija su `search_path`, ninguna función de trigger es ejecutable, y las cabeceras de `vercel.json` (CSP, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`) **ya salen en la web** (`curl -I` a la URL de Vercel). Los avisos de Supabase quedan en tres: 12 tablas con RLS y sin política (son las privadas a propósito: sólo se llega por RPC), 143 funciones `security definer` ejecutables con sesión (es el diseño de «una sola puerta»; se revisaron, ver abajo) y la protección de contraseñas filtradas, que es del plan Pro.

**Tres huecos, que cierra la migración 171 — aplicada en producción el 2026-11-09 con autorización de Vicente:**

1. **Sin cuenta se leía quién juega dónde.** Con la clave pública sola respondían con filas `attendees` (32), `club_members` (15) y `profile_photos` (10): quién va a cada partido, quién está en cada club y las fotos de galería de cada persona. Las políticas de lectura eran para el rol `public`, que incluye a `anon`. La 171 las pasa a `authenticated` (sólo cambia el rol; con sesión se lee lo mismo). Es la misma decisión de la 143 para `profiles`, una capa más abajo.
2. **`is_blocked_pair(a, b)` contestaba por cualquier par** a cualquiera con cuenta: se podía dibujar el grafo de bloqueos entero, cuando `blocked_users` sólo deja ver un bloqueo a quien lo hizo. Ahora sólo contesta si quien pregunta es una de las dos personas (los dos únicos usos, la política `friendships_insert` y `desbloquear_usuario()`, lo cumplen).
3. **`profile-gallery` aceptaba cualquier archivo de cualquier tamaño**: único bucket sin `file_size_limit` ni `allowed_mime_types`, y público. Queda en 5 MB e imágenes, como `avatars`.

**Cómo se probó:** arnés `171_..._test.sql`, 23 casos como `anon` y como `authenticated` con el `sub` de cada persona. Sin la migración fallan 6 (control negativo visto); con ella, 23/23 en la base local. La batería completa queda en 129/134 y los cinco que fallan **fallan igual sin la 171** (se revirtió en local y se corrieron tres veces: ver [Pruebas](../operacion/pruebas.md)). **Ensayada contra producción** en una transacción con `rollback` (23/23, y después se comprobó que no quedó nada), y recién entonces aplicada. **Comprobado después de aplicarla, de las dos formas:** desde fuera, con la clave pública y sin sesión, `attendees`, `club_members` y `profile_photos` responden cero filas (antes 32, 15 y 10) y `rpc/is_blocked_pair` responde 401; por catálogo, las tres políticas son `{authenticated}`, la función es la nueva y el bucket tiene 5 MB e imágenes. Y con la sesión de una persona real (simulada en una transacción) se siguen leyendo las mismas filas: 15 integrantes, 10 fotos, 37 inscripciones. El modo automático había bloqueado el primer intento de aplicarla («Production Deploy»): un despliegue a producción pide el sí explícito de Vicente.

**Lo que NO se tocó, y por qué:**

- **`matches` sigue legible sin cuenta** (los partidos normales; los de clubes son privados desde la 44d), y también `clubs`, `club_photos` y todo lo de recintos. El arnés de la 44d exige de forma explícita que `anon` vea los partidos normales, y es justo lo que mostraría una vitrina pública. **Ojo: la fila de `matches` trae `id_organizador`.** Es parte de la decisión de producto que sigue abierta («¿superficie pública sin cuenta?», en [Pendientes](../operacion/pendientes.md)).
- **`lista_de_espera(p_match_id)`** es `security definer` y no mira si quien llama puede ver el partido: devuelve la cola (ids y prioridad) también de un partido de clubes ajeno. Bajo riesgo (hay que conocer el id del partido), anotado como pendiente.
- **`perfil_acepta_solicitudes(p_user)`, `tiene_permiso_de_club(club, user, permiso)`, `es_participante_de_reserva` y `es_organizador_de_reserva`** aceptan el id de otra persona y contestan sí o no. Las usan políticas con el rol de quien consulta, así que el EXECUTE no se puede quitar; atarlas a `auth.uid()` exige revisar cada llamada desde funciones `definer`. Lo que dejan saber es poco (una preferencia, un permiso de club, y lo de reservas pide conocer el id de la reserva). Pendiente, sin urgencia.
- **`support-screenshots` es un bucket público**: una captura que alguien adjunta a «reportar un problema» queda legible por URL. La ruta no es adivinable, pero una captura puede traer datos personales. Pasarlo a privado exige cambiar cómo el correo de soporte enlaza la imagen. Pendiente.
- **`anon` y `authenticated` conservan `REFERENCES` y `TRIGGER`** sobre las tablas (privilegios por omisión). Por la API no se puede crear ni una llave ni un disparador, así que no abren nada; quitarlos sería higiene.

**Mapeo:** SOC 2 CC6.1 y ISO 27701 7.4.x (minimización y acceso a datos personales) para los puntos 1 y 2; SOC 2 CC6.6/CC6.8 para el 3.

## Tercera pasada (2026-11-13): lo que se abre con una cuenta normal (migración 177)

Aplicada en producción el 2026-11-13; arnés `177_..._test.sql` en verde contra producción, con la migración dentro de la transacción revertida, y comprobado desde fuera (la API sin cuenta responde 200 con el pre-request activo, los buckets devuelven `[]` al listarlos sin cuenta y las URL públicas siguen sirviendo).

- **El bloqueo se respeta.** `trg_friendships_transiciones` sólo deja `pending → accepted|rejected` desde el cliente (antes el bloqueado se desbloqueaba solo), y `messages_insert`/`messages_read` miran `is_blocked_pair` en los DM (también los de desafío). `chat_destinatarios` (175) también, parchada sobre el cuerpo desplegado.
- **Alta de partidos con columnas contadas**: las que manda `createMatch` y ninguna más (fuera `reserva_id`, `estado`, asistencia, cancelación…). `club_local_id`, `club_visitante_id` y `challenge_id` siguen concedidas porque las apps instaladas las mandan (en nulo); las valida `aa_matches_alta_desde_el_cliente` con `_puede_publicar_partido_de_desafio`.
- **Desafíos abiertos**: la respuesta sólo actualiza `estado`, la publicación sólo sus campos editables y `estado`; transiciones cerradas (una publicación no se reabre, una respuesta no revive si la publicación cerró).
- **Invitaciones**: una solicitud respondida no se vuelve a responder (el expulsado ya no vuelve solo).
- **Buckets públicos sin listado**: fuera las seis políticas SELECT `using (bucket_id = …)`; cada uno lista lo que puede borrar o reemplazar (`remove` y `upsert` lo necesitan). Servir por URL pública no pasa por políticas.
- **Dos pasos en el servidor**: `mfa_cumplida()` y el pre-request de PostgREST `exigir_mfa_por_peticion` (`alter role authenticator set pgrst.db_pre_request`): a quien tiene un factor verificado, la API le exige `aal2` en cada petición (tablas y RPC). El tiempo real y Storage no pasan por PostgREST: políticas RESTRICTIVAS `mfa_exigida` en `messages`, `notifications`, `attendees` y `storage.objects`, y la del canal Broadcast del chat. Sin factor no cambia nada (hoy, ninguna cuenta tiene). La app registra el token de push sólo con la sesión que ya entró (`App.js`, `sesionQueEntro`).
- **Menores**: con edad < 18 no se aparece en búsquedas (se fuerza al poner la edad y se rechaza encenderlo); la edad, una vez puesta, no la cambia el cliente (Editar perfil la muestra fija). La única cuenta menor de producción quedó oculta.
- **`complejo_calificaciones`** se lee sólo con cuenta. El buscador de administradores escapa `%` y `_`.
- **Regla aprendida:** un disparador con la guarda `current_user <> 'authenticated'` **no puede ser `security definer`**: adentro, `current_user` es el dueño y la guarda deja pasar todo. Si necesita leer saltándose la RLS, que llame a una función definer aparte. Lo vigila `src/services/__tests__/huecosDeUnaCuentaNormal.test.js` para la 177.

## Notas relacionadas

- [Autenticación](../funcionalidades/autenticacion.md)
- [Chat](../funcionalidades/chat.md)
- [Configuración](../funcionalidades/configuracion.md)

## search_path de las funciones

Desde la **migración 88** (2026-09-14) **todas** las funciones de `public` tienen `search_path` fijo: la consulta `select count(*) from pg_proc ... where proconfig is null` devuelve **0**.

Las diecinueve que faltaban las levantó el linter de Supabase, y conviene tener escrito qué tan grave era, porque la primera lectura fue peor que la realidad: **ninguna era `security definer`**, así que no había escalada de privilegios. Corrían con los permisos de quien las llamaba.

Se arreglaron igual por una razón concreta: varias las llaman funciones que **sí** son `security definer` —`crear_reserva` llama a `precio_de_bloque`, `calcular_comision` y `normaliza_telefono_cl`— y dentro de esa llamada manda el `search_path` de la que define. Estaban cubiertas **por dónde se las llamaba, no por lo que eran**: una garantía prestada que deja de valer el día que alguna se llame desde otro lado.

Se hizo con `alter function ... set search_path`, que **no toca el cuerpo**. Copiar diecinueve cuerpos para cambiarles el entorno habría sido diecinueve oportunidades de introducir un error donde no había ninguno.

**Antes se comprobó que ninguna usara algo fuera de `public`** (unaccent, pgcrypto, earthdistance). Fijar el camino en una función que dependiera de una extensión la habría roto: es la única forma en que este cambio podía hacer daño.

**Pendiente y es tuyo:** la protección de contraseñas filtradas de Supabase Auth está **desactivada**. Se enciende en Authentication → Policies del panel; no se puede hacer por SQL ni por migración.

## Los diálogos y avisos del navegador no existen

**Ni `window.confirm` ni `window.alert` abren nada en la app web**: los dos devuelven en un par de milisegundos sin mostrar un cuadro. Y `Alert.alert` de React Native tampoco funciona en web. O sea que las tres formas «obvias» de hablarle a la persona fallan, y fallan **en silencio**, que es lo peor: el botón responde al toque, no aparece ningún error, y la única conclusión posible es que la app está rota.

Costó dos hallazgos separados. Primero `confirmAction` (2026-09-15): **cerrar sesión no hacía nada**, ni eliminar la cuenta, ni borrar una foto del club, ni expulsar a un integrante. Después `notify()`: **17 mensajes en 5 pantallas**, casi todos errores («No pudimos cargar más», «No pudimos cambiar el silencio»), que nadie veía nunca.

La salida son dos piezas propias, que andan en los tres lados: `useConfirmacion` (un Modal, para lo que hay que confirmar) y `avisos` + `AvisosHost` (una cola con su anfitrión en la raíz de la app, para lo que solo hay que leer). **Regla para lo que venga: nada que tenga que ver la persona pasa por un diálogo del navegador.**

`AvisosHost` se monta FUERA del navegador de pantallas a propósito: un aviso lanzado por una acción que cambia de pantalla se leería a medias si muriera con la pantalla que lo lanzó. Y es una cola, no un aviso único: dos errores seguidos —pasa cuando algo de red falla— se pisaban.

## Confirmar algo destructivo

`window.confirm` **no abre nada en la app web**: devuelve `false` en un milisegundo sin mostrar ningún cuadro. Tres pantallas tenían su propia copia de un `confirmAction` que lo usaba cuando `Platform.OS === 'web'`, así que **cerrar sesión no hacía nada, en silencio** — y lo mismo eliminar la cuenta, borrar una foto del club y expulsar a un integrante. El botón respondía al toque, no aparecía ningún error, y la única conclusión posible era que la app estaba rota. `Alert.alert` de React Native tampoco funciona en web. La salida es `useConfirmacion`, un Modal propio que anda en los tres lados (2026-09-15). Se descubrió probando cerrar sesión en el navegador, no leyendo código. Desde 2026-09-22 admite una TERCERA salida opcional (`alternativa: { label, onPress }`, entre la destructiva y el cierre, más un rótulo propio para el cierre): salir de una pantalla con cambios sin guardar tiene tres respuestas —guardar, descartar y seguir editando— y con dos botones una de las tres se pierde. Quien no la pasa ve el diálogo de siempre.
