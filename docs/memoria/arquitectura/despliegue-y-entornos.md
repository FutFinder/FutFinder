# Despliegue y entornos

Última revisión: 2026-08-08

## Propósito

Concentrar la configuración versionada para ejecutar, publicar y diagnosticar FutFinder sin incluir credenciales ni configuración personal.

## Estado verificado

La configuración del repositorio define exportación web con Vercel, builds nativos con EAS y un backend Supabase. Esta nota describe lo que está versionado; no confirma el estado de cuentas, secretos ni despliegues remotos.

## Web en Vercel

- `vercel.json` ejecuta `npx expo export --platform web`.
- El resultado se publica desde `dist`.
- La regla de reescritura dirige todas las rutas a `index.html`, necesaria para las rutas de una aplicación de una sola página.

## Builds nativos con EAS

- `eas.json` requiere EAS CLI `>= 12.0.0` y toma la versión de aplicación desde la configuración local.
- Los perfiles versionados son `development` (cliente de desarrollo y distribución interna), `preview` (distribución interna) y `production` (incremento automático de versión).
- `app.config.js` declara el identificador de paquete `com.futfinder.app` para Android e iOS, permisos de ubicación y plugins de ubicación, selector de imágenes y notificaciones.

## Configuración de Supabase y modo de demostración

- Copia `.env.example` a `.env` y proporciona `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY`. El prefijo público permite que Expo inyecte ambos valores en el bundle cliente.
- Si falta cualquiera de ellas, `isSupabaseConfigured` es falso. Los servicios devuelven datos o resultados de demostración para que la interfaz pueda renderizarse; no equivale a un backend conectado.
- `src/services/supabase.js` configura AsyncStorage para sesiones nativas y conserva el comportamiento de almacenamiento web de Supabase en web.

## Archivo de servicios Google para Android

`app.config.js` asigna `android.googleServicesFile` a la ruta contenida en `GOOGLE_SERVICES_JSON`; si no existe, usa `./google-services.json`. El archivo real no se versiona.

Flujo requerido para builds:

1. Registra o localiza en Firebase la aplicación Android con el paquete configurado y descarga su archivo de servicios.
2. Para desarrollo local, guarda el archivo como `google-services.json` en la raíz del repositorio, donde está ignorado por Git.
3. Para EAS Build, carga el archivo como secreto de tipo archivo del proyecto EAS con el nombre `GOOGLE_SERVICES_JSON`. EAS entrega al worker una ruta al archivo descifrado; por eso la variable contiene una ruta, no el contenido del archivo.

No incorpores una copia ficticia, el contenido del archivo ni credenciales en esta memoria. El repositorio no permite confirmar si el secreto ya existe en EAS.

## Rutas de código relacionadas

- `vercel.json`, `eas.json` y `app.config.js`
- `.env.example`, `.gitignore` y `package.json`
- `src/services/supabase.js`, `src/services/notifications.js` y `supabase/functions/send-push/`

## Limitaciones conocidas

Sin el archivo de servicios válido, un prebuild o build Android que evalúe `googleServicesFile` no puede resolver esa entrada. La exportación web y Expo Go no usan ese archivo.

## Notas relacionadas

- [Stack y estructura](stack-y-estructura.md)
- [Visión y alcance](../producto/vision-y-alcance.md)
- [Inicio de la memoria](../00-inicio.md)
