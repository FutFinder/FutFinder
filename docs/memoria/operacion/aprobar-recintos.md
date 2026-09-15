# Aprobar recintos

Cómo se pasa de «alguien quiere sumar su complejo» a «su recinto está en el buscador». No hay panel de administración: son dos consultas, y están acá para no reinventarlas cada vez.

**Son dos permisos distintos y conviene no confundirlos.** El primero deja CREAR el recinto; el segundo deja PUBLICARLO. Tener el primero no acerca al segundo, y los dos los da FutFinder a mano.

## 1. Habilitar a alguien para crear su recinto

Llega una fila a `solicitudes_recinto` (la manda la persona desde la app, pestaña Reservas → «Quiero sumar mi recinto»). Trae nombre del recinto, dirección, comuna, nombre del dueño, teléfono, correo y —desde la migración 110— **cuántas canchas tiene, hasta seis fotos y los servicios que ofrece**.

**Las fotos están en el bucket privado `solicitud-fotos`** y la columna `fotos` guarda su RUTA, no una URL: se miran desde Supabase → Storage, o por el enlace firmado que trae el correo del aviso (vence a los 7 días). No son públicas porque el recinto todavía no entró.

**Los servicios usan el mismo catálogo cerrado que `complejo_servicios`**, así que al cargar el recinto se copian tal cual:

```sql
-- Con el complejo ya creado, copia lo que marcó el dueño en su solicitud.
-- Va directo a la tabla y no por `admin_actualizar_servicios`: esa RPC exige
-- `auth.uid()` y ser administrador del complejo, y en el editor de SQL no hay
-- sesión. Desde ahí se escribe como postgres, que no pasa por la RLS.
insert into public.complejo_servicios (complejo_id, servicio)
select '<complejo_id>', s
  from public.solicitudes_recinto sr, unnest(sr.servicios) as s
 where sr.id = '<solicitud_id>'
    on conflict (complejo_id, servicio) do nothing;
```

Los tres campos **pueden venir vacíos**: las solicitudes anteriores a la 110 no los tienen, y una app vieja tampoco los manda. `n_canchas` en `null` significa «no lo dijo», no «cero».

Lo que hay que mirar antes de aprobar sigue siendo lo que no está en la tabla: que el complejo exista, que quien escribe tenga que ver con él, y que vaya a trabajar en serio. Eso es una llamada, no una consulta.

```sql
-- Reemplaza el id por el de la solicitud.
begin;

update public.solicitudes_recinto
   set estado = 'aprobada', avisada_at = now()
 where id = '00000000-0000-0000-0000-000000000000'
returning solicitante_id, nombre_recinto, telefono;

-- Con el `solicitante_id` que devolvió la línea de arriba:
insert into public.autorizaciones_recinto (user_id, solicitud_id, nota)
values (
  '<solicitante_id>',
  '00000000-0000-0000-0000-000000000000',
  'Hablé con el dueño el <fecha>'
);

commit;
```

**La autorización es de un solo uso.** Se gasta en el momento en que la persona crea su recinto, en la misma transacción, así que dos toques del botón no pueden dar dos recintos. Quien tiene dos sedes manda dos solicitudes y se ven las dos.

Un índice único impide crear dos autorizaciones para la misma solicitud: aprobar dos veces por error no entrega dos recintos.

Desde ese momento, en «Mis recintos» esa persona ve **«Ya puedes crear tu recinto»** en vez del vacío de siempre.

## 2. Aprobar la publicación

El dueño carga sus canchas, horarios y precios, y cuando tiene al menos una cancha activa con horario puede apretar **«Mandar a revisión»**. Eso escribe `complejos.revision_pedida_at`.

```sql
-- Lo que está esperando revisión.
select c.id, c.nombre, c.comuna, c.revision_pedida_at,
       (select count(*) from public.canchas_reservables k
         where k.complejo_id = c.id and k.activa) as canchas_activas
  from public.complejos c
 where c.revision_pedida_at is not null
   and not c.aprobado_futfinder
 order by c.revision_pedida_at;
```

Antes de aprobar conviene mirar la ficha como la va a ver un jugador: nombre, dirección, foto, precios. **Y sobre todo el punto del mapa** — es lo único que el dueño fija por su cuenta y lo que más rompe el buscador si está mal.

```sql
update public.complejos
   set aprobado_futfinder = true
 where id = '<complejo_id>';
```

Aprobar **no publica**: habilita al dueño a publicar cuando quiera. Publicar y despublicar siguen siendo suyos. Despublicar nunca exige nada — si un recinto tiene que salir del buscador, sale.

Quitar la aprobación (`aprobado_futfinder = false`) **no despublica** lo que ya está publicado; solo impide volver a publicar. Para bajar un recinto del buscador hay que poner `publicado = false`.

## Lo que no se hace por acá

`verificado_futfinder` es otra cosa: es la insignia que ve el jugador, y no tiene nada que ver con poder publicar. Un recinto aprobado y publicado puede no estar verificado.

## Notas relacionadas

- [Reservas](../funcionalidades/reservas.md)
- [Base de datos](../arquitectura/base-de-datos.md)
