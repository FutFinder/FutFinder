// Ejecutar contra PostgreSQL local con las migraciones vigentes y pg instalado:
// FUTFINDER_TEST_DATABASE_URL=postgresql://.../futfinder_test_agenda node este_archivo
// Dos conexiones reales; no usar PGlite para esta prueba. Crea datos ficticios
// y los elimina al terminar. Rechaza destinos que no sean de prueba locales.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const url = new URL(process.env.FUTFINDER_TEST_DATABASE_URL || 'http://sin-configurar');
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  && url.pathname.startsWith('/futfinder_test_'), 'Se requiere una base local futfinder_test_*');
const config = { connectionString: url.href };
const admin = new Client(config), a = new Client(config), b = new Client(config);
const users = [randomUUID(), randomUUID(), randomUUID()];
const matches = [];

async function fixture(hours, mode = 'inmediata', player = users[1]) {
  const id = randomUUID();
  await admin.query(`insert into public.matches
    (id,id_organizador,titulo,comuna,cancha_nombre,latitud,longitud,hora,
     cupos_totales,cupos_disponibles,duracion_min,aprobacion)
    values($1,$2,'Prueba concurrencia','Ñuñoa','Cancha ficticia',-33.45,-70.61,
     date_trunc('hour',now()) + $3 * interval '1 hour',1,1,60,$4)`, [id,users[0],hours,mode]);
  matches.push(id);
  if (mode === 'manual') await admin.query(`insert into attendees(id_partido,id_jugador,estado)
    values($1,$2,'pendiente')`, [id,player]);
  return id;
}
async function actor(c, id) {
  await c.query('begin');
  await c.query('set local role authenticated');
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
}
async function race({name,hours,manual=false,rollback=false,adjacent=false,otherPlayer=false}) {
  const mode = manual ? 'manual' : 'inmediata';
  const one = await fixture(hours,mode);
  const two = await fixture(hours + (adjacent ? 1 : 0),mode,otherPlayer ? users[2] : users[1]);
  await actor(a,manual ? users[0] : users[1]);
  await actor(b,manual ? users[0] : otherPlayer ? users[2] : users[1]);
  const query = manual ? 'select approve_join($1,$2) as r' : 'select join_match($1) as r';
  const params = (id,player) => manual ? [id,player] : [id];
  const first = await a.query(query,params(one,users[1]));
  assert.equal(first.rows[0].r.ok,true);
  const pid = (await b.query('select pg_backend_pid() pid')).rows[0].pid;
  let settled = false;
  const second = b.query(query,params(two,otherPlayer ? users[2] : users[1]))
    .then(r=>({data:r.rows[0].r}),e=>({error:e.message})).finally(()=>{settled=true;});
  // A mantiene su inscripción sin COMMIT. B debe esperar por ese jugador,
  // y volver a consultar la agenda después de que A termine.
  let waiting = false;
  const deadline = Date.now()+5000;
  while (!settled && Date.now()<deadline) {
    const q=await admin.query('select wait_event_type from pg_stat_activity where pid=$1',[pid]);
    if(q.rows[0]?.wait_event_type==='Lock'){waiting=true;break;}
    await new Promise(r=>setTimeout(r,20));
  }
  await a.query(rollback ? 'rollback' : 'commit');
  const result = await second;
  await b.query(result.error ? 'rollback' : 'commit');
  if(!otherPlayer) assert(waiting, `${name}: la segunda operación no esperó al mismo jugador`);
  if(rollback || adjacent || otherPlayer) assert.equal(result.data?.ok,true,JSON.stringify(result));
  else assert.match(result.error || result.data?.reason || '',/CHOQUE_HORARIO/);
  const count = await admin.query(`select count(*)::int n from attendees
    where id_partido=any($1::uuid[]) and id_jugador<>$2 and estado='inscrito'`,[[one,two],users[0]]);
  assert.equal(count.rows[0].n, adjacent || otherPlayer ? 2 : 1);
  console.log('OK: '+name);
}
(async()=>{
  try {
    await Promise.all([admin.connect(),a.connect(),b.connect()]);
    await admin.query(`insert into auth.users
      (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
       raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,email_change_token_new,recovery_token)
      select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',
       'agenda-'||u||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
       from unnest($1::uuid[]) u`,[users]);
    await race({name:'Dos ingresos superpuestos solo inscriben una vez',hours:1500});
    await race({name:'Dos aprobaciones superpuestas solo inscriben una vez',hours:1510,manual:true});
    await race({name:'Si la primera transacción revierte, la segunda entra',hours:1520,rollback:true});
    await race({name:'Dos partidos contiguos permiten ambas inscripciones',hours:1530,adjacent:true});
    await race({name:'Jugadores distintos pueden ocupar la misma hora',hours:1540,otherPlayer:true});
  } finally {
    await Promise.allSettled([a.query('rollback'),b.query('rollback')]);
    await admin.query('delete from public.matches where id=any($1::uuid[])',[matches]);
    await admin.query('delete from auth.users where id=any($1::uuid[])',[users]);
    await Promise.all([a.end(),b.end(),admin.end()]);
  }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
