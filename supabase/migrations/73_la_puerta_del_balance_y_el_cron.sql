-- =============================================================
-- FutFinder migration 73: cerrar la puerta del Balance y agendar el
-- vencimiento de reservas
-- =============================================================
-- DOS COSAS QUE NO TIENEN QUE VER ENTRE SÍ salvo que las dos son
-- operación y las dos estaban pendientes desde que se escribió el
-- vertical.
--
-- 1. `cargar_balance` ACREDITA SALDO SIN COBRAR NADA. Recibe un monto y
--    un `p_metodo` ('tarjeta' o 'transferencia'), escribe el movimiento
--    y devuelve el saldo nuevo. No hay pasarela detrás: es un tapón
--    esperando a Transbank/Flow/lo que se elija. Mientras tanto está
--    concedida a `authenticated`, o sea que cualquiera con la clave
--    pública y una cuenta puede regalarse la plata que quiera.
--
--    Hoy no hace daño —`balance_movimientos` está vacía y ninguna
--    pantalla la llama, el flujo del jugador sigue en datos de ejemplo—
--    pero es una puerta abierta esperando que alguien la empuje, y el
--    día que las pantallas del jugador se conecten sería tarde.
--
--    Se revoca de `authenticated`. La FUNCIÓN NO SE BORRA: el día que
--    exista la pasarela, lo que hay que reescribir es su cuerpo (validar
--    contra el proveedor antes de acreditar), y para eso conviene que la
--    firma y sus llamadores futuros sigan existiendo. Volver a
--    concederla es una línea, y esa línea debería ir en la misma
--    migración que conecte el cobro de verdad.
--
--    `get_mi_balance` NO se toca: leer el saldo propio no regala nada.
--
-- 2. `vencer_reservas_pasadas` NUNCA SE AGENDÓ. Se creó en la 55 con la
--    nota «hay que programarla con pg_cron» y quedó ahí. Sin ella, una
--    reserva que quedó 'armando' y cuyo partido ya pasó se queda
--    'armando' para siempre: no estorba el horario —el índice único solo
--    protege 'confirmada'— pero ensucia la agenda del recinto y las
--    listas del jugador con partidos que nunca van a jugarse.
--
--    Recién ahora tiene sentido agendarla: hasta la migración 70 el
--    corte estaba mal calculado y habría matado reservas TRES HORAS
--    ANTES de que empezara su propio partido. Agendarla antes del
--    arreglo habría sido peor que no agendarla.
--
--    Cada 5 minutos, igual que los otros cinco cron del proyecto.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. La puerta del Balance ─────────────────────────────────────
revoke execute on function public.cargar_balance(integer, text) from public, anon, authenticated;

-- ── 2. El cron del vencimiento ───────────────────────────────────
-- `cron.schedule` con un nombre que ya existe lo reemplaza, así que
-- basta con llamarla; el `unschedule` previo es para que la migración
-- también sirva para corregir un agendamiento anterior distinto.
do $$
begin
    if exists (select 1 from cron.job where jobname = 'futfinder-vencer-reservas') then
        perform cron.unschedule('futfinder-vencer-reservas');
    end if;
    perform cron.schedule(
        'futfinder-vencer-reservas',
        '*/5 * * * *',
        'select public.vencer_reservas_pasadas();'
    );
end $$;
