# Revisión diaria

Lo que hay que mirar todos los días mientras no exista un panel de administración completo. Son cuatro revisiones y ninguna toma más de un minuto. Desde la migración 151 hay una pantalla para lo que son conflictos entre personas —Ajustes → Moderación, sólo para quien está en el padrón—, y la sección 2 la usa; lo demás sigue siendo consultas en el editor SQL.

**La primera es la única urgente**: es plata de otra persona.

## 1. Plata por devolver

Un pago en `reversar` es de alguien que **pagó y no recibió nada**: lo pone `confirmar_pago` cuando el jugador pagó y, entre medio, otro grupo se llevó el bloque. La plata ya se movió.

```sql
select p.id, p.monto, p.orden_comercio, p.pagado_at,
       pr.username, r.fecha, r.hora_inicio, c.nombre as recinto
  from public.pagos p
  join public.profiles pr on pr.id = p.user_id
  left join public.reservas r on r.id = p.reserva_id
  left join public.canchas_reservables k on k.id = r.cancha_id
  left join public.complejos c on c.id = k.complejo_id
 where p.estado = 'reversar'
 order by p.pagado_at;
```

Cuando devuelvas el dinero, anótalo — si no, la lista crece para siempre y a la tercera nadie sabe cuál ya está resuelta:

```sql
select public.marcar_pago_reversado(
  '<pago_id>',
  'Devuelto por transferencia el <fecha>'
);
```

Solo corre con `service_role` (desde el editor SQL de Supabase). No se puede marcar como devuelto un pago que estaba bien cobrado, y marcarlo dos veces no pisa la fecha ni la nota de la primera.

**Devolver la plata sigue siendo a mano.** Cuando Flow esté conectado, la Edge Function va a llamar a su API de devolución y después a esta misma función. Hasta entonces, la transferencia la haces tú.

**Desde la migración 168 esta consulta también ve las cancelaciones.** Una reserva pagada con tarjeta que se cancela (el jugador, el recinto o el partido que se cae) deja sus pagos en `reversar` y le avisa a quien pagó: `cancelar_reserva_interna` y `admin_cancelar_reserva` llaman a `reversar_pagos_de_reserva`, la misma que usan `confirmar_pago` y el cron. Antes de la 168 esos pagos quedaban en `pagado`, sin marca. La consulta que sigue es el control de que esa grieta sigue cerrada: **tiene que venir vacía**; si trae filas, hay un camino de cancelación que no pasa por la 168.

```sql
select p.id, p.monto, p.orden_comercio, p.pagado_at, r.id as reserva_id, r.fecha, r.hora_inicio
  from public.pagos p
  join public.reservas r on r.id = p.reserva_id
 where p.estado = 'pagado' and r.estado = 'cancelada'
 order by p.pagado_at;
```

**Pagos que se quedaron en `pendiente` (desde la migración 190).** La conciliación (`conciliar-pagos`, cada 10 minutos) le pregunta a Flow por cada pendiente con más de 20 minutos y lo resuelve; uno que Flow sigue informando como pendiente no se cierra a la fuerza. Esta consulta **tendría que venir vacía**: si trae filas, la conciliación no está corriendo (falta el secreto, la función no está desplegada o Flow no contesta) o Flow tiene un cobro abierto hace más de un día, y hay que mirarlo en el panel de Flow.

```sql
select p.id, p.monto, p.orden_comercio, p.created_at, p.referencia_externa is not null as tiene_enlace
  from public.pagos p
 where p.estado = 'pendiente' and p.created_at < now() - interval '24 hours'
 order by p.created_at;

-- Lo que hizo la conciliación en las últimas 24 horas.
select * from public.conciliaciones where created_at > now() - interval '24 hours' order by created_at desc;
```

## 2. Moderación: lo que espera a que alguien decida

**La cola vive en la app**: Ajustes → Moderación (migraciones 151 y 164), y sólo la ve quien está en `public.moderadores`. Trae cuatro listas, en este orden:

1. **Revisiones de sanción**: un club pidió revisar una sanción y su desafío está congelado (`bloqueado_sancion`) hasta que alguien decida. Se resuelve desde la pantalla: retirar o mantener la sanción.
2. **Resultados en disputa**: un club rechazó el marcador del otro y el desafío quedó en `resultado_en_disputa`, sin salida para los clubes. Se reabre desde la pantalla.
3. **Reportes de usuario sin mirar**: se resuelven desde la pantalla (migración 194). **Plazo: 24 horas** desde que llegan; es lo que piden Apple y Google. Cómo decidir, más abajo.
4. **Recintos esperando revisión**: los que apretaron «Mandar a revisión» y todavía no están aprobados, con cuántos días llevan esperando. Se aprueban desde la pantalla; cómo, en [Aprobar recintos](aprobar-recintos.md). Rechazar todavía no existe.

Si hace falta mirarlas sin la pantalla (o sin estar en el padrón), son estas consultas en el editor SQL:

```sql
-- 1. Revisiones de sanción pendientes
select r.id, c.nombre as club, r.tipo, r.motivo, r.created_at
  from public.club_sanction_reviews r
  left join public.clubs c on c.id = r.club_id
 where r.estado = 'pendiente'
 order by r.created_at;

-- 2. Resultados en disputa
select d.id, cr.nombre as club_retador, cd.nombre as club_retado, d.match_id
  from public.club_challenges d
  left join public.clubs cr on cr.id = d.club_retador_id
  left join public.clubs cd on cd.id = d.club_retado_id
 where d.estado = 'resultado_en_disputa'
 order by d.created_at;

-- 3. Reportes de usuario sin mirar (los de más de 24 horas, primero)
select u.id, u.motivo, u.elemento, u.descripcion, p.username as reportado, u.created_at,
       u.created_at < now() - interval '24 hours' as fuera_de_plazo
  from public.user_reports u
  left join public.profiles p on p.id = u.reported_id
 where u.reviewed_at is null
 order by u.created_at;

-- 4. Recintos esperando revisión
select c.id, c.nombre, c.comuna, c.revision_pedida_at,
       (select count(*) from public.canchas_reservables k
         where k.complejo_id = c.id and k.activa) as canchas_activas
  from public.complejos c
 where c.revision_pedida_at is not null and not c.aprobado_futfinder
 order by c.revision_pedida_at;
```

Las RPC `moderacion_*` exigen una sesión que esté en el padrón y por eso no sirven desde el editor SQL (sin sesión, `es_moderador()` da falso). Desde ahí una revisión se resuelve con `resolver_revision_sancion()`, que sólo corre con `service_role`.

### Reportes: cómo decidir (migración 194)

Cada fila trae qué se reportó, a quién, la descripción, cuántos reportes más tiene esa persona y si ya está suspendida. Las decisiones, de menor a mayor:

- **Descartar**: el reporte no se sostiene (un desacuerdo de cancha, un reporte de venganza). No avisa a nadie.
- **Advertir**: algo menor y primera vez. Le llega un aviso con las reglas de convivencia.
- **Quitar contenido**: una foto, un escudo, una descripción o una bio ofensiva, sexual o que suplanta a alguien. Se borra y le llega un aviso. **No se puede deshacer.**
- **Suspender 7 días**: insultos, acoso o reincidencia después de una advertencia. **30 días**: acoso grave, amenazas o una segunda suspensión. Mientras dura no puede publicar partidos, escribir, subir fotos ni pedir amistad; sí puede reportar.

Si lo reportado es ilegal (amenazas serias, contenido sexual de menores), además de quitarlo y suspender hay que guardar el reporte y avisar a la autoridad; no borres la cuenta, que borraría la evidencia.

La persona apela por correo a futfindercl@gmail.com. Para levantar una suspensión antes de tiempo, desde el editor SQL:

```sql
update public.moderacion_suspensiones set hasta = now() where user_id = '<user_id>';
```

## 3. Solicitudes de recinto nuevas

```sql
select id, nombre_recinto, comuna, nombre_dueno, telefono, correo, created_at
  from public.solicitudes_recinto
 where estado = 'nueva'
 order by created_at;
```

## 4. Que el cron siga vivo

`vencer_reservas_pasadas` corre cada cinco minutos (migración 73, `futfinder-vencer-reservas`) y es lo que libera las horas de las reservas que nadie pagó. Si se cae, los bloques quedan tomados por reservas muertas.

```sql
select jobname, active,
       (select max(end_time) from cron.job_run_details d where d.jobid = j.jobid) as ultima_corrida
  from cron.job j where jobname like 'futfinder-%';
```

## Notas relacionadas

- [Aprobar recintos](aprobar-recintos.md)
- [Reservas](../funcionalidades/reservas.md)
