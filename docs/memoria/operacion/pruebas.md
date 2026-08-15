# Pruebas

Última revisión: 2026-08-13

## Comprobaciones locales del proyecto

```bash
npm test
```

Ejecuta las pruebas de Node de `src/**/__tests__/*.test.js`: utilidades de chat, privacidad de amistades, bandeja y preferencias de avisos, destinos de avisos, edición de perfil, rutas y búsqueda.

```bash
npm run build:web
```

Genera la exportación web de Expo y detecta fallos de empaquetado o compatibilidad web. No ejecuta las pruebas SQL ni valida servicios remotos.

## Pruebas SQL de RLS y contratos de base de datos

Los archivos `supabase/tests/35_privacy_test.sql`, `36_chat_security_test.sql`, `38_push_reliability_test.sql`, `39_chat_mention_all_test.sql`, `40_bandeja_chat_rpc_test.sql`, `41_desafio_ciclo_test.sql`, `42_desafio_chat_rls_test.sql`, `43_desafio_plazos_test.sql`, `43c_propuesta_ubicacion_test.sql`, `43d_rechazo_doble_pertenencia_test.sql`, `44_partido_clubes_test.sql`, `44b_ubicacion_protegida_test.sql`, `44c_notify_match_updated_test.sql`, `44d_partido_privado_test.sql`, `44e_attendees_solo_por_rpc_test.sql`, `45_inscripcion_por_club_test.sql`, `45b_origen_compatibilidad_test.sql`, `45c_reserva_voluntaria_test.sql`, `45d_escritores_attendees_test.sql` , `46_cambios_de_partido_test.sql`, `47_cancelacion_y_sancion_test.sql` y `47b_valida_sancion_sin_execute_test.sql` verifican privacidad, RLS de chat, fiabilidad de push, `/todos`, la RPC de bandeja y el ciclo de desafíos entre clubes hasta inscripción, reservas, nómina por club, cambios negociados y cancelación con sanción. El arnés de la 47 corre 25 casos. Antes de aplicar la migración se ejecutó con la propia 47 dentro de la misma transacción, y después de aplicarla se repitió solo, 25/25 las dos veces; midió el Trust Score del jugador inscrito y del administrador antes y después de sancionar para comprobar que la sanción es del club, y exige que los bloqueos de crear, aceptar y proponer fallen con un mensaje que diga «sancionado», no con cualquier error, porque un fallo de RLS daría el caso por bueno sin haber probado nada. El de la 47b son 5 casos y su valor está en el tercero: comprueba que quitarle el `EXECUTE` a la función de trigger no la deja de disparar. Los dos primeros casos —privilegios y trigger instalado— no bastarían: si PostgreSQL comprobara ese privilegio en cada disparo, la revocación habría desactivado la regla sin romper ninguna pantalla. El quinto cierra la trampa contraria, que un trigger que rechazara SIEMPRE también pasaría los casos 3 y 4. `47c_incomparecencia_y_revisiones_test.sql` cubre la incomparecencia y la revisión de sanciones con 26 casos, y a diferencia del arnés de la 47 **no reutiliza ningún partido de la base**: crea sus cuatro clubes, sus dos encuentros y su gente dentro de la transacción, porque necesita un partido con la hora ya pasada y moverle la hora a un partido real —aunque sea dentro de una transacción— es tocar datos de prueba que alguien está usando para otra cosa. Su caso 17 es el que sostiene toda la unidad: un `authenticated` que llama `resolver_revision_sancion` recibe `permission denied`, y se exige ese mensaje y no cualquier error, porque un fallo de RLS daría el caso por bueno sin haber probado nada. Los casos 5, 6 y 7 fijan la ventana de 24 horas por los dos bordes —antes de la hora no, a las 25 horas tampoco, a las 23:30 sí—; el 11 comprueba que cada club puede acusar al otro y quedan dos informes y dos sanciones, uno por club acusado; y el 8 fija lo que NO pasa al informar: el desafío sigue publicado y el hilo abierto, porque el congelado empieza cuando alguien pide la revisión (caso 14) y termina cuando se resuelve la última (casos 19 y 20).

**Los arneses no son inmunes a los datos reales.** Al preparar la 47c, el de la 47 falló dos veces por la comprobación manual de la U5.1, sin que el código hubiera cambiado: toma el ÚLTIMO partido de clubes que exista —que pasó a ser uno de los P51, ya cancelado de verdad— y dos de sus conteos no estaban acotados a ese partido. El caso 9 contaba los `club_match_cancelled` de un administrador real sin filtrar por `matchId`, y el 15 contaba los eventos `encuentro_cancelado` de un desafío que ya traía uno. Se corrigieron acotando los conteos al partido de la prueba y borrando la bitácora del encuentro dentro de la transacción, junto a las sanciones que ya se borraban. Es el precio de reutilizar datos reales, y la razón por la que el arnés de la 47c crea los suyos.

Dos trampas al escribir estas pruebas. `set local role anon` **no borra** `request.jwt.claims`: sin poner unas claims sin `sub`, `auth.uid()` sigue devolviendo el usuario del bloque anterior y la comprobación de acceso anónimo pasa midiendo otra cosa. Y para provocar un vencimiento se envejece la fila, nunca el reloj, de modo que lo que se prueba es la comparación contra `now()` que hace el servidor.

Cada archivo se abre con `begin;` y termina en `rollback;`, así que ejecutarlo no deja filas guardadas ni siquiera si se corre contra el proyecto real — que hoy es el único que existe, porque no hay un Supabase de desarrollo separado. Lo que sí exige autorización explícita es **aplicar** una migración, no correr una prueba.

La verificación U3 del 2026-08-13 compuso también cada migración con su arnés dentro de una transacción exterior: 44e sola 8/8, 45 sola 14/14, ambas juntas 45b 13/13, 45c 18/18 y 45d 5/5. Se probó una carrera real con dos sesiones: la segunda recibió `lock_not_available` mientras la primera retenía la fila de `matches`, y ambas hicieron rollback. Tras aplicar 44e y 45 en producción se repitieron los arneses seguros —todos con su propio `BEGIN/ROLLBACK`— con los mismos resultados, más 44d 16/16. El catálogo confirmó 25 asistentes `legado`, cero NULL, ACL, Realtime y orden de triggers; la consulta final confirmó cero fixtures, objetos temporales, avisos duplicados y sesiones `idle in transaction`.

La comprobación local posterior al despliegue pasó `npm run lint` con 0 errores y 25 advertencias conocidas, `npm test` 376/376, Deno 13/13 y `npm run build:web`.

La prueba manual autenticada se hizo el 2026-08-13, con dos sesiones a la vez, y encontró un fallo de cliente que ninguna prueba SQL podía ver: la nómina pedía `profiles.nombre`, columna inexistente, y PostgREST rechazaba la consulta entera con `400 / 42703`. Corregido y cubierto por `src/utils/__tests__/nominaQuery.test.js`, que contrasta cada columna pedida contra `schema.sql` y las migraciones. Repetida la comprobación, pasó entera, incluido el corte de 720 px en Chrome a 390 × 845. Todo lo verificado es web; el render nativo en un dispositivo físico no tiene evidencia. `45_inscripcion_por_club_test.sql` se volvió a ejecutar contra producción, 14/14, y se verificó después que su `ROLLBACK` dejó la nómina idéntica fila por fila, sin usuarios ni partidos de fixture.

U4.4 lo repitió y subió la apuesta: `46_cambios_de_partido_test.sql` estuvo en 22/22 desde el primer día mientras la comprobación manual encontraba **tres** fallos, todos de cliente. Uno tumbaba el hilo entero en web (`Illegal invocation`) y sus nueve pruebas estaban en verde, porque todas inyectaban temporizadores falsos y el camino por defecto —el único que corre— no se ejecutaba nunca. Otro leía el nombre del club de una fila que nunca lo trae, y su prueba pura pasaba porque el nombre se le pasaba a mano: probaba la función, no la fuente. De ahí salen dos reglas: cuando algo se puede inyectar hay que probar **también** el valor por defecto, y una prueba que fabrica su propia entrada no dice nada sobre de dónde sale esa entrada en la aplicación — para eso las pruebas nuevas usan las formas reales de los cargadores y fijan el contrato de las fuentes contra el código y las migraciones.

U5.1 volvió a dar la razón a esa regla y añadió una vuelta más. El arnés SQL estuvo en 25/25 desde el primer día y la comprobación manual encontró igual un fallo de cliente: el hilo de un encuentro cancelado mostraba, como motivo, el de una sanción anterior del club por OTRO encuentro. La regresión que lo fija (`cancelacionEncuentro.test.js`) usa las fuentes reales del cargador —`sancionVigente()` sobre filas con la forma de `club_sanctions` y `challengeCtaContext()`, que es lo que arma `ChatThreadScreen`— y no un contexto escrito a mano. La vuelta de tuerca: escrita así, esa prueba **pasó en verde antes de existir el arreglo**, porque el `inicio_at` del fixture era posterior al «ahora» de la prueba y `sancionVigente()` devolvía null: no había ninguna sanción que mezclar. Verde por la razón equivocada es peor que rojo, y sólo se detectó porque se exigió ver el rojo antes de tocar el código. Cuando una prueba nueva pasa a la primera, la pregunta no es si el código está bien: es si la prueba está midiendo algo.

Una prueba SQL en verde no dice que la pantalla funcione. El arnés de la 45 llevaba 14/14 desde el despliegue mientras la nómina se veía vacía en las dos cuentas: el servidor estaba bien y quien mentía era el `select` del cliente. Por eso ninguna fase se cierra sólo con SQL.

## Pruebas de Edge Function

La lógica pura de la función `send-push` se prueba aparte:

```bash
deno test supabase/functions/send-push/pushLogic.test.ts
```

Esa suite cubre clasificación de tickets y recibos, deduplicación/validez de tokens y preferencias de push. No invoca Expo ni un proyecto Supabase reales.

## Flujos manuales autenticados

Con una instancia de desarrollo configurada y cuentas de prueba, comprobar al menos:

- acceso a rutas privadas sin sesión y retorno al destino después de login;
- privacidad de búsqueda y solicitudes de amistad entre dos usuarios;
- permisos de chat directo, de partido y de club, lectura, silencio y `/todos` grupal;
- publicación/solicitud/gestión de partido, asistencia y estados de error;
- membresía, administración y desafío de club;
- U3 con ambos clubes: reservar o no al proponer/aprobar, publicar, inscribirse/postular, confirmar o rechazar desde el club propio, salir/retirar y observar los cambios en la otra sesión sin recargar;
- edición de perfil con una imagen válida y una operación que falle para observar la reversión;
- bandeja de avisos: lectura, borrado, reintento y navegación al destino.

## Push sólo en dispositivo físico

La validación de push nativo exige dispositivos físicos Android/iOS, permisos concedidos, configuración de Firebase/EAS y servicios remotos autorizados. Probar registro de token, cada preferencia de categoría, recepción en primer plano y arranque frío, además de un token inválido. Web y simuladores omiten el registro nativo; por tanto, ni `npm test` ni `npm run build:web` validan push nativo.

## Notas relacionadas

- [Estado actual](estado-actual.md)
- [Pendientes](pendientes.md)
- [Despliegue y entornos](../arquitectura/despliegue-y-entornos.md)
