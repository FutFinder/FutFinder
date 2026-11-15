import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Check, Users } from 'lucide-react-native';

import Sheet from './Sheet';
import { Avatar, GhostButton, Input, Note, PrimaryButton } from './ui';
import { paleta as C, radios as R, fuentes as F } from '../../theme/colors';
import { listMyFriends } from '../../services/friends';
import { limpiarNombre, NOMBRE_MAX } from '../../utils/asientos.js';

/**
 * Hoja para elegir a UN amigo y sentarlo en un asiento.
 *
 * `excluidos` son los perfiles que ya tienen asiento en el partido: se
 * muestran apagados, con su motivo, en vez de esconderse —esconderlos hace
 * pensar que el amigo desapareció de la lista—.
 */
export function SelectorDeAmigos({ visible, onClose, onElegir, excluidos = [], titulo = 'Agregar a un amigo' }) {
  const [estado, setEstado] = useState({ cargando: true, error: false, amigos: [] });
  const [busqueda, setBusqueda] = useState('');

  const cargar = useCallback(async () => {
    setEstado((s) => ({ ...s, cargando: true, error: false }));
    const { data, error } = await listMyFriends();
    setEstado({ cargando: false, error: !!error, amigos: data || [] });
  }, []);

  useEffect(() => {
    if (visible) {
      setBusqueda('');
      cargar();
    }
  }, [visible, cargar]);

  const fuera = useMemo(() => new Set(excluidos), [excluidos]);
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase().replace(/^@/, '');
    if (!q) return estado.amigos;
    return estado.amigos.filter((f) => (f.username || '').toLowerCase().includes(q));
  }, [busqueda, estado.amigos]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={titulo}
      subtitle="Queda con su asiento al tiro y le avisamos. Si no puede ir, se baja sin costo."
      footer={<GhostButton label="Cancelar" onPress={onClose} height={48} style={{ flex: 1 }} />}
    >
      {estado.cargando ? (
        <View style={styles.centro}>
          <ActivityIndicator color={C.green} />
        </View>
      ) : estado.error ? (
        <View style={styles.centro}>
          <Text style={styles.vacioTitulo}>No pudimos cargar tus amigos</Text>
          <GhostButton label="Reintentar" onPress={cargar} height={42} style={{ alignSelf: 'center', paddingHorizontal: 22 }} />
        </View>
      ) : estado.amigos.length === 0 ? (
        <View style={styles.centro}>
          <Users color={C.textGhost} size={26} strokeWidth={1.8} />
          <Text style={styles.vacioTitulo}>Todavía no tienes amigos en FutFinder</Text>
          <Text style={styles.vacioTexto}>
            Reserva el asiento y comparte el link de invitación: cada uno entra con su cuenta y lo toma.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {estado.amigos.length > 6 ? (
            <Input value={busqueda} onChangeText={setBusqueda} placeholder="Buscar por nombre de usuario" maxLength={30} />
          ) : null}
          {filtrados.length === 0 ? <Note>Ningún amigo coincide con «{busqueda.trim()}».</Note> : null}
          {filtrados.map((f) => {
            const yaEsta = fuera.has(f.user_id);
            return (
              <Pressable
                key={f.user_id}
                onPress={() => onElegir(f)}
                disabled={yaEsta}
                accessibilityRole="button"
                accessibilityLabel={yaEsta ? `${f.username} ya tiene asiento` : `Agregar a ${f.username}`}
                style={({ pressed }) => [styles.fila, yaEsta && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
              >
                <Avatar url={f.foto_url} name={f.username} size={38} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={styles.nombre}>
                    @{f.username}
                  </Text>
                  <Text numberOfLines={1} style={styles.detalle}>
                    {yaEsta ? 'Ya tiene un asiento en este partido' : f.comuna || 'Amigo'}
                  </Text>
                </View>
                {yaEsta ? <Check color={C.textGhost} size={16} strokeWidth={2.2} /> : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </Sheet>
  );
}

/**
 * Hoja para ocupar un asiento escribiendo sólo un nombre (período de
 * lanzamiento). `inicial` trae el nombre actual cuando se está corrigiendo.
 */
export function NombreDeAsientoSheet({ visible, onClose, onGuardar, inicial = '', guardando = false }) {
  const [nombre, setNombre] = useState(inicial);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (visible) {
      setNombre(inicial || '');
      setError(null);
    }
  }, [visible, inicial]);

  const guardar = () => {
    const limpio = limpiarNombre(nombre);
    if (!limpio) {
      setError(`Escribe un nombre de hasta ${NOMBRE_MAX} letras`);
      return;
    }
    onGuardar(limpio);
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={inicial ? 'Cambiar el nombre' : 'Invitado por nombre'}
      subtitle="Para alguien que todavía no tiene la app. Sólo se guarda en este partido."
      scroll={false}
      footer={
        <>
          <GhostButton label="Cancelar" onPress={onClose} height={48} style={{ flex: 1 }} />
          <PrimaryButton label="Guardar" onPress={guardar} loading={guardando} disabled={guardando} height={48} style={{ flex: 1 }} />
        </>
      }
    >
      <View style={{ gap: 8 }}>
        <Input
          value={nombre}
          onChangeText={(t) => {
            setNombre(t);
            if (error) setError(null);
          }}
          placeholder="Ej: Johan"
          maxLength={NOMBRE_MAX}
          error={!!error}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Note>Aparece en la lista con la etiqueta «Invitado». Si después se crea una cuenta, puedes reemplazarlo.</Note>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  centro: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 26,
    paddingHorizontal: 12,
  },
  vacioTitulo: {
    fontSize: 14.5,
    fontFamily: F.bold,
    color: C.textPrimary,
    textAlign: 'center',
  },
  vacioTexto: {
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: F.medium,
    color: C.textSecondary,
    textAlign: 'center',
  },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.row,
  },
  nombre: {
    fontSize: 14,
    fontFamily: F.bold,
    color: C.textPrimary,
  },
  detalle: {
    marginTop: 1,
    fontSize: 12,
    fontFamily: F.medium,
    color: C.textSecondary,
  },
  error: {
    fontSize: 11.5,
    fontFamily: F.semiBold,
    color: C.red,
  },
});

export default SelectorDeAmigos;
