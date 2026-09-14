-- =============================================================
-- FutFinder migration 88: search_path fijo en los ayudantes
-- =============================================================
-- DIECINUEVE FUNCIONES NO TENÍAN `search_path` FIJO. Lo levantó el
-- linter de Supabase y conviene decir con precisión qué tan grave es,
-- porque la primera lectura fue peor que la realidad: **ninguna de las
-- diecinueve es `security definer`**. Sin eso no hay escalada de
-- privilegios — corren con los permisos de quien las llama, no con los
-- del dueño de la función.
--
-- Entonces, ¿por qué tocarlas? Porque varias las llaman funciones que SÍ
-- son `security definer` (`crear_reserva` llama a `precio_de_bloque`,
-- `calcular_comision` y `normaliza_telefono_cl`; `cancelar_reserva` llama
-- a `inicio_de_reserva`). Dentro de esa llamada manda el `search_path`
-- de la que define, así que hoy están cubiertas **por dónde se las llama
-- y no por lo que son**. Eso es una garantía prestada: el día que alguna
-- se llame desde otro lado, deja de valer.
--
-- QUÉ NO CAMBIA: el cuerpo. `alter function ... set search_path` no
-- recompila ni reescribe nada, solo fija el entorno con el que corre. Por
-- eso esta migración no copia ni una línea de lógica — copiar diecinueve
-- cuerpos para cambiarles el entorno habría sido diecinueve
-- oportunidades de introducir un error donde no había ninguno.
--
-- SE COMPROBÓ ANTES QUE NINGUNA USE ALGO FUERA DE `public`: ni `unaccent`,
-- ni `pgcrypto`, ni `earthdistance`. Fijar el camino a `public` en una
-- función que dependiera de una extensión la habría roto — es la única
-- forma en que este cambio podía hacer daño.
--
-- Cinco de las diecinueve son de otros verticales (chat, partidos,
-- clubes). Van igual: el arreglo es el mismo y dejar la mitad hecha
-- garantiza que el linter siga avisando y nadie lo mire.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── Reservas ─────────────────────────────────────────────────────
alter function public.inicio_de_reserva(date, time) set search_path = public;
alter function public.fin_de_reserva(date, time, time) set search_path = public;
alter function public.precio_de_bloque(uuid, date, time) set search_path = public;
alter function public.calcular_comision(integer) set search_path = public;
alter function public.comision_params() set search_path = public;
alter function public.normaliza_telefono_cl(text) set search_path = public;
alter function public.motivo_reserva_omitida(text) set search_path = public;
alter function public.search_canchas(text, integer) set search_path = public;

-- ── Búsqueda y distancias ────────────────────────────────────────
alter function public.distancia_km(numeric, numeric, numeric, numeric) set search_path = public;
alter function public.haversine_meters(numeric, numeric, numeric, numeric) set search_path = public;
alter function public.aproximar_grado(numeric) set search_path = public;
alter function public.sin_tildes(text) set search_path = public;
alter function public.norm_text(text) set search_path = public;

-- ── Otros verticales ─────────────────────────────────────────────
alter function public.partido_reglas() set search_path = public;
alter function public.desafio_reglas() set search_path = public;
alter function public.es_impedimento_personal(text) set search_path = public;
alter function public.chat_validate_mention_all() set search_path = public;
alter function public.tg_auto_suspend() set search_path = public;
alter function public.tg_match_future_only() set search_path = public;
