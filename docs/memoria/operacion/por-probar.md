# Por probar al final

Última revisión: 2026-11-13

## Qué es esta nota

La lista de lo que se **cambió y no se pudo probar** en su momento, para
recorrerla de una vez al final, antes de lanzar. Pedido explícito: lo que no
se prueba al hacerlo se anota acá y se prueba al final, todo junto.

Cada ítem dice **qué se cambió**, **qué sí se comprobó** y **qué falta y
cómo**. Cuando un ítem queda probado, se borra de acá y el resultado se anota
en la nota del dominio (o en [Pruebas](pruebas.md)). Lo que es trabajo por
hacer —no por probar— vive en [Pendientes](pendientes.md).

## Lo que hace falta para probar casi todo

- **Un build nativo** (EAS, Android e iOS) con lo que hay en `main`: íconos,
  permisos, recuperar contraseña, borrar cuenta, edad fija, push tras el
  segundo paso y el aviso de modo de prueba en el pago. Esta Mac no tiene
  Xcode ni el SDK de Android: el build sale por EAS (`npm run build:android`
  / `build:ios`) y se prueba en un teléfono.
- **Dos o tres cuentas de prueba desechables** en producción, una con fotos
  subidas (avatar y galería), otra con una app de autenticación (TOTP).
- **Claves de Flow en modo sandbox** cargadas en Supabase → Edge Functions →
  Secrets: `FLOW_API_KEY`, `FLOW_SECRET_KEY` y `FLOW_AMBIENTE=sandbox`
  (obligatoria desde el 2026-11-13).

## 1. Cuentas (2026-11-13, commits 87e0881 y 75b1c89)

- **Borrar la cuenta de punta a punta.** Comprobado: migración 176 con arnés
  17/17 y control negativo contra producción; `eliminar-cuenta` v1 responde
  401/405 sin sesión. **Falta:** con una cuenta desechable que tenga avatar,
  galería, un club fundado con otro integrante, un partido por jugar y otro
  jugado: borrarla desde Ajustes y mirar que (a) la sesión se cierra, (b) el
  club sigue y el otro integrante quedó admin con aviso, (c) el partido por
  jugar se canceló con aviso, (d) las carpetas de la cuenta en `avatars` y
  `profile-gallery` quedaron vacías y `cuentas_por_limpiar` la marca limpia.
  Y un caso bloqueado (con saldo, o única admin de un recinto): el mensaje se
  ve en español y la cuenta sigue.
- **Recuperar la contraseña.** Comprobado: 14 pruebas de Node de
  `recuperacionPolicy`, y en el navegador la pantalla abre con el correo ya
  escrito y sin el correo en la URL. **Falta:** con un correo real: que llegue
  el código, que «Reenviar código» funcione, que con TOTP pida el segundo
  código, que la contraseña nueva sirva para entrar, que la vieja ya no, y que
  otra sesión abierta (otro navegador) quede cerrada. Desde Iniciar sesión y
  desde Ajustes. En web y en el teléfono.
- **Eliminar mi cuenta en una app ya instalada** (build anterior, que llama la
  RPC directo): los datos se borran y los archivos quedan en la cola; la
  primera vez que alguien borre su cuenta con el build nuevo, la función
  limpia la cola. Mirar `cuentas_por_limpiar` después.

## 2. Tiendas (2026-11-13, commit 87e0881)

- **Íconos, splash y permisos.** Comprobado: `expo config --type introspect`
  (iOS sólo pide ubicación «mientras se usa» y fotos, en español; Android
  quita micrófono, cámara, ubicación en segundo plano). **Falta:** verlos en
  un build (ícono en la pantalla de inicio de los dos sistemas, ícono
  adaptativo con máscara redonda, splash, ícono de notificación en Android) y
  que App Store Connect acepte el ícono sin canal alfa.
- **Que el build de tienda salga.** `eas.json` combina `appVersionSource:
  "local"` con `autoIncrement` y config dinámica: puede fallar (ver
  [Despliegue y entornos](../arquitectura/despliegue-y-entornos.md)).

## 3. Seguridad con una cuenta normal (2026-11-13, migración 177, commit 2acfff2)

Comprobado: arnés de la 177 contra producción (todos los casos, con controles
de que lo legítimo sigue), y desde fuera la API anónima, los buckets sin
listado y las URL públicas. **Falta, en la app con cuentas reales:**

- **Uso normal sin regresiones:** publicar un partido normal; publicar el
  partido de un desafío aceptado (flujo antiguo de clubes); aceptar una
  solicitud de amistad; aceptar una invitación a club; retirar y deshacer una
  respuesta a un desafío abierto; cambiar avatar y portada (usan `upsert`),
  borrar una foto de la galería propia y del club, cambiar el escudo del club
  (`list` + `remove`). Todo eso depende de las políticas que cambió la 177.
- **Bloqueo:** bloquear a alguien y comprobar en su sesión que no puede
  escribir ni leer el DM, tampoco en tiempo real.
- **Editar perfil con la edad ya puesta:** el campo se ve fijo y guardar el
  resto funciona. **Ajustes de un menor:** encender «Visible en búsquedas»
  muestra el mensaje y vuelve el interruptor.
- **Verificación en dos pasos de punta a punta:** activar TOTP en una cuenta;
  cerrar sesión; entrar con la contraseña y, ANTES del código, comprobar que
  la API rechaza (403 `MFA_REQUERIDA`) y que no se registró el token de push;
  después del código, que todo vuelve y el push se registra. El pre-request de
  PostgREST sólo se probó por SQL y con la clave anónima, **nunca con un JWT
  real de usuario**.

## 4. Personal: dos pasos obligatorios (migración 167, aplicada apagada)

Comprobado: arnés 16/16 contra producción con la bandera encendida y apagada
dentro de la transacción. **Falta:** con el build que trae `MfaSetupScreen`,
que cada moderador y administrador de recinto active su código; recién
entonces `update feature_flags set activo = true where nombre =
'mfa_obligatoria_staff'`, y comprobar con una cuenta de personal que sin el
código pierde el panel y con el código lo recupera. Confirmar antes en el
panel de Supabase que *MFA → TOTP* está habilitado.

## 5. Pagos con Flow (2026-11-13, migración 178, funciones v4, commits eddadb4 y d3fa7b4)

Comprobado: arnés de la 178 15/15 contra producción; 75 pruebas de Deno
(lógica de reintento y de cobros); desde fuera, `flow-confirmacion` 405/503 y
`pagar-reserva` `configurada: false`. **Falta, con claves de sandbox:**

- Pagar una reserva completa y una dividida (cada parte), y ver que se
  confirman.
- Tocar «pagar», cerrar la ventana sin pagar y volver a tocar: tiene que abrir
  **el mismo enlace**. Cambiar la cuota (pago dividido) y volver a pagar: tiene
  que ser una orden nueva.
- Pagar el enlace viejo después de que se armó uno nuevo: el pago queda
  `reversar` con su motivo y llega el aviso «Te devolveremos un pago».
- Pagar y volver a tocar «pagar» antes de que llegue el aviso de Flow: la app
  entra a esperar y la reserva aparece confirmada (`yaPagado`).
- La pantalla de pago muestra «modo de prueba».
- `flow-confirmacion` con un token inventado con forma: 400 (Flow no lo
  conoce). Más de 120 avisos por minuto desde una IP: 429.
- Antes de los pagos reales: cambiar a `FLOW_AMBIENTE=produccion` con las
  claves de la empresa y hacer un pago real chico y su devolución.

## 6. Saldo (migración 178)

Los candados contra el doble gasto y la doble devolución sólo se comprobaron
por presencia (el arnés corre en una sola transacción). **Falta:** la carrera
de verdad con dos sesiones (`scripts/carrera-dos-sesiones.sh` contra la base
local): dos reservas del mismo jugador confirmadas a la vez con saldo para una
sola, y dos cancelaciones del recinto a la vez. Sólo importa cuando exista la
carga de saldo.

## 7. Lo que ya estaba sin probar antes de esta tanda

- **Push en un teléfono físico** (el P1 de [Pendientes](pendientes.md)):
  permisos, token, una categoría permitida, una bloqueada por preferencia, y
  token inválido. Con el ícono de notificación nuevo.
- **La migración 175** (chat por Broadcast) está aplicada en producción pero
  su archivo y los cambios del cliente siguen sin commitear en una de las
  Macs: probar el chat en tiempo real cuando ese trabajo se suba.

## Notas relacionadas

- [Pendientes](pendientes.md)
- [Pruebas](pruebas.md)
- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
- [Base de datos](../arquitectura/base-de-datos.md)
