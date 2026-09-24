# TrueScore: cómo probarlo a mano

Guía para probar las cuatro fases en la app. La lógica ya está probada con las pruebas SQL de `supabase/tests/134…137` (64, 36, 27 y 14 casos): acá se prueba lo que ve la gente. Las reglas están en `docs/truescore-spec.md`, con las decisiones en su sección 8.

## Antes de empezar

- **Hay una sola base de datos: producción.** Todo lo que hagas lo ven los usuarios reales. Usa partidos y cuentas de prueba.
- **Activar la fase 1 deja a TODAS las cuentas en 75**, con su evento «inicio». No se puede deshacer de forma limpia: si después apagas el flag, el puntaje queda donde estaba y vuelven a regir las reglas viejas.
- **Varias cuentas a la vez:** cada origen del navegador guarda su propia sesión. `http://localhost:8081` y `http://127.0.0.1:8081` son dos; para una tercera o cuarta, usa una ventana privada o el teléfono.
- Todo se corre en el **editor SQL de Supabase**.

## Activar y apagar

```sql
select public.truescore_activar_fase1();   -- asistencia, racha, salidas, cancelación, expulsión, colores
select public.truescore_activar_fase2();   -- reincidencia, reclamos, prioridad en la cola, bono del organizador
select public.truescore_activar_fase3();   -- fair play
select public.truescore_activar_fase4();   -- inactividad (job mensual)

select nombre, activo, activado_at from feature_flags order by nombre;

-- Apagar una fase (vuelven las reglas anteriores para esa parte):
update feature_flags set activo = false where nombre = 'truescore_fase2';
```

Las fases 2, 3 y 4 exigen la fase 1. Recomiendo activarlas de a una y probar cada una antes de la siguiente.

## Consultas útiles

```sql
-- El registro de una cuenta, en orden (reemplaza el username).
select e.id, e.tipo, e.puntos_aplicados, e.puntaje_despues, e.racha_despues, e.motivo, e.created_at
  from truescore_eventos e join profiles p on p.id = e.user_id
 where p.username = 'usuario_de_prueba' order by e.id;

-- ¿El puntaje guardado coincide con rehacer el registro desde cero?
select p.username, public.truescore_recalcular(p.id) from profiles p where p.username = 'usuario_de_prueba';

-- Correr los jobs sin esperar los 15 minutos.
select public.truescore_cerrar_sin_confirmar();   -- partidos sin confirmar a las 24 h
select public.truescore_cerrar_reclamos_vencidos();
select public.fairplay_cerrar_partidos();         -- cierre del fair play a las 48 h
select public.truescore_inactividad();            -- mensual
```

**Para no esperar horas**, se puede correr la hora de un partido de prueba hacia atrás desde el editor SQL (el editor no pasa por la guarda que protege a `matches` de la app):

```sql
update matches set hora = hora - interval '25 hours' where id = '<id del partido de prueba>';
```

## Fase 1

| Qué probar | Cómo | Qué tiene que pasar |
| --- | --- | --- |
| Colores | Abre Gestionar partido con solicitudes, cola y nómina | Cada jugador con su TrueScore y color: verde (75+), amarillo (50–74), rojo (<50) |
| Salirse | Con un jugador, abre «Salir del partido» a ~5 h del inicio | La hoja dice «−13 pts» antes de confirmar; el historial muestra −13 |
| Salida con 48 h o más | Salirse con 2 días de aviso | −1 y la racha no se pierde |
| Asistencia | Al terminar el partido, el organizador marca Asistió / Llegó tarde / No fue a todos y confirma | +6 (o según racha), −8, −35. No deja confirmar a medias; la segunda vez dice que ya estaba confirmada |
| Plazo de 24 h | No confirmes; corre la hora 25 h atrás y ejecuta `truescore_cerrar_sin_confirmar()` | Jugadores sin cambios (evento neutro); organizador −10 y un aviso |
| Cancelar | Cancelar con «Lluvia», con «Otro motivo» a más de 12 h, y a ~5 h | 0, 0 y −15. Los jugadores quedan sin cambios |
| Expulsar | En Confirmados, el ícono de sacar a un jugador | Sale sin perder puntos; si intenta volver: «El organizador te sacó de este partido» |
| GPS | Confirmar llegada por GPS | «Llegada confirmada», sin puntos |
| Historial | Perfil → Ver historial | «Inicio de TrueScore 75» y cada evento con su motivo |
| Teléfono | Ajustes → Verificar teléfono | Sin proveedor de SMS: «La verificación por SMS todavía no está disponible» |

## Fase 2

| Qué probar | Cómo | Qué tiene que pasar |
| --- | --- | --- |
| Reincidencia | Marca «No fue» al mismo jugador en dos partidos | −35 y después −53 (sólo cuentan los eventos desde que se activó la fase 2) |
| Tardanzas | Tres «Llegó tarde» en pocos partidos | −8, −8 y la tercera −15 |
| Reclamo | Organizador marca a B «No fue» y a C y D «Asistió». B toca «Reclamar» en su historial; C y D confirman en el detalle del partido | Con la segunda confirmación, B recupera el puntaje (y la racha); el organizador −20 |
| Reclamo sin compañeros | Si sólo 1 compañero asistió | No deja reclamar y dice por qué |
| Bono | Confirmar la asistencia antes de 12 h desde el fin | El aviso dice «Ganaste +5»; entre 12 y 24 h, +2 |
| Prioridad en la cola | Partido lleno; a la cola entra primero alguien con 75 y después alguien con 90+ | El de 90+ aparece primero con «Prioridad» y recibe el turno al liberarse un cupo |

## Fase 3

| Qué probar | Cómo | Qué tiene que pasar |
| --- | --- | --- |
| Reportar | En «Calificar jugadores», «Reportar a este jugador», elegir motivo, enviar | «Reporte enviado»; no deja reportar dos veces a la misma persona en ese partido |
| Agresión | Reportar con «Agresión física» | El organizador recibe aviso; en Gestionar partido → Confirmados, «La vi» baja 40 el fair play del jugador |
| Cierre a las 48 h | Corre la hora 49 h atrás y ejecuta `fairplay_cerrar_partidos()` | +1 a quien jugó sin reportes válidos; −15 con 3 o más; nada con 1 o 2 |
| Reporte que no cuenta | Que reporte alguien con TrueScore bajo 75 | No suma al conteo |
| Perfil | Tarjeta de reputación | «Fair play N / 100» |
| Revisión | `select * from fairplay_revisiones where estado = 'pendiente';` y `select public.fairplay_resolver_revision(<id>, 'nota');` | La cuenta deja de estar marcada |

## Fase 4

Seis meses no se pueden esperar en la app; la regla está probada en `supabase/tests/137_truescore_fase4_inactividad_test.sql`. Lo que sí se puede comprobar: que el job no mueve a nadie que haya jugado hace poco.

```sql
select public.truescore_inactividad();   -- con todos recién activados, debe devolver 0
```
