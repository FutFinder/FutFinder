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
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || './google-services.json';

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
      googleServicesFile,
    },
    notification: {
      // Sin `icon`: no hay un ícono de notificación real en el repo todavía
      // (tampoco existe carpeta `assets/`). Sin este campo, Android/iOS usan
      // su ícono de notificación por defecto en vez de fallar el build por
      // apuntar a un archivo inexistente.
      color: '#71B533',
      androidMode: 'default',
      androidCollapsedTitle: 'FutFinder',
      iosDisplayInForeground: true,
    },
    web: {
      bundler: 'metro',
      name: 'FutFinder',
      shortName: 'FutFinder',
      themeColor: '#71B533',
      backgroundColor: '#0A0C0A',
    },
    plugins: [
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
          color: '#71B533',
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
