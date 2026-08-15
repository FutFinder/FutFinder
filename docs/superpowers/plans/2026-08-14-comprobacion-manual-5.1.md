# Comprobación manual — Tarea 5.1 (cancelación y sanción)

Estado: **migración 47 aplicada en producción el 2026-08-14**, arnés SQL 25/25
contra el esquema aplicado, `send-push` en versión 7. Falta lo único que una
prueba SQL no puede ver: las dos sesiones reales.

La Tarea 5.1 **no se cierra** hasta terminar esta comprobación.

---

## Regla de oro: qué NO se puede tocar

Estas dos cosas siguen haciendo falta para las unidades siguientes:

- **El partido `c0e0b5fd-6eb7-4f8e-8503-f5b8eedd5dac`** (chatgpt vs chatgpt2).
  No se cancela ni se edita.
- **Los clubes `chatgpt` y `chatgpt2`.** No pueden quedar sancionados: una
  sanción los deja 14 días sin poder crear ni aceptar desafíos.

Por eso toda la comprobación corre sobre **clubes desechables** creados para
esto. Ninguna de las dos pruebas toca el partido ni los clubes reales.

Además, `chatgpt` y `chatgpt2` ya tienen un desafío ACTIVO entre ellos (el de
ese partido), y `club_challenges_unique_activo` impide un segundo desafío
activo entre el mismo par. Aunque quisieras, no podrías montar la prueba con
ellos sin cerrar el que hay.

### Las cuentas

| Cuenta | `username` | Club real | Clubes usados hoy |
|---|---|---|---|
| A | `chatgptpruebas5415` | chatgpt | 1 de 3 |
| B | `chatgptpruebas54152` | chatgpt2 | 1 de 3 |

El tope es de **3 clubes por persona**, así que A puede entrar a 2 más y B a 2
más. El montaje de abajo usa exactamente ese margen.

---

## Montaje (una sola vez, todo desde la app)

1. **Cuenta A** crea el club `P51-A`.
2. **Cuenta B** crea los clubes `P51-B` y `P51-C`.

Quien crea un club queda como administrador, así que no hace falta invitar a
nadie. Quedan: A en `chatgpt` + `P51-A`; B en `chatgpt2` + `P51-B` + `P51-C`.

3. **Encuentro 1** — `P51-A` vs `P51-B`, para **dentro de 2 días**:
   A desafía a `P51-B` → B acepta → A crea la propuesta oficial con fecha a 2
   días → B la aprueba. Al proponer y al aprobar, **digan que sí a la reserva
   de cupo**: así los dos administradores quedan inscritos y se puede
   comprobar el aviso que reciben los jugadores.
   Este encuentro se deja **vivo**: es el que demuestra la decisión C3.

4. **Encuentro 2** — `P51-A` vs `P51-C`, para **dentro de ~90 minutos**:
   mismo circuito (A desafía → B acepta desde `P51-C` → A propone con la hora
   a 90 min → B aprueba). Publicar un partido a 90 minutos está permitido: el
   servidor sólo exige que la hora sea futura.

> El cambio de hora **no** sirve para acercar un partido a menos de 2 horas:
> `cambio_partido_revisa_campos` exige que la hora propuesta esté al menos 2
> horas más adelante. Por eso el Encuentro 2 nace ya con la hora encima.

---

## Prueba B — cancelar DENTRO de las 2 horas (sí sanciona)

Se hace primero, porque deja a `P51-A` sancionado con el Encuentro 1 todavía
publicado, que es justo lo que hay que mirar.

**Cuenta A**, en el hilo del Encuentro 2:

1. La barra **«Cancelar encuentro»** tiene que estar **arriba del todo**, justo
   bajo la cabecera del chat, no en el menú de tres puntos.
2. Como faltan menos de 2 horas, junto al texto debe verse la etiqueta
   **«SANCIONA»** *antes de tocar nada*.
3. Al abrirla aparece el aviso en ámbar: **«Cancelar ahora sanciona a tu club»**,
   diciendo 14 días y que **los partidos ya publicados siguen en pie**.
4. **Deja el motivo vacío**: el botón de confirmar tiene que quedar apagado y
   debajo debe leerse que el motivo es obligatorio. Prueba también con tres
   espacios: mismo resultado.
5. Escribe un motivo real («no llegamos con el equipo») y confirma. El botón
   dice **«Cancelar y asumir la sanción»**.

### Qué comprobar en la sesión A (la que canceló)

- [ ] El partido queda **cancelado**, no desaparece: sigue en el historial con
      su motivo.
- [ ] En el chat aparece el evento **«P51-A (@chatgptpruebas5415) canceló el
      encuentro: «no llegamos con el equipo».»**
- [ ] Aparece un segundo evento: **«P51-A quedó sancionado 14 días y no podrá
      crear ni aceptar desafíos nuevos. Hasta el <fecha>.»**
- [ ] En **Avisos** llega **«Tu club quedó sancionado»** (etiqueta roja «CLUB
      SANCIONADO»), y al tocarlo abre el **club**, no el hilo.
- [ ] **No** llega aviso de cancelación a quien canceló: ya sabe lo que hizo.

### Qué comprobar en la sesión B (el club rival, `P51-C`)

- [ ] En **Avisos** llega **«Se canceló el encuentro»** (etiqueta roja
      «ENCUENTRO CANCELADO») con el motivo en el cuerpo y atajo **«VER MOTIVO»**
      que lleva al hilo.
- [ ] En el hilo se ve el evento de cancelación **sin recargar** (el sondeo es
      de 15 segundos).
- [ ] **NO** llega ningún aviso de sanción: la sanción es asunto del club
      sancionado, no del rival.
- [ ] `P51-C` **no** queda sancionado: puede seguir creando desafíos.

### Qué comprobar en las restricciones de `P51-A`

- [ ] Desde A, intentar **desafiar** a otro club con `P51-A`: tiene que
      rechazarlo diciendo hasta qué fecha dura la sanción.
- [ ] Que B mande un desafío **a** `P51-A`: también debe rechazarse.
- [ ] En un hilo de desafío de `P51-A`, la barra inferior debe decir **«Club
      sancionado»** en vez de ofrecer la acción de turno.
- [ ] **C3 — lo más importante:** el **Encuentro 1 sigue publicado y abierto**,
      con su nómina intacta. La sanción bloquea lo nuevo, no arrastra lo ya
      acordado.

### Trust Score

- [ ] El Trust Score de A y de B **no cambia** ni un punto (Perfil → Trust
      Score, antes y después). Es la diferencia con cancelar un partido normal.

---

## Prueba A — cancelar con MÁS de 2 horas (no sanciona)

Se hace sobre el **Encuentro 1**, y la cancela **la cuenta B desde `P51-B`**.
Así el club que cancela llega sin ninguna sanción encima y se ve limpio que
cancelar con aviso no deja nada.

**Cuenta B**, en el hilo del Encuentro 1 (faltan 2 días):

1. La barra de arriba dice **«Cancelar encuentro»** **sin** la etiqueta
   «SANCIONA».
2. Al abrirla, el aviso es neutro: **«Se cancelará para los dos clubes»**, y
   dice que **no hay sanción**.
3. El motivo sigue siendo obligatorio (compruébalo otra vez con el campo
   vacío).
4. Confirma con un motivo («se nos inundó la cancha»). El botón dice
   **«Confirmar cancelación»**, no «asumir la sanción».

### Qué comprobar

- [ ] **`P51-B` no queda sancionado.** Puede crear y aceptar desafíos
      inmediatamente después.
- [ ] En el chat aparece **sólo** el evento de cancelación: **no** hay evento de
      sanción.
- [ ] En **Avisos** de A llega «Se canceló el encuentro» con el motivo; en las
      dos cuentas, quien canceló no recibe aviso.
- [ ] Los administradores inscritos reciben además el aviso de partido
      cancelado.
- [ ] El partido queda cancelado conservando su chat y su nómina.
- [ ] Trust Score sin cambios en ninguna de las dos cuentas.

---

## Volver atrás sin esperar 14 días

**Lo normal es no necesitarlo**: los clubes `P51-*` son desechables. Si
molestan, bórralos desde la app (eliminar el club borra en cascada su sanción).

Si por lo que sea **un club que importa quedara sancionado**, la sanción se
retira desde Supabase → SQL Editor, que corre con `service_role`. No se borra
la fila: se marca `retirada`, que es exactamente lo que hará la revisión de la
Tarea 5.2, y el club se desbloquea en el acto.

```sql
-- Ver qué sanciones hay y a quién bloquean (sólo lectura)
select s.id, c.nombre as club, s.estado, s.motivo, s.inicio_at, s.fin_at
  from public.club_sanctions s
  join public.clubs c on c.id = s.club_id
 order by s.created_at desc;

-- Retirar UNA sanción concreta (reemplaza el id)
update public.club_sanctions
   set estado = 'retirada'
 where id = '<id-de-la-sancion>';
```

Comprobado en el arnés (caso 25): con `estado = 'retirada'` el club vuelve a
operar de inmediato y el historial queda registrado.

Para dejar el terreno como estaba, con los clubes de prueba ya borrados:

```sql
select count(*) as sanciones_vivas
  from public.club_sanctions
 where estado in ('vigente','provisional') and fin_at > now();

select estado, motivo_cancelacion
  from public.matches
 where id = 'c0e0b5fd-6eb7-4f8e-8503-f5b8eedd5dac';   -- debe seguir 'abierto' y sin motivo
```

---

## Lo que hay que mirar con lupa

U3 y U4.4 enseñaron que el arnés SQL puede estar en verde mientras la pantalla
miente. Dos sospechas concretas de esta unidad:

1. **La cabecera del ciclo puede quedarse vieja.** El sondeo de 15 segundos
   recarga la bitácora y el partido, pero **no** vuelve a leer la fila del
   desafío. La barra de cancelación sí debería pasar a «Este encuentro ya está
   cancelado» sola, porque mira el estado del PARTIDO; la barra de abajo, en
   cambio, podría seguir mostrando la acción de un desafío «publicado» hasta
   reabrir el hilo. **Si pasa, es un fallo y hay que anotarlo**, no darlo por
   normal.
2. **La sanción no entra en el sondeo.** Se lee al abrir el hilo y después de
   cancelar. Si otro administrador del mismo club sanciona mientras tienes el
   hilo abierto, la barra puede tardar en enterarse hasta reabrir. Es una
   decisión tomada (no pagar una consulta cada 15 s en todas las sesiones),
   pero conviene confirmar que al reabrir aparece.

Todo lo comprobado hasta ahora es **web**. El render nativo en un dispositivo
físico sigue sin evidencia, igual que en U3 y U4.4.

---

## Al terminar

Si pasa entera, se actualiza `docs/memoria/funcionalidades/clubes.md` para
cerrar la Tarea 5.1 con la fecha y lo verificado, y recién ahí se pasa a la
Tarea 5.2 (incomparecencia y revisión de sanciones).

---

# Resultado de la primera pasada (2026-08-14)

**Pasó todo lo de fondo.** La cancelación dentro de 2 horas sancionó a `P51-A`
14 días; `P51-A` no puede enviar ni recibir desafíos; su partido publicado
anterior siguió activo (decisión C3); los avisos llegaron a las cuentas
correctas; el Trust Score de las dos cuentas quedó en 100. La cancelación con
anticipación desde `P51-B` avisó de que no habría sanción, no dejó sanción ni
evento, y conservó el motivo correcto en el evento del chat y en el detalle del
partido, con la nómina disponible.

**Y encontró un fallo de interfaz**, ya corregido. En el hilo de
`P51-A vs P51-B` —cancelado CON anticipación— la barra sobre el compositor
mostraba:

> Club sancionado — «Canceló el encuentro con menos de 2 horas de aviso:
> Prueba manual P51: cancha no disponible»

Ese texto es el motivo de la sanción que `P51-A` se llevó por el OTRO encuentro
(`P51-A vs P51-C`). El motivo real de éste era «Prueba manual P51: cancelación
con anticipación», y el servidor lo tenía bien: el detalle del partido lo
mostraba correcto.

La causa era el orden en `getChallengeCta`, que preguntaba por la sanción del
club antes de mirar si el desafío ya estaba cerrado. Ahora **el estado cerrado
manda**: en un desafío cerrado no hay ninguna acción que la sanción pueda
impedir, así que se muestra su propio estado. Y donde la sanción sí bloquea
algo, su motivo ya no va suelto: lleva delante «Tu club está sancionado:».

---

# Comprobación corta para cerrar 5.1

Sólo esto. **No hace falta volver a cancelar nada ni crear clubes nuevos**: se
usan los mismos `P51-*` y sus datos, que se conservaron a propósito.

Antes de empezar, recarga la web para tomar el cliente nuevo (Cmd+Shift+R).

### 1. El hilo del encuentro cancelado con anticipación

Con la **cuenta A** (`chatgptpruebas5415`), que es la del club sancionado —es
la única sesión donde el fallo se veía—, abre el hilo de `P51-A vs P51-B`
(partido `e50c7303-82fe-41b5-aa3a-88cd94e2a76d`).

- [ ] La barra **sobre el compositor** ya **no** dice «Club sancionado» ni
      repite «Canceló el encuentro con menos de 2 horas de aviso…». Ahora debe
      mostrar el estado del desafío: **«Cancelado»**.
- [ ] En el chat, el evento sigue diciendo el motivo correcto de ESTE
      encuentro: **«…canceló el encuentro: «Prueba manual P51: cancelación con
      anticipación».»**
- [ ] En ningún punto de ese hilo aparece la frase «cancha no disponible», que
      es de la sanción del otro encuentro.
- [ ] La barra de **arriba** puede seguir informando que el club está
      sancionado y hasta cuándo. Eso es correcto y no es lo que se arregló: va
      redactado como restricción del club («Tu club no puede crear ni aceptar
      desafíos hasta el…»), no como el motivo del encuentro.

### 2. Que la sanción siga anunciándose donde sí importa

- [ ] Con la cuenta A, abre un hilo de un desafío de `P51-A` que **no** esté
      cerrado, o intenta enviar un desafío nuevo con `P51-A`. Tiene que seguir
      diciendo que el club está sancionado — el arreglo no apagó el aviso, sólo
      lo sacó de donde no correspondía.

### 3. El otro hilo, de control

- [ ] Abre el hilo de `P51-A vs P51-C` (el que sí se canceló dentro de las 2
      horas). Su evento de cancelación debe seguir diciendo «cancha no
      disponible», que ahí sí es el motivo correcto, y su evento de sanción
      debe seguir estando.

Si los tres puntos pasan, **la Tarea 5.1 queda cerrada** y se anota la fecha en
`docs/memoria/funcionalidades/clubes.md`.
