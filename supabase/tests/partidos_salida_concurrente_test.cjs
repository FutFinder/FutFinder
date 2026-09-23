// Ejecutar contra PostgreSQL local con las migraciones vigentes y pg instalado:
// FUTFINDER_TEST_DATABASE_URL=postgresql://.../futfinder_test_salida node este_archivo
//
// LA CARRERA DE N02–N04 NO SE REPRODUCE LLAMANDO DOS VECES SEGUIDAS. Hacen
// falta DOS conexiones con DOS transacciones abiertas a la vez: la segunda
// tiene que leer el estado ANTES del COMMIT de la primera, que es justo lo que
// una llamada secuencial no puede hacer. Por eso este archivo existe aparte
// del arnés SQL, que cubre lo demás de la migración 122.
//
// Cada caso comprueba las dos mitades del arreglo:
//   1. que la segunda sesión ESPERE (queda en wait_event_type = 'Lock'), o sea
//      que el bloqueo existe y no es un `if` optimista;
//   2. que después de esperar el efecto se aplique UNA sola vez.
//
// Crea datos ficticios y los elimina al terminar. Rechaza destinos que no sean
// bases locales de prueba.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');

const url = new URL(process.env.FUTFINDER_TEST_DATABASE_URL || 'http://sin-configurar');
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  && url.pathname.startsWith('/futfinder_test_'), 'Se requiere una base local futfinder_test_*');

const config = { connectionString: url.href };
const admin = new Client(config), a = new Client(config), b = new Client(config);
const org = randomUUID(), jugador = randomUUID();
const partidos = [];

/** Un partido del organizador con el jugador inscrito. */
async function fixture({ horas, duracion = 90, estado = 'abierto' }) {
  const id = randomUUID();
  await admin.query(`insert into public.matches
    (id,id_organizador,titulo,comuna,cancha_nombre,latitud,longitud,hora,
     cupos_totales,cupos_disponibles,duracion_min,aprobacion,estado)
    values($1,$2,'Prueba salida concurrente','Ñuñoa','Cancha ficticia',-33.45,-70.61,
     now() + ($3 || ' hours')::interval, 5, 5, $4, 'inmediata', 'abierto')`,
    [id, org, String(horas + 10000), duracion]);
  await admin.query(`insert into public.attendees(id_partido,id_jugador,estado)
    values($1,$2,'inscrito')`, [id, jugador]);
  // La hora real se escribe después: `trg_match_future_only` no deja nacer un
  // partido en el pasado, y `tg_matches_reprogramar` (123) no mira un partido
  // sin más inscritos que éste.
  await admin.query(`update public.matches set hora = now() + ($2 || ' hours')::interval,
    estado = $3 where id = $1`, [id, String(horas), estado]);
  partidos.push(id);
  return id;
}

async function abrir(c, id) {
  await c.query('begin');
  await c.query('set local role authenticated');
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
}

/** Espera a que `pid` quede detenido en un Lock, o se rinde a los 5 segundos. */
async function esperoPorElBloqueo(pid, terminada) {
  const limite = Date.now() + 5000;
  while (!terminada() && Date.now() < limite) {
    const q = await admin.query(
      'select wait_event_type from pg_stat_activity where pid=$1', [pid]);
    if (q.rows[0]?.wait_event_type === 'Lock') return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

async function puntaje() {
  const q = await admin.query(
    'select trust_score, asistencias_confirmadas from public.profiles where id=$1', [jugador]);
  return q.rows[0];
}

/**
 * Corre la misma llamada en dos sesiones, con la segunda leyendo antes de que
 * la primera confirme. Devuelve las dos respuestas.
 */
async function carrera({ sqlA, paramsA, sqlB, paramsB, actorA, actorB }) {
  await abrir(a, actorA);
  await abrir(b, actorB);
  const primera = await a.query(sqlA, paramsA);
  const pid = (await b.query('select pg_backend_pid() pid')).rows[0].pid;
  let lista = false;
  const segunda = b.query(sqlB, paramsB)
    .then((r) => ({ data: r.rows[0].r }), (e) => ({ error: e.message }))
    .finally(() => { lista = true; });
  const espero = await esperoPorElBloqueo(pid, () => lista);
  await a.query('commit');
  const resultado = await segunda;
  await b.query(resultado.error ? 'rollback' : 'commit');
  return { primera: primera.rows[0].r, segunda: resultado, espero };
}

async function salidaSimultanea() {
  const p = await fixture({ horas: 48 });
  await admin.query('update public.profiles set trust_score = 80 where id=$1', [jugador]);

  const { primera, segunda, espero } = await carrera({
    sqlA: 'select leave_match_penalized($1) as r', paramsA: [p],
    sqlB: 'select leave_match_penalized($1) as r', paramsB: [p],
    actorA: jugador, actorB: jugador,
  });

  assert(espero, 'la segunda salida no esperó: el partido no quedó bloqueado');
  assert.equal(primera.ok, true);
  assert.equal(primera.penalty, 3);
  assert.equal(segunda.data?.ok, false, JSON.stringify(segunda));
  const { trust_score } = await puntaje();
  assert.equal(Number(trust_score), 77, 'la sanción se cobró dos veces');
  const filas = await admin.query(
    'select count(*)::int n from public.attendees where id_partido=$1 and id_jugador=$2', [p, jugador]);
  assert.equal(filas.rows[0].n, 0);
  console.log('OK: N02 — dos salidas simultáneas cobran una sola sanción');
}

async function gpsSimultaneo() {
  // Empezó hace 20 minutos: dentro de la ventana que acepta el GPS.
  const p = await fixture({ horas: -0.33 });
  await admin.query(
    'update public.profiles set trust_score = 80, asistencias_confirmadas = 0 where id=$1', [jugador]);

  const { primera, segunda, espero } = await carrera({
    sqlA: 'select confirm_attendance_gps($1,-33.45,-70.61) as r', paramsA: [p],
    sqlB: 'select confirm_attendance_gps($1,-33.45,-70.61) as r', paramsB: [p],
    actorA: jugador, actorB: jugador,
  });

  assert(espero, 'la segunda confirmación no esperó: la inscripción no quedó bloqueada');
  assert.equal(primera.ok, true);
  assert.equal(primera.already, undefined);
  assert.equal(segunda.data?.already, true, JSON.stringify(segunda));
  const { trust_score, asistencias_confirmadas } = await puntaje();
  assert.equal(Number(trust_score), 81, 'el punto del GPS se dio dos veces');
  assert.equal(Number(asistencias_confirmadas), 1, 'la asistencia se contó dos veces');
  const hist = await admin.query(`select count(*)::int n from public.trust_score_history
    where user_id=$1 and match_id=$2 and reason='Asistencia confirmada por GPS'`, [jugador, p]);
  assert.equal(hist.rows[0].n, 1);
  console.log('OK: N03 — dos confirmaciones GPS simultáneas premian una sola vez');
}

async function asistenciaSimultanea() {
  // Terminó hace una hora y media: dentro del plazo de 72 h del organizador, y
  // sin superponerse con el partido del caso anterior.
  const p = await fixture({ horas: -3 });
  await admin.query(
    'update public.profiles set trust_score = 80, asistencias_confirmadas = 0 where id=$1', [jugador]);
  const marcas = JSON.stringify({ [jugador]: 'presente' });

  const { primera, segunda, espero } = await carrera({
    sqlA: 'select save_match_attendance($1,$2::jsonb) as r', paramsA: [p, marcas],
    sqlB: 'select save_match_attendance($1,$2::jsonb) as r', paramsB: [p, marcas],
    actorA: org, actorB: org,
  });

  assert(espero, 'el segundo guardado no esperó: el partido no quedó bloqueado');
  assert.equal(primera.ok, true);
  assert.equal(segunda.data?.ok, true, JSON.stringify(segunda));
  const { trust_score, asistencias_confirmadas } = await puntaje();
  assert.equal(Number(trust_score), 82, 'el premio de asistencia se aplicó dos veces');
  assert.equal(Number(asistencias_confirmadas), 1, 'la asistencia se contó dos veces');
  console.log('OK: N04 — dos guardados simultáneos premian una sola vez');
}

async function asistenciaSimultaneaConMarcasDistintas() {
  // El informe pide explícitamente este caso además del anterior: dos
  // sesiones que guardan marcas DISTINTAS del mismo jugador. Con el partido
  // bloqueado dejan de ser simultáneas, así que la segunda lee lo que la
  // primera aplicó y mueve sólo la diferencia — que es la promesa de la 107:
  // el puntaje depende de la marca FINAL y no del camino.
  const p = await fixture({ horas: -6 });
  await admin.query(
    'update public.profiles set trust_score = 80, asistencias_confirmadas = 0 where id=$1', [jugador]);

  const { primera, segunda, espero } = await carrera({
    sqlA: 'select save_match_attendance($1,$2::jsonb) as r',
    paramsA: [p, JSON.stringify({ [jugador]: 'presente' })],
    sqlB: 'select save_match_attendance($1,$2::jsonb) as r',
    paramsB: [p, JSON.stringify({ [jugador]: 'ausente' })],
    actorA: org, actorB: org,
  });

  assert(espero, 'el segundo guardado no esperó: el partido no quedó bloqueado');
  assert.equal(primera.ok, true);
  assert.equal(segunda.data?.ok, true, JSON.stringify(segunda));
  // 80 +2 (presente) −17 (corrección a ausente) = 65, que es exactamente lo
  // que dan las dos marcas una después de otra. Sin el bloqueo, la segunda
  // partía del historial previo y dejaba 65 o 67 según quién ganara.
  const { trust_score, asistencias_confirmadas } = await puntaje();
  assert.equal(Number(trust_score), 65, 'la corrección no partió del estado real');
  assert.equal(Number(asistencias_confirmadas), 0, 'la ausencia tiene que devolver el contador');
  const estado = await admin.query(
    'select estado from public.attendees where id_partido=$1 and id_jugador=$2', [p, jugador]);
  assert.equal(estado.rows[0].estado, 'no_asistio', 'gana la marca que se guardó al final');
  console.log('OK: N04 — dos guardados simultáneos con marcas distintas dejan la marca final');
}

(async () => {
  try {
    await Promise.all([admin.connect(), a.connect(), b.connect()]);
    await admin.query(`insert into auth.users
      (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
       raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,email_change_token_new,recovery_token)
      select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',
       'salida-'||u||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
       from unnest($1::uuid[]) u`, [[org, jugador]]);

    await salidaSimultanea();
    await gpsSimultaneo();
    await asistenciaSimultanea();
    await asistenciaSimultaneaConMarcasDistintas();
    console.log('Todo OK');
  } finally {
    try {
      await admin.query('delete from public.matches where id = any($1::uuid[])', [partidos]);
      await admin.query('delete from public.canchas where created_by = any($1::uuid[])', [[org, jugador]]);
      await admin.query('delete from auth.users where id = any($1::uuid[])', [[org, jugador]]);
    } catch (e) {
      console.error('No se pudo limpiar:', e.message);
    }
    await Promise.allSettled([admin.end(), a.end(), b.end()]);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
