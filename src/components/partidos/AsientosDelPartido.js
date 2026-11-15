import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Share, Platform } from 'react-native';
import { Link2 } from 'lucide-react-native';

import ListaDeAsientos from './ListaDeAsientos';
import { SelectorDeAmigos, NombreDeAsientoSheet } from './SelectorDeAmigos';
import { Note, SurfaceButton } from './ui';
import { paleta as C, fuentes as F } from '../../theme/colors';
import {
  agregarNombre,
  asignarAmigo,
  cambiarAsiento,
  getAsientosSinCuenta,
  getTokenDeInvitacion,
  liberarAsiento,
  quitarAmigo,
  reservarAsientos,
  useNombresVigentes,
} from '../../services/asientos';
import {
  asientosDelPartido,
  contadorDeJugadores,
  linkDeInvitacion,
  reservasDisponibles,
  textoDeInvitacion,
} from '../../utils/asientos.js';
import { notify } from '../../utils/notify';

/**
 * Los asientos de un partido ya publicado.
 *
 * Lee los asientos sin cuenta, los junta con la nómina que ya cargó la
 * pantalla y dibuja la lista completa. Con `editable` (el organizador, en un
 * partido que todavía admite cambios) suma las acciones de cada asiento y el
 * link de invitación.
 *
 * `version` cambia cuando la pantalla recarga el partido: así los asientos
 * se vuelven a leer junto con la nómina. `onCambio` le pide a la pantalla
 * que recargue después de cada cambio, porque los cupos los cuenta el
 * servidor.
 */
export default function AsientosDelPartido({
  match,
  nomina = [],
  editable = false,
  miId = null,
  version = 0,
  onCambio,
  onVerPerfil,
  onUnirme,
  etiquetaUnirme,
}) {
  const matchId = match?.id;
  const [sinCuenta, setSinCuenta] = useState([]);
  const [errorDeCarga, setErrorDeCarga] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [paraAmigo, setParaAmigo] = useState(null);
  const [paraNombre, setParaNombre] = useState(null);
  const turno = useRef(0);
  const nombresActivos = useNombresVigentes();

  const cargar = useCallback(async () => {
    if (!matchId) return;
    const mio = ++turno.current;
    const { data, error } = await getAsientosSinCuenta(matchId);
    if (mio !== turno.current) return;
    setErrorDeCarga(!!error);
    if (!error) setSinCuenta(data);
  }, [matchId]);

  useEffect(() => {
    cargar();
  }, [cargar, version]);

  const contador = contadorDeJugadores(match);
  const asientos = useMemo(() => asientosDelPartido(match, nomina, sinCuenta), [match, nomina, sinCuenta]);
  const conAsiento = useMemo(
    () => nomina.filter((a) => ['inscrito', 'confirmado_gps', 'no_asistio'].includes(a.estado)).map((a) => a.user_id),
    [nomina]
  );
  const reservas = reservasDisponibles(sinCuenta);

  if (!contador) return null;

  // Toda acción pasa por acá: una a la vez, error a la vista y recarga al final.
  const hacer = async (accion) => {
    if (ocupado) return false;
    setOcupado(true);
    const r = await accion();
    setOcupado(false);
    if (!r?.ok) {
      notify('No se guardó el cambio', r?.mensaje || 'Inténtalo de nuevo.', 'error');
      cargar();
      return false;
    }
    await cargar();
    onCambio?.();
    return true;
  };

  const elegirAmigo = async (amigo) => {
    const asiento = paraAmigo;
    setParaAmigo(null);
    await hacer(() => asignarAmigo(matchId, amigo.user_id, asiento?.asiento_id || null));
  };

  const guardarNombre = async (nombre) => {
    const asiento = paraNombre;
    const ok = await hacer(() =>
      asiento?.asiento_id ? cambiarAsiento(asiento.asiento_id, 'nombre', nombre) : agregarNombre(matchId, nombre)
    );
    if (ok) setParaNombre(null);
  };

  const liberar = (a) =>
    hacer(() => (a.tipo === 'cuenta' ? quitarAmigo(matchId, a.user_id) : liberarAsiento(a.asiento_id)));

  const compartirLink = async () => {
    if (ocupado) return;
    setOcupado(true);
    const r = await getTokenDeInvitacion(matchId);
    setOcupado(false);
    if (!r.ok || !r.token) {
      notify('No pudimos crear el link', r.mensaje || 'Inténtalo de nuevo.', 'error');
      return;
    }
    const url = linkDeInvitacion(matchId, r.token);
    const texto = textoDeInvitacion(match, r.token);
    try {
      // Sin `expo-clipboard`: en web se copia con la API del navegador y en
      // nativo se abre la hoja del sistema, que también permite copiar.
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
        notify('Link copiado', 'Pégalo en tu grupo de WhatsApp.', 'ok');
        return;
      }
      await Share.share(Platform.OS === 'ios' ? { message: texto, url } : { message: texto });
    } catch {
      // Cerrar la hoja del sistema sin compartir no es un error.
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.cabecera}>
        <Text style={styles.contador}>{contador.texto}</Text>
        <Text style={styles.resto}>
          {contador.completo ? 'Partido completo' : `jugadores confirmados · ${contador.resto}`}
        </Text>
      </View>

      <ListaDeAsientos
        asientos={asientos}
        editable={editable}
        nombresActivos={nombresActivos}
        ocupado={ocupado}
        miId={miId}
        onAmigo={setParaAmigo}
        onNombre={setParaNombre}
        onReservar={() => hacer(() => reservarAsientos(matchId, 1))}
        onLiberar={liberar}
        onVerPerfil={onVerPerfil}
        onUnirme={onUnirme}
        etiquetaUnirme={etiquetaUnirme}
      />

      {errorDeCarga ? (
        <Note>No pudimos cargar los asientos reservados y por nombre. Desliza para actualizar.</Note>
      ) : null}

      {editable ? (
        <>
          <SurfaceButton
            label={
              reservas > 0
                ? `Compartir link de invitación · ${reservas} ${reservas === 1 ? 'reservado' : 'reservados'}`
                : 'Compartir link de invitación'
            }
            icon={Link2}
            onPress={compartirLink}
            disabled={ocupado}
            height={46}
          />
          <Note>
            {reservas > 0
              ? 'Manda el link a tu gente: cada uno entra con su cuenta y toma uno de los asientos reservados. El link nunca da acceso a los cupos libres.'
              : 'El link sólo sirve para asientos reservados. Reserva uno con el candado y después compártelo.'}
          </Note>
        </>
      ) : null}

      <SelectorDeAmigos
        visible={!!paraAmigo}
        onClose={() => setParaAmigo(null)}
        onElegir={elegirAmigo}
        excluidos={conAsiento}
        titulo={paraAmigo?.tipo === 'nombre' ? `Reemplazar a ${paraAmigo.nombre}` : 'Agregar a un amigo'}
      />
      <NombreDeAsientoSheet
        visible={!!paraNombre}
        onClose={() => setParaNombre(null)}
        onGuardar={guardarNombre}
        inicial={paraNombre?.tipo === 'nombre' ? paraNombre.nombre : ''}
        guardando={ocupado}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cabecera: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  contador: {
    fontSize: 24,
    fontFamily: F.extraBold,
    color: C.green,
    letterSpacing: -0.4,
  },
  resto: {
    flex: 1,
    fontSize: 12.5,
    fontFamily: F.semiBold,
    color: C.textSecondary,
  },
});
