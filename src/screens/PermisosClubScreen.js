import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Shield, Check, ChevronRight } from 'lucide-react-native';

import { paleta as C, radios as R, medidas as S, fuentes as F, alfa } from '../theme/colors';
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
      { key: 'answerChallenge', label: 'Aceptar o rechazar desafíos', hint: 'Responder desafíos de otros clubes' },
      { key: 'chatClubs', label: 'Chatear con otros clubes', hint: 'Abrir conversación con el admin rival' },
    ],
  },
  {
    titulo: 'Gente',
    permisos: [
      { key: 'invite', label: 'Invitar jugadores', hint: 'Enviar enlaces e invitaciones' },
      { key: 'removeMembers', label: 'Quitar integrantes', hint: 'Sacar jugadores del club' },
      { key: 'editNicks', label: 'Editar apodos', hint: 'Cambiar el apodo de otros integrantes' },
    ],
  },
  {
    titulo: 'Partido',
    permisos: [
      // NO ES LA DEL PRÓXIMO PARTIDO. `club_lineups` no tiene `match_id`: es el
      // once base del club, y decía lo contrario justo donde se decide quién
      // puede tocarlo.
      { key: 'lineup', label: 'Armar alineación', hint: 'Editar la alineación general del club' },
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

  // Rediseño de Clubes (2026-11-26): «Por rol» es una matriz con las dos
  // columnas a la vista y «Por integrante» la lista de excepciones.
  const [vista, setVista] = useState('rol');
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

  const toggleRolePermiso = useCallback((rol, key) => {
    setRoles((prev) => ({ ...prev, [rol]: { ...prev[rol], [key]: !prev[rol][key] } }));
    setDirty(true);
  }, []);

  /**
   * Escribe el borrador y devuelve si lo consiguió.
   *
   * El booleano lo usa «Guardar y salir» del aviso de cambios sin guardar: un
   * error del servidor tiene que dejar los cambios en pantalla, no llevárselos.
   */
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
      return true;
    }

    const resultados = await Promise.all(tareas);
    setSaving(false);
    const conError = resultados.find((r) => r?.error);
    if (conError) {
      setBanner({ type: 'error', title: 'No se pudo guardar todo', message: conError.error.message });
      return false;
    }
    setRolesOriginal(clonarRoles(roles));
    setOverridesOriginal(clonarOverrides(overrides));
    setDirty(false);
    flash('Permisos actualizados para el club');
    return true;
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

  /**
   * Salir con permisos sin guardar pregunta antes.
   *
   * La pantalla ya distinguía el borrador de lo escrito —`dirty` y un botón
   * «Guardar permisos» aparte— pero los dos botones de volver salían directo,
   * así que el reparto que alguien acababa de armar se perdía sin un aviso.
   *
   * `beforeRemove` cubre el botón de la pantalla, el gesto del sistema y el
   * botón físico de Android de una sola vez. El valor viaja por ref para no
   * volver a suscribir el oyente con cada interruptor que se toca.
   */
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const guardarRef = useRef(guardar);
  guardarRef.current = guardar;
  const saliendoRef = useRef(false);

  useEffect(() => {
    const quitar = navigation.addListener('beforeRemove', (e) => {
      if (!dirtyRef.current || saliendoRef.current) return;
      e.preventDefault();
      const salir = () => {
        saliendoRef.current = true;
        navigation.dispatch(e.data.action);
      };
      confirmar(
        'Tienes permisos sin guardar',
        'Si sales ahora, el reparto vuelve a como estaba.',
        salir,
        {
          confirmar: 'Salir sin guardar',
          alternativa: {
            label: 'Guardar y salir',
            // Sólo sale si se guardó: un error del servidor tiene que dejar
            // los cambios delante, no llevárselos.
            onPress: async () => {
              if (await guardarRef.current()) salir();
            },
          },
          cancelar: 'Seguir editando',
        }
      );
    });
    return quitar;
  }, [navigation, confirmar]);

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
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Volver"
          style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
        >
          <ArrowLeft color={C.textPrimary} size={18} strokeWidth={2.2} />
        </Pressable>
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Permisos del club
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            Solo administradores{club?.nombre ? ` · ${club.nombre}` : ''}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

        <View style={styles.segmento} accessibilityRole="tablist">
          {[
            ['rol', 'Por rol'],
            ['integrante', 'Por integrante'],
          ].map(([clave, etiqueta]) => {
            const activo = vista === clave;
            return (
              <Pressable
                key={clave}
                onPress={() => setVista(clave)}
                accessibilityRole="tab"
                accessibilityState={{ selected: activo }}
                style={[styles.segmentoOpcion, activo && styles.segmentoOpcionActiva]}
              >
                <Text style={[styles.segmentoTexto, activo && styles.segmentoTextoActivo]}>{etiqueta}</Text>
              </Pressable>
            );
          })}
        </View>

        {vista === 'rol' ? (
          <>
            <View style={styles.columnas}>
              <Text style={styles.columna}>CAPITÁN</Text>
              <Text style={styles.columna}>JUGADOR</Text>
            </View>
            {GRUPOS.map((g) => (
              <View key={g.titulo} style={styles.grupo}>
                <Text style={styles.grupoTitulo}>{g.titulo}</Text>
                <View style={styles.grupoCard}>
                  {g.permisos.map((p, i) => (
                    <View key={p.key} style={[styles.permRow, i > 0 && styles.permRowDivider]}>
                      <Text style={styles.permLabel} accessibilityHint={p.hint}>
                        {p.label}
                      </Text>
                      {['capitan', 'jugador'].map((rol) => (
                        <View key={rol} style={styles.celda}>
                          <Toggle
                            on={!!roles[rol]?.[p.key]}
                            onPress={() => toggleRolePermiso(rol, p.key)}
                            etiqueta={`${p.label}, ${ROLE_LABEL[rol]}`}
                          />
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </View>
            ))}
            <Text style={styles.nota}>
              El administrador tiene todos los permisos y no se puede limitar. Lo que desactives
              para un rol lo pierden todos los que lo tienen, salvo sus excepciones.
            </Text>
          </>
        ) : (
          <>
            <Text style={[styles.nota, { marginTop: 4, marginBottom: 12 }]}>
              {(() => {
                const n = Object.values(overrides).filter((o) => Object.keys(o || {}).length > 0).length;
                return n
                  ? `${n} ${n === 1 ? 'integrante tiene' : 'integrantes tienen'} excepciones.`
                  : 'Nadie tiene excepciones: todos usan los permisos de su rol.';
              })()}
            </Text>
            <View style={styles.grupoCard}>
              {members.map((m, i) => {
                const n = Object.keys(overrides[m.user_id] || {}).length;
                const esAdmin = m.rol === 'admin';
                return (
                  <Pressable
                    key={m.member_id}
                    onPress={() => setSheetUserId(m.user_id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Permisos de ${m.apodo || m.username}`}
                    style={({ pressed }) => [
                      styles.memberRow,
                      i > 0 && styles.permRowDivider,
                      pressed && { backgroundColor: C.surfaceHover },
                    ]}
                  >
                    <MiniAvatar foto={m.foto_url} size={36} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {m.apodo || m.username}
                      </Text>
                      <Text style={[styles.memberMeta, n > 0 && { color: C.green }]}>
                        {esAdmin
                          ? 'Administrador · todos los permisos'
                          : n
                            ? `${ROLE_LABEL[m.rol]} · ${n} ${n === 1 ? 'excepción' : 'excepciones'}`
                            : `${ROLE_LABEL[m.rol]} · permisos del rol`}
                      </Text>
                    </View>
                    <ChevronRight color={C.textMuted} size={18} strokeWidth={2.2} />
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.pie}>
        <Pressable
          onPress={handleRestaurar}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Restaurar los permisos sugeridos"
          style={({ pressed }) => [styles.pieSecundario, pressed && { backgroundColor: C.surfaceHover }]}
        >
          <Text style={styles.pieSecundarioTexto}>Restaurar</Text>
        </Pressable>
        <Pressable
          onPress={guardar}
          disabled={!dirty || saving}
          accessibilityRole="button"
          accessibilityState={{ disabled: !dirty || saving, busy: saving }}
          style={[styles.saveBtn, (!dirty || saving) && styles.saveBtnDisabled]}
        >
          {saving ? (
            <ActivityIndicator color={dirty ? C.textOnGreen : C.textFaint} />
          ) : (
            <Text style={[styles.saveLabel, { color: dirty ? C.textOnGreen : C.textFaint }]}>
              {dirty ? 'Guardar' : 'Todo guardado'}
            </Text>
          )}
        </Pressable>
      </View>

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
                    <Text style={styles.sheetMeta}>
                      {sheetIsAdmin
                        ? 'Administrador'
                        : `Hereda los permisos de ${ROLE_LABEL[sheetMember.rol]}`}
                    </Text>
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
                              {tieneOverride
                                ? `Excepción: ${valor ? 'activado' : 'desactivado'} solo para ${sheetMember.apodo || sheetMember.username}`
                                : 'Del rol'}
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

function Toggle({ on, onPress, disabled, etiqueta }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="switch"
      accessibilityState={{ checked: !!on, disabled: !!disabled }}
      accessibilityLabel={etiqueta}
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
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPressed: { backgroundColor: C.chipStrong },
  headerTitles: { flex: 1, minWidth: 0 },
  headerTitle: { color: C.textPrimary, fontSize: 19, fontFamily: F.extraBold, letterSpacing: -0.2 },
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

  scrollContent: { paddingHorizontal: S.screenPadding, paddingBottom: 32 },

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

  grupo: { marginTop: 14 },
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
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  permRowDivider: { borderTopWidth: 1, borderTopColor: C.hairline },
  permLabel: { flex: 1, color: C.textPrimary, fontSize: 14, fontFamily: F.semiBold },
  permHint: { marginTop: 3, color: C.textFaint, fontSize: 12, lineHeight: 16 },
  permOrigin: { marginTop: 3, color: C.textFaint, fontSize: 11.5, fontFamily: F.semiBold },

  overrideCount: { color: C.textFaint, fontSize: 11.5, fontFamily: F.bold },

  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  memberRowConCambios: { borderColor: C.greenBorder },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  memberName: { color: C.textPrimary, fontSize: 14.5, fontFamily: F.bold, flexShrink: 1 },
  memberMeta: { marginTop: 2, color: C.textSecondary, fontSize: 12 },
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
  toggleKnobOn: { backgroundColor: C.textOnGreen, alignSelf: 'flex-end' },

  saveBtn: {
    flex: 1.6,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.green,
  },
  saveBtnDisabled: { backgroundColor: C.chip },
  saveLabel: { fontSize: 15, fontFamily: F.extraBold },

  segmento: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    marginTop: 4,
  },
  segmentoOpcion: { flex: 1, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segmentoOpcionActiva: { backgroundColor: C.surfaceAlt },
  segmentoTexto: { color: C.textSecondary, fontSize: 13.5, fontFamily: F.bold },
  segmentoTextoActivo: { color: C.textPrimary },
  columnas: { flexDirection: 'row', justifyContent: 'flex-end', gap: 4, marginTop: 16, paddingRight: 14 },
  columna: { width: 58, textAlign: 'center', color: C.textSecondary, fontSize: 10.5, fontFamily: F.bold, letterSpacing: 0.6 },
  celda: { width: 58, alignItems: 'center' },
  grupoTitulo: { color: C.textPrimary, fontSize: 14, fontFamily: F.extraBold, marginBottom: 8 },
  nota: { color: C.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 16 },
  pie: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: S.screenPadding,
    paddingTop: 12,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: C.borderSoft,
    backgroundColor: C.bg,
  },
  pieSecundario: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  pieSecundarioTexto: { color: C.textPrimary, fontSize: 14.5, fontFamily: F.bold },
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
  sheetCloseLabel: { color: C.textOnGreen, fontSize: 14.5, fontFamily: F.extraBold },
});
