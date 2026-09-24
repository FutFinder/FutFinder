import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { paleta as C, fuentes as F } from '../../theme/colors';
import { Card, PrimaryButton, SectionLabel } from './ui';
import {
  confirmarReclamo,
  reclamosDelPartido,
  useTrueScoreAjustes,
} from '../../services/trueScore';
import { textoEstadoReclamo } from '../../utils/trueScore';

/**
 * Reclamos de asistencia de un partido (TrueScore fase 2).
 *
 * Lo ven el jugador que reclamó, el organizador y los compañeros que
 * asistieron; a estos últimos les ofrece confirmar que el reclamante sí
 * estuvo. Con las confirmaciones necesarias el servidor corrige el puntaje.
 * Qué reclamos ve cada uno lo decide `truescore_reclamos_del_partido`.
 */
export default function ReclamosDelPartido({ matchId, style }) {
  const ajustes = useTrueScoreAjustes();
  const activo = !!(ajustes.fase1 && ajustes.fase2);
  const [reclamos, setReclamos] = useState([]);
  const [enviando, setEnviando] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(async () => {
    if (!activo || !matchId) return;
    setReclamos(await reclamosDelPartido(matchId));
  }, [activo, matchId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!activo || reclamos.length === 0) return null;

  const confirmar = async (r) => {
    if (enviando) return;
    setEnviando(r.id);
    setAviso(null);
    const res = await confirmarReclamo(r.id);
    setEnviando(null);
    if (!res?.ok) {
      setAviso({ error: true, texto: res?.reason || 'No pudimos confirmar el reclamo.' });
      return;
    }
    setAviso({
      error: false,
      texto: res.aceptado
        ? `Listo: con tu confirmación se corrigió la marca de @${r.usuario}.`
        : `Gracias. Falta ${res.faltan === 1 ? '1 confirmación' : `${res.faltan} confirmaciones`} más.`,
    });
    await cargar();
  };

  return (
    <View style={[{ gap: 9, marginTop: 16 }, style]}>
      <SectionLabel>Reclamos de asistencia</SectionLabel>
      <Card style={{ gap: 12 }}>
        {reclamos.map((r) => (
          <View key={r.id} style={{ gap: 8 }}>
            <Text style={styles.title}>
              {r.es_mio ? 'Tu reclamo' : `@${r.usuario} dice que sí estuvo a tiempo`}
            </Text>
            <Text style={styles.meta}>
              {textoEstadoReclamo(r)}
              {r.ya_confirme ? ' Ya lo confirmaste.' : ''}
            </Text>
            {r.puedo_confirmar ? (
              <PrimaryButton
                label="Sí, estuvo a tiempo"
                onPress={() => confirmar(r)}
                loading={enviando === r.id}
                height={42}
              />
            ) : null}
          </View>
        ))}
        {aviso ? (
          <Text style={[styles.meta, { color: aviso.error ? C.red : C.green }]}>{aviso.texto}</Text>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 13.5, fontFamily: F.bold, color: C.textPrimary },
  meta: { fontSize: 12, lineHeight: 17, color: C.textSecondary },
});
