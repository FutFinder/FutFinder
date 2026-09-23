// Ejecutar contra PostgreSQL local con las migraciones vigentes y pg instalado:
// FUTFINDER_TEST_DATABASE_URL=postgresql://.../futfinder_test_clubes node este_archivo
//
// LAS TRES CARRERAS DE C04, C05 Y C06 NO SE REPRODUCEN LLAMANDO DOS VECES
// SEGUIDAS: hacen falta DOS transacciones abiertas a la vez, porque lo que
// falla es que las dos CUENTAN antes de que la otra confirme. El arnés SQL de
// la 130 cubre el mecanismo y la no regresión; esto cubre las carreras.
//
// Cada caso comprueba las dos mitades:
//   1. que la segunda sesión ESPERE (wait_event_type = 'Lock'), o sea que el
//      bloqueo de la 130 existe y no es un `if` optimista;
//   2. que al despertar vea lo que la primera dejó y se rechace.
//
// Escribe `club_members` directamente, que es donde están los tres triggers;
// la RPC de aceptar invitación termina en el mismo INSERT. Crea datos
// ficticios y los elimina al terminar. Rechaza destinos que no sean bases
// locales de prueba.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');

const url = new URL(process.env.FUTFINDER_TEST_DATABASE_URL || 'http://sin-configurar');
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  && url.pathname.startsWith('/futfinder_test_'), 'Se requiere una base local futfinder_test_*');

const config = { connectionString: url.href };
const admin = new Client(config), a = new Client(config), b = new Client(config);
const usuarios = [];
const clubes = [];

async function usuario() {
  const id = randomUUID();
  await admin.query(`insert into auth.users
    (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
     raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,email_change_token_new,recovery_token)
    values('00000000-0000-0000-0000-000000000000',$1::uuid,'authenticated','authenticated',
     'clubes-'||$1::text||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','','')`, [id]);
  usuarios.push(id);
  return id;
}

async function club(creador, plan = 'estandar') {
  const id = randomUUID();
  await admin.query(`insert into public.clubs (id,nombre,slug,created_by,plan)
    values($1::uuid,'Prueba concurrencia '||left($1::text,8),'prueba-'||$1::text,$2,$3)`, [id, creador, plan]);
  clubes.push(id);
  return id;
}

const miembro = (club, user, rol = 'jugador') =>
  admin.query('insert into public.club_members (club_id,user_id,rol) values($1,$2,$3)', [club, user, rol]);

async function abrir(c) {
  await c.query('begin');
}

/** Espera a que `pid` quede detenido en un Lock, o se rinde a los 5 segundos. */
async function esperoPorElBloqueo(pid, terminada) {
  const limite = Date.now() + 5000;
  while (!terminada() && Date.now() < limite) {
    const q = await admin.query('select wait_event_type from pg_stat_activity where pid=$1', [pid]);
    if (q.rows[0]?.wait_event_type === 'Lock') return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

/** Corre dos escrituras de nómina a la vez, con la segunda leyendo antes del COMMIT de la primera. */
async function carrera(sqlA, paramsA, sqlB, paramsB) {
  await abrir(a);
  await abrir(b);
  await a.query(sqlA, paramsA);
  const pid = (await b.query('select pg_backend_pid() pid')).rows[0].pid;
  let lista = false;
  const segunda = b.query(sqlB, paramsB)
    .then(() => ({ ok: true }), (e) => ({ error: e.message }))
    .finally(() => { lista = true; });
  const espero = await esperoPorElBloqueo(pid, () => lista);
  await a.query('commit');
  const resultado = await segunda;
  await b.query(resultado.error ? 'rollback' : 'commit');
  return { segunda: resultado, espero };
}

async function dosAdminsSalenALaVez() {
  const uno = await usuario(), dos = await usuario(), jug = await usuario();
  const c = await club(uno, 'premium');
  await miembro(c, uno, 'admin');
  await miembro(c, dos, 'admin');
  await miembro(c, jug, 'jugador');

  const { segunda, espero } = await carrera(
    'delete from public.club_members where club_id=$1 and user_id=$2', [c, uno],
    'delete from public.club_members where club_id=$1 and user_id=$2', [c, dos]
  );

  assert(espero, 'la segunda baja no esperó: el club no quedó serializado');
  assert.match(segunda.error || '', /sin administrador/, JSON.stringify(segunda));
  const q = await admin.query(
    "select count(*)::int n from public.club_members where club_id=$1 and rol='admin'", [c]);
  assert.equal(q.rows[0].n, 1, 'el club quedó sin administrador');
  console.log('OK: C04 — dos administradores no pueden salir a la vez');
}

async function dosAceptanLaUltimaPlaza() {
  const jefe = await usuario();
  const c = await club(jefe, 'estandar');
  await miembro(c, jefe, 'admin');
  // 13 más: con el administrador son 14 de 15.
  for (let i = 0; i < 13; i += 1) await miembro(c, await usuario());
  const uno = await usuario(), dos = await usuario();

  const { segunda, espero } = await carrera(
    "insert into public.club_members (club_id,user_id,rol) values($1,$2,'jugador')", [c, uno],
    "insert into public.club_members (club_id,user_id,rol) values($1,$2,'jugador')", [c, dos]
  );

  assert(espero, 'la segunda alta no esperó: el club no quedó serializado');
  assert.match(segunda.error || '', /límite de 15 integrantes|limite de 15 integrantes/,
    JSON.stringify(segunda));
  const q = await admin.query("select count(*)::int n from public.club_members where club_id=$1", [c]);
  assert.equal(q.rows[0].n, 15, 'el club pasó de su máximo');
  console.log('OK: C05 — dos aceptaciones no ocupan la misma última plaza');
}

async function unJugadorEnDosClubesALaVez() {
  const jug = await usuario();
  const c1 = await club(await usuario()), c2 = await club(await usuario());
  await miembro(c1, jug);
  await miembro(c2, jug);
  const c3 = await club(await usuario()), c4 = await club(await usuario());

  const { segunda, espero } = await carrera(
    "insert into public.club_members (club_id,user_id,rol) values($1,$2,'jugador')", [c3, jug],
    "insert into public.club_members (club_id,user_id,rol) values($1,$2,'jugador')", [c4, jug]
  );

  assert(espero, 'la segunda alta no esperó: el jugador no quedó serializado');
  assert.match(segunda.error || '', /máximo de 3 clubes|maximo de 3 clubes/, JSON.stringify(segunda));
  const q = await admin.query("select count(*)::int n from public.club_members where user_id=$1", [jug]);
  assert.equal(q.rows[0].n, 3, 'el jugador pasó de tres clubes');
  console.log('OK: C06 — dos aceptaciones simultáneas no pasan de tres clubes');
}

(async () => {
  try {
    await Promise.all([admin.connect(), a.connect(), b.connect()]);
    await dosAdminsSalenALaVez();
    await dosAceptanLaUltimaPlaza();
    await unJugadorEnDosClubesALaVez();
    console.log('Todo OK');
  } finally {
    try {
      // Borrar el club arrastra la nómina; sacar a los miembros uno a uno choca
      // con la regla de que un club no se queda sin administrador.
      await admin.query('delete from public.clubs where id = any($1::uuid[])', [clubes]);
      await admin.query('delete from public.canchas where created_by = any($1::uuid[])', [usuarios]);
      await admin.query('delete from auth.users where id = any($1::uuid[])', [usuarios]);
    } catch (e) {
      console.error('No se pudo limpiar:', e.message);
    }
    await Promise.allSettled([admin.end(), a.end(), b.end()]);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
