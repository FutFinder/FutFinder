-- =============================================================
-- FutFinder migration 56: Balance FutFinder (monedero interno)
-- =============================================================
-- El saldo se calcula como sum(monto) del ledger `balance_movimientos`,
-- nunca se guarda un campo `saldo` mutable aparte: así no hay forma de
-- que un saldo mostrado se desincronice de sus movimientos.
--
-- Carga mínima $1.000 CLP, sin monto máximo, no caduca. La integración
-- real con una pasarela (Webpay/Flow/Mercado Pago) queda fuera de este
-- alcance: `metodo_carga` solo registra qué eligió el usuario, no cobra
-- nada de verdad todavía.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

create table if not exists public.balance_movimientos (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    tipo text not null check (tipo in ('carga', 'cobro_reserva', 'devolucion_cancelacion')),
    -- positivo = entra saldo, negativo = sale
    monto integer not null,
    reserva_id uuid references public.reservas(id),
    metodo_carga text check (metodo_carga in ('tarjeta', 'transferencia')),
    created_at timestamptz not null default now(),

    constraint balance_movimientos_carga_sin_reserva check (
        tipo <> 'carga' or reserva_id is null
    ),
    -- El signo de `monto` tiene que calzar con el tipo de movimiento;
    -- ninguna función debería poder insertar un cobro positivo por error.
    constraint balance_movimientos_signo check (
        (tipo = 'carga' and monto > 0)
        or (tipo = 'cobro_reserva' and monto < 0)
        or (tipo = 'devolucion_cancelacion' and monto > 0)
    )
);

create index if not exists idx_balance_movimientos_user on public.balance_movimientos(user_id);
create index if not exists idx_balance_movimientos_user_created on public.balance_movimientos(user_id, created_at desc);

alter table public.balance_movimientos enable row level security;

-- La tabla más sensible de todo el vertical: solo lo propio, sin
-- excepción, y sin insert/update/delete directo — solo las RPC de
-- abajo (y `confirmar_reserva`/`cancelar_reserva` en la migración 55)
-- escriben en ella.
drop policy if exists "balance_movimientos_select" on public.balance_movimientos;
create policy "balance_movimientos_select"
    on public.balance_movimientos for select
    using (auth.uid() = user_id);

-- ── RPC: cargar_balance ───────────────────────────────────────────
create or replace function public.cargar_balance(
    p_monto integer,
    p_metodo text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_saldo integer;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;
    if p_monto is null or p_monto < 1000 then
        return json_build_object('ok', false, 'reason', 'La carga mínima es $1.000');
    end if;
    if p_metodo not in ('tarjeta', 'transferencia') then
        return json_build_object('ok', false, 'reason', 'Medio de carga inválido');
    end if;

    insert into public.balance_movimientos (user_id, tipo, monto, metodo_carga)
    values (v_me, 'carga', p_monto, p_metodo);

    select coalesce(sum(monto), 0) into v_saldo
      from public.balance_movimientos where user_id = v_me;

    insert into public.notifications (user_id, type, title, body, data)
    values (
        v_me, 'balance_cargado', 'Saldo cargado',
        'Se agregaron $' || p_monto || ' a tu Balance FutFinder.',
        jsonb_build_object('monto', p_monto)
    );

    return json_build_object('ok', true, 'saldo', v_saldo);
end;
$$;

revoke all on function public.cargar_balance(integer, text) from public;
grant execute on function public.cargar_balance(integer, text) to authenticated;

-- ── RPC: get_mi_balance ───────────────────────────────────────────
-- Devuelve el saldo y los movimientos SOLO del usuario autenticado.
-- No acepta un p_user_id: no hay forma de pedir el saldo de otro
-- (regla de negocio de privacidad de saldos).
create or replace function public.get_mi_balance()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_saldo integer;
    v_movimientos json;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select coalesce(sum(monto), 0) into v_saldo
      from public.balance_movimientos where user_id = v_me;

    select coalesce(json_agg(json_build_object(
               'id', id, 'tipo', tipo, 'monto', monto,
               'reserva_id', reserva_id, 'metodo_carga', metodo_carga,
               'created_at', created_at
           ) order by created_at desc), '[]'::json)
      into v_movimientos
      from public.balance_movimientos
     where user_id = v_me;

    return json_build_object('ok', true, 'saldo', v_saldo, 'movimientos', v_movimientos);
end;
$$;

revoke all on function public.get_mi_balance() from public;
grant execute on function public.get_mi_balance() to authenticated;
