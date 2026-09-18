import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Servicio de permisos del club (migración 119).
 *
 * Sólo existen nueve permisos delegables — los que corresponden a una
 * función real y sin ambigüedad dentro de Clubes. El mockup traía once:
 * quedaron afuera `attendance` (no es una acción propia, viaja dentro del
 * parámetro `p_asistencia` de `proponer_resultado()`, así que ya es parte
 * de `results`) y `seeStats` (no hay ninguna pantalla de estadísticas
 * privadas del club que bloquear: agregarle un candado habría sido
 * inventar una puerta que no existe).
 *
 * LA AUTORIDAD ES EL SERVIDOR. Cada función de acá es un espejo de
 * `tiene_permiso_de_club()` y de las cuatro RPC que escriben en las tablas
 * de permisos — se usan para pintar la pantalla, no para decidir: si algo
 * queda mal calculado acá, la RLS/RPC del servidor igual rechaza lo que no
 * corresponde.
 */

export const PERMISOS_CLUB = [
  'pubChallenge',
  'answerChallenge',
  'chatClubs',
  'invite',
  'removeMembers',
  'editNicks',
  'lineup',
  'results',
  'editClub',
];

export const ROLES_CON_PERMISOS = ['capitan', 'jugador'];

function permisosVacios() {
  const o = {};
  for (const p of PERMISOS_CLUB) o[p] = false;
  return o;
}

/**
 * Trae los permisos configurados por rol para un club: `{ capitan: {...9
 * booleanos}, jugador: {...9 booleanos} }`. Un rol o permiso sin fila
 * sembrada se lee como `false` — no debería pasar (la migración 119 siembra
 * las 18 filas al crear el club), pero una lectura defensiva no lastima.
 */
export async function getRolePermissions(clubId) {
  if (!isSupabaseConfigured) return { data: { capitan: permisosVacios(), jugador: permisosVacios() }, error: null };
  const { data, error } = await supabase
    .from('club_role_permissions')
    .select('rol, permiso, activo')
    .eq('club_id', clubId);
  if (error) {
    console.error('[FutFinder] getRolePermissions:', error);
    return { data: { capitan: permisosVacios(), jugador: permisosVacios() }, error };
  }
  const out = { capitan: permisosVacios(), jugador: permisosVacios() };
  for (const fila of data || []) {
    if (out[fila.rol] && fila.permiso in out[fila.rol]) out[fila.rol][fila.permiso] = !!fila.activo;
  }
  return { data: out, error: null };
}

/**
 * Todas las excepciones por integrante de un club: `{ [user_id]: {
 * [permiso]: boolean } }`. Sólo un admin del club puede leer las de
 * cualquiera (RLS); un jugador que la llamara sólo vería las propias.
 */
export async function getAllMemberOverrides(clubId) {
  if (!isSupabaseConfigured) return { data: {}, error: null };
  const { data, error } = await supabase
    .from('club_member_permission_overrides')
    .select('user_id, permiso, activo')
    .eq('club_id', clubId);
  if (error) {
    console.error('[FutFinder] getAllMemberOverrides:', error);
    return { data: {}, error };
  }
  const out = {};
  for (const fila of data || []) {
    if (!out[fila.user_id]) out[fila.user_id] = {};
    out[fila.user_id][fila.permiso] = !!fila.activo;
  }
  return { data: out, error: null };
}

/** Las excepciones de un solo integrante: `{ [permiso]: boolean }`. */
export async function getMemberOverrides(clubId, userId) {
  if (!isSupabaseConfigured) return { data: {}, error: null };
  const { data, error } = await supabase
    .from('club_member_permission_overrides')
    .select('permiso, activo')
    .eq('club_id', clubId)
    .eq('user_id', userId);
  if (error) {
    console.error('[FutFinder] getMemberOverrides:', error);
    return { data: {}, error };
  }
  const out = {};
  for (const fila of data || []) out[fila.permiso] = !!fila.activo;
  return { data: out, error: null };
}

/**
 * El mismo cálculo que `tiene_permiso_de_club()`: admin → siempre todo;
 * si no, la excepción propia manda sobre el default del rol; sin
 * excepción, el default del rol; sin nada de eso, false.
 */
export function resolvePermisos({ rol, isAdmin, rolePermissions, overrides } = {}) {
  if (isAdmin) {
    const todo = {};
    for (const p of PERMISOS_CLUB) todo[p] = true;
    return todo;
  }
  const delRol = (rolePermissions && rolePermissions[rol]) || permisosVacios();
  const propios = overrides || {};
  const out = {};
  for (const p of PERMISOS_CLUB) {
    out[p] = p in propios ? !!propios[p] : !!delRol[p];
  }
  return out;
}

/**
 * Mis permisos resueltos en UN club: mi rol, si soy admin, y los nueve
 * booleanos ya resueltos (rol + mis propias excepciones).
 */
export async function getMisPermisosEnClub(clubId) {
  if (!isSupabaseConfigured) {
    return { data: { rol: null, isAdmin: false, permisos: permisosVacios() }, error: null };
  }
  const { data: sesion } = await supabase.auth.getUser();
  const userId = sesion?.user?.id;
  if (!userId) return { data: { rol: null, isAdmin: false, permisos: permisosVacios() }, error: null };

  const { data: miembro, error: errMiembro } = await supabase
    .from('club_members')
    .select('rol')
    .eq('club_id', clubId)
    .eq('user_id', userId)
    .maybeSingle();
  if (errMiembro || !miembro) {
    return { data: { rol: null, isAdmin: false, permisos: permisosVacios() }, error: errMiembro || null };
  }

  const isAdmin = miembro.rol === 'admin';
  if (isAdmin) {
    const todo = {};
    for (const p of PERMISOS_CLUB) todo[p] = true;
    return { data: { rol: 'admin', isAdmin: true, permisos: todo }, error: null };
  }

  const [{ data: rolePermissions }, { data: overrides }] = await Promise.all([
    getRolePermissions(clubId),
    getMemberOverrides(clubId, userId),
  ]);

  return {
    data: {
      rol: miembro.rol,
      isAdmin: false,
      permisos: resolvePermisos({ rol: miembro.rol, isAdmin: false, rolePermissions, overrides }),
    },
    error: null,
  };
}

/**
 * De VARIOS clubes a la vez (para bandejas de desafíos/resultados, donde
 * antes sólo se preguntaba por clubes administrados): para cada club donde
 * participo, resuelve si tengo AL MENOS UNO de los `permisos` pedidos —
 * siendo admin siempre alcanza. Devuelve sólo los ids que califican, en la
 * misma forma que devolvía `getMisClubesAdmin()`, para no tener que tocar
 * las pantallas que ya arman listas de ids así.
 */
export async function getMisClubesConPermiso(permisos) {
  const lista = Array.isArray(permisos) ? permisos : [permisos];
  if (!isSupabaseConfigured) return { data: [], error: null };
  const { data: sesion } = await supabase.auth.getUser();
  const userId = sesion?.user?.id;
  if (!userId) return { data: [], error: null };

  const { data: misMembresias, error: errM } = await supabase
    .from('club_members')
    .select('club_id, rol')
    .eq('user_id', userId);
  if (errM) {
    console.error('[FutFinder] getMisClubesConPermiso:', errM);
    return { data: [], error: errM };
  }
  if (!misMembresias || misMembresias.length === 0) return { data: [], error: null };

  const clubIdsAdmin = misMembresias.filter((m) => m.rol === 'admin').map((m) => m.club_id);
  const clubIdsNoAdmin = misMembresias.filter((m) => m.rol !== 'admin');

  if (clubIdsNoAdmin.length === 0) return { data: clubIdsAdmin, error: null };

  const idsNoAdmin = clubIdsNoAdmin.map((m) => m.club_id);
  const [{ data: roleRows, error: errR }, { data: overrideRows, error: errO }] = await Promise.all([
    supabase
      .from('club_role_permissions')
      .select('club_id, rol, permiso, activo')
      .in('club_id', idsNoAdmin)
      .in('permiso', lista),
    supabase
      .from('club_member_permission_overrides')
      .select('club_id, permiso, activo')
      .eq('user_id', userId)
      .in('club_id', idsNoAdmin)
      .in('permiso', lista),
  ]);
  if (errR || errO) {
    console.error('[FutFinder] getMisClubesConPermiso:', errR || errO);
    return { data: clubIdsAdmin, error: errR || errO };
  }

  const rolPorClub = new Map(clubIdsNoAdmin.map((m) => [m.club_id, m.rol]));
  const activoPorRol = new Map(); // `${club_id}:${rol}:${permiso}` -> activo
  for (const f of roleRows || []) activoPorRol.set(`${f.club_id}:${f.rol}:${f.permiso}`, !!f.activo);
  const overridePorClub = new Map(); // `${club_id}:${permiso}` -> activo
  for (const f of overrideRows || []) overridePorClub.set(`${f.club_id}:${f.permiso}`, !!f.activo);

  const califican = idsNoAdmin.filter((clubId) => {
    const rol = rolPorClub.get(clubId);
    return lista.some((permiso) => {
      const key = `${clubId}:${permiso}`;
      if (overridePorClub.has(key)) return overridePorClub.get(key);
      return !!activoPorRol.get(`${clubId}:${rol}:${permiso}`);
    });
  });

  return { data: [...clubIdsAdmin, ...califican], error: null };
}

/**
 * Guarda los permisos de UN rol del club (jugador o capitán). Sólo un
 * admin puede llamarla — lo exige `club_guardar_permisos_rol()` en el
 * servidor. `permisos` es un objeto parcial, sólo las claves que cambian.
 */
export async function guardarPermisosRol(clubId, rol, permisos) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await supabase.rpc('club_guardar_permisos_rol', {
    p_club_id: clubId,
    p_rol: rol,
    p_permisos: permisos,
  });
  if (error) {
    console.error('[FutFinder] guardarPermisosRol:', error);
    return { error: { message: error.message || 'No se pudieron guardar los permisos del rol' } };
  }
  return { error: null };
}

/**
 * Guarda (o quita) una excepción para UN integrante. El servidor rechaza
 * si el objetivo es administrador — al admin no se le abre ni se le
 * cierra nada con una excepción, primero hay que cambiarle el rol.
 */
export async function guardarPermisoIntegrante(clubId, userId, permiso, activo) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await supabase.rpc('club_guardar_permiso_integrante', {
    p_club_id: clubId,
    p_user_id: userId,
    p_permiso: permiso,
    p_activo: activo,
  });
  if (error) {
    console.error('[FutFinder] guardarPermisoIntegrante:', error);
    return { error: { message: error.message || 'No se pudo guardar la excepción' } };
  }
  return { error: null };
}

/** Borra TODAS las excepciones de un integrante: vuelve a heredar del rol. */
export async function quitarExcepcionesIntegrante(clubId, userId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await supabase.rpc('club_quitar_excepciones_integrante', {
    p_club_id: clubId,
    p_user_id: userId,
  });
  if (error) {
    console.error('[FutFinder] quitarExcepcionesIntegrante:', error);
    return { error: { message: error.message || 'No se pudieron quitar las excepciones' } };
  }
  return { error: null };
}

/**
 * Restaura los permisos sugeridos del club (capitán con casi todo activo,
 * jugador con `invite`) y borra todas las excepciones por integrante. No
 * toca a los clubes que nunca la llaman: el default con el que nace un
 * club sigue siendo el conservador (capitán sólo con alineación).
 */
export async function restaurarPermisosDefault(clubId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await supabase.rpc('club_restaurar_permisos_default', {
    p_club_id: clubId,
  });
  if (error) {
    console.error('[FutFinder] restaurarPermisosDefault:', error);
    return { error: { message: error.message || 'No se pudieron restaurar los permisos' } };
  }
  return { error: null };
}
