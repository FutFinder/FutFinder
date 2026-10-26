/**
 * Política de privacidad y política de cookies de FutFinder.
 *
 * Viven acá y no en una web aparte porque `futfinder.cl/privacidad`, a donde
 * apuntaban Bienvenida, Registro y Ajustes, no respondía: aceptar una
 * política que no se puede leer no es aceptar nada. Como datos puros se
 * pueden probar sin montar la pantalla y `LegalScreen` las dibuja igual en
 * web y en el teléfono.
 *
 * CADA FRASE TIENE QUE SER VERDAD EN EL CÓDIGO. Antes de cambiar un servicio
 * externo, una clave del almacenamiento local o qué entra en «Exportar mis
 * datos», revisa la sección que lo nombra. Si cambia algo de fondo, sube
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

export const DOCUMENTOS_LEGALES = { privacidad, cookies };
