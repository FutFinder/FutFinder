import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Pago con tarjeta de una reserva.
 *
 * TRES PIEZAS Y UNA SOLA QUE SABE DE FLOW. La base (migración 78) maneja
 * órdenes, montos y estados sin nombrar a ningún proveedor; la Edge Function
 * `pagar-reserva` es la única que tiene credenciales y la única que habla con
 * Flow; esto de acá solo las junta. Cambiar de proveedor no toca este archivo.
 *
 * LA APP NUNCA DECIDE SI UN PAGO SALIÓ. Lo único que hace después de mandar a
 * alguien a pagar es preguntar cómo quedó la fila en la base, que la escribe
 * el aviso firmado del proveedor. Un cliente que se cree a sí mismo que pagó
 * es exactamente la manera de regalar canchas.
 */

const SIN_CONFIG = { data: null, error: { message: 'Sin conexión a la base' } };

/**
 * ¿Hay pasarela conectada?
 *
 * Se pregunta ANTES de dejar apretar el botón, y no después, para no crear
 * una reserva que no se va a poder pagar. Mientras no exista la cuenta de
 * comercio esto devuelve `false` y la pantalla lo dice; el día que se carguen
 * las credenciales empieza a devolver `true` sin tocar una línea de la app.
 */
export async function estadoPasarela() {
  if (!isSupabaseConfigured) return { data: { configurada: false }, error: null };
  try {
    const { data, error } = await supabase.functions.invoke('pagar-reserva', {
      method: 'GET',
    });
    if (error) throw error;
    return { data: { configurada: !!data?.configurada, ambiente: data?.ambiente || null }, error: null };
  } catch (e) {
    // Que la consulta falle NO es «no hay pasarela»: puede ser la red. Se
    // devuelve el error y la pantalla deja el botón quieto en vez de afirmar
    // algo que no sabe.
    console.error('[FutFinder] estadoPasarela:', e);
    return { data: null, error: { message: 'No pudimos comprobar el medio de pago.' } };
  }
}

/**
 * Arma el cobro y devuelve la URL del proveedor.
 *
 * No abre nada: quién abre la ventana es la pantalla, porque en web y en
 * nativo se hace distinto.
 */
export async function iniciarPagoReserva(reservaId) {
  if (!isSupabaseConfigured) return SIN_CONFIG;
  if (!reservaId) return { data: null, error: { message: 'Falta la reserva' } };
  try {
    const { data, error } = await supabase.functions.invoke('pagar-reserva', {
      body: { reservaId },
    });
    if (error) throw error;
    if (!data?.ok) {
      return {
        data: { configurada: data?.configurada !== false },
        error: { message: data?.reason || 'No se pudo iniciar el pago.' },
      };
    }
    return { data, error: null };
  } catch (e) {
    console.error('[FutFinder] iniciarPagoReserva:', e);
    return { data: null, error: { message: 'No se pudo iniciar el pago. No se te cobró nada.' } };
  }
}

/**
 * Cómo quedó: el último pago de la reserva y el estado de la reserva.
 *
 * Lectura directa y no RPC: `pagos_select` deja ver los propios y
 * `reservas_select` la reserva de quien organiza, así que la RLS ya hace el
 * filtro exacto. Se piden las dos en paralelo porque se leen juntas — un pago
 * `pagado` sin la reserva no dice nada (ver `faseDePago`).
 */
export async function estadoDePago(reservaId) {
  if (!isSupabaseConfigured) return SIN_CONFIG;
  if (!reservaId) return { data: null, error: { message: 'Falta la reserva' } };

  const [{ data: pagos, error: e1 }, { data: reserva, error: e2 }] = await Promise.all([
    supabase
      .from('pagos')
      .select('id, estado, monto, orden_comercio, pagado_at')
      .eq('reserva_id', reservaId)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('reservas')
      .select('id, estado, precio_total, fecha, hora_inicio')
      .eq('id', reservaId)
      .maybeSingle(),
  ]);

  if (e1 || e2) {
    console.error('[FutFinder] estadoDePago:', e1 || e2);
    return { data: null, error: { message: (e1 || e2).message || 'No se pudo consultar el pago.' } };
  }
  return { data: { pago: pagos?.[0] || null, reserva: reserva || null }, error: null };
}
