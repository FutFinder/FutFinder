# Pendientes de calidad de FutFinder

Revisión: 2026-09-23. Estado del código: `9c771a5` después de `git pull`.

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

## Inicio

| ID | Prioridad | Pendiente y evidencia | Comprobación de cierre |
| --- | --- | --- | --- |
| I01 | P2 | Inicio pide 20 partidos globales ordenados por hora y **después** aplica el radio. Veinte partidos lejanos pueden ocultar el primero cercano. `HomeScreen.js:91-103`, `matches.js:39-65`. | Sembrar 20 lejanos más tempranos y uno cercano posterior; el cercano debe aparecer. |
| I02 | P2 | `listOpenMatches` devuelve `{ data: [], error }` ante un fallo, pero Inicio descarta `error` y muestra el estado «sin partidos». También descarta errores de partidos de club. `HomeScreen.js:91-96,135-147,385-398`. | Simular red caída y mostrar error/reintento, conservando datos previos si los había. |
| I03 | P2 | La tarjeta de reputación lee `profiles.partidos_jugados`, contador que el código de Perfil reconoce como no incrementado, mientras Perfil usa `asistencias_confirmadas`. Inicio también lee `profile.reportes`, columna ausente del esquema y migraciones; por eso muestra 0. `HomeScreen.js:200-202`, `profile.js:309-313`, `schema.sql:19-37`. | Con asistencias y reportes de prueba, comparar Inicio y Perfil: ambos deben mostrar la misma cifra definida para cada etiqueta. |
| I04 | P2 | Inicio puede ejecutar `load` dos veces (foco, refresco o inscripción) y no descarta respuestas antiguas. `HomeScreen.js:91-155`. **Detectado por flujo de código; falta reproducir con respuestas fuera de orden.** | Entregar la recarga nueva antes de una anterior y conservar la información nueva. |

## Perfil

| ID | Prioridad | Pendiente y evidencia | Comprobación de cierre |
| --- | --- | --- | --- |
| P01 | P2 | El historial trae las últimas 20 filas por `inscrito_at` y luego las ordena por hora del partido. Puede omitir una participación reciente inscrita hace tiempo; además «ausencias acumuladas» y tasa de asistencia se calculan solo sobre esas 20 filas. `profile.js:232-256,300-328`, `ProfileScreen.js:175-177`, `AccountStatusCard.js:45-102`. | Inscripción antigua a partido reciente más 20 inscripciones posteriores; historial y contadores deben conservar significado correcto. |
| P02 | P2 | Un fallo de red al buscar un perfil público se convierte en `null`, y la pantalla concluye «Este jugador no existe». `profile.js:70-78`, `ProfileScreen.js:175-186`. | Simular error de red y distinguirlo de una fila realmente inexistente, con reintento. |
| P03 | P2 | «Ver todo» en Últimas participaciones navega a Buscar partidos; no abre el historial completo que promete. `ProfileScreen.js:530-536`. | El botón debe abrir un historial real, o llevar un texto que describa el destino disponible. |

## Ajustes

| ID | Prioridad | Pendiente y evidencia | Comprobación de cierre |
| --- | --- | --- | --- |
| A01 | P2 | Al fallar el guardado del radio, `radiusKm` conserva el valor nuevo mientras el perfil y la base conservan el anterior. `SettingsScreen.js:365-370,763-773`. | Rechazar `updateMyProfile` y verificar que el valor visible vuelve al persistido. |
| A02 | P2 | Dos cambios rápidos de un interruptor pueden resolver fuera de orden; el rollback de la primera petición pisa la segunda elección. `SettingsScreen.js:356-363`. **Detectado por flujo de código; falta reproducir con dos respuestas controladas.** | Primera escritura falla después de que la segunda tenga éxito; UI y base deben quedar en el segundo valor. |

## Alcance de la revisión

La inspección de este turno cubrió el código de Inicio, bandeja e hilo de Chat, Perfil y sus servicios principales, además de los hallazgos existentes de Avisos y Ajustes. `npm run verify` pasó 1.566 pruebas con 25 advertencias de lint y `npm run build:web` terminó correctamente en la revisión previa del mismo commit. Estas comprobaciones no cubren recorridos autenticados con dos cuentas, entrega push en teléfonos ni el estado desplegado de Supabase. **Inicio, Chat y Perfil aún no se pueden dar por completos:** hay fallas pendientes en cada uno y los casos marcados como flujo de código requieren una reproducción dirigida.
