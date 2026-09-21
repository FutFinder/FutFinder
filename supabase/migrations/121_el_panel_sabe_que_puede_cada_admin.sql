-- =============================================================
-- FutFinder migration 121: el panel sabe qué puede cada administrador
-- =============================================================
-- LOS PERMISOS EXISTEN Y SE APLICAN, PERO LA APP NO PUEDE VERLOS.
-- Desde la migración 83 el dueño reparte tres permisos —`canchas`,
-- `cobros` y `ficha`— y siete disparadores sobre las tablas los hacen
-- cumplir llamando a `puede_en_complejo()`. Comprobado contra producción
-- el 2026-09-21, 6/6: un administrador sin permisos no edita la ficha,
-- no crea canchas, no crea cobros y no toca tarifas.
--
-- El problema es que `admin_mis_complejos()` sólo devuelve `rol`, así
-- que el panel NO TIENE CÓMO SABER qué puede quien lo está mirando. Le
-- muestra a todo administrador las filas de Canchas, Horarios y tarifas,
-- Cobros y Ficha, y quien no tiene el permiso se entera recién al
-- guardar — con un error, que es como se lee «la app está rota».
--
-- La propia pantalla ya resolvió esto bien para otra cosa: los botones
-- de publicar y mandar a revisión se le esconden a quien no es dueño,
-- «porque ese rechazo llega como un error». Esta migración le da el dato
-- que falta para poder hacer lo mismo con las filas de configuración.
--
-- EL DUEÑO VIENE CON LOS TRES EN `true`, y esa es la decisión de fondo:
-- quien llama no tiene que acordarse de mirar también el rol. `rol` se
-- sigue devolviendo porque hay cosas que SÍ son sólo del dueño —la lista
-- de administradores, publicar, despublicar— y ésas no son permisos.
-- Así el cliente tiene exactamente la misma regla que el servidor:
--   · ¿puedo hacer algo de un área? → la bandera de esa área.
--   · ¿es una decisión del dueño?   → `rol`.
--
-- HAY QUE HACER `drop` ANTES: cambiar las columnas que devuelve una
-- función `returns table` no se puede con `create or replace`. Se
-- vuelven a conceder los permisos abajo, porque el drop se los lleva.
--
-- NO CAMBIA NINGUNA REGLA. Ni concede, ni revoca, ni toca
-- `puede_en_complejo()` ni los disparadores: sólo deja leer lo que ya
-- estaba guardado en `complejo_admins`, y sólo de uno mismo.
-- =============================================================

drop function if exists public.admin_mis_complejos();

create or replace function public.admin_mis_complejos()
returns table (
    id uuid,
    nombre text,
    descripcion text,
    direccion text,
    region text,
    comuna text,
    latitud numeric,
    longitud numeric,
    foto_url text,
    verificado_futfinder boolean,
    publicado boolean,
    aprobado_futfinder boolean,
    revision_pedida_at timestamp with time zone,
    rating_avg numeric,
    rating_count integer,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    rol text,
    puede_canchas boolean,
    puede_cobros boolean,
    puede_ficha boolean
)
language sql
security definer
set search_path = public
as $$
    select c.id, c.nombre, c.descripcion, c.direccion, c.region, c.comuna,
           c.latitud, c.longitud, c.foto_url, c.verificado_futfinder,
           c.publicado, c.aprobado_futfinder, c.revision_pedida_at,
           c.rating_avg, c.rating_count, c.created_at, c.updated_at,
           ca.rol,
           -- Las mismas tres respuestas que daría `puede_en_complejo()`,
           -- incluido que el dueño no tiene banderas que mirar. Si algún
           -- día esto y esa función dejaran de coincidir, el panel
           -- escondería filas que sí se pueden usar, o al revés.
           ca.rol = 'dueño' or coalesce(ca.puede_canchas, false),
           ca.rol = 'dueño' or coalesce(ca.puede_cobros, false),
           ca.rol = 'dueño' or coalesce(ca.puede_ficha, false)
      from public.complejos c
      join public.complejo_admins ca on ca.complejo_id = c.id
     where ca.user_id = auth.uid()
     order by c.nombre;
$$;

comment on function public.admin_mis_complejos() is
  'Los recintos que administra quien llama, con su rol y con lo que puede '
  'hacer en cada uno. Las tres banderas responden lo mismo que '
  'puede_en_complejo(): el dueño siempre true. Sirven para esconder lo que '
  'el servidor va a rechazar, nunca para autorizar nada.';

revoke all on function public.admin_mis_complejos() from public, anon;
grant execute on function public.admin_mis_complejos() to authenticated;
