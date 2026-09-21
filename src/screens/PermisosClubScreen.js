import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ShieldCheck, Shield, Check } from 'lucide-react-native';

import { paleta as C, radios as R, medidas as S, fuentes as F, alfa } from '../theme/colors';
import { modalidadInline } from '../utils/clubMeta';
import Banner from '../components/Banner';
import useConfirmacion from '../components/useConfirmacion';
import { getCurrentUser } from '../services/auth';
import { getClubById, listMembers, setCaptain } from '../services/clubs';
import {
  PERMISOS_CLUB,
  getRolePermissions,
  getAllMemberOverrides,
  guardarPermisosRol,
  guardarPermisoIntegrante,
  quitarExcepcionesIntegrante,
  restaurarPermisosDefault,
} from '../services/clubPermissions';

/**
 * Permisos del club (migración 119) — reemplaza a «Ajustes del club» en el
 * acceso rápido de la portada. Editar los datos del club (nombre, escudo,
 * comuna, tema) sigue disponible para el admin desde el lápiz del encabezado
 * del club, sin pasar por acá.
 *
 * Sólo NUEVE de los permisos entran en esta pantalla. El mockup traía once:
 * `attendance` no es una acción propia — viaja dentro de `p_asistencia` al
 * proponer el resultado, así que ya es parte de «Subir resultados» — y
 * `seeStats` no corresponde a ninguna pantalla real que bloquear.
 *
 * DOS RELOJES DISTINTOS. El cambio de ROL de un integrante (capitán ↔
 * jugador) y «Usar los del rol» se guardan al toque, igual que en el resto
 * de Integrantes — no tendría sentido dejarlos pendientes de un botón
 * aparte. Los interruptores de permiso sí quedan en borrador local y sólo
 * se escriben al tocar «Guardar permisos»: es la pantalla que reparte quién
 * puede hacer qué en el club, y una pantalla así no debería escribir nada
 * sin que alguien lo confirme a propósito.
 */

const GRUPOS = [
  {
    titulo: 'Desafíos',
    permisos: [
      { key: 'pubChallenge', label: 'Publicar desafíos', hint: 'Crear desafíos abiertos a nombre del club' },
      { key: 'answerChallenge', label: 'Aceptar o rechazar', hint: 'Responder desafíos de otros clubes' },
      { key: 'chatClubs', label: 'Chatear con otros clubes', hint: 'Abrir conversación con el admin rival' },
    ],
  },
  {
    titulo: 'Plantel',
    permisos: [
      { key: 'invite', label: 'Invitar jugadores', hint: 'Enviar enlaces e invitaciones' },
      { key: 'removeMembers', label: 'Quitar integrantes', hint: 'Sacar jugadores del club' },
      { key: 'editNicks', label: 'Editar apodos', hint: 'Cambiar el apodo de otros integrantes' },
    ],
  },
  {
    titulo: 'Partidos',
    permisos: [
      { key: 'lineup', label: 'Armar alineación', hint: 'Editar la formación del próximo partido' },
      { key: 'results', label: 'Subir resultados', hint: 'Registrar marcador y estadísticas' },
    ],
  },
  {
    titulo: 'Club',
    permisos: [
      { key: 'editClub', label: 'Editar datos del club', hint: 'Nombre, escudo, comuna y formato' },
    ],
  },
];

const ROLE_LABEL = { admin: 'Administrador', capitan: 'Capitán', jugador: 'Jugador' };
const ROLE_TABS = ['capitan', 'jugador', 'admin'];

function permisosVacios() {
  const o = {};
  for (const p of PERMISOS_CLUB) o[p] = false;
  return o;
}

function clonarRoles(roles) {
  return { capitan: { ...roles.capitan }, jugador: { ...roles.jugador } };
}

function clonarOverrides(overrides) {
  const out = {};
  for (const uid of Object.keys(overrides)) out[uid] = { ...overrides[uid] };
  return out;
}

function diffRol(original, actual) {
  const cambios = {};
  for (const p of PERMISOS_CLUB) {
    if (!!original[p] !== !!actual[p]) cambios[p] = !!actual[p];
  }
  return cambios;
}

function diffOverrides(original, actual) {
  const cambios = [];
  const uids = new Set([...Object.keys(original), ...Object.keys(actual)]);
  for (const uid of uids) {
    const antes = original[uid] || {};
    const ahora = actual[uid] || {};
    for (const p of PERMISOS_CLUB) {
      if (p in ahora && !!antes[p] !== !!ahora[p]) {
        cambios.push({ userId: uid, permiso: p, activo: !!ahora[p] });
      }
    }
  }
  return cambios;
}

export default function PermisosClubScreen({ navigation, route }) {
  const { clubId, club: clubDeRuta } = route.params || {};
  const { confirmar, dialogo } = useConfirmacion();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);
  const [toast, setToast] = useState('');

  const [club, setClub] = useState(clubDeRuta || null);
  const [members, setMembers] = useState([]);
  const [soyAdmin, setSoyAdmin] = useState(false);

  const [role, setRole] = useState('capitan');
  const [rolesOriginal, setRolesOriginal] = useState({ capitan: permisosVacios(), jugador: permisosVacios() });
  const [roles, setRoles] = useState({ capitan: permisosVacios(), jugador: permisosVacios() });
  const [overridesOriginal, setOverridesOriginal] = useState({});
  const [overrides, setOverrides] = useState({});
  const [dirty, setDirty] = useState(false);

  const [sheetUserId, setSheetUserId] = useState(null);
  const [sheetWorking, setSheetWorking] = useState(false);

  const flash = useCallback((msg) => {
    setToast(msg);
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, []);

  const cargar = useCallback(async () => {
    setLoading(true);
    const user = await getCurrentUser();

    const [{ data: clubData }, { data: miembros }, { data: rolePerms }, { data: allOverrides }] = await Promise.all([
      clubDeRuta ? Promise.resolve({ data: clubDeRuta }) : getClubById(clubId),
      listMembers(clubId),
      getRolePermissions(clubId),
      getAllMemberOverrides(clubId),
    ]);

    setClub(clubData || null);
    setMembers(miembros || []);
    const miMembresia = (miembros || []).find((m) => m.user_id === user?.id);
    setSoyAdmin(miMembresia?.rol === 'admin');

    setRolesOriginal(clonarRoles(rolePerms));
    setRoles(clonarRoles(rolePerms));
    setOverridesOriginal(clonarOverrides(allOverrides));
    setOverrides(clonarOverrides(allOverrides));
    setDirty(false);
    setLoading(false);
  }, [clubId, clubDeRuta]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const current = roles[role] || permisosVacios();

  const toggleRolePermiso = useCallback(
    (key) => {
      if (role === 'admin') return;
      setRoles((prev) => ({ ...prev, [role]: { ...prev[role], [key]: !prev[role][key] } }));
      setDirty(true);
    },
    [role]
  );

  const toggleGrupoCompleto = useCallback(
    (grupo) => {
      if (role === 'admin') return;
      const activo = roles[role] || permisosVacios();
      const todosActivos = grupo.permisos.every((p) => activo[p.key]);
      setRoles((prev) => {
        const next = { ...prev[role] };
        grupo.permisos.forEach((p) => {
          next[p.key] = !todosActivos;
        });
        return { ...prev, [role]: next };
      });
      setDirty(true);
    },
    [role, roles]
  );

  const guardar = useCallback(async () => {
    setSaving(true);
    const tareas = [];
    for (const rol of ['capitan', 'jugador']) {
      const cambios = diffRol(rolesOriginal[rol], roles[rol]);
      if (Object.keys(cambios).length > 0) tareas.push(guardarPermisosRol(clubId, rol, cambios));
    }
    for (const c of diffOverrides(overridesOriginal, overrides)) {
      tareas.push(guardarPermisoIntegrante(clubId, c.userId, c.permiso, c.activo));
    }

    if (tareas.length === 0) {
      setSaving(false);
      setDirty(false);
      return;
    }

    const resultados = await Promise.all(tareas);
    setSaving(false);
    const conError = resultados.find((r) => r?.error);
    if (conError) {
      setBanner({ type: 'error', title: 'No se pudo guardar todo', message: conError.error.message });
      return;
    }
    setRolesOriginal(clonarRoles(roles));
    setOverridesOriginal(clonarOverrides(overrides));
    setDirty(false);
    flash('Permisos actualizados para el club');
  }, [clubId, roles, rolesOriginal, overrides, overridesOriginal, flash]);

  const handleRestaurar = useCallback(() => {
    confirmar(
      'Restaurar permisos sugeridos',
      'Capitán y jugador vuelven a los permisos sugeridos para el club, y se borran todas las excepciones por integrante. Esto se guarda de inmediato.',
      async () => {
        setSaving(true);
        const { error } = await restaurarPermisosDefault(clubId);
        if (error) {
          setSaving(false);
          setBanner({ type: 'error', title: 'No se pudo restaurar', message: error.message });
          return;
        }
        await cargar();
        setSaving(false);
        flash('Volvimos a los permisos sugeridos');
      },
      { confirmar: 'Restaurar' }
    );
  }, [clubId, confirmar, cargar, flash]);

  // ── Hoja de excepciones por integrante ─────────────────────────
  const sheetMember = useMemo(() => members.find((m) => m.user_id === sheetUserId) || null, [members, sheetUserId]);
  const sheetOverrides = sheetUserId ? overrides[sheetUserId] || {} : {};
  const sheetIsAdmin = sheetMember?.rol === 'admin';
  const sheetRoleBase = sheetMember ? roles[sheetMember.rol === 'admin' ? 'jugador' : sheetMember.rol] || permisosVacios() : permisosVacios();

  const cambiarRolIntegrante = useCallback(
    async (nuevoRol) => {
      if (!sheetMember || sheetIsAdmin || sheetMember.rol === nuevoRol) return;
      setSheetWorking(true);
      const { error } = await setCaptain(sheetMember.member_id, nuevoRol === 'capitan');
      setSheetWorking(false);
      if (error) {
        setBanner({ type: 'error', title: 'No se pudo cambiar el rol', message: error.message });
        return;
      }
      setMembers((prev) => prev.map((m) => (m.member_id === sheetMember.member_id ? { ...m, rol: nuevoRol } : m)));
      flash(`${sheetMember.username} ahora es ${ROLE_LABEL[nuevoRol].toLowerCase()}`);
    },
    [sheetMember, sheetIsAdmin, flash]
  );

  const toggleOverride = useCallback(
    (key) => {
      if (!sheetUserId || sheetIsAdmin) return;
      setOverrides((prev) => {
        const actuales = prev[sheetUserId] || {};
        const base = !!sheetRoleBase[key];
        const actual = key in actuales ? !!actuales[key] : base;
        return { ...prev, [sheetUserId]: { ...actuales, [key]: !actual } };
      });
      setDirty(true);
    },
    [sheetUserId, sheetIsAdmin, sheetRoleBase]
  );

  const usarPermisosDelRol = useCallback(async () => {
    if (!sheetUserId || sheetIsAdmin) return;
    setSheetWorking(true);
    const { error } = await quitarExcepcionesIntegrante(clubId, sheetUserId);
    setSheetWorking(false);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudieron quitar las excepciones', message: error.message });
      return;
    }
    const nuevosOverrides = { ...overrides, [sheetUserId]: {} };
    const nuevosOverridesOriginal = { ...overridesOriginal, [sheetUserId]: {} };
    setOverrides(nuevosOverrides);
    setOverridesOriginal(nuevosOverridesOriginal);
    // Esta acción se guarda al toque, no al tocar «Guardar permisos» — sin
    // recalcular acá, `dirty` seguía en `true` por un cambio que ya no
    // existe (el diff real de overrides quedó en cero), y el botón se
    // mostraba activo sin nada pendiente que guardar.
    const quedanCambiosDeRol = ['capitan', 'jugador'].some(
      (rol) => Object.keys(diffRol(rolesOriginal[rol], roles[rol])).length > 0
    );
    const quedanCambiosDeOverride = diffOverrides(nuevosOverridesOriginal, nuevosOverrides).length > 0;
    setDirty(quedanCambiosDeRol || quedanCambiosDeOverride);
    flash('Vuelve a los permisos de su rol');
  }, [clubId, sheetUserId, sheetIsAdmin, flash, overrides, overridesOriginal, roles, rolesOriginal]);

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.green} />
        </View>
      </SafeAreaView>
    );
  }

  if (!soyAdmin) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={8}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <ArrowLeft color={C.textPrimary} size={18} strokeWidth={2.2} />
          </Pressable>
        </View>
        <View style={styles.loadingBox}>
          <Shield color={C.textMuted} size={32} strokeWidth={1.6} />
          <Text style={styles.emptyText}>Sólo un administrador del club puede gestionar los permisos.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
        >
          <ArrowLeft color={C.textPrimary} size={18} strokeWidth={2.2} />
        </Pressable>
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Permisos
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {club?.nombre}
            {club?.modalidad ? ` · ${modalidadInline(club.modalidad)}` : ''}
          </Text>
        </View>
        <Pressable
          onPress={handleRestaurar}
          disabled={saving}
          style={({ pressed }) => [styles.restaurarBtn, pressed && { backgroundColor: C.chipStrong }]}
        >
          <Text style={styles.restaurarLabel}>Restaurar</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

        <Text style={styles.sectionLabel}>Rol que estoy editando</Text>
        <View style={styles.tabsRow}>
          {ROLE_TABS.map((r) => {
            const activo = role === r;
            return (
              <Pressable
                key={r}
                onPress={() => setRole(r)}
                style={[styles.tab, activo && styles.tabActive]}
              >
                <Text style={[styles.tabLabel, activo && styles.tabLabelActive]}>{ROLE_LABEL[r]}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.noteCard, role === 'admin' && styles.noteCardAdmin]}>
          <ShieldCheck color={role === 'admin' ? C.green : C.textFaint} size={18} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={styles.noteTitle}>{ROLE_LABEL[role]}</Text>
            <Text style={styles.noteText}>
              {role === 'admin'
                ? 'Tiene todos los permisos y no se puede limitar. Sólo hay un admin por club: se cede desde Integrantes.'
                : role === 'capitan'
                  ? 'Mano derecha del admin. Actívale lo que corresponda sin tocar los datos del club.'
                  : 'Permisos base de cualquier integrante. Lo que desactives acá lo pierden todos, salvo las excepciones de abajo.'}
            </Text>
          </View>
        </View>

        {role !== 'admin' &&
          GRUPOS.map((g) => {
            const todosActivos = g.permisos.every((p) => current[p.key]);
            return (
              <View key={g.titulo} style={styles.grupo}>
                <View style={styles.grupoHeader}>
                  <Text style={styles.sectionLabel}>{g.titulo}</Text>
                  <Pressable onPress={() => toggleGrupoCompleto(g)}>
                    <Text style={styles.grupoAllLabel}>{todosActivos ? 'Quitar todos' : 'Activar todos'}</Text>
                  </Pressable>
                </View>
                <View style={styles.grupoCard}>
                  {g.permisos.map((p, i) => (
                    <View key={p.key} style={[styles.permRow, i > 0 && styles.permRowDivider]}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.permLabel}>{p.label}</Text>
                        <Text style={styles.permHint}>{p.hint}</Text>
                      </View>
                      <Toggle on={!!current[p.key]} onPress={() => toggleRolePermiso(p.key)} />
                    </View>
                  ))}
                </View>
              </View>
            );
          })}

        <View style={styles.grupoHeader}>
          <Text style={styles.sectionLabel}>Excepciones por integrante</Text>
          <Text style={styles.overrideCount}>
            {(() => {
              const n = Object.values(overrides).filter((o) => Object.keys(o || {}).length > 0).length;
              return n ? `${n} con cambios` : 'Sin cambios';
            })()}
          </Text>
        </View>

        <View style={{ gap: 10 }}>
          {members.map((m) => {
            const n = Object.keys(overrides[m.user_id] || {}).length;
            const esAdmin = m.rol === 'admin';
            return (
              <Pressable
                key={m.member_id}
                onPress={() => setSheetUserId(m.user_id)}
                style={({ pressed }) => [styles.memberRow, n > 0 && styles.memberRowConCambios, pressed && { backgroundColor: C.chipStrong }]}
              >
                <MiniAvatar foto={m.foto_url} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.memberNameRow}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {m.apodo || m.username}
                    </Text>
                    {(esAdmin || m.rol === 'capitan') && (
                      <View style={[styles.tag, esAdmin ? styles.tagAdmin : styles.tagCapitan]}>
                        <Text style={[styles.tagLabel, { color: esAdmin ? C.green : '#8ACFF0' }]}>
                          {esAdmin ? 'Admin' : 'Capitán'}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.memberMeta}>
                    {esAdmin
                      ? 'Todos los permisos'
                      : n
                        ? `${n} ${n === 1 ? 'permiso propio' : 'permisos propios'}`
                        : `Permisos de ${ROLE_LABEL[m.rol].toLowerCase()}`}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={guardar}
          disabled={!dirty || saving}
          style={[styles.saveBtn, (!dirty || saving) && styles.saveBtnDisabled]}
        >
          {saving ? (
            <ActivityIndicator color={dirty ? C.greenInk : C.textFaint} />
          ) : (
            <Text style={[styles.saveLabel, { color: dirty ? C.greenInk : C.textFaint }]}>
              {dirty ? 'Guardar permisos' : 'Todo guardado'}
            </Text>
          )}
        </Pressable>
      </ScrollView>

      {toast ? (
        <View style={styles.toast}>
          <Check color={C.green} size={16} strokeWidth={2.4} />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      <Modal
        visible={!!sheetUserId}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setSheetUserId(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheetUserId(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            {sheetMember && (
              <>
                <View style={styles.sheetHeaderRow}>
                  <MiniAvatar foto={sheetMember.foto_url} size={42} />
                  <View>
                    <Text style={styles.sheetName}>{sheetMember.apodo || sheetMember.username}</Text>
                    <Text style={styles.sheetMeta}>{ROLE_LABEL[sheetMember.rol]}</Text>
                  </View>
                </View>

                <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Rol</Text>
                <View style={styles.tabsRow}>
                  {['capitan', 'jugador'].map((r) => {
                    const activo = sheetMember.rol === r;
                    return (
                      <Pressable
                        key={r}
                        disabled={sheetIsAdmin || sheetWorking}
                        onPress={() => cambiarRolIntegrante(r)}
                        style={[styles.tab, activo && styles.tabActive, sheetIsAdmin && { opacity: 0.4 }]}
                      >
                        <Text style={[styles.tabLabel, activo && styles.tabLabelActive]}>{ROLE_LABEL[r]}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.grupoHeader}>
                  <Text style={styles.sectionLabel}>Permisos propios</Text>
                  {!sheetIsAdmin && (
                    <Pressable onPress={usarPermisosDelRol} disabled={sheetWorking}>
                      <Text style={styles.grupoAllLabel}>Usar los del rol</Text>
                    </Pressable>
                  )}
                </View>

                {sheetIsAdmin ? (
                  <View style={styles.lockedBox}>
                    <Text style={styles.lockedText}>
                      El administrador tiene todos los permisos del club. Para limitarlo, primero cámbiale el rol.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.grupoCard}>
                    {PERMISOS_CLUB.map((key, i) => {
                      const label = GRUPOS.flatMap((g) => g.permisos).find((p) => p.key === key)?.label || key;
                      const tieneOverride = key in sheetOverrides;
                      const valor = tieneOverride ? !!sheetOverrides[key] : !!sheetRoleBase[key];
                      return (
                        <View key={key} style={[styles.permRow, i > 0 && styles.permRowDivider]}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.permLabel}>{label}</Text>
                            <Text style={[styles.permOrigin, tieneOverride && { color: C.green }]}>
                              {tieneOverride ? 'Permiso propio' : 'Heredado del rol'}
                            </Text>
                          </View>
                          <Toggle on={valor} onPress={() => toggleOverride(key)} />
                        </View>
                      );
                    })}
                  </View>
                )}

                <Pressable style={styles.sheetCloseBtn} onPress={() => setSheetUserId(null)}>
                  <Text style={styles.sheetCloseLabel}>Listo</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {dialogo}
    </SafeAreaView>
  );
}

function Toggle({ on, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={[styles.toggleTrack, on && styles.toggleTrackOn, disabled && { opacity: 0.4 }]}
    >
      <View style={[styles.toggleKnob, on && styles.toggleKnobOn]} />
    </Pressable>
  );
}

function MiniAvatar({ foto, size = 40 }) {
  if (foto) {
    return <Image source={{ uri: foto }} style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]} />;
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Shield color={C.textMuted} size={size * 0.45} strokeWidth={1.8} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.screenPadding,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 8,
  },
  iconBtn: {
    width: S.iconBtn,
    height: S.iconBtn,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPressed: { backgroundColor: C.chipStrong },
  headerTitles: { flex: 1, minWidth: 0 },
  headerTitle: { color: C.textPrimary, fontSize: 17, fontFamily: F.bold, letterSpacing: -0.2 },
  headerSubtitle: { color: C.textSecondary, fontSize: 12.5, marginTop: 1 },
  restaurarBtn: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restaurarLabel: { color: C.textSecondary, fontSize: 12, fontFamily: F.bold },

  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 40 },
  emptyText: { color: C.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19 },

  scrollContent: { paddingHorizontal: S.screenPadding, paddingBottom: 48, gap: 0 },

  sectionLabel: {
    fontFamily: F.bold,
    fontSize: 10.5,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: C.textFaint,
  },

  tabsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  tab: {
    flex: 1,
    borderRadius: R.cardSm,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: 'transparent',
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: C.green, borderColor: C.green },
  tabLabel: { color: C.textSecondary, fontSize: 13, fontFamily: F.extraBold },
  tabLabelActive: { color: C.greenInk },

  noteCard: {
    marginTop: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.hairline,
    borderRadius: R.cardSm,
    padding: 14,
    flexDirection: 'row',
    gap: 11,
    alignItems: 'flex-start',
  },
  noteCardAdmin: { borderColor: C.greenBorder },
  noteTitle: { color: C.textPrimary, fontSize: 13.5, fontFamily: F.extraBold },
  noteText: { marginTop: 4, color: C.textFaint, fontSize: 12.5, lineHeight: 18 },

  grupo: { marginTop: 22 },
  grupoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 22,
  },
  grupoAllLabel: { color: C.green, fontSize: 11.5, fontFamily: F.bold },
  grupoCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.hairline,
    borderRadius: R.cardSm,
    paddingHorizontal: 15,
  },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 14 },
  permRowDivider: { borderTopWidth: 1, borderTopColor: C.hairline },
  permLabel: { color: C.textPrimary, fontSize: 14, fontFamily: F.bold },
  permHint: { marginTop: 3, color: C.textFaint, fontSize: 12, lineHeight: 16 },
  permOrigin: { marginTop: 3, color: C.textFaint, fontSize: 11.5, fontFamily: F.semiBold },

  overrideCount: { color: C.textFaint, fontSize: 11.5, fontFamily: F.bold },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.hairline,
    borderRadius: R.cardSm,
    padding: 13,
  },
  memberRowConCambios: { borderColor: C.greenBorder },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  memberName: { color: C.textPrimary, fontSize: 14.5, fontFamily: F.bold, flexShrink: 1 },
  memberMeta: { marginTop: 4, color: C.textFaint, fontSize: 12 },
  tag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  tagAdmin: { backgroundColor: C.greenSoft },
  tagCapitan: { backgroundColor: 'rgba(90,184,224,0.16)' },
  tagLabel: { fontSize: 9.5, fontFamily: F.extraBold, letterSpacing: 0.5, textTransform: 'uppercase' },

  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: { backgroundColor: C.chip, alignItems: 'center', justifyContent: 'center' },

  toggleTrack: {
    width: 48,
    height: 28,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.track,
    backgroundColor: C.track,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleTrackOn: { backgroundColor: C.green, borderColor: C.green },
  toggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.textSecondary,
  },
  toggleKnobOn: { backgroundColor: C.greenInk, alignSelf: 'flex-end' },

  saveBtn: {
    marginTop: 28,
    height: 54,
    borderRadius: R.row,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.green,
  },
  saveBtnDisabled: { backgroundColor: C.chip },
  saveLabel: { fontSize: 15, fontFamily: F.extraBold },

  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 24,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: R.cardSm,
    paddingVertical: 13,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  toastText: { color: C.textPrimary, fontSize: 13, fontFamily: F.bold },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: R.hero,
    borderTopRightRadius: R.hero,
    borderTopWidth: 1,
    borderColor: C.border,
    paddingHorizontal: S.screenPadding,
    paddingTop: 14,
    paddingBottom: 30,
    maxHeight: '82%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 3,
    backgroundColor: alfa(C.tinta, 0.2),
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.hairline,
  },
  sheetName: { color: C.textPrimary, fontSize: 16, fontFamily: F.extraBold },
  sheetMeta: { marginTop: 3, color: C.textSecondary, fontSize: 12 },

  lockedBox: {
    padding: 18,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: C.dashedBorder,
    borderRadius: R.cardSm,
  },
  lockedText: { color: C.textFaint, fontSize: 12.5, lineHeight: 19, fontFamily: F.semiBold },

  sheetCloseBtn: {
    marginTop: 18,
    height: 52,
    borderRadius: R.cardSm,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCloseLabel: { color: C.greenInk, fontSize: 14.5, fontFamily: F.extraBold },
});
