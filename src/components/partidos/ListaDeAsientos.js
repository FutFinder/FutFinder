import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Lock, Pencil, Plus, User, UserPlus, X } from 'lucide-react-native';

import { Avatar, Tag } from './ui';
import { paleta as C, radios as R, fuentes as F } from '../../theme/colors';

/**
 * La lista de asientos de un partido: una fila por jugador del total.
 *
 * Sirve para las tres vistas —armar al publicar, gestionar y la vista
 * pública— y no sabe nada del servidor: recibe la lista ya ordenada
 * (`asientosDelBorrador` / `asientosDelPartido`) y avisa de cada toque.
 *
 * Tipos de asiento: creador, cuenta, nombre, reservado y libre.
 *
 * Con `editable` (sólo el organizador) cada asiento muestra sus acciones:
 *   «+»      elegir a un amigo            (`onAmigo`)
 *   lápiz    escribir sólo un nombre      (`onNombre`, sólo con `nombresActivos`)
 *   candado  reservarlo para el link      (`onReservar`)
 *   ✕        liberarlo                    (`onLiberar`)
 * Sin `editable`, los libres ofrecen `onUnirme` y las cuentas abren su perfil.
 */
export default function ListaDeAsientos({
  asientos = [],
  editable = false,
  nombresActivos = false,
  ocupado = false,
  miId = null,
  onAmigo,
  onNombre,
  onReservar,
  onLiberar,
  onVerPerfil,
  onUnirme,
  etiquetaUnirme = 'Unirme',
}) {
  return (
    <View style={styles.lista}>
      {asientos.map((a, i) => (
        <Fila
          key={a.key}
          numero={i + 1}
          asiento={a}
          ultimo={i === asientos.length - 1}
          editable={editable}
          nombresActivos={nombresActivos}
          ocupado={ocupado}
          miId={miId}
          onAmigo={onAmigo}
          onNombre={onNombre}
          onReservar={onReservar}
          onLiberar={onLiberar}
          onVerPerfil={onVerPerfil}
          onUnirme={onUnirme}
          etiquetaUnirme={etiquetaUnirme}
        />
      ))}
    </View>
  );
}

function Fila({
  numero,
  asiento: a,
  ultimo,
  editable,
  nombresActivos,
  ocupado,
  miId,
  onAmigo,
  onNombre,
  onReservar,
  onLiberar,
  onVerPerfil,
  onUnirme,
  etiquetaUnirme,
}) {
  const conCuenta = a.tipo === 'creador' || a.tipo === 'cuenta';
  const titulo = conCuenta
    ? `@${a.username || 'jugador'}`
    : a.tipo === 'nombre'
    ? a.nombre
    : a.tipo === 'reservado'
    ? 'Asiento reservado'
    : 'Cupo libre';

  const etiqueta =
    a.tipo === 'creador'
      ? { label: 'Creador', tone: 'green' }
      : a.tipo === 'nombre'
      ? { label: 'Invitado', tone: 'neutral' }
      : a.tipo === 'reservado'
      ? { label: 'Reservado', tone: 'gold' }
      : a.tipo === 'libre'
      ? { label: 'Libre', tone: 'neutral' }
      : a.user_id && a.user_id === miId
      ? { label: 'Tú', tone: 'green' }
      : null;

  const perfil = conCuenta && a.user_id && a.user_id !== miId && onVerPerfil ? () => onVerPerfil(a.user_id) : null;

  // Qué puede hacer el organizador con este asiento.
  const puedeAmigo = editable && onAmigo && (a.tipo === 'libre' || a.tipo === 'reservado' || a.tipo === 'nombre');
  const puedeNombre = editable && onNombre && nombresActivos && a.tipo !== 'creador' && a.tipo !== 'cuenta';
  const puedeReservar = editable && onReservar && a.tipo === 'libre';
  const puedeLiberar =
    editable &&
    onLiberar &&
    (a.tipo === 'reservado' || a.tipo === 'nombre' || (a.tipo === 'cuenta' && a.asignado !== false && a.liberable !== false));

  const cuerpo = (
    <>
      <Text style={styles.numero}>{numero}</Text>
      {conCuenta ? (
        <Avatar url={a.foto_url} name={a.username} size={36} />
      ) : (
        <View style={[styles.generico, a.tipo === 'libre' && styles.genericoLibre]}>
          {a.tipo === 'reservado' ? (
            <Lock color={C.gold} size={15} strokeWidth={2} />
          ) : a.tipo === 'nombre' ? (
            <User color={C.textDim} size={16} strokeWidth={2} />
          ) : (
            <Plus color={C.textGhost} size={15} strokeWidth={2} />
          )}
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[styles.titulo, a.tipo === 'libre' && styles.tituloLibre]}>
          {titulo}
        </Text>
      </View>
      {etiqueta ? <Tag label={etiqueta.label} tone={etiqueta.tone} /> : null}
    </>
  );

  return (
    <View style={[styles.fila, !ultimo && styles.filaBorde]}>
      {perfil ? (
        <Pressable
          onPress={perfil}
          accessibilityRole="button"
          accessibilityLabel={`Ver el perfil de ${a.username || 'jugador'}`}
          style={({ pressed }) => [styles.cuerpo, pressed && { opacity: 0.75 }]}
        >
          {cuerpo}
        </Pressable>
      ) : (
        <View style={styles.cuerpo}>{cuerpo}</View>
      )}

      {puedeAmigo ? (
        <Accion
          icon={UserPlus}
          label={a.tipo === 'libre' ? 'Agregar a un amigo' : 'Reemplazar por la cuenta de un amigo'}
          onPress={() => onAmigo(a)}
          disabled={ocupado}
          tono="verde"
        />
      ) : null}
      {puedeNombre ? (
        <Accion
          icon={Pencil}
          label={a.tipo === 'nombre' ? 'Cambiar el nombre' : 'Escribir un nombre'}
          onPress={() => onNombre(a)}
          disabled={ocupado}
        />
      ) : null}
      {puedeReservar ? (
        <Accion icon={Lock} label="Reservar este asiento" onPress={() => onReservar(a)} disabled={ocupado} />
      ) : null}
      {puedeLiberar ? (
        <Accion icon={X} label="Liberar este asiento" onPress={() => onLiberar(a)} disabled={ocupado} tono="rojo" />
      ) : null}

      {!editable && a.tipo === 'libre' && onUnirme ? (
        <Pressable
          onPress={onUnirme}
          disabled={ocupado}
          accessibilityRole="button"
          accessibilityLabel={etiquetaUnirme}
          style={({ pressed }) => [styles.unirme, (pressed || ocupado) && { opacity: 0.7 }]}
        >
          <Text style={styles.unirmeTexto}>{etiquetaUnirme}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Accion({ icon: Icon, label, onPress, disabled, tono = 'neutro' }) {
  const color = tono === 'verde' ? C.green : tono === 'rojo' ? C.red : C.textSoft;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.accion, (pressed || disabled) && { opacity: 0.55 }]}
    >
      <Icon color={color} size={16} strokeWidth={2.1} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lista: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.cardSm,
    paddingHorizontal: 12,
  },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 54,
    paddingVertical: 8,
  },
  filaBorde: {
    borderBottomWidth: 1,
    borderBottomColor: C.divider,
  },
  cuerpo: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  numero: {
    width: 18,
    textAlign: 'center',
    fontSize: 11.5,
    fontFamily: F.bold,
    color: C.textMuted,
  },
  generico: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.chip,
    borderWidth: 1,
    borderColor: C.border,
  },
  genericoLibre: {
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
    borderColor: C.dashedBorderStrong,
  },
  titulo: {
    fontSize: 14,
    fontFamily: F.bold,
    color: C.textPrimary,
  },
  tituloLibre: {
    fontFamily: F.semiBold,
    color: C.textFaint,
  },
  accion: {
    width: 34,
    height: 34,
    borderRadius: R.iconBtn,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.chip,
    borderWidth: 1,
    borderColor: C.border,
  },
  unirme: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: R.chip,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.green,
  },
  unirmeTexto: {
    fontSize: 12.5,
    fontFamily: F.extraBold,
    color: C.greenInk,
  },
});
