#!/usr/bin/env node
/**
 * La conciliación de pagos pendientes, de punta a punta, contra la base
 * LOCAL y con un Flow simulado (migración 190, Edge Function
 * `conciliar-pagos`).
 *
 * Siembra una reserva con su pago por cada caso, todos `pendiente` hace 30
 * minutos salvo uno recién creado, levanta la función real con Deno
 * (`flow-simulado.ts` intercepta sólo la API de Flow) y comprueba en la base
 * cómo quedó cada uno:
 *
 *   A  Flow: pagado, mismo monto      → pagado, reserva confirmada
 *   B  Flow: pagado, OTRO monto       → reversar (plata por devolver)
 *   C  Flow: rechazado                → fallido
 *   D  Flow: anulado                  → expirado
 *   E  Flow: sigue pendiente          → pendiente (no se toca)
 *   F  Flow no contesta               → pendiente (se reintenta)
 *   G  sin token                      → expirado, sin preguntarle a Flow
 *   H  recién creado (5 min)          → pendiente, no entra al lote
 *
 * Además: sin el secreto contesta 401, una segunda pasada no cambia nada de
 * lo resuelto, y cada pasada deja su fila en `conciliaciones`.
 *
 * Sólo contra `supabase_db_futfinder-local`. Borra todo lo que crea, también
 * si algo falla. Uso: node scripts/conciliar-pagos-local/probar.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CT = 'supabase_db_futfinder-local';
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MARCA = `concil-${Date.now()}`;
const PUERTO = 8790;
const SECRETO = randomBytes(24).toString('hex');

const sql = (texto) => execFileSync('docker',
  ['exec', '-i', CT, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'],
  { input: texto, encoding: 'utf8' }).trim();

if (execFileSync('docker', ['ps', '--filter', `name=^${CT}$`, '--format', '{{.Names}}'], { encoding: 'utf8' }).trim() !== CT) {
  console.error(`No está el contenedor ${CT}: esto sólo corre contra la base local.`);
  process.exit(1);
}
const servicio = execFileSync('docker', ['exec', 'supabase_storage_futfinder-local', 'printenv', 'SERVICE_KEY'], { encoding: 'utf8' }).trim();

const u = randomUUID();
const uAdmin = randomUUID();
const tok = (c) => `TOK${MARCA.replace(/\W/g, '')}${c}`.slice(0, 40);
const CASOS = {
  A: { flow: { status: 2, amount: 20000 }, espera: 'pagado' },
  B: { flow: { status: 2, amount: 9990 }, espera: 'reversar' },
  C: { flow: { status: 3 }, espera: 'fallido' },
  D: { flow: { status: 4 }, espera: 'expirado' },
  E: { flow: { status: 1 }, espera: 'pendiente' },
  F: { flow: 'CAE', espera: 'pendiente' },
  G: { sinToken: true, espera: 'expirado' },
  H: { flow: { status: 2, amount: 20000 }, reciente: true, espera: 'pendiente' },
};

let complejo = null;
let funcion = null;
const fallos = [];
const check = (nombre, ok, detalle = '') => {
  console.log(`${ok ? '✔' : '✖'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos.push(nombre);
};

function limpiar() {
  try {
    sql(`
      delete from public.conciliaciones where created_at > now() - interval '1 hour' and ambiente = 'sandbox';
      delete from public.notifications where user_id = '${u}';
      delete from public.pagos where user_id = '${u}';
      delete from public.reservas where organizador_id = '${u}';
      ${complejo ? `delete from public.canchas_reservables where complejo_id = '${complejo}';
      delete from public.complejo_admins where complejo_id = '${complejo}';
      delete from public.complejos where id = '${complejo}';` : ''}
      delete from auth.users where id in ('${u}', '${uAdmin}');
    `);
  } catch (e) { console.error('limpieza:', e.message); }
  if (funcion) funcion.kill();
}

try {
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    select '00000000-0000-0000-0000-000000000000', x, 'authenticated', 'authenticated', '${MARCA}-' || x || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}'
      from unnest(array['${u}', '${uAdmin}']::uuid[]) x;
    insert into public.profiles (id, username)
    select x, 'conc' || substr(replace(x::text, '-', ''), 1, 10) from unnest(array['${u}', '${uAdmin}']::uuid[]) x
    on conflict (id) do nothing;
  `);
  complejo = sql(`insert into public.complejos (nombre, comuna, latitud, longitud) values ('${MARCA}', 'Ñuñoa', -33.45, -70.6) returning id;`);
  sql(`insert into public.complejo_admins (complejo_id, user_id, rol) values ('${complejo}', '${uAdmin}', 'dueño');`);
  const cancha = sql(`insert into public.canchas_reservables (complejo_id, nombre, tipo, precio_hora) values ('${complejo}', '${MARCA}', 'futbol_7', 20000) returning id;`);

  const flow = {};
  Object.entries(CASOS).forEach(([c, caso], i) => {
    const orden = `${MARCA}-${c}`;
    const token = caso.sinToken ? null : tok(c);
    const hace = caso.reciente ? '5 minutes' : '30 minutes';
    sql(`
      with r as (
        insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin, precio_total, modalidad, medio_pago, precio_cancha, estado)
        values ('${cancha}', '${u}', current_date + ${400 + i}, '05:19', '06:19', 20000, 'completa', 'tarjeta', 20000, 'armando')
        returning id
      )
      insert into public.pagos (user_id, reserva_id, monto, proveedor, orden_comercio, referencia_externa, created_at)
      select '${u}', r.id, 20000, 'flow', '${orden}', ${token ? `'${token}'` : 'null'}, now() - interval '${hace}' from r;
    `);
    if (token) flow[token] = caso.flow === 'CAE' ? 'CAE' : { commerceOrder: orden, flowOrder: 1000 + i, ...caso.flow };
  });

  // ── La función real, con Flow simulado ─────────────────────────
  funcion = spawn('deno', ['run', '--allow-net', '--allow-env', '--allow-read', path.join(AQUI, 'flow-simulado.ts')], {
    env: {
      ...process.env,
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: servicio,
      FLOW_API_KEY: 'clave-de-prueba',
      FLOW_SECRET_KEY: 'secreto-de-prueba',
      FLOW_AMBIENTE: 'sandbox',
      CONCILIAR_PAGOS_SECRETO: SECRETO,
      FLOW_SIMULADO: JSON.stringify(flow),
      PUERTO_FUNCION: String(PUERTO),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  funcion.stderr.on('data', (d) => { logs += d; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`la función no arrancó:\n${logs}`)), 30000);
    funcion.stdout.on('data', (d) => { if (String(d).includes('LISTO')) { clearTimeout(t); resolve(); } });
  });

  const llamar = (secreto) => fetch(`http://127.0.0.1:${PUERTO}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secreto ? { 'x-conciliar-secreto': secreto } : {}) },
    body: '{}',
  });

  check('sin secreto contesta 401', (await llamar(null)).status === 401);
  check('con un secreto equivocado contesta 401', (await llamar('x'.repeat(48))).status === 401);

  const r1 = await llamar(SECRETO);
  const resumen = await r1.json();
  check('la pasada contesta 200', r1.status === 200, JSON.stringify(resumen));
  check('el lote toma los 7 viejos y no el recién creado', resumen.revisados === 7);

  const estados = () => Object.fromEntries(sql(
    `select orden_comercio || '=' || estado from public.pagos where user_id = '${u}' order by orden_comercio;`,
  ).split('\n').map((l) => { const [o, e] = l.split('='); return [o.slice(-1), e]; }));

  const e1 = estados();
  for (const [c, caso] of Object.entries(CASOS)) {
    check(`${c} queda ${caso.espera}`, e1[c] === caso.espera, `quedó ${e1[c]}`);
  }
  check('A confirmó su reserva', sql(`select r.estado from public.reservas r join public.pagos p on p.reserva_id = r.id where p.orden_comercio = '${MARCA}-A';`) === 'confirmada');
  // `pago_cobrado_sin_reserva` (migración 178) avisa con el tipo `reserva_cancelada`.
  check('B deja aviso a quien pagó', Number(sql(`select count(*) from public.notifications where user_id = '${u}' and type = 'reserva_cancelada' and title = 'Te devolveremos un pago';`)) === 1);
  check('la pasada quedó en conciliaciones', Number(sql(`select count(*) from public.conciliaciones where created_at > now() - interval '5 minutes' and confirmados = 1 and reversar = 1 and cerrados = 3 and siguen_pendientes = 1 and sin_respuesta = 1;`)) === 1);

  // ── Segunda pasada: lo resuelto no se toca ─────────────────────
  const r2 = await (await llamar(SECRETO)).json();
  check('la segunda pasada sólo mira los que siguen pendientes (E y F)', r2.revisados === 2, JSON.stringify(r2));
  const e2 = estados();
  check('la segunda pasada no cambia nada', JSON.stringify(e2) === JSON.stringify(e1));
  check('A sigue con un solo pago pagado', sql(`select count(*) from public.pagos where orden_comercio = '${MARCA}-A' and estado = 'pagado';`) === '1');
  check('ningún log trae el correo de quien paga', !/@/.test(logs), logs.trim().split('\n').slice(-3).join(' | '));
} catch (e) {
  fallos.push(e.message);
  console.error(e);
} finally {
  limpiar();
}

if (fallos.length) {
  console.error(`\n✖ ${fallos.length} fallo(s).`);
  process.exit(1);
}
console.log('\n✔ La conciliación resuelve cada caso por el camino de siempre y no toca lo que sigue pendiente.');
process.exit(0);
