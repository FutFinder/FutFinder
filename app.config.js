/**
 * Config dinámica (en vez de app.json estático) para poder resolver
 * `android.googleServicesFile` desde una variable de entorno en builds de
 * EAS, sin comprometer el archivo real a Git. Ver
 * docs/memoria/arquitectura/despliegue-y-entornos.md para el secreto de EAS
 * que hay que crear (`GOOGLE_SERVICES_JSON`, tipo file).
 *
 * En EAS Build, el secreto de tipo "file" se inyecta como una variable de
 * entorno cuyo valor es la ruta local (en el worker) al archivo ya
 * descifrado — por eso `process.env.GOOGLE_SERVICES_JSON` aquí es una RUTA,
 * no el contenido del archivo.
 */
const fs = require('fs');

// Sin el archivo, el build igual sale: se omite `googleServicesFile` en vez
// de apuntar a una ruta que no existe, que hace fallar el prebuild. El costo
// es que Android queda sin push (FCM) hasta que se cargue el secreto.
const googleServicesPath = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
const googleServicesFile = fs.existsSync(googleServicesPath) ? googleServicesPath : undefined;

/**
 * El verde de la app: `paleta.green` de `src/theme/colors.js`.
 *
 * VA ESCRITO A MANO, y no es por pereza. `colors.js` es un módulo ES, y que
 * un `require()` lo lea depende de la detección de sintaxis de Node, que es
 * reciente: acá (Node 26) funciona —pruébalo y verás que sí—, pero en un Node
 * 18 el mismo `require` tira `SyntaxError: Unexpected token 'export'`. Este
 * archivo lo evalúa el prebuild, también en el worker de EAS Build, y no
 * fijamos su versión de Node en ninguna parte: `package.json` no declara
 * `engines` ni `type`. Un hex duplicado se ve feo; un prebuild que no arranca
 * deja sin build. (`tailwind.config.js` sí importa `colors.js`, y por eso es
 * la excepción y no el ejemplo a seguir.)
 *
 * La copia no se desincroniza sola: `nadieEscribeLaPaletaAMano.test.js`
 * compara este valor con `paleta.green` y desde ahora además lee los archivos
 * de configuración de la raíz, que era justo lo que no miraba.
 *
 * Hasta hoy acá estaba el verde oliva de la paleta legada, borrada al
 * unificar la estética (2026-09-16). No se escribe su hex ni para contar
 * esto: la prueba va por texto y lo cazaría acá igual. Sobrevivió casi un mes
 * porque esa prueba sólo recorría `src/`. El peor de los tres sitios era el
 * `color` del plugin `expo-notifications`: es el tinte del ícono de
 * notificación en Android, o sea el color de marca que ve cualquiera que
 * reciba un push.
 */
const VERDE = '#55DF69';

module.exports = {
  expo: {
    name: 'FutFinder',
    slug: 'futfinder',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    splash: {
      resizeMode: 'contain',
      backgroundColor: '#0A0C0A',
    },
    androidStatusBar: {
      backgroundColor: '#0A0C0A',
      barStyle: 'light-content',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.futfinder.app',
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'FutFinder usa tu ubicación para mostrarte partidos cerca y confirmar tu asistencia.',
      },
    },
    android: {
      package: 'com.futfinder.app',
      permissions: [
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.RECEIVE_BOOT_COMPLETED',
        'android.permission.VIBRATE',
        'android.permission.WAKE_LOCK',
        'android.permission.RECORD_AUDIO',
      ],
      // Local: cae a ./google-services.json (no versionado, ver .gitignore).
      // EAS Build: viene de la variable de entorno inyectada por el secreto
      // de tipo file `GOOGLE_SERVICES_JSON` (falta crearlo, ver docs).
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    notification: {
      // Sin `icon`: no hay un ícono de notificación real en el repo todavía
      // (tampoco existe carpeta `assets/`). Sin este campo, Android/iOS usan
      // su ícono de notificación por defecto en vez de fallar el build por
      // apuntar a un archivo inexistente.
      color: VERDE,
      androidMode: 'default',
      androidCollapsedTitle: 'FutFinder',
      iosDisplayInForeground: true,
    },
    web: {
      bundler: 'metro',
      name: 'FutFinder',
      shortName: 'FutFinder',
      themeColor: VERDE,
      backgroundColor: '#0A0C0A',
    },
    plugins: [
      // Sentry. Su trabajo en el build nativo es subir los mapas de origen:
      // sin ellos el stack llega minificado y un informe no sirve de nada.
      // El SDK se inicializa en `App.js` y NO arranca sin
      // EXPO_PUBLIC_SENTRY_DSN, así que esto es inerte hasta que exista.
      '@sentry/react-native',
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'FutFinder usa tu ubicación para mostrarte partidos cerca y confirmar tu asistencia.',
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission:
            'FutFinder necesita acceso a tus fotos para que puedas subir tu foto de perfil y portadas de partidos.',
          cameraPermission: 'FutFinder usa tu cámara para que puedas tomar fotos de perfil.',
        },
      ],
      [
        'expo-notifications',
        {
          color: VERDE,
          defaultChannel: 'default',
          sounds: [],
        },
      ],
      // Manrope (Google Fonts) — tipografía del handoff de Reservas. Se
      // carga bajo su propio nombre de familia; el resto de la app sigue
      // usando `System` (theme/colors.js: fonts.*), no se toca nada fuera
      // de los componentes de `src/components/reservas/`.
      'expo-font',
    ],
    scheme: 'futfinder',
    extra: {
      eas: {
        projectId: '254ce906-c402-456b-80df-8e060a10b09b',
      },
    },
    owner: 'futfinder',
  },
};
