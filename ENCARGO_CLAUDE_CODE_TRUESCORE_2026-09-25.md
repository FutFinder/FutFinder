# Encargo para Claude Code: cerrar pendientes de TrueScore y teléfono

Fecha: 2026-09-25. Auditoría base: commit `7e1f085` y [`PENDIENTES_CALIDAD_2026-09-23.md`](PENDIENTES_CALIDAD_2026-09-23.md), casos T01–T07. Este archivo es un encargo de implementación; los siete casos siguen **abiertos** hasta comprobar su corrección.

## Instrucción para Claude Code

Revisa y corrige los siete casos siguientes en la app FutFinder. Antes de editar, sigue `AGENTS.md`: haz `git pull`, conserva cambios ajenos y consulta solo la memoria pertinente. Contrasta cada hallazgo con el código actual, agrega pruebas útiles para las reglas y fallos relevantes, y prueba los flujos visibles. Usa español de Chile en toda la interfaz. Actualiza el listado de pendientes: marca cada caso resuelto únicamente después de verificarlo y conserva los demás casos e historial. Al terminar, ejecuta las comprobaciones pertinentes, revisa `git status`, crea un commit con solo tus archivos y haz `git push` como indica `AGENTS.md`. Entrega un resumen por ID con cambio, prueba y cualquier límite pendiente.

No incluyas credenciales ni números de teléfono reales en archivos o commits. Las cuentas de prueba, si se necesitan, están en un archivo externo al repositorio ya facilitado por el usuario. Evita cambios de datos productivos o flags para demostrar un caso: usa pruebas controladas o un entorno seguro para escenarios que alteren puntajes, sanciones y teléfonos.

## Problemas por corregir

### T01 · P1 · Perfil oculta el TrueScore inicial

- **Evidencia:** con fase 1 activa, una cuenta con `trust_score=75`, cero asistencias y un evento «Inicio de TrueScore 75» ve «N.A.» y «Se calcula tras tus primeros partidos» en Perfil. Confirmado en web con sesión iniciada y consulta de solo lectura.
- **Origen probable:** `src/utils/playerMeta.js` (`trustDisplay`), `src/screens/ProfileScreen.js` y `src/components/player/ReputationCard.js` conservan la regla anterior de ocultar el puntaje hasta el primer partido.
- **Cierre:** una cuenta recién inicializada muestra 75 y el nivel «Confiable» en Perfil, Inicio e Historial. Si de verdad falta el dato o falla su carga, la interfaz no inventa un puntaje. Comprueba también la misma cifra en perfiles públicos e invitaciones de club; los casos históricos I05 y P07 del listado están relacionados.

### T02 · P2 · Inicio usa niveles antiguos y un 100 inventado

- **Evidencia:** una cuenta con 75 aparece como «SÓLIDO» y «VERIFICADO», aunque `truescore_ajustes` la clasifica «Confiable». El camino `profile?.trust_score ?? 100` atribuye 100 cuando falta el perfil. Confirmado en web para el nivel; la rama de error se detectó en código.
- **Origen probable:** `src/screens/HomeScreen.js`, `src/components/home/TacticalHeader.js` y `src/components/home/TrustScoreCard.js`.
- **Cierre:** Inicio usa los niveles y umbrales activos del servidor, muestra «TrueScore» con una etiqueta coherente y distingue error/ausencia de perfil de un puntaje real. Prueba 75, los límites 50/90 y fallo de carga. Revisa los demás `?? 100` de la app antes de cerrar, sin ampliar el cambio a reglas de servidor innecesarias.

### T03 · P2 · El texto de GPS promete puntos que ya no da

- **Evidencia de código:** `src/screens/MatchDetailScreen.js` y `src/screens/MatchSpotScreen.js` aún dicen que confirmar por GPS suma o sube el Trust Score. Con fase 1 activa, el GPS solo confirma la llegada; la asistencia puntuada la registra el organizador.
- **Cierre:** en todas las pantallas y estados con fase 1 activa, el texto de GPS describe su efecto real. Si la app mantiene el flujo antiguo detrás del flag apagado, su texto debe corresponder a ese flujo. Verifica el detalle y «Mi cupo» en una situación elegible.

### T04 · P1 · Se puede confirmar una salida o cancelación sin conocer su costo

- **Evidencia de código:** `src/screens/MatchDetailScreen.js` y `src/screens/ManageMatchScreen.js` solicitan `truescore_costo_salida`, pero dejan habilitado el botón cuando la respuesta aún no llega o falla. El texto vuelve a «Salir del partido» o «Sí, cancelar el partido» sin costo.
- **Cierre:** con fase 1 activa, impide confirmar mientras el costo válido está pendiente o falló. Muestra un estado de carga y un error con reintento; presenta el costo exacto, incluido cero, antes de habilitar la acción. Vuelve a calcularlo al cambiar el motivo de cancelación y evita aceptar una respuesta anterior fuera de orden. Prueba RPC lenta, fallida y cambio rápido de motivo.

### T05 · P2 · Una restricción se atribuye falsamente a TrueScore cero

- **Evidencia de código:** `src/screens/PartidosScreen.js` afirma «Tu Trust Score llegó a 0» para toda cuenta restringida. La fase nueva no suspende automáticamente por puntaje. Hay un mensaje semejante en `src/services/matchRules.js`; revisa si puede aparecer con fase 1 activa.
- **Cierre:** la pantalla y los errores muestran el motivo real disponible o una explicación neutra si no se conoce, sin culpar a TrueScore. Prueba una cuenta restringida por otra causa y conserva la fecha de reactivación si existe.

### T06 · P2 · Historial truncado en 100 eventos

- **Evidencia de código:** `listMisEventosTrueScore` en `src/services/trueScore.js` usa límite 100; `src/screens/TrustScoreHistoryScreen.js` carga solo ese bloque, sin paginación. El cambio prometía acceso a cada movimiento inmutable.
- **Cierre:** pagina de forma estable hasta el primer evento, conserva el orden al cargar más y no duplica ni pierde filas si llegan eventos nuevos. Prueba al menos 101 eventos y la convivencia con el historial anterior archivado, si está visible en la pantalla.

### T07 · P2 · Un error de teléfono se presenta como «sin número»

- **Evidencia de código:** `miTelefono()` en `src/services/trueScore.js` devuelve `null` ante error; `src/screens/VerificarTelefonoScreen.js` lo sustituye por `{ registrado: false }`. Una falla de red puede ocultar un teléfono ya guardado y mostrar el formulario de registro.
- **Cierre:** separa «sin teléfono registrado» de «no pudimos consultarlo», muestra error con reintento y no permite guardar basándose en un estado desconocido. Prueba la RPC fallida con una cuenta que sí tiene número; no expongas el número completo en logs ni documentación.

## Qué quedó comprobado y qué sigue sin comprobarse

- El 2026-09-24, `truescore_ajustes` devolvió fases 1–3 activas, inicio en 75 y `telefono_obligatorio=false`; `mi_telefono` devolvió también `verificacion_sms=false` para la cuenta probada. Historial mostró el evento inicial y Perfil mostró Fair Play 100. Esto demuestra conexión de esas vistas, no todos los flujos de puntuación.
- La auditoría pasó `npm run verify` (1.586/1.586 pruebas) y `npm run build:web`. Los archivos SQL 134–138 contienen 152 inserciones de casos en el repositorio actual; **esta auditoría no los ejecutó**. No presentes esas pruebas como recién ejecutadas sin correrlas.
- Fase 4 y su tarea mensual, cierre de reclamos y Fair Play a las 48 horas, unicidad y obligatoriedad del teléfono en producción, y builds móviles **no quedaron verificados de punta a punta**. Son comprobaciones separadas, no fallos demostrados. Documenta lo que puedas comprobar de forma segura y deja explícito lo que siga pendiente.
- La aceptación y el rechazo de **solicitudes de amistad** en Avisos sí se probaron: mostraron «Solicitud aceptada» y «Solicitud rechazada», sin botones ni error, incluso tras recargar. No rehagas ese arreglo por este encargo; una solicitud nueva de club aún no se probó.

Consulta `docs/truescore-spec.md`, `docs/truescore-como-probar.md` y las migraciones 134–138 para las reglas, pero verifica los hechos sensibles al tiempo contra el código y la instancia a la que realmente tengas acceso. El listado consolidado conserva otros pendientes de Inicio, Chat y Perfil fuera de este encargo.
