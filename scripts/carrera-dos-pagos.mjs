#!/usr/bin/env node
/**
 * La carrera de dos pagos por la misma cancha y la misma hora.
 *
 * QUÉ PRUEBA. Una reserva sin confirmar no ocupa el bloque, así que dos
 * grupos pueden estar pagando la misma hora a la vez. Cuando llegan los dos
 * avisos de Flow, `confirmar_pago` tiene que dejar EXACTAMENTE una reserva
 * confirmada; el otro pago —plata que ya se movió— tiene que quedar en
 * `reversar`, con su reserva `rechazada` y un aviso a quien pagó. Nunca dos
 * confirmadas, nunca un pago perdido sin marca.
 *
 * POR QUÉ NO ES UN ARNÉS .sql. Los de `supabase/tests/` corren en una sola
 * sesión: prueban la regla, no la carrera. El candado
 * (`pg_advisory_xact_lock` sobre cancha|fecha|hora, el mismo de
 * `confirmar_reserva`) sólo se ejercita con dos transacciones vivas. Es la
 * misma razón de `scripts/carrera-dos-sesiones.sh`.
 *
 * CÓMO CORRE. Dos procesos `psql` reales dentro del contenedor de la base
 * local. Dos clases de vuelta:
 *   · ORQUESTADA: A confirma y retiene su transacción 1,5 s antes del
 *     COMMIT; B entra a los 0,4 s. B tiene que ESPERAR a A (si no esperó, el
 *     candado no está) y, al despertar, ver la hora tomada.
 *   · LIBRE: los dos se lanzan a la vez y se mira quién gana.
 *
 * Sólo contra la base local: se niega si el contenedor no es
 * `supabase_db_futfinder-local`. Crea usuarios y reservas ficticias y las
 * borra al terminar, también si algo falla.
 *
 * Uso:  node scripts/carrera-dos-pagos.mjs [vueltas libres, 8 por omisión]
 */

import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const CT = 'supabase_db_futfinder-local';
const VUELTAS = Number(process.argv[2] || 8);
const MARCA = `carrera-${Date.now()}`;

function hayContenedor() {
  try {
    return execFileSync('docker', ['ps', '--filter', `name=^${CT}$`, '--format', '{{.Names}}'],
      { encoding: 'utf8' }).trim() === CT;
  } catch (_) { return false; }
}

function sql(texto) {
  return execFileSync('docker',
    ['exec', '-i', CT, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'],
    { input: texto, encoding: 'utf8' }).trim();
}

/** Lanza un psql y devuelve { salida, ms } cuando termina. */
function sesion(texto) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn('docker',
      ['exec', '-i', CT, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A']);
    let salida = '';
    p.stdout.on('data', (d) => { salida += d; });
    p.stderr.on('data', (d) => { salida += d; });
    p.on('close', () => resolve({ salida: salida.trim(), ms: Date.now() - t0 }));
    p.stdin.end(texto);
  });
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

if (!hayContenedor()) {
  console.error(`No está corriendo ${CT}. Esto sólo corre contra la base local.`);
  process.exit(1);
}

const uA = randomUUID();
const uB = randomUUID();
const uAdmin = randomUUID();
let complejo = null;
let cancha = null;
const fallos = [];

function preparar() {
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', '${MARCA}-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}'
      from unnest(array['${uA}', '${uB}', '${uAdmin}']::uuid[]) u;
    insert into public.profiles (id, username)
    select u, 'carr' || substr(replace(u::text, '-', ''), 1, 10) from unnest(array['${uA}', '${uB}', '${uAdmin}']::uuid[]) u
    on conflict (id) do nothing;
  `);
  complejo = sql(`insert into public.complejos (nombre, comuna, latitud, longitud) values ('${MARCA}', 'Ñuñoa', -33.45, -70.6) returning id;`);
  sql(`insert into public.complejo_admins (complejo_id, user_id, rol) values ('${complejo}', '${uAdmin}', 'dueño');`);
  cancha = sql(`insert into public.canchas_reservables (complejo_id, nombre, tipo, precio_hora) values ('${complejo}', '${MARCA}', 'futbol_7', 20000) returning id;`);
}

/** Dos reservas `armando` por el MISMO bloque, cada una con su pago pendiente. */
function bloque(n) {
  const dia = 300 + n;
  const fila = (u, orden) => sql(`
    with r as (
      insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin, precio_total, modalidad, medio_pago, precio_cancha, estado)
      values ('${cancha}', '${u}', current_date + ${dia}, '05:19', '06:19', 20000, 'completa', 'tarjeta', 20000, 'armando')
      returning id
    )
    insert into public.pagos (user_id, reserva_id, monto, proveedor, orden_comercio)
    select '${u}', r.id, 20000, 'flow', '${orden}' from r
    returning reserva_id;
  `);
  const ordenA = `${MARCA}-${n}-A`;
  const ordenB = `${MARCA}-${n}-B`;
  return { ordenA, ordenB, resA: fila(uA, ordenA), resB: fila(uB, ordenB) };
}

const confirmar = (orden) =>
  `select public.confirmar_pago('${orden}', 'TOKEN-${orden}', '{"amount": 20000}'::jsonb)::text;`;

function revisar(nombre, b) {
  const [confirmadas, rechazadas, pagados, porDevolver, avisos] = sql(`
    select
      (select count(*) from public.reservas where id in ('${b.resA}', '${b.resB}') and estado = 'confirmada') || '|' ||
      (select count(*) from public.reservas where id in ('${b.resA}', '${b.resB}') and estado = 'rechazada') || '|' ||
      (select count(*) from public.pagos where orden_comercio in ('${b.ordenA}', '${b.ordenB}') and estado = 'pagado') || '|' ||
      (select count(*) from public.pagos where orden_comercio in ('${b.ordenA}', '${b.ordenB}') and estado = 'reversar') || '|' ||
      (select count(*) from public.notifications n
         join public.pagos p on p.user_id = n.user_id
        where p.orden_comercio in ('${b.ordenA}', '${b.ordenB}') and p.estado = 'reversar'
          and n.type = 'reserva_cancelada' and n.data->>'pagoId' = p.id::text);
  `).split('|').map(Number);
  // El pago perdedor y su reserva tienen que ser de la MISMA persona.
  const cruzado = sql(`
    select count(*) from public.pagos p join public.reservas r on r.id = p.reserva_id
     where p.orden_comercio in ('${b.ordenA}', '${b.ordenB}')
       and ((p.estado = 'pagado' and r.estado <> 'confirmada') or (p.estado = 'reversar' and r.estado <> 'rechazada'));
  `);
  const ok = confirmadas === 1 && rechazadas === 1 && pagados === 1 && porDevolver === 1 && avisos === 1 && cruzado === '0';
  const detalle = `confirmadas=${confirmadas} rechazadas=${rechazadas} pagados=${pagados} reversar=${porDevolver} avisos=${avisos} cruzados=${cruzado}`;
  if (!ok) fallos.push(`${nombre}: ${detalle}`);
  return { ok, detalle };
}

function limpiar() {
  try {
    sql(`
      delete from public.notifications where user_id in ('${uA}', '${uB}', '${uAdmin}');
      delete from public.pagos where user_id in ('${uA}', '${uB}');
      delete from public.reservas where organizador_id in ('${uA}', '${uB}');
      delete from public.canchas_reservables where complejo_id = '${complejo}';
      delete from public.complejo_admins where complejo_id = '${complejo}';
      delete from public.complejos where id = '${complejo}';
      delete from auth.users where id in ('${uA}', '${uB}', '${uAdmin}');
    `);
  } catch (e) {
    console.error('⚠ No pude limpiar el fixture:', String(e.stderr || e.message).split('\n')[0]);
    console.error(`  Quedaron filas marcadas «${MARCA}» en la base local.`);
  }
}

try {
  preparar();

  // ── Orquestada: B tiene que esperar a A ───────────────────────
  {
    const b = bloque(0);
    const a = sesion(`begin; ${confirmar(b.ordenA)} select pg_sleep(1.5); commit;`);
    await espera(400);
    const segundo = await sesion(confirmar(b.ordenB));
    const primero = await a;
    const esperó = segundo.ms >= 900;
    const r = revisar('orquestada', b);
    const ganoA = /"resultado" : "confirmada"/.test(primero.salida) && /"resultado" : "reversar"/.test(segundo.salida);
    if (!esperó) fallos.push(`orquestada: B no esperó a A (${segundo.ms} ms): el candado no está`);
    if (!ganoA) fallos.push(`orquestada: se esperaba A confirmada y B reversar → A=${primero.salida} B=${segundo.salida}`);
    console.log(`${r.ok && esperó && ganoA ? '✔' : '✖'} orquestada: B esperó ${segundo.ms} ms · ${r.detalle}`);
  }

  // ── Libres: los dos a la vez ──────────────────────────────────
  let ganaA = 0;
  for (let i = 1; i <= VUELTAS; i += 1) {
    const b = bloque(i);
    const [ra, rb] = await Promise.all([sesion(confirmar(b.ordenA)), sesion(confirmar(b.ordenB))]);
    const r = revisar(`libre ${i}`, b);
    if (/"resultado" : "confirmada"/.test(ra.salida)) ganaA += 1;
    if (!/"ok" : true/.test(ra.salida) || !/"ok" : true/.test(rb.salida)) {
      fallos.push(`libre ${i}: alguna sesión no contestó ok → A=${ra.salida} B=${rb.salida}`);
    }
    console.log(`${r.ok ? '✔' : '✖'} libre ${i}: ${r.detalle}`);
  }
  console.log(`\nEn las libres ganó A ${ganaA} de ${VUELTAS} veces.`);

  // ── El aviso repetido no cambia nada ──────────────────────────
  {
    const b = bloque(VUELTAS + 1);
    await sesion(confirmar(b.ordenA));
    await Promise.all([sesion(confirmar(b.ordenA)), sesion(confirmar(b.ordenB)), sesion(confirmar(b.ordenB))]);
    const r = revisar('aviso repetido', b);
    console.log(`${r.ok ? '✔' : '✖'} aviso repetido (A dos veces, B dos veces a la vez): ${r.detalle}`);
  }
} finally {
  limpiar();
}

if (fallos.length) {
  console.log(`\n✖ ${fallos.length} fallo(s):`);
  for (const f of fallos) console.log(`  ${f}`);
  process.exit(1);
}
console.log('\n✔ Una sola reserva confirmada por bloque; el otro pago quedó para devolver, con su aviso.');
