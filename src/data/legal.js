/**
 * Términos y condiciones, política de privacidad y política de cookies.
 *
 * Viven acá y no en una web aparte porque `futfinder.cl/terminos` y
 * `futfinder.cl/privacidad`, a donde apuntaban Bienvenida, Registro y
 * Ajustes, no respondían: aceptar algo que no se puede leer no es aceptar
 * nada. Como datos puros se
 * pueden probar sin montar la pantalla y `LegalScreen` las dibuja igual en
 * web y en el teléfono.
 *
 * CADA FRASE TIENE QUE SER VERDAD EN EL CÓDIGO. Antes de cambiar un servicio
 * externo, una clave del almacenamiento local, qué entra en «Exportar mis
 * datos» o una regla de reservas o de clubes, revisa la sección que lo nombra. Si cambia algo de fondo, sube
 * `ACTUALIZADO` y, para cookies, `VERSION_AVISO_COOKIES` en
 * `utils/avisoCookies.js`, que vuelve a mostrar el aviso en web.
 */

export const ACTUALIZADO = '26 de octubre de 2026';
export const CORREO_PRIVACIDAD = 'futfindercl@gmail.com';

const privacidad = {
  titulo: 'Política de privacidad',
  resumen:
    'Usamos tus datos para que puedas encontrar partidos, armar clubes y jugar. No vendemos tu información ni mostramos publicidad.',
  secciones: [
    {
      titulo: 'Quiénes somos',
      parrafos: [
        `FutFinder es una aplicación para organizar fútbol amateur en Chile. Somos responsables de los datos personales que tratamos a través de la app. Para cualquier consulta sobre privacidad escríbenos a ${CORREO_PRIVACIDAD} o usa «Reportar un problema» en Ajustes.`,
        'Tratamos tus datos conforme a la Ley N° 19.628 sobre protección de la vida privada y, desde su entrada en vigencia, a la Ley N° 21.719 de protección de datos personales.',
      ],
    },
    {
      titulo: 'Qué datos guardamos',
      lista: [
        'Cuenta: correo, contraseña (cifrada por nuestro proveedor de autenticación; nunca la vemos) y, si lo registras, tu número de celular.',
        'Perfil: nombre de usuario, foto, portada, edad, biografía, región y comuna, posición, nivel y modalidad que prefieres.',
        'Ubicación: tu posición aproximada, solo si das permiso, para mostrarte partidos cercanos. Puedes usar la app eligiendo una comuna a mano.',
        'Actividad: partidos que publicas o a los que te unes, asistencia, clubes, amistades, bloqueos, reservas de canchas y las calificaciones que das y recibes, con las que se calcula tu Trust Score.',
        'Mensajes del chat, fotos de galerías y los reportes que envías a soporte, con su captura si la adjuntas.',
        'Pagos de reservas: el monto y su estado. Los datos de tu tarjeta los ingresas directamente en Flow; FutFinder no los recibe ni los guarda.',
        'Datos técnicos: el token para enviarte notificaciones push y, si la app falla, un informe de error sin tu correo, tu IP ni el contenido de tus mensajes.',
      ],
    },
    {
      titulo: 'Para qué los usamos',
      lista: [
        'Crear y mantener tu cuenta, e iniciar sesión.',
        'Mostrarte partidos, clubes y canchas cerca de ti, y que otros jugadores te encuentren si así lo permites.',
        'Hacer funcionar el chat, las invitaciones, las reservas y los pagos.',
        'Enviarte avisos sobre tus partidos, clubes, chats y amistades, según lo que elijas en Ajustes.',
        'Cuidar la comunidad: reputación, reportes, bloqueos y moderación.',
        'Corregir errores y mantener la app segura.',
      ],
      parrafos: [
        'No usamos tus datos para publicidad, no los vendemos y no armamos perfiles para terceros.',
      ],
    },
    {
      titulo: 'Qué ven los demás',
      parrafos: [
        'Tu perfil público (nombre de usuario, foto, portada, edad, comuna, posición, nivel, estadísticas y Trust Score) lo pueden ver otros jugadores dentro de clubes, partidos y chats. En Ajustes → Privacidad decides si apareces en la búsqueda de jugadores y quién puede enviarte solicitudes de amistad.',
        'Las fotos que subes (perfil, portada, galerías de clubes y capturas de reportes) se guardan con un enlace público: quien tenga el enlace puede verlas. No subas imágenes con información confidencial.',
        'El resultado de un partido entre clubes ya finalizado es público. La hora exacta y la cancha solo las ven los integrantes de esos clubes.',
      ],
    },
    {
      titulo: 'Con quién los compartimos',
      parrafos: [
        'Solo con proveedores que necesitamos para que la app funcione, y solo lo necesario para su tarea:',
      ],
      lista: [
        'Supabase: base de datos, autenticación y almacenamiento de archivos.',
        'Flow: procesamiento de pagos de reservas.',
        'Mapbox y OpenStreetMap (Nominatim): mapas y búsqueda de direcciones.',
        'Expo (y, a través de ella, Apple y Google): envío de notificaciones push.',
        'Resend: envío de correos al equipo cuando reportas un problema o solicitas sumar un recinto.',
        'Sentry: informes de errores, sin datos que te identifiquen.',
      ],
      parrafosFinales: [
        'Algunos de estos proveedores procesan datos fuera de Chile. También podemos entregar información cuando una autoridad competente lo exija conforme a la ley.',
      ],
    },
    {
      titulo: 'Cuánto tiempo los guardamos',
      parrafos: [
        'Mientras tu cuenta esté activa. Si la eliminas desde Ajustes → Cuenta, borramos tu cuenta y tus datos asociados o los desvinculamos de ti, salvo lo que debamos conservar por obligación legal o contable, como el registro de los pagos.',
      ],
    },
    {
      titulo: 'Tus derechos',
      parrafos: [
        'Puedes acceder a tus datos, corregirlos, eliminarlos, oponerte a un tratamiento o pedir una copia para llevártela. Desde la app ya puedes:',
      ],
      lista: [
        'Editar tu perfil y tus preferencias en cualquier momento.',
        'Descargar tus datos con «Exportar mis datos» en Ajustes (perfil, partidos, amigos y clubes; los mensajes de chat no se incluyen).',
        'Elegir qué notificaciones recibes y desactivar el permiso de ubicación desde tu teléfono o navegador.',
        'Eliminar tu cuenta desde Ajustes → Cuenta.',
      ],
      parrafosFinales: [
        `Para cualquier otra solicitud escríbenos a ${CORREO_PRIVACIDAD}. Te responderemos dentro de los plazos que fija la ley.`,
      ],
    },
    {
      titulo: 'Menores de edad',
      parrafos: [
        'FutFinder se puede usar desde los 12 años. Si tienes menos de 14, necesitas la autorización de tu madre, padre o tutor para crear una cuenta. Si eres responsable de un menor y crees que usa la app sin tu autorización, escríbenos y eliminaremos la cuenta.',
      ],
    },
    {
      titulo: 'Seguridad',
      parrafos: [
        'Protegemos tus datos con conexiones cifradas y reglas en el servidor que limitan qué puede leer o cambiar cada cuenta. Ningún sistema es infalible: si detectamos un incidente que afecte tus datos, te avisaremos.',
      ],
    },
    {
      titulo: 'Cambios a esta política',
      parrafos: [
        'Si cambiamos algo importante, lo avisaremos dentro de la app antes de que aplique. La fecha de la última actualización aparece al inicio.',
      ],
    },
  ],
};

const cookies = {
  titulo: 'Política de cookies',
  resumen:
    'FutFinder no usa cookies de publicidad ni de seguimiento. En la versión web guardamos en tu navegador solo lo necesario para que la app funcione.',
  secciones: [
    {
      titulo: 'Qué son',
      parrafos: [
        'Las cookies y el almacenamiento local son pequeños archivos o registros que un sitio guarda en tu navegador para recordar cosas entre visitas. En el teléfono, la app usa el almacenamiento interno del dispositivo para lo mismo.',
      ],
    },
    {
      titulo: 'Qué guardamos y para qué',
      parrafos: [
        'Todo lo que guarda FutFinder es necesario para que la app funcione o es una comodidad que tú activas al usarla:',
      ],
      lista: [
        'Sesión: el acceso a tu cuenta, para que no tengas que iniciar sesión cada vez. Lo crea Supabase y se borra al cerrar sesión.',
        'Cuenta recordada: tu correo y nombre de usuario (nunca la contraseña), para ofrecerte entrar más rápido en este dispositivo.',
        'Preferencias de uso: el club que tenías abierto, qué mensajes de club ya leíste y qué avisos de bienvenida ya viste.',
        'Copia temporal de datos: la última lista de partidos que cargaste, para mostrarla mientras se actualiza o si pierdes la conexión.',
        'Aviso de cookies: que ya viste este aviso, para no repetírtelo.',
      ],
    },
    {
      titulo: 'Servicios de terceros',
      parrafos: [
        'Cuando abres el mapa de partidos en la web, Mapbox carga el mapa y puede guardar en tu navegador un identificador anónimo para medir el uso de su servicio. No lo usamos nosotros ni sirve para mostrarte publicidad. Puedes revisar cómo lo trata en la política de privacidad de Mapbox.',
        'No usamos Google Analytics, píxeles de redes sociales ni ninguna otra herramienta de publicidad o seguimiento.',
      ],
    },
    {
      titulo: 'Cómo controlarlas',
      parrafos: [
        'Como todo lo que guardamos es necesario para el funcionamiento, no pedimos un consentimiento aparte. Aun así, puedes borrar el almacenamiento de FutFinder desde la configuración de tu navegador o eliminando los datos de la app en tu teléfono. Si lo haces, se cerrará tu sesión y perderás las preferencias guardadas en ese dispositivo.',
        'Si algún día sumamos cookies opcionales, como medición o publicidad, te pediremos permiso antes de activarlas y podrás rechazarlas.',
      ],
    },
    {
      titulo: 'Contacto',
      parrafos: [
        `Si tienes dudas sobre esta política escríbenos a ${CORREO_PRIVACIDAD}. Lo demás sobre tus datos está en la Política de privacidad.`,
      ],
    },
  ],
};

const terminos = {
  titulo: 'Términos y condiciones',
  resumen:
    'Las reglas para usar FutFinder: juega limpio, cumple lo que te comprometes a jugar y trata bien a los demás. Al crear tu cuenta aceptas estos términos.',
  secciones: [
    {
      titulo: 'Qué es FutFinder',
      parrafos: [
        'FutFinder es una aplicación para encontrar y organizar partidos de fútbol amateur, armar clubes, conversar con otros jugadores y reservar canchas en Chile. Al crear una cuenta o usar la app aceptas estos términos y nuestra Política de privacidad. Si no estás de acuerdo, no uses la app.',
      ],
    },
    {
      titulo: 'Tu cuenta',
      lista: [
        'Puedes usar FutFinder desde los 12 años. Si tienes menos de 14, necesitas la autorización de tu madre, padre o tutor.',
        'Los datos de tu perfil deben ser verdaderos. No puedes hacerte pasar por otra persona.',
        'Tu cuenta es personal: cuida tu contraseña y no la compartas. Eres responsable de lo que se haga con ella.',
        'Puedes eliminar tu cuenta cuando quieras desde Ajustes → Cuenta.',
      ],
    },
    {
      titulo: 'Partidos',
      lista: [
        'Quien publica un partido es su organizador: define la cancha, la hora, los cupos, la cuota y los requisitos, y confirma después quién asistió.',
        'Al inscribirte te comprometes a ir. Salirte, llegar tarde o no presentarte afecta tu puntaje de reputación según las reglas que la app muestra antes de cada acción.',
        'Si un partido tiene una cuota, se acuerda y se paga entre los jugadores y el organizador fuera de la app, salvo que se trate de una reserva pagada en FutFinder. FutFinder no cobra ni garantiza esas cuotas.',
      ],
    },
    {
      titulo: 'Reputación',
      parrafos: [
        'Tu puntaje de reputación (Trust Score o TrueScore) y las calificaciones de tus compañeros reflejan tu asistencia, puntualidad y juego limpio. Los calcula el sistema a partir de lo que ocurre en los partidos; nadie puede editar el suyo. Un organizador puede exigir un puntaje mínimo para entrar a su partido.',
      ],
    },
    {
      titulo: 'Clubes y desafíos',
      lista: [
        'Puedes pertenecer hasta a tres clubes. Cada club admite hasta 26 integrantes y 3 administradores.',
        'Los administradores gestionan el club, sus integrantes y sus desafíos, y son responsables de su uso.',
        'El resultado de un desafío lo proponen los administradores de un club y lo confirma el otro. Si no hay acuerdo, el resultado queda en disputa hasta que lo revise FutFinder.',
        'Un club que cancela un desafío con menos de 2 horas de aviso puede quedar sancionado para nuevos desafíos durante 14 días.',
      ],
    },
    {
      titulo: 'Reservas de canchas y pagos',
      lista: [
        'Las canchas las administra cada recinto. FutFinder te permite ver su disponibilidad, reservar y pagar, pero no es dueño de las canchas ni responde por su estado o por lo que ocurra en ellas.',
        'Los pagos con tarjeta los procesa Flow. Los montos se muestran en pesos chilenos antes de pagar.',
        'Puedes cancelar una reserva confirmada hasta 12 horas antes de su inicio; lo pagado vuelve a tu Balance FutFinder. Después de ese plazo no se puede cancelar desde la app.',
        'Si pagaste y la reserva no alcanzó a confirmarse, por ejemplo porque otro grupo tomó el horario antes, te devolvemos el monto completo.',
        'Lo que tengas en tu Balance solo se usa para pagar reservas dentro de FutFinder.',
      ],
    },
    {
      titulo: 'Recintos',
      parrafos: [
        'Si administras un recinto en FutFinder, te comprometes a publicar información real sobre tus canchas, precios y horarios, y a respetar las reservas confirmadas. Revisamos cada recinto antes de publicarlo y podemos retirarlo si no cumple estos términos.',
      ],
    },
    {
      titulo: 'Convivencia y contenido',
      parrafos: [
        'Eres responsable de lo que publicas: mensajes, fotos, nombres de clubes y descripciones. No está permitido:',
      ],
      lista: [
        'Insultar, acosar, amenazar o discriminar a otras personas.',
        'Publicar contenido sexual, violento, ilegal o que no te pertenezca.',
        'Hacer spam, estafas o vender productos sin autorización.',
        'Crear cuentas falsas, manipular la reputación o los resultados, o intentar acceder a datos de otros.',
        'Agredir a otros jugadores dentro o fuera de la cancha.',
      ],
      parrafosFinales: [
        'Puedes bloquear a otro jugador o reportar su cuenta desde su perfil, y reportar un problema de la app desde Ajustes.',
      ],
    },
    {
      titulo: 'Moderación y suspensión',
      parrafos: [
        'Podemos revisar reportes, ocultar contenido y suspender o cerrar cuentas que no cumplan estos términos. Si crees que nos equivocamos, escríbenos y revisaremos tu caso.',
      ],
    },
    {
      titulo: 'Responsabilidad',
      parrafos: [
        'El fútbol es un deporte de contacto. Cada jugador participa bajo su propia responsabilidad y debe cuidar su salud y la de los demás. FutFinder pone en contacto a jugadores, clubes y recintos, pero no organiza los partidos ni está presente en ellos, por lo que no responde por lesiones, daños, pérdidas o conflictos entre usuarios, salvo en lo que la ley no permita excluir.',
        'Hacemos lo posible para que la app funcione siempre, pero puede tener interrupciones o errores. Podemos cambiar, agregar o quitar funciones.',
        'Nada de esto limita los derechos que te da la Ley N° 19.496 de protección de los derechos de los consumidores.',
      ],
    },
    {
      titulo: 'Cambios y ley aplicable',
      parrafos: [
        'Si cambiamos algo importante de estos términos, te lo avisaremos antes de que aplique. Seguir usando la app después significa que aceptas los cambios.',
        'Estos términos se rigen por las leyes de Chile.',
      ],
    },
    {
      titulo: 'Contacto',
      parrafos: [
        `Si tienes dudas sobre estos términos escríbenos a ${CORREO_PRIVACIDAD} o usa «Reportar un problema» en Ajustes.`,
      ],
    },
  ],
};

export const DOCUMENTOS_LEGALES = { terminos, privacidad, cookies };
