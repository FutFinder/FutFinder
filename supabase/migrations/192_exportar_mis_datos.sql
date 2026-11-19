-- =============================================================
-- 192. EXPORTAR MIS DATOS, COMPLETO
--
-- «Exportar mis datos» (Ajustes) armaba el archivo en el cliente con perfil,
-- historial de partidos, amigos, clubes y términos aceptados. Faltaba casi
-- todo lo demás que es de la persona: teléfono, ubicación guardada, reservas,
-- pagos, movimientos de saldo, calificaciones que dio, reportes que hizo,
-- tickets de soporte, solicitudes de recinto, a quién bloqueó, el historial
-- de su puntaje y lo que escribió en el chat. Y varias de esas tablas el
-- cliente NO las puede leer enteras (`perfil_telefonos` no tiene políticas;
-- un DM con alguien que ya no es amigo deja de verse), así que un export
-- armado en el cliente nunca iba a estar completo.
--
-- La Ley 21.719 da derecho de acceso y portabilidad sobre los datos propios.
-- Esta función los junta en el servidor, SÓLO los de quien llama
-- (`auth.uid()`), y la app los agrega al archivo.
--
-- LO QUE NO TRAE, a propósito: lo que escribieron otras personas (mensajes
-- recibidos, calificaciones recibidas con su autor, reportes en contra) —son
-- datos de ellas— y los avisos del sistema. De los mensajes propios trae los
-- últimos 5.000, con el tipo de conversación y no el destinatario.
--
-- Pruebas: supabase/tests/192_exportar_mis_datos_test.sql
-- =============================================================

create or replace function public.exportar_mis_datos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Inicia sesión para exportar tus datos.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generado_por', 'exportar_mis_datos (migración 192)',
    'telefono', (
      select jsonb_build_object('telefono', t.telefono, 'verificado_at', t.verificado_at)
        from public.perfil_telefonos t where t.user_id = v_uid),
    'ubicacion_guardada', (
      select jsonb_build_object('latitud', u.latitud, 'longitud', u.longitud, 'actualizada_at', u.actualizada_at)
        from public.perfil_ubicaciones u where u.user_id = v_uid),
    'reservas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'fecha', r.fecha, 'hora_inicio', r.hora_inicio, 'hora_fin', r.hora_fin,
               'estado', r.estado, 'modalidad', r.modalidad, 'medio_pago', r.medio_pago,
               'precio_total', r.precio_total,
               'rol', case when r.organizador_id = v_uid then 'organizador' else 'participante' end)
             order by r.fecha desc, r.hora_inicio desc)
        from public.reservas r
       where r.organizador_id = v_uid
          or exists (select 1 from public.reserva_participantes p
                      where p.reserva_id = r.id and p.user_id = v_uid)), '[]'::jsonb),
    'pagos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'reserva_id', p.reserva_id, 'monto', p.monto, 'proveedor', p.proveedor,
               'orden_comercio', p.orden_comercio, 'estado', p.estado,
               'creado', p.created_at, 'pagado_at', p.pagado_at)
             order by p.created_at desc)
        from public.pagos p where p.user_id = v_uid), '[]'::jsonb),
    'movimientos_de_saldo', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tipo', b.tipo, 'monto', b.monto, 'reserva_id', b.reserva_id, 'fecha', b.created_at)
             order by b.created_at desc)
        from public.balance_movimientos b where b.user_id = v_uid), '[]'::jsonb),
    'calificaciones_que_diste', coalesce((
      select jsonb_agg(jsonb_build_object(
               'partido_id', g.match_id, 'puntualidad', g.puntualidad, 'fairplay', g.fairplay,
               'nivel', g.nivel, 'comentario', g.comentario, 'fecha', g.created_at)
             order by g.created_at desc)
        from public.ratings g where g.rater_id = v_uid), '[]'::jsonb),
    'calificaciones_de_recintos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'recinto_id', c.complejo_id, 'estrellas', c.estrellas, 'etiquetas', c.etiquetas,
               'comentario', c.comentario, 'fecha', c.created_at)
             order by c.created_at desc)
        from public.complejo_calificaciones c where c.user_id = v_uid), '[]'::jsonb),
    'reportes_que_hiciste', coalesce((
      select jsonb_agg(jsonb_build_object(
               'motivo', x.motivo, 'descripcion', x.descripcion, 'elemento', x.elemento,
               'estado', x.estado, 'fecha', x.created_at)
             order by x.created_at desc)
        from public.user_reports x where x.reporter_id = v_uid), '[]'::jsonb),
    'tickets_de_soporte', coalesce((
      select jsonb_agg(jsonb_build_object(
               'categoria', s.category, 'titulo', s.title, 'descripcion', s.description,
               'estado', s.estado, 'fecha', s.created_at)
             order by s.created_at desc)
        from public.support_tickets s where s.user_id = v_uid), '[]'::jsonb),
    'solicitudes_de_recinto', coalesce((
      select jsonb_agg(jsonb_build_object(
               'recinto', q.nombre_recinto, 'direccion', q.direccion, 'comuna', q.comuna,
               'nombre_dueno', q.nombre_dueno, 'telefono', q.telefono, 'correo', q.correo,
               'mensaje', q.mensaje, 'estado', q.estado, 'fecha', q.created_at)
             order by q.created_at desc)
        from public.solicitudes_recinto q where q.solicitante_id = v_uid), '[]'::jsonb),
    'cuentas_bloqueadas', coalesce((
      select jsonb_agg(jsonb_build_object('cuenta_id', k.blocked_id, 'fecha', k.created_at)
             order by k.created_at desc)
        from public.blocked_users k where k.blocker_id = v_uid), '[]'::jsonb),
    'historial_de_puntaje', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cambio', h.change_amount, 'motivo', h.reason, 'partido_id', h.match_id, 'fecha', h.created_at)
             order by h.created_at desc)
        from public.trust_score_history h where h.user_id = v_uid), '[]'::jsonb),
    'mensajes_que_escribiste', coalesce((
      select jsonb_agg(jsonb_build_object(
               'fecha', m.created_at,
               'conversacion', case
                 when m.receiver_id is not null then 'mensaje directo'
                 when m.match_id is not null then 'partido'
                 when m.club_id is not null then 'club'
                 when m.challenge_id is not null then 'desafío entre clubes'
                 else 'otra' end,
               'texto', m.content)
             order by m.created_at desc)
        from (select * from public.messages
               where sender_id = v_uid
               order by created_at desc
               limit 5000) m), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.exportar_mis_datos() from public, anon;
grant execute on function public.exportar_mis_datos() to authenticated;
