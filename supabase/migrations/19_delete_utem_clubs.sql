-- =============================================================
-- FutFinder migration 19: eliminar clubes con "utem" en el nombre
-- Se borra en orden para respetar las FK (aunque hay CASCADE).
-- =============================================================

-- 1. Miembros del club
DELETE FROM public.club_members
WHERE club_id IN (
    SELECT id FROM public.clubs WHERE LOWER(nombre) LIKE '%utem%'
);

-- 2. Solicitudes e invitaciones del club
DELETE FROM public.club_join_requests
WHERE club_id IN (
    SELECT id FROM public.clubs WHERE LOWER(nombre) LIKE '%utem%'
);

-- 3. Mensajes del chat del club
DELETE FROM public.messages
WHERE club_id IN (
    SELECT id FROM public.clubs WHERE LOWER(nombre) LIKE '%utem%'
);

-- 4. El club en sí
DELETE FROM public.clubs
WHERE LOWER(nombre) LIKE '%utem%';
