import React, { useEffect, useState } from 'react';

import { useAuth } from '../contexts/AuthContext';
import { estadoDeMiAceptacion } from '../services/aceptacionLegal';
import TerminosActualizadosScreen from '../screens/TerminosActualizadosScreen';

/**
 * Antes de entrar a la app, quien no aceptó la versión vigente de los
 * términos y la política (`VERSION_LEGAL`) tiene que aceptarla.
 *
 * POR QUÉ EXISTE (2026-11-19). La aceptación se pedía sólo una vez, en el
 * registro. Cuando los textos cambiaron de fondo el 2026-11-18 (la empresa
 * responsable y la edad mínima de 14), quienes ya tenían cuenta seguían
 * usando la app bajo un texto que nunca aceptaron. Y las cuentas creadas
 * antes de la migración 181 no tenían ninguna aceptación guardada: el día
 * que se escribió esto eran 28 de 29.
 *
 * Va sólo sobre `Main` porque es la puerta de entrada: Splash, Login y el
 * registro terminan ahí. Un enlace profundo a otra pantalla no pasa por acá,
 * pero la próxima vez que se abra la app sí.
 *
 * MIENTRAS SE PREGUNTA, LA APP SE MUESTRA. Esperar a la red para pintar
 * Inicio retrasaría la entrada de todos para pillar a unos pocos; si la
 * respuesta es «pendiente», las pestañas se cambian por la pantalla de
 * aceptación. Si no se pudo leer, no se bloquea a nadie: se pregunta de
 * nuevo la próxima vez que se monte.
 */
const alDiaEnEstaSesion = new Set();

export default function withTerminosVigentes(Pantalla) {
  function ConTerminosVigentes(props) {
    const { user } = useAuth();
    const uid = user?.id ?? null;
    const [pendiente, setPendiente] = useState(false);

    useEffect(() => {
      if (!uid || alDiaEnEstaSesion.has(uid)) return undefined;
      let vivo = true;
      estadoDeMiAceptacion().then((estado) => {
        if (!vivo) return;
        if (estado === 'al-dia') alDiaEnEstaSesion.add(uid);
        setPendiente(estado === 'pendiente');
      });
      return () => {
        vivo = false;
      };
    }, [uid]);

    if (pendiente) {
      return (
        <TerminosActualizadosScreen
          navigation={props.navigation}
          onAceptado={() => {
            if (uid) alDiaEnEstaSesion.add(uid);
            setPendiente(false);
          }}
        />
      );
    }
    return <Pantalla {...props} />;
  }

  ConTerminosVigentes.displayName = 'withTerminosVigentes';
  return ConTerminosVigentes;
}
