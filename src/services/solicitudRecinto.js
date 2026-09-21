import { supabase, isSupabaseConfigured } from './supabase';
import { comoSolicitud } from '../utils/solicitudRecinto';

/**
 * «Quiero sumar mi recinto» (migración 80).
 *
 * DOS CAMINOS Y NINGUNO PIERDE LA SOLICITUD. El normal es la Edge Function
 * `solicitud-recinto`, que la guarda y además avisa al equipo por correo. Si
 * esa llamada falla —la función caída, la red a medias— se llama la RPC
 * directo: la solicitud queda igual de guardada y lo único que se pierde es el
 * aviso inmediato, que el equipo recupera leyendo la tabla.
 *
 * ESO ES SEGURO PORQUE LOS DOS CAMINOS SON EL MISMO. La función no hace otra
 * cosa que llamar a `crear_solicitud_recinto` con el token de quien manda el
 * formulario; llamarla desde acá no se salta ninguna comprobación. Y mandarla
 * dos veces no crea dos filas: la RPC devuelve la solicitud pendiente que ya
 * existía.
 *
 * DOS PUERTAS, Y LA DIFERENCIA ES UN `id` (migración 120). Sin `id` se crea
 * una solicitud; con `id` se CORRIGE una que ya existe. No es un detalle de
 * implementación: `crear_solicitud_recinto` dedupea por nombre de recinto y
 * devuelve la vieja SIN pisar nada, así que mandar una corrección por esa
 * puerta la perdería en silencio. Quién es dueño de esa solicitud lo decide
 * la base con el token, nunca esto.
 *
 * NO HAY MODO DEMO. Sin Supabase configurado esto no finge que se mandó: una
 * solicitud que nadie recibió es peor que un error.
 *
 * LAS FOTOS NO PASAN POR ACÁ. Se suben al elegirlas (`uploadFotoSolicitud`) y
 * lo que viaja en el formulario son sus RUTAS. Así el envío no queda esperando
 * seis subidas, y una foto que falla se reintenta sola sin volver a llenar
 * nada — ver la migración 110 para por qué se guarda la ruta y no una URL.
 */

const SIN_CONFIG = { data: null, error: { message: 'Sin conexión a la base' } };
const INCOMPLETA = { data: null, error: { message: 'Faltan datos del formulario.' } };

/**
 * Manda la solicitud. Devuelve `{ id, reusada, corregida, avisada }`.
 *
 * `corregir` es el id de una solicitud propia todavía sin atender: si viene,
 * esto CORRIGE esa solicitud en vez de crear una nueva.
 *
 * `avisada` dice si el correo al equipo llegó a salir. La pantalla NO lo usa
 * para decidir si hubo éxito —la solicitud está guardada de todas formas— sino
 * como dato del estado real.
 */
export async function enviarSolicitudRecinto(form, corregir = null) {
  if (!isSupabaseConfigured) return SIN_CONFIG;

  const payload = comoSolicitud(form);
  if (!payload) return INCOMPLETA;
  const cuerpo = corregir ? { ...payload, id: corregir } : payload;

  try {
    const { data, error } = await supabase.functions.invoke('solicitud-recinto', { body: cuerpo });
    if (error) throw error;
    if (!data?.ok) {
      return { data: null, error: { message: data?.reason || 'No pudimos mandar tu solicitud.' } };
    }
    return {
      data: {
        id: data.id,
        reusada: !!data.reusada,
        corregida: !!data.corregida,
        avisada: !!data.avisada,
      },
      error: null,
    };
  } catch (e) {
    // No se devuelve el error todavía: queda el camino directo a la base.
    console.error('[FutFinder] enviarSolicitudRecinto (función):', e);
  }

  const { data, error } = await supabase.rpc(
    corregir ? 'actualizar_solicitud_recinto' : 'crear_solicitud_recinto',
    {
      ...(corregir ? { p_id: corregir } : {}),
      p_nombre_recinto: payload.nombreRecinto,
      p_direccion: payload.direccion,
      p_comuna: payload.comuna,
      p_nombre_dueno: payload.nombreDueno,
      p_telefono: payload.telefono,
      p_correo: payload.correo,
      p_mensaje: payload.mensaje,
      p_n_canchas: payload.nCanchas,
      p_fotos: payload.fotos,
      p_servicios: payload.servicios,
    },
  );

  if (error) {
    console.error('[FutFinder] enviarSolicitudRecinto (rpc):', error);
    // La RPC está concedida solo a `authenticated`: sin sesión el error es un
    // 42501, y «inténtalo de nuevo» mandaría a reintentar algo que no va a
    // cambiar hasta que la persona entre a su cuenta.
    const message = error.code === '42501'
      ? 'Inicia sesión para mandarnos tu recinto.'
      : 'No pudimos mandar tu solicitud. Inténtalo de nuevo.';
    return { data: null, error: { message } };
  }
  if (!data?.ok) {
    return { data: null, error: { message: data?.reason || 'Revisa los datos del formulario.' } };
  }
  return {
    data: {
      id: data.id,
      reusada: !!data.reusada,
      corregida: !!data.corregida,
      avisada: false,
    },
    error: null,
  };
}

/**
 * La solicitud sin atender de quien mira, si tiene una.
 *
 * Lectura directa y no RPC: `solicitudes_recinto_select_propias` ya filtra por
 * `auth.uid()`, así que no hay nada que autorizar acá. Existe para que la
 * tarjeta de Reservas diga «ya nos escribiste» en vez de invitar otra vez a
 * alguien que ya está esperando respuesta.
 */
export async function miSolicitudPendiente() {
  if (!isSupabaseConfigured) return { data: null, error: null };
  const { data, error } = await supabase
    .from('solicitudes_recinto')
    // Se traen todos los campos, no sólo el nombre: con ellos se precarga la
    // pantalla de corrección. Es la misma fila que la RLS ya deja ver (la
    // policy filtra por `auth.uid()`), así que no se abre nada nuevo.
    .select('id, nombre_recinto, direccion, comuna, nombre_dueno, telefono, correo, '
      + 'mensaje, n_canchas, fotos, servicios, created_at')
    .eq('estado', 'nueva')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('[FutFinder] miSolicitudPendiente:', error);
    return { data: null, error: null }; // No saber no es un error que mostrar.
  }
  return { data: data?.[0] || null, error: null };
}
