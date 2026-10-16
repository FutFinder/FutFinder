-- =============================================================
-- FutFinder migration 163: el organizador puede borrar su portada
-- =============================================================
-- LA OCTAVA DIFERENCIA, y la encontró mirar `storage` con la misma lupa
-- que `public`. La migración 08 reparte, bucket por bucket, las cuatro
-- puertas de cada foto: leer, subir, reemplazar y borrar. Producción tiene
-- 27 políticas sobre `storage.objects` y el repositorio construye 28: la
-- que falta es `match_covers_organizer_delete`.
--
-- O sea: hoy, en producción, **nadie puede borrar la portada de un
-- partido**, ni siquiera quien lo organiza. Todos los demás buckets sí
-- tienen su puerta de borrado —`avatars`, `club-logos`, `club-gallery`,
-- `complejo-fotos`, `profile-gallery`, `solicitud-fotos` y
-- `support-screenshots`—; `match-covers` es el único asimétrico, y la
-- asimetría no está escrita en ninguna parte. Es un accidente de cómo se
-- aplicó la 08, no una decisión.
--
-- NO AMPLÍA NADA QUE NO SE PUEDA HACER YA. El organizador tiene
-- `match_covers_organizer_upload` y `match_covers_organizer_update`, y la
-- app sube con `upsert: true`: puede SOBRESCRIBIR la portada cuando
-- quiera. Poder borrarla es estrictamente menos que poder reemplazarla por
-- cualquier cosa. El predicado es el mismo de las otras dos puertas del
-- bucket, palabra por palabra: la carpeta del objeto es el id del partido
-- y el partido es suyo.
--
-- HOY NO LA LLAMA NADIE: `src/services/storage.js` no exporta un
-- `removeMatchCoverFile`. Esto no es para que empiece a borrarse, es para
-- que la base que construye el repositorio y la que está corriendo digan
-- lo mismo — y para que el día que la pantalla ofrezca «quitar la
-- portada», la puerta ya esté donde la 08 dijo que estaría.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

drop policy if exists "match_covers_organizer_delete" on storage.objects;
create policy "match_covers_organizer_delete"
    on storage.objects for delete
    using (
        bucket_id = 'match-covers'
        and exists (
            select 1 from public.matches m
            where m.id::text = (storage.foldername(name))[1]
              and m.id_organizador = auth.uid()
        )
    );
