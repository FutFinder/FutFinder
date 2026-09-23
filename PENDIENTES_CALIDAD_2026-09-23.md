# Pendientes de calidad de FutFinder

Revisión: 2026-09-23. Base de código contrastada: `7e17aa2` después de `git pull`.

Este es el listado único para priorizar arreglos de Inicio, Chat, Perfil, Avisos y Ajustes. **Ningún ítem de esta lista está corregido por este documento.** Los casos C01–C10 provienen de [la auditoría de chats y notificaciones](ERRORES_CHATS_NOTIFICACIONES_2026-09-23.txt), que contiene los pasos y las pruebas de reproducción. Los casos nuevos se detectaron al revisar el flujo de datos del código; donde falta una prueba de interfaz o de dos sesiones, se indica.

Prioridades: **P1** afecta lectura, privacidad o avisos relevantes; **P2** produce datos o acciones incorrectas; **P3** es una inconsistencia de menor impacto. La prioridad no afirma que el fallo haya ocurrido en producción.

## Chat y avisos

| ID | Prioridad | Pendiente y evidencia | Comprobación de cierre |
| --- | --- | --- | --- |
| C01 | P1 | Abrir un hilo marca leído aunque `listThreadMessages` devuelva error. `ChatThreadScreen.js:317-325` muestra el error y llama igualmente a `markThreadAsRead`. | Fallar la carga de mensajes y confirmar que el marcador de lectura no avanza. |
| C02 | P2 | El callback Realtime marca leído al llegar un mensaje aunque el hilo esté detrás de otra pantalla o se esté leyendo el historial. `ChatThreadScreen.js:485-516`. | Probar foco, app activa y scroll con dos sesiones. |
| C03 | P2 | La paginación del historial puede omitir mensajes con `created_at` idéntico: ordena y pagina solo por fecha. `messages.js:725-732`. | Más de 40 mensajes con el mismo timestamp, sin pérdidas ni duplicados al paginar. |
| C04 | P1 | Leer un DM no cierra su aviso `message_new`; el siguiente mensaje actualiza la fila anterior y no genera un nuevo INSERT para push. `32_chat_lectura_silencio_avisos.sql:176-202`, `15_notificaciones_mensajes.sql:44-69`. | Leer un DM, recibir otro y comprobar bandeja, popup y push nuevo. |
| C05 | P1 | Silenciar un hilo no silencia sus popup ni push; el silencio solo se aplica a la bandeja/conteo de chat. `ChatDetailsScreen.js:193-196`, `NotificationToastHost.js:41-47`, `send-push/index.ts:133-164`. | Probar DM silenciado, aviso normal y excepción explícita de mensaje importante en dos dispositivos. |
| C06 | P2 | Avisos anteriores a los últimos 50 quedan fuera de la bandeja; los filtros se aplican después de ese límite. `notifications.js:196-205`, `NotificationsScreen.js:390-408`. | Crear un aviso accionable en la posición 51 y encontrarlo al filtrar/paginar. |
| C07 | P2 | Si falla una acción optimista, el rollback reemplaza el arreglo entero y puede borrar de pantalla avisos recibidos durante la espera. `notificationInbox.js:55-60`. | Reproducir acción fallida y llegada simultánea sin perder ni resucitar filas. |
| C08 | P2 | Tocar un aviso lo muestra leído aunque `markAsRead` falle; no se revierte ni informa el error. `NotificationsScreen.js:258-261`. | Fallar el guardado y comprobar que UI y servidor vuelven a coincidir. |
| C09 | P2 | El contador de la campana no escucha DELETE ni recarga al volver al foco. `notifications.js:303-307`, `useUnreadNotifications.js:18-43`. | Borrar avisos con campana montada y comprobar contador local y de otra sesión. |
| C10 | P1 | Un popup puede conservar título y cuerpo de la cuenta anterior al cerrar sesión. `NotificationToastHost.js:36-58`; `limpiarToasts` solo aparece en pruebas. | Cerrar/cambiar sesión con popup visible y verificar limpieza inmediata. |
| C11 | P2 | La bandeja permite cargas simultáneas por montaje, foco, refresco y Realtime sin versión de solicitud. Una respuesta antigua puede sobrescribir una más nueva. `ChatScreen.js:58-114`. **Detectado por flujo de código; falta reproducir con respuestas fuera de orden.** | Retrasar la primera respuesta, entregar la segunda antes y conservar la lista más reciente. |
| C12 | P3 | El aviso sin conexión dice «últimos mensajes guardados», pero `ChatScreen` solo conserva el estado de la instancia montada; al abrirla sin conexión no hay caché persistente. `ChatStates.js:112-119`, `ChatScreen.js:45-65`. | Mostrar una descripción fiel o guardar realmente el último estado, probado tras reiniciar la app sin red. |
| C13 | P2 | Detalles de un chat de partido pide todos los asistentes cuyo estado no sea `cancelado`, incluidos los `pendiente`, y los presenta como «inscritos». La regla del propio chat niega acceso a los pendientes. `messages.js:936-956`, `matchRules.js:574-590`, `ChatDetailsScreen.js:113-121`. | Crear una solicitud manual pendiente y comprobar que no cuenta como participante con acceso al chat. |
| C14 | P2 | Detalles de un hilo `challenge:<id>` cae en el subtítulo por defecto «Mensaje directo», aunque es un grupo entre clubes. `ChatDetailsScreen.js:107-122`. | Abrir Detalles desde un desafío y ver un subtítulo propio del desafío y sus participantes. |
| C15 | P2 | Si `getThreadParticipants` devuelve `{ data: [], error }`, Detalles ignora `error` y anuncia cero jugadores/inscritos. `messages.js:925-956`, `ChatDetailsScreen.js:75-87`. | Simular error de esa consulta y mostrar estado de error con reintento, sin afirmar que el chat está vacío. |
| C16 | P2 | La bandeja de Chats ignora el `error` de `listIncomingRequests` y pone `requests=[]`; desaparecen la tarjeta y el contador de solicitudes como si no existieran. `friends.js:271-285`, `ChatScreen.js:61-66,86,233`. | Fallar solo la consulta de solicitudes mientras la de hilos funciona; mantener el último dato o mostrar error parcial. |

## Inicio

| ID | Prioridad | Pendiente y evidencia | Comprobación de cierre |
| --- | --- | --- | --- |
| I01 | P2 | Inicio pide 20 partidos globales ordenados por hora y **después** aplica el radio. Veinte partidos lejanos pueden ocultar el primero cercano. `HomeScreen.js:91-103`, `matches.js:39-65`. | Sembrar 20 lejanos más tempranos y uno cercano posterior; el cercano debe aparecer. |
| I02 | P2 | `listOpenMatches` devuelve `{ data: [], error }` ante un fallo, pero Inicio descarta `error` y muestra el estado «sin partidos». También descarta errores de partidos de club. `HomeScreen.js:91-96,135-147,385-398`. | Simular red caída y mostrar error/reintento, conservando datos previos si los había. |
| I03 | P2 | La tarjeta de reputación lee `profiles.partidos_jugados`, contador que el código de Perfil reconoce como no incrementado, mientras Perfil usa `asistencias_confirmadas`. Inicio también lee `profile.reportes`, columna ausente del esquema y migraciones; por eso muestra 0. `HomeScreen.js:200-202`, `profile.js:309-313`, `schema.sql:19-37`. | Con asistencias y reportes de prueba, comparar Inicio y Perfil: ambos deben mostrar la misma cifra definida para cada etiqueta. |
| I04 | P2 | Inicio puede ejecutar `load` dos veces (foco, refresco o inscripción) y no descarta respuestas antiguas. `HomeScreen.js:91-155`. **Detectado por flujo de código; falta reproducir con respuestas fuera de orden.** | Entregar la recarga nueva antes de una anterior y conservar la información nueva. |
| I05 | P2 | Inicio interpreta el `trust_score=100` inicial como reputación ganada: muestra «TRUST 100», «ÉLITE» y «VERIFICADO» incluso con cero partidos confirmados. Si falla la carga del perfil, `getCurrentProfile` devuelve `null` y el mismo valor se inventa por `?? 100`. Perfil, en cambio, muestra `N.A.` sin partidos. `HomeScreen.js:200-205,242-245`, `TacticalHeader.js:38-46`, `auth.js:153-162`, `playerMeta.js:126-145`. | Comparar Inicio y Perfil de una cuenta nueva y repetir con fallo de carga; ninguno debe atribuir reputación no obtenida. |
| I06 | P3 | La etiqueta «ADMIN · N CLUBES» cuenta **todas** las membresías cuando el club activo es administrado, aunque en los demás clubes la persona sea integrante común. `HomeScreen.js:230-238`. | Cuenta administradora en un club y miembro en otro: la etiqueta debe describir correctamente qué cuenta. |
| I07 | P2 | Si el único partido cercano es uno destacado en «Tu club juega», Inicio dice arriba «1 partido cerca de ti» y abajo «Sin partidos en tu radio». `HomeScreen.js:240-242,258-263,371-398`, `clubMatchRules.js:359-366`. **Confirmado en web autenticada.** | Mostrar «No hay otros partidos cerca» o un estado equivalente cuando el único cercano ya está destacado, sin contradecir el resumen. |

## Perfil

| ID | Prioridad | Pendiente y evidencia | Comprobación de cierre |
| --- | --- | --- | --- |
| P01 | P2 | El historial trae las últimas 20 filas por `inscrito_at` y luego las ordena por hora del partido. Puede omitir una participación reciente inscrita hace tiempo; además «ausencias acumuladas» y tasa de asistencia se calculan solo sobre esas 20 filas. `profile.js:232-256,300-328`, `ProfileScreen.js:175-177`, `AccountStatusCard.js:45-102`. | Inscripción antigua a partido reciente más 20 inscripciones posteriores; historial y contadores deben conservar significado correcto. |
| P02 | P2 | Un fallo de red al buscar un perfil público se convierte en `null`, y la pantalla concluye «Este jugador no existe». `profile.js:70-78`, `ProfileScreen.js:175-186`. | Simular error de red y distinguirlo de una fila realmente inexistente, con reintento. |
| P03 | P2 | «Ver todo» en Últimas participaciones navega a Buscar partidos; no abre el historial completo que promete. `ProfileScreen.js:530-536`. | El botón debe abrir un historial real, o llevar un texto que describa el destino disponible. |
| P04 | P2 | Si falla la consulta del estado de cuenta, el servicio devuelve `suspended:false` y la tarjeta afirma «Cuenta en buen estado»/«Sin sanciones ni restricciones activas». No distingue ausencia de sanción de falta de datos. `profile.js:265-285`, `AccountStatusCard.js:42-69`. | Fallar la consulta de estado y mostrar «No pudimos comprobarlo» o un estado equivalente, sin afirmar buen estado. |
| P05 | P2 | Si falla la consulta de valoraciones, `getUserRatingSummary` devuelve ceros como si la persona no tuviera evaluaciones; Perfil transforma eso en «Sin evaluaciones todavía». `ratings.js:199-239`, `playerMeta.js:112-123`, `ReputationCard.js:44-57`. | Fallar solo la consulta de valoraciones para un perfil con reseñas y distinguir error de cero evaluaciones. |
| P06 | P2 | «Invitar a este jugador a mi club» abre `ClubInvite` con solo `clubId`: no pasa el `userId` del perfil ni preselecciona al jugador. La pantalla de destino arranca con búsqueda vacía y un máximo de 30 resultados, así que el jugador que se quería invitar puede no aparecer. `PlayerPublicActions.js:124-137`, `ProfileScreen.js:333-337`, `ClubInviteScreen.js:36-65`. | Abrir la invitación desde un perfil fuera de los primeros 30 resultados y ofrecer directamente al destinatario correcto. |
| P07 | P2 | En la lista de invitaciones, una persona sin partidos confirmados aparece como «Reputación 100», aunque su Perfil muestra «N.A.». La pantalla usa `trust_score ?? 100` sin considerar `asistencias_confirmadas`, que la búsqueda ya devuelve. **Confirmado en web autenticada con el mismo jugador en ambas pantallas.** `ClubInviteScreen.js:151-165`, `playerMeta.js:126-145`. | Ver el mismo jugador nuevo en Perfil e Invitaciones; ambos deben comunicar que su reputación todavía no es evaluable. |

## Ajustes

| ID | Prioridad | Pendiente y evidencia | Comprobación de cierre |
| --- | --- | --- | --- |
| A01 | P2 | Al fallar el guardado del radio, `radiusKm` conserva el valor nuevo mientras el perfil y la base conservan el anterior. `SettingsScreen.js:365-370,763-773`. | Rechazar `updateMyProfile` y verificar que el valor visible vuelve al persistido. |
| A02 | P2 | Dos cambios rápidos de un interruptor pueden resolver fuera de orden; el rollback de la primera petición pisa la segunda elección. `SettingsScreen.js:356-363`. **Detectado por flujo de código; falta reproducir con dos respuestas controladas.** | Primera escritura falla después de que la segunda tenga éxito; UI y base deben quedar en el segundo valor. |

## Alcance de la revisión

La inspección cubrió el código de Inicio, bandeja/hilo/detalles de Chat, Perfil y sus servicios principales, además de los hallazgos existentes de Avisos y Ajustes. En esta revisión `npm run verify` pasó 1.566 pruebas con 25 advertencias de lint; `npm run build:web` terminó correctamente en la revisión anterior de la misma base de aplicación. La verificación autenticada siguiente confirma varios casos de interfaz, pero no cubre errores de red provocados, respuestas fuera de orden, entrega push en teléfonos ni el estado desplegado de todas las migraciones. **Inicio, Chat y Perfil aún no se pueden dar por completos:** hay fallas pendientes en cada uno.

## Verificación web con sesión iniciada (2026-09-23)

Se usaron las tres cuentas del archivo de pruebas proporcionado fuera del repositorio, contra el Supabase configurado en `.env`. No se registran aquí correos, contraseñas, identificadores de usuario ni contenido de conversaciones. Las sesiones se abrieron en la web local; no se enviaron mensajes ni invitaciones, ni se crearon partidos. Abrir un DM sí marcó ese hilo como leído, que era el efecto que se necesitaba observar.

- **I05 confirmado en dos cuentas:** Inicio mostró «TRUST 100», «ÉLITE» y «VERIFICADO» con cero partidos jugados; Perfil de cada una mostró Trust Score «N.A.» y la explicación de que se calcula tras los primeros partidos.
- **I06 confirmado:** la cuenta organizadora mostró «ADMIN · 3 CLUBES» en Inicio, mientras el selector identificó dos clubes como «Administrador» y uno como «Integrante».
- **I07 confirmado:** en esa misma cuenta, el resumen anunció un partido cercano, «Tu club juega» mostró ese encuentro y «Partidos cerca de ti» afirmó «Sin partidos en tu radio».
- **P03 confirmado:** desde un Perfil con participaciones, «Ver todo» abrió la pestaña de búsqueda de partidos, no un historial.
- **C14 confirmado:** Detalles de un desafío existente mostró el nombre del encuentro seguido de «Mensaje directo», junto a dos participantes de clubes.
- **P06 confirmado en su primera parte:** desde un perfil público se pulsó «Invitar a este jugador a mi club»; la pantalla siguiente abrió una búsqueda vacía y sin destinatario seleccionado. En esta prueba el jugador sí apareció dentro de los primeros 30; el caso de quedar fuera del límite sigue pendiente.
- **C04 confirmado en su primera parte:** antes de abrir un DM había un mensaje pendiente en Chat y un aviso `message_new` sin leer. Tras leer el DM, desapareció el pendiente del chat, pero la campana conservó sus dos avisos sin leer. No se generó un segundo mensaje para medir la falta de push nuevo; esa segunda parte conserva la reproducción SQL de la auditoría original.
- **P07 confirmado:** el mismo jugador sin partidos tenía reputación «N.A.» en su Perfil y «Reputación 100» en la lista de invitaciones.

Los casos que dependen de errores de red, respuestas fuera de orden, más de 50 avisos o push físico no se consideran verificados por esta sesión. **Inicio, Chat y Perfil siguen abiertos a corrección y prueba.**
