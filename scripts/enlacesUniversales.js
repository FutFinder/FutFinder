/**
 * Enlaces universales: qué dominio y qué rutas abren la app en el teléfono,
 * y los dos archivos que el dominio tiene que publicar para probarlo.
 *
 * Una sola fuente para las tres partes que tienen que calzar:
 * `app.config.js` (lo que declara la app), `scripts/enlaces-universales.mjs`
 * (que escribe los archivos en `public/.well-known/`) y su prueba.
 *
 * El dominio es `www` y no la raíz: en Vercel `futfinder.cl` redirige a
 * `www.futfinder.cl`, y ni Apple ni Google siguen redirecciones al buscar
 * sus archivos. Con la raíz, la verificación fallaría sin avisar.
 */

const DOMINIO = 'www.futfinder.cl';

/**
 * Las rutas que se abren en la app, con la sintaxis de Apple (`*` al final =
 * todo lo que sigue). Salen de `src/navigation/direcciones.js`, y la prueba
 * exige que toda dirección con sesión esté cubierta (desde el 2026-11-27
 * todas las pantallas con sesión tienen la suya). Términos, políticas,
 * eliminar la cuenta y la galería de QA quedan fuera a propósito: se leen en
 * el navegador, sin la app.
 */
const RUTAS = [
  // Las pestañas.
  '/inicio',
  '/partidos',
  '/clubes',
  '/reservas',
  '/chat',
  '/perfil',
  // Partidos, clubes, desafíos y chat.
  '/p/*',
  '/publicar',
  '/clubes/*',
  '/desafio/*',
  '/chat/*',
  // Perfil y cuenta.
  '/perfil/*',
  '/jugador/*',
  '/amigos',
  '/avisos',
  '/saldo',
  '/moderacion',
  // Reservar una cancha, y el grupo de una reserva.
  '/recintos/*',
  '/mis-reservas',
  '/reserva/*',
  // El lado de quien administra un recinto.
  '/mis-recintos',
  '/mis-recintos/*',
];

/** Las mismas rutas como `data` de un intentFilter de Android. */
function datosDeAndroid() {
  return RUTAS.map((ruta) =>
    ruta.endsWith('/*')
      ? { scheme: 'https', host: DOMINIO, pathPrefix: ruta.slice(0, -1) }
      : { scheme: 'https', host: DOMINIO, path: ruta }
  );
}

/** Contenido de `/.well-known/apple-app-site-association`. */
function generarAppleAppSiteAssociation(teamId, bundleId) {
  if (!/^[A-Z0-9]{10}$/.test(String(teamId || ''))) {
    throw new Error(
      `Team ID de Apple inválido («${teamId}»): son 10 letras mayúsculas o números (developer.apple.com → Membership).`
    );
  }
  if (!bundleId) throw new Error('Falta el bundleIdentifier de iOS.');
  return {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${bundleId}`],
          components: RUTAS.map((ruta) => ({ '/': ruta })),
        },
      ],
    },
  };
}

/** Contenido de `/.well-known/assetlinks.json`. */
function generarAssetLinks(paquete, huellas) {
  if (!paquete) throw new Error('Falta el package de Android.');
  if (!Array.isArray(huellas) || huellas.length === 0) {
    throw new Error('Falta la huella SHA-256 del certificado de Android (eas credentials).');
  }
  const normalizadas = huellas.map((h) => String(h).trim().toUpperCase());
  for (const h of normalizadas) {
    if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(h)) {
      throw new Error(`Huella inválida («${h}»): tiene que ser un SHA-256, 32 pares separados por «:».`);
    }
  }
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: paquete,
        sha256_cert_fingerprints: normalizadas,
      },
    },
  ];
}

module.exports = {
  DOMINIO,
  RUTAS,
  datosDeAndroid,
  generarAppleAppSiteAssociation,
  generarAssetLinks,
};
