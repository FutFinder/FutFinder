# Fichas de tienda

Escrita el 2026-11-19. Son los textos para pegar en App Store Connect y Google Play Console, armados según lo que la app hace hoy, no según lo planeado. Es el paso 3 de [Lanzamiento](lanzamiento.md). Antes de enviar, revisar contra el código lo marcado con ⚠️.

## Lo mismo en las dos tiendas

- **Nombre:** FutFinder
- **Categoría:** Deportes. En App Store, secundaria: Redes sociales.
- **Correo de contacto y soporte:** futfindercl@gmail.com
- **Sitio:** https://www.futfinder.cl
- **Política de privacidad:** https://www.futfinder.cl/privacidad
- **Términos:** https://www.futfinder.cl/terminos
- **Eliminar la cuenta (Google):** https://www.futfinder.cl/eliminar-cuenta
- **Cuenta para quien revisa:** se crea con [`scripts/cuenta-revision/`](../../../scripts/cuenta-revision/README.md). El correo y la contraseña van sólo en el formulario de la tienda.

## Textos

**Subtítulo (App Store, máx. 30):**
> Partidos, clubes y canchas

**Descripción corta (Google Play, máx. 80):**
> Encuentra o completa tu partido de fútbol. Arma tu club y busca rivales.

**Texto promocional (App Store, máx. 170):**
> ¿Te faltan jugadores para el partido? Publícalo en FutFinder y completa los cupos con jugadores que están cerca de ti.

**Descripción (las dos tiendas, máx. 4000):**

> FutFinder es la app para jugar fútbol amateur en Chile. Encuentra un partido cerca de ti, completa el tuyo cuando te faltan jugadores y arma tu club para enfrentarte a otros.
>
> PARTIDOS
> • Busca partidos de fútbol 5, 7 y 11 por comuna, fecha, nivel y distancia.
> • Publica tu partido con cancha, hora, cupos y valor por persona.
> • Recibe solicitudes, acepta jugadores y maneja la lista de espera.
> • Chat del partido para coordinar con todos los inscritos.
>
> CLUBES
> • Crea tu club, invita a tus amigos y define capitanes.
> • Desafía a otros clubes y acuerda fecha, cancha y resultado.
> • Chat del club, alineación, calendario e historial de encuentros.
>
> AMIGOS Y CHAT
> • Agrega amigos y escríbeles directo.
> • Avisos de solicitudes, partidos y mensajes.
>
> REPUTACIÓN
> • Después de cada partido, los jugadores se califican en puntualidad y fair play.
> • Tu TrueScore muestra qué tan confiable eres: los organizadores pueden pedir un mínimo para entrar.
>
> COMUNIDAD SEGURA
> • Reporta perfiles, clubes, fotos y partidos, y bloquea a quien no quieras ver.
> • Un equipo de moderación revisa cada reporte.
> • La app es para personas de 14 años o más.

⚠️ **Reservas de canchas.** La descripción no las nombra a propósito. Hoy no hay recintos publicados y Flow no está conectado (paso 1.8 de [Lanzamiento](lanzamiento.md)). Una función que la ficha promete y que quien revisa no puede usar se rechaza (guía 2.1). Cuando haya recintos y pagos en producción, agregar:

> RESERVAS
> • Encuentra recintos, mira los horarios disponibles y reserva tu cancha.
> • Paga tu parte o divide el pago con tu equipo.

**Palabras clave (App Store, máx. 100, separadas por coma, sin espacios):**
> futbol,pichanga,partido,cancha,club,futbolito,baby,jugadores,equipo,rival,deporte,amateur,chile

## App Store Connect

**Notas para quien revisa (App Review Information → Notes).** Van en inglés porque es el idioma del equipo de revisión:

> FutFinder requires an account; please use the demo account provided. The account already has content: a club ("Fútbol de los Jueves") where it is the admin, another club it can view and report ("Atlético Providencia"), two upcoming matches, a direct chat, club and match chats, and a pending friend request.
>
> The app is in Spanish (Chile). It is only offered in Chile; matches and clubs are located in Santiago.
>
> User-generated content (Guideline 1.2):
> • Report: on any user profile ("Reportar esta cuenta" button), in a chat ("Reportar cuenta"), on the page of a club you are not a member of, e.g. "Atlético Providencia" (flag icon), on a club photo (flag icon in the photo viewer) and on a match page (flag icon).
> • Block: on any user profile ("Bloquear usuario" button). Blocked users cannot send you direct messages, and you are warned if they are in a match you open.
> • Moderation: reports are reviewed by our moderation team within 24 hours. Moderators can remove the content and suspend the account that posted it.
> • Users must accept the Terms of Use, which forbid objectionable content and abusive behavior, when they sign up.
>
> Account deletion (Guideline 5.1.1(v)): "Perfil" tab → gear icon ("Configuración") → "Eliminar cuenta".
>
> Location permission is optional and only requested while the app is in use, to show nearby matches.
>
> Sign in: email and password only. There is no third-party login.

Los nombres de los botones se comprobaron contra el código el 2026-11-19 (`PlayerPublicActions.js`, `ChatThreadScreen.js`, `ClubHeaderBar.js`, `ClubGalleryScreen.js`, `MatchDetailScreen.js`, `SettingsScreen.js`). ⚠️ Volver a mirarlos en el build que se envía. Si no coinciden, quien revisa no los encuentra y rechaza.

**Clasificación por edad.** Se responde el cuestionario y Apple calcula la edad:
- Contenido generado por usuarios / interacción entre usuarios: **sí** (chat, fotos, perfiles).
- Violencia, contenido sexual, lenguaje vulgar, drogas, apuestas, terror: **no**.
- Acceso libre a la web: **no**.
- Edad mínima propia de la app: 14 años, comprobada al registrarse y en el servidor (migración 186).

**Privacidad de la app (App Privacy).** Nada se usa para rastrear (*tracking*) ni para publicidad. Todo va **vinculado a la identidad** de la persona, salvo el diagnóstico.

| Tipo de dato | Para qué |
|---|---|
| Información de contacto → correo electrónico | Funcionalidad de la app (cuenta) |
| Información de contacto → número de teléfono | Funcionalidad de la app (verificación), si la persona lo agrega |
| Información de contacto → nombre | Funcionalidad de la app (nombre de usuario visible) |
| Ubicación → **ubicación precisa** | Funcionalidad de la app (partidos cerca) |
| Contenido del usuario → fotos | Funcionalidad de la app (perfil, club, partido) |
| Contenido del usuario → otro contenido (mensajes de chat, calificaciones, reportes) | Funcionalidad de la app |
| Identificadores → ID de usuario | Funcionalidad de la app |
| Identificadores → ID de dispositivo (token de push) | Funcionalidad de la app (avisos) |
| Compras → historial de compras | Funcionalidad de la app (reservas), sólo cuando haya pagos |
| Diagnóstico → datos de fallos y rendimiento | Analítica de la app (Sentry), **no vinculado** |

⚠️ **Ubicación precisa, no aproximada.** [Lanzamiento](lanzamiento.md) decía «aproximada», pero `src/services/location.js` pide `Accuracy.Balanced` y guarda la latitud y la longitud sin redondear en `perfil_ubicaciones`. Para Apple, una coordenada con tres decimales o más ya es ubicación precisa. Declararla aproximada sin redondear antes es una declaración falsa. Declararla precisa no tiene costo.

⚠️ Los chats de usuarios **no** son cifrados de extremo a extremo: no decir eso en ninguna parte.

## Google Play Console

**Seguridad de los datos.** Los mismos datos de la tabla de arriba, en las categorías de Google:

- **Información personal:** correo, nombre (de usuario), teléfono (opcional), ID de usuario, y «Otra información» por la fecha de nacimiento.
- **Ubicación:** precisa y aproximada.
- **Fotos y videos:** fotos.
- **Mensajes:** otros mensajes dentro de la app (chat).
- **Actividad en la app:** interacciones (partidos, clubes, calificaciones) y otro contenido generado por el usuario (reportes, descripciones).
- **Información y rendimiento de la app:** registros de fallos y diagnóstico (Sentry).
- **Identificadores del dispositivo:** token de push.
- **Información financiera → historial de compras:** sólo cuando haya reservas pagadas. Los datos de la tarjeta los recibe Flow, no FutFinder.

Para todos: se recopilan, **no se comparten** con terceros para sus propios fines, son necesarios para el funcionamiento (salvo diagnóstico, que es opcional en la práctica porque sin DSN no se envía), **se cifran en tránsito** y **se pueden borrar** (en la app y en https://www.futfinder.cl/eliminar-cuenta).

**Público objetivo:** 14 años o más. La app no está pensada para niños.

**Cuestionario de contenido (IARC):** sí hay interacción entre usuarios y contenido que ellos publican. No hay compras de bienes digitales, ni apuestas, ni ubicación compartida con otros usuarios (los demás sólo ven la comuna).

⚠️ Comprobar la última frase: si en algún lugar se muestra a otros la distancia exacta o el punto de una persona, contestar que sí se comparte la ubicación.

**Acceso a la app:** «Todas o algunas funciones están restringidas», con la misma cuenta de revisión y la instrucción: «Inicia sesión con el correo y la contraseña».

## Capturas

No están hechas. Apple pide capturas de iPhone de 6,9" (1320 × 2868) y Google, al menos dos de teléfono. Conviene sacarlas con la cuenta de revisión ya sembrada en producción: Inicio, un partido, el club, el chat y el perfil. ⚠️ No mostrar nombres ni fotos de personas reales que no lo hayan autorizado.

## Notas relacionadas

- [Lanzamiento](lanzamiento.md)
- [Por probar](por-probar.md)
- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
