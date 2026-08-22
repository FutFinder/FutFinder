-- =============================================================
-- 53. Tema de color del club
-- =============================================================
-- Idempotente: seguro de re-ejecutar.
--
-- QUÉ AGREGA
--   `clubs.tema`: una de cuatro CLAVES ESTABLES —'green', 'blue', 'red',
--   'yellow'— que la app traduce a una escala de tonos completa
--   (src/theme/clubThemes.js). No es un HEX a propósito:
--
--     · un color libre no se puede validar en el servidor;
--     · no garantiza contraste de texto ni de iconos;
--     · deja la app sin forma de retocar la paleta más adelante sin
--       reescribir filas.
--
-- POR QUÉ `NOT NULL DEFAULT 'green'`
--   Los clubes existentes tienen que conservar el verde, y con un default
--   no volátil Postgres no reescribe la tabla: el backfill es instantáneo
--   incluso con la tabla llena. Además evita el tercer estado «tema nulo»,
--   que obligaría a cada consulta a decidir qué significa.
--   (La app normaliza igualmente un valor ausente o desconocido a verde:
--   ver `normalizarTemaClub()`. Que la columna no exista todavía no puede
--   dejar una pantalla sin color.)
--
-- QUIÉN PUEDE CAMBIARLO
--   Los administradores del club y nadie más. No hace falta una policy
--   nueva: `clubs_update` (migración 20) ya limita el UPDATE de la fila
--   entera a los administradores, y `tema` es una columna más de esa fila.
--   Lo que sí se hace acá es volver EXPLÍCITO el `WITH CHECK` de esa
--   policy. Hoy es equivalente —Postgres reutiliza el `USING` cuando falta
--   el `WITH CHECK`—, pero escrito se puede leer, probar y no se pierde en
--   una edición futura de la policy.
--
-- QUÉ NO CAMBIA
--   Los colores semánticos de la app (victoria, empate, derrota, error,
--   dorado de Premium) no viven en la base de datos ni dependen de esta
--   columna. Un club rojo no altera el color de una victoria.
--
-- Pruebas: supabase/tests/53_tema_del_club_test.sql
-- =============================================================

-- ── 1. La columna ────────────────────────────────────────────
alter table public.clubs
    add column if not exists tema text not null default 'green';

-- ── 2. El CHECK, aparte y re-creable ─────────────────────────
-- Se agrega en un bloque propio para que la migración sea idempotente
-- incluso si la columna ya existía sin restricción (mismo patrón que la
-- migración 29 con `modalidad`).
do $$
begin
    if exists (
        select 1 from pg_constraint
        where conname = 'clubs_tema_check'
          and conrelid = 'public.clubs'::regclass
    ) then
        alter table public.clubs drop constraint clubs_tema_check;
    end if;
end $$;

-- Cualquier fila que hubiera quedado con un valor desconocido —de una
-- ejecución anterior a medias— vuelve al verde antes de imponer el CHECK,
-- para que la migración no falle a mitad de camino.
update public.clubs
   set tema = 'green'
 where tema is null
    or tema not in ('green', 'blue', 'red', 'yellow');

alter table public.clubs
    add constraint clubs_tema_check
    check (tema in ('green', 'blue', 'red', 'yellow'));

comment on column public.clubs.tema is
    'Tema de color del club: green | blue | red | yellow. Clave estable, nunca un HEX; la escala de tonos vive en src/theme/clubThemes.js. Default green para todos los clubes anteriores a esta migración.';

-- ── 3. RLS: el UPDATE sigue siendo solo de administradores ────
-- Misma expresión que la migración 20, ahora también como WITH CHECK.
-- Equivalente en comportamiento; explícito para que se pueda auditar.
drop policy if exists "clubs_update" on public.clubs;
create policy "clubs_update"
    on public.clubs for update
    using (
        exists (
            select 1 from public.club_members m
            where m.club_id = clubs.id
              and m.user_id = auth.uid()
              and m.rol = 'admin'
        )
    )
    with check (
        exists (
            select 1 from public.club_members m
            where m.club_id = clubs.id
              and m.user_id = auth.uid()
              and m.rol = 'admin'
        )
    );
