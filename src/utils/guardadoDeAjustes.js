/**
 * Guardar un ajuste de Ajustes (interruptor o selector) con cambio optimista
 * y rollback, sin que dos toques rápidos se pisen (A02).
 *
 * EL FALLO. `toggleField` aplicaba el valor, esperaba al servidor y, si
 * fallaba, volvía a `!value`. Con dos toques seguidos las respuestas podían
 * llegar al revés: la primera fallaba DESPUÉS de que la segunda saliera bien,
 * y su rollback dejaba en pantalla un valor que ya no era el de la base. Y
 * `!value` sólo sirve para booleanos: el selector de solicitudes de amistad
 * (`'everyone'` / `'nobody'`) quedaba en `false`.
 *
 * AHORA. Cada campo lleva su turno: sólo la última petición de ese campo
 * puede deshacer, y deshace al valor que había justo antes de ella, sea cual
 * sea su tipo. Una respuesta vieja no cambia nada ni avisa de un error.
 *
 * Sin React ni Supabase, para probarse con `node --test`.
 */
export function crearGuardadoDeAjustes({ leer, escribir, guardar }) {
  const turnos = new Map();

  return {
    async cambiar(campo, valor) {
      const turno = (turnos.get(campo) || 0) + 1;
      turnos.set(campo, turno);
      const anterior = leer(campo);
      escribir(campo, valor);

      let error = null;
      try {
        ({ error } = (await guardar(campo, valor)) || {});
      } catch (e) {
        error = e || { message: 'No se pudo guardar' };
      }

      if (turnos.get(campo) !== turno) return { error: null, vieja: true };
      if (error) {
        escribir(campo, anterior);
        return { error };
      }
      return { error: null };
    },
  };
}
