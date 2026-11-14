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
const { DOMINIO, datosDeAndroid } = require('./scripts/enlacesUniversales.js');

// Sin el archivo, el build igual sale: se omite `googleServicesFile` en vez
// de apuntar a una ruta que no existe, que hace fallar el prebuild. El costo
// es que Android queda sin push (FCM) hasta que se cargue el secreto.
const googleServicesPath = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
const googleServicesFile = fs.existsSync(googleServicesPath) ? googleServicesPath : undefined;

module.exports = {
  expo: {
    name: 'FutFinder',
    slug: 'futfinder',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    // Íconos e imagen de inicio: los dibuja `scripts/generar-iconos.mjs` a
    // partir de la marca (`FutFinderMark`). Sin `icon`, App Store Connect
    // rechaza el build y Android muestra el ícono genérico.
    icon: './assets/icon.png',
    splash: {
      image: './assets/splash-icon.png',
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
      // Enlaces universales: `https://www.futfinder.cl/p/<id>` abre la app.
      // Apple lo confirma leyendo `/.well-known/apple-app-site-association`
      // del dominio (lo escribe `scripts/enlaces-universales.mjs`). Sin ese
      // archivo el enlace sigue abriendo la web, sin error.
      associatedDomains: [`applinks:${DOMINIO}`],
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'FutFinder usa tu ubicación para mostrarte partidos cerca y confirmar tu asistencia.',
        // Todo va por HTTPS (Supabase, Mapbox, Sentry). Sin cargas
        // arbitrarias por HTTP, que App Review pide justificar; la red local
        // queda abierta sólo para el servidor de desarrollo.
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: false,
          NSAllowsLocalNetworking: true,
        },
      },
    },
    android: {
      package: 'com.futfinder.app',
      // Enlaces universales (App Links): mismo dominio y mismas rutas que en
      // iOS. Con `autoVerify`, Android lee `/.well-known/assetlinks.json` y,
      // si la huella del certificado calza, abre la app sin preguntar.
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: datosDeAndroid(),
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#0A0C0A',
      },
      permissions: [
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.RECEIVE_BOOT_COMPLETED',
        'android.permission.VIBRATE',
        'android.permission.WAKE_LOCK',
      ],
      // La app no graba audio, no usa la cámara (las fotos salen de la
      // galería) ni pide ubicación en segundo plano. Se bloquean para que
      // ninguna dependencia los vuelva a meter en el manifiesto: un permiso
      // declarado y sin uso es motivo de rechazo en Google Play.
      blockedPermissions: [
        'android.permission.RECORD_AUDIO',
        'android.permission.CAMERA',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        // Vienen de la plantilla de Expo y la app no los usa. Lo que SÍ queda
        // es READ_EXTERNAL_STORAGE: `requestMediaLibraryPermissionsAsync`
        // (services/storage.js) lo pide en Android 12 o anterior.
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ],
      // Local: cae a ./google-services.json (no versionado, ver .gitignore).
      // EAS Build: viene de la variable de entorno inyectada por el secreto
      // de tipo file `GOOGLE_SERVICES_JSON` (falta crearlo, ver docs).
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    notification: {
      // Android pinta el ícono de notificación sólo por su alfa: tiene que ser
      // una silueta blanca sobre transparente, no el ícono de la app.
      icon: './assets/notification-icon.png',
      color: '#55DF69',
      androidMode: 'default',
      androidCollapsedTitle: 'FutFinder',
      iosDisplayInForeground: true,
    },
    web: {
      bundler: 'metro',
      favicon: './assets/favicon.png',
      name: 'FutFinder',
      shortName: 'FutFinder',
      themeColor: '#55DF69',
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
          // Sólo «mientras se usa la app» (`requestForegroundPermissionsAsync`
          // en services/location.js). Con `false` el plugin NO escribe las
          // claves de «siempre», que si no llegan con su texto en inglés y
          // App Review pregunta para qué se pide ubicación en segundo plano.
          locationWhenInUsePermission:
            'FutFinder usa tu ubicación para mostrarte partidos cerca y confirmar tu asistencia.',
          locationAlwaysPermission: false,
          locationAlwaysAndWhenInUsePermission: false,
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission:
            'FutFinder necesita acceso a tus fotos para que puedas subir tu foto de perfil y portadas de partidos.',
          // Las fotos se eligen de la galería; nunca se abre la cámara ni se
          // graba audio. Sin estos `false` el plugin agrega RECORD_AUDIO en
          // Android y los textos de cámara y micrófono en inglés en iOS.
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
      [
        // La sesión vive en el almacén seguro (src/services/supabase.js). El
        // plugin saca esos datos del respaldo automático de Android: restaurados
        // en otro teléfono no se pueden descifrar. `faceIDPermission: false`
        // porque no se usa biometría y el permiso por omisión viene en inglés.
        'expo-secure-store',
        { configureAndroidBackup: true, faceIDPermission: false },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/notification-icon.png',
          color: '#55DF69',
          defaultChannel: 'default',
          sounds: [],
        },
      ],
      // Manrope (Google Fonts) — la tipografía de toda la app
      // (theme/colors.js: `fuentes`). La carga `useFonts` en App.js.
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
