# Revisión diaria

Lo que hay que mirar todos los días mientras no exista un panel de administración. Son cuatro consultas y ninguna toma más de un minuto.

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

## 2. Recintos esperando revisión

```sql
select c.id, c.nombre, c.comuna, c.revision_pedida_at,
       (select count(*) from public.canchas_reservables k
         where k.complejo_id = c.id and k.activa) as canchas_activas
  from public.complejos c
 where c.revision_pedida_at is not null and not c.aprobado_futfinder
 order by c.revision_pedida_at;
```

Cómo aprobarlos, en [Aprobar recintos](aprobar-recintos.md).

## 3. Solicitudes de recinto nuevas

```sql
select id, nombre_recinto, comuna, nombre_dueno, telefono, correo, created_at
  from public.solicitudes_recinto
 where estado = 'nueva'
 order by created_at;
```

## 4. Que el cron siga vivo

`vencer_reservas_pasadas` corre cada cinco minutos y es lo que libera las horas de las reservas que nadie pagó. Si se cae, los bloques quedan tomados por reservas muertas.

```sql
select jobname, active,
       (select max(end_time) from cron.job_run_details d where d.jobid = j.jobid) as ultima_corrida
  from cron.job j where jobname like 'futfinder-%';
```

## Notas relacionadas

- [Aprobar recintos](aprobar-recintos.md)
- [Reservas](../funcionalidades/reservas.md)
