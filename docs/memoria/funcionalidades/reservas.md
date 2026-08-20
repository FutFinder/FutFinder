# Reservas

Última revisión: 2026-08-20

## Propósito

Vertical de reserva de canchas (handoff de Claude Design `Reservas.dc.html`, proyecto "Nueva estética y reservas", 33 pantallas): buscar complejo → elegir cancha → elegir fecha y hora → elegir modalidad de pago → cobrar → confirmar. Incluye el futuro Balance FutFinder (monedero interno) y tres modalidades de pago (completa, dividida entre 2 capitanes, dividida entre todos).

## Estado actual — solo descubrimiento, sin pagos

**Backend deliberadamente simulado.** No hay tablas de Supabase para complejos, canchas, reservas ni balance, ni pasarela de pago conectada — decisión explícita documentada en `src/services/reservas.js` y `reservasRules.js`. Todas las funciones de `reservas.js` devuelven siempre los mismos datos de ejemplo y no dependen de `isSupabaseConfigured`, a diferencia del resto de los servicios de la app.

Construido hasta ahora (pantallas 1 a 8 del handoff):
- Fundaciones: tokens (`reservas`/`reservasRadius`/`reservasFonts`/`reservasSizes` en `theme/colors.js`, comparten paleta con `clubsExplorer`) y primitivas (`components/reservas/ui.js`: `Card`, `Button`, `IconButton`, `Chip`, `Badge`, `ListRow`, `SectionLabel`, `Sheet`, `Stepper`, `NoticeCard`, `StickyFooter`), validadas en `ReservasUiGalleryScreen` (pantalla interna de QA, no es parte del producto).
- Shell de navegación: Avisos dejó de ser pestaña, su lugar lo toma `ReservasTab` (ícono calendario); la campana de notificaciones (`NotificationBell`) pasa arriba a la derecha en cada pantalla principal.
- Descubrimiento completo: `ReservasScreen` (lista + "Juega hoy" + filtros vía `FiltrosSheet`, y la vista de mapa esquemático con dos pines destacados y su vista previa — el mapa NO es un `MapView` real, es una ilustración de Views, igual que el propio prototipo, así que no hereda el pendiente de mapa real en web), `ComplejoDetailScreen`, `ElegirCanchaScreen`, `FechaHoraScreen` y `ResumenReservaScreen`.

**Todavía no construido:** Balance/monedero (pantallas 11, 26), las tres modalidades de pago con su transacción atómica (9, 10, 12–18, 19–22), post-reserva (23–25) y bordes/calificación (27–33). El CTA "Continuar al pago" de `ResumenReservaScreen` muestra un aviso de "todavía no disponible" en vez de navegar a una pantalla inexistente.

## Reglas y permisos

`reservasRules.js` es puro (sin React, sin Supabase) y centraliza el cargo de servicio fijo ($1.500), el redondeo de cuota a $50, los límites de jugadores (2–30), la carga mínima de Balance ($1.000) y la ventana de cancelación (12 h) — ningún componente debe recalcular estos números por su cuenta. También trae `buildFechaOptions()`/`fechaLabel()` (tira de fechas real, con fecha LOCAL para no correrse un día en husos negativos como Chile si se usara `toISOString()`) y `addMinutesToHora()` (corrige una inconsistencia del propio prototipo, que siempre suma 1 hora sin mirar la duración de 90 min elegida).

Dos adaptaciones deliberadas del prototipo a datos reales, no fabricados: el mapa reutiliza los complejos reales ya cargados (no una lista de ejemplo aparte), y la lista de "Elegir cancha"/"Ver horarios" navega con el `canchaId` real tocado en vez de ignorar cuál fila se presionó.

## Pantallas y dependencias

- Pantallas: `ReservasScreen`, `ComplejoDetailScreen`, `ElegirCanchaScreen`, `FechaHoraScreen`, `ResumenReservaScreen`, `ReservasUiGalleryScreen` (QA interna).
- Código: `src/services/reservas.js`, `reservasRules.js`, `src/components/reservas/ui.js`, `FiltrosSheet.js`.
- Navegación: `MainTabs.js` (`ReservasTab`), `AppNavigator.js` (`ComplejoDetail`, `ElegirCancha`, `FechaHora`, `Resumen`, todas con `withAuthGuard`).

## Estados, errores y problemas conocidos

La disponibilidad horaria (`getDisponibilidad()`) es la misma grilla fija de 12 bloques con 5 ocupados siempre, sin variar por cancha ni por fecha — limitación de datos de ejemplo, no un bug. Un complejo sin canchas cargadas (dos de los tres complejos de ejemplo) muestra un aviso en vez de un botón roto, y `ComplejoDetailScreen` esconde el CTA sticky en ese caso.

## Notas relacionadas

- [Sistema visual](../diseno/sistema-visual.md)
- [Navegación](../arquitectura/navegacion.md)
