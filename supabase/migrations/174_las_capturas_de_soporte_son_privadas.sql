-- =============================================================
-- 174. LAS CAPTURAS DE SOPORTE SON PRIVADAS
--
-- Segunda pasada de seguridad (2026-11-09), punto «`support-screenshots`
-- es un bucket público».
--
-- QUÉ PASABA. La migración 52 creó el bucket público «como el resto» y
-- dejó escrito que el nombre del archivo no es adivinable. Las dos cosas
-- eran peores de lo que decían:
--   · Una captura de «reportar un problema» puede traer lo que la persona
--     tenía en pantalla: un chat, un cobro, un teléfono. No es una foto de
--     perfil.
--   · La ruta SÍ se podía averiguar. La política de lectura era
--     `bucket_id = 'support-screenshots'` para el rol `public`: cualquiera
--     con cuenta —y sin cuenta también— podía LISTAR la carpeta de otra
--     persona por la API de Storage y bajar lo que hubiera. Comprobado en
--     la base local el 2026-11-09: otra cuenta listó la carpeta ajena (1
--     archivo), la descargó y la firmó; sin cuenta, también.
--
-- QUÉ CAMBIA.
--   1. El bucket deja de ser público: `/object/public/...` ya no responde.
--   2. La lectura pasa a ser sólo de quien subió el archivo (su carpeta es
--      su `auth.uid()`), y sólo con sesión. Se necesita por dos razones:
--      la Edge Function `reportar-problema` firma el enlace del correo CON
--      EL TOKEN DE QUIEN REPORTA (no usa la clave de servicio), y la app
--      borra la captura huérfana si falla guardar el ticket (Storage exige
--      poder leer lo que se borra). El equipo las ve desde el panel, con
--      su propio rol.
--   3. Subir y borrar quedan igual: cada uno en su carpeta.
--   Los topes (8 MB, sólo imágenes) no se tocan.
--
-- QUÉ GUARDA `support_tickets.screenshot_url` DESDE AHORA. La app nueva
-- guarda la RUTA dentro del bucket (`<user_id>/<marca de tiempo>.<ext>`),
-- no una URL. Se usa la misma columna a propósito: una columna nueva
-- obligaría a que la app saliera DESPUÉS de la migración (un insert con una
-- columna que no existe pierde el reporte entero), y no hay OTA. Así el
-- cliente no depende del orden. Los tickets viejos, y los de las apps ya
-- instaladas, traen la URL pública completa: la función saca la ruta de
-- esa URL y la firma igual. No se reescribe ninguna fila.
--
-- ORDEN DE DESPLIEGUE — IMPORTA, y esta migración va AL FINAL:
--   1º  Desplegar `reportar-problema` (la versión que firma). Funciona con
--       el bucket público y con el privado, con la ruta y con la URL vieja.
--   2º  Publicar la app nueva (web al subir a `main`; nativa en el próximo
--       build). Guarda la ruta.
--   3º  Aplicar ESTA migración.
--   Si esta migración se aplica antes que el paso 1, los correos de las
--   apps ya instaladas llevarían un enlace muerto (la captura no se pierde:
--   queda en el bucket, pero el equipo tendría que ir a buscarla al panel).
--   Las apps ya instaladas siguen funcionando después del paso 3: suben
--   igual, guardan la URL pública —que ya no abre— y la función la
--   convierte en un enlace firmado.
--
-- Pruebas: supabase/tests/174_las_capturas_de_soporte_son_privadas_test.sql
-- =============================================================

-- ── 1. El bucket deja de ser público ──
update storage.buckets
   set public = false
 where id = 'support-screenshots';

-- ── 2. La lectura es de quien subió el archivo, y con sesión ──
drop policy if exists "support_screenshots_public_select" on storage.objects;
drop policy if exists "support_screenshots_owner_select" on storage.objects;
create policy "support_screenshots_owner_select"
    on storage.objects for select
    to authenticated
    using (
        bucket_id = 'support-screenshots'
        and (select auth.uid())::text = (storage.foldername(name))[1]
    );

-- ── 3. La columna dice lo que trae ──
comment on column public.support_tickets.screenshot_url is
    'Captura adjunta al reporte. Desde la migración 174 la app guarda la RUTA dentro del bucket privado support-screenshots (<user_id>/<marca>.<ext>); los tickets anteriores y los de apps ya instaladas traen la URL pública completa, que ya no abre. La Edge Function reportar-problema acepta las dos formas y manda un enlace firmado.';
