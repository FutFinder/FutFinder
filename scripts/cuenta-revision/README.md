# Cuenta para quien revisa la app

Apple (guía 2.1) y Google Play piden una cuenta con la que se pueda entrar y
ver la app funcionando. FutFinder no se usa sin sesión, así que sin esta
cuenta la revisión se rechaza.

`semilla.sql` **no crea la cuenta**: le pone contenido a una que ya existe.
Así la contraseña nunca pasa por el repositorio ni por una sesión de Claude.

## Pasos

1. **Después de la limpieza de producción** (`scripts/limpieza-prelanzamiento/`):
   la limpieza borra partidos, clubes y mensajes, y con ellos lo que deja
   esta semilla.
2. **Registrar la cuenta en www.futfinder.cl**, como cualquier persona: un
   correo que sea tuyo (te llega el código), una contraseña nueva que no uses
   en otro lado, una fecha de nacimiento de mayor de edad, aceptar los
   términos y terminar el onboarding (ubicación en Santiago). Sin
   verificación en dos pasos y sin cuenta de moderador.
3. **En `semilla.sql`, paso 0**, cambiar `CAMBIAR@ejemplo.cl` por ese correo.
4. **Ensayo**: `begin;` + el archivo + `rollback;` por el MCP de Supabase o el
   editor SQL. Tiene que terminar con «Semilla lista».
5. **De verdad**: `begin;` + el archivo + `commit;`.
6. **Comprobar** entrando con la cuenta: Inicio con el club y dos partidos,
   Chat con tres conversaciones y una solicitud de amistad, Clubes con
   «Fútbol de los Jueves».
7. **El correo y la contraseña van sólo en los formularios de las tiendas**
   (App Store Connect → App Review Information; Play Console → Acceso a la
   app). Nunca en el repositorio, un commit ni un chat.

## Qué deja

- Dos compañeros (`matias_rojas` y `camila_soto`) con correos
  `revision.companero1/2@futfinder.cl`. Su contraseña no es un hash válido:
  nadie puede entrar con ellos.
- Amistad aceptada con Matías y una solicitud pendiente de Camila.
- El club «Fútbol de los Jueves», con la cuenta de revisión como
  administradora y los dos como integrantes, y tres mensajes en el chat.
- El club «Atlético Providencia», de Camila, del que la cuenta no es parte:
  la bandera de «Reportar club» sólo aparece a quien no es del club.
- «Fútbol 7 entre amigos» (lo organiza Matías, a 21 días, 21:00 hora de
  Chile), con la cuenta inscrita y dos mensajes en su chat.
- «Fútbol 5 abierto» (lo organiza la cuenta, a 24 días), con Camila inscrita.
- Una conversación directa de tres mensajes con Matías.

Los partidos quedan a tres semanas para que sigan vigentes durante la
revisión. Si la revisión se alarga o hay que reenviar el build pasado ese
plazo, hay que moverles la hora (`update public.matches set hora = …`).

## Lo que hay que saber

- **Se niega a correr dos veces** (si el club ya existe), si el correo no
  existe, si la cuenta no terminó el onboarding, si tiene dos pasos activos o
  si `telefono_obligatorio` está encendido.
- `messages_force_server_fields` les pone a todos los mensajes la misma hora,
  y entonces el chat no sabe cuál es el último. La semilla les corre la hora
  con los disparadores apagados **sólo para ese update**
  (`set local session_replication_role = replica` y de vuelta a `origin` en
  la línea siguiente). En producción `postgres` puede hacerlo (comprobado el
  2026-11-19 en una transacción revertida).
- Los avisos que nacen de la semilla (solicitud de amistad, «se unió a tu
  partido», mensajes) quedan en la bandeja de la cuenta: también es contenido
  para quien revisa.
- Ensayada en la base local el 2026-11-19 y revisada en la app web a 375 px:
  los chats muestran el último mensaje y la hora, y el club y los partidos
  aparecen en Inicio, Clubes y Chat.
