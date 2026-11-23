# Limpieza antes del lanzamiento

Deja producción sin el contenido de prueba (cuentas, partidos, clubes,
desafíos, mensajes, avisos, reservas, recintos, reportes, archivos) y
conserva la configuración: esquema, funciones, políticas, cron jobs, Vault,
Edge Functions y sus secretos, `feature_flags`, `truescore_config` y los
buckets (vacíos).

Se corre **una vez**, el día antes de abrir la app, con el sí de Vicente.
No es una migración: no va en `supabase/migrations/`.

## Archivos

- `limpieza.sql`: la base. Sin `begin`/`commit`, para envolverlo en un ensayo
  o en la corrida de verdad. Tiene guardas que abortan todo si:
  - un correo de la lista no existe (para que un error de tipeo no borre esa cuenta),
  - la lista está vacía (salvo `v_permitir_cero = true`),
  - hay registros de plata (pagos, saldos, cobros), que se conservan por ley,
  - aparece una tabla en `public` que no está clasificada (podría ser configuración),
  - al final queda contenido o no calza el número de cuentas.
- `limpiar-storage.mjs`: los archivos. Va **después** del SQL (se niega si
  todavía hay partidos o clubes). Conserva sólo la foto y la galería de las
  cuentas que quedaron; sin `--ejecutar` sólo muestra lo que borraría.
- `archivos.js`: la regla de qué archivo se queda, probada en
  `scripts/__tests__/limpiezaPrelanzamiento.test.js`.

## Pasos

1. **Respaldo.** Panel de Supabase → Database → Backups, o `pg_dump` con la
   cadena de conexión del panel. Sin respaldo no se sigue: esto no se deshace.
2. **Elegir las cuentas que se salvan.** En `limpieza.sql`, paso 0, cambiar
   `CAMBIAR@ejemplo.cl` por los correos (la de moderación, como mínimo; si no
   queda ninguna cuenta de moderador, nadie puede moderar desde la app).
3. **Ensayo.** Mandar `begin;` + el archivo + `rollback;` (MCP de Supabase o
   editor SQL). Tiene que terminar en el resumen sin error. Comprobar después
   que los conteos de producción siguen iguales.
4. **De verdad.** `begin;` + el archivo + `commit;`.
5. **Archivos.** Con la clave de servicio del panel (Settings → API), sólo en
   la línea de comandos:

   ```bash
   SUPABASE_URL=https://jvfoendzblkoxvwvommz.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/limpieza-prelanzamiento/limpiar-storage.mjs
   ```

   Revisar el resumen y repetir con `--ejecutar`. Borrar por la API también
   saca la copia del CDN, cosa que el SQL no hace.
6. **Comprobar** en www.futfinder.cl: entrar con una cuenta conservada, ver
   Inicio, Partidos, Clubes y Chat vacíos, y que la cuenta siga siendo
   moderadora.

## Lo que hay que saber

- Usa `TRUNCATE`, no `DELETE`: no dispara avisos ni pushes por cada partido o
  club borrado, y las guardas de borrado no se interponen. Va sin `CASCADE`:
  si algo conservado apuntara a lo que se vacía, Postgres aborta.
- Las cuentas conservadas mantienen login, perfil, teléfono, ubicación,
  aceptaciones legales y tokens de push; sus números (TrueScore, partidos,
  calificaciones, sanciones) vuelven al valor por defecto.
- Los recintos se borran todos, incluidos los aprobados: los reales se
  vuelven a cargar después por el flujo de solicitud y aprobación.
- Ensayado contra producción el 2026-11-18 conservando la cuenta de
  moderación: pasaron todas las guardas, quedaron 1 cuenta, 1 moderador,
  9 feature flags, 39 filas de `truescore_config` y cero partidos, clubes y
  recintos; se revirtió y producción quedó igual.
