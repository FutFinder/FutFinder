# Despliegue y entornos

Última revisión: 2026-08-13

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

El cierre de U3 del 2026-08-13 no ejecutó ningún build nativo. La exportación web pasa, pero sigue avisando que no puede resolver `./google-services.json`; antes de un futuro build Android hay que confirmar que EAS tenga configurado el secreto de archivo `GOOGLE_SERVICES_JSON`.

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

## Edge Functions y sus secretos

`supabase/config.toml` (desde 2026-09-10) declara el `verify_jwt` de cada función y por qué. Es la parte que no se ve en el código y la que se rompe en silencio: una función que recibe avisos de afuera con la verificación puesta devuelve 401 al proveedor y el aviso se pierde sin dejar rastro en nuestros logs.

| Función | `verify_jwt` | Quién la llama |
|---|---|---|
| `send-push` | sí | Database Webhook de Supabase |
| `pagar-reserva` | sí | la app, con la sesión del jugador |
| `flow-confirmacion` | **no** | Flow, de servidor a servidor |
| `flow-retorno` | **no** | el navegador del jugador volviendo de Flow |
| `solicitud-recinto` | sí | la app, con la sesión de quien manda el formulario |

Las dos sin verificación no quedan desprotegidas: `flow-confirmacion` no le cree al POST que recibe —solo toma el `token` y va a preguntarle a Flow con una consulta firmada con la Secret Key— y `flow-retorno` no lee ni escribe nada, solo muestra una página que rebota a la app.

**Secretos de la pasarela** (Supabase → Edge Functions → Secrets; ninguno va en el repo ni en esta memoria):

- `FLOW_API_KEY` y `FLOW_SECRET_KEY` — de la cuenta de comercio de Flow.
- `FLOW_AMBIENTE` — `sandbox` por omisión; `produccion` hay que escribirlo a propósito, para que nadie cobre plata de verdad por olvidarse de una variable.
- `FUNCTIONS_BASE_URL` — opcional, solo si hay un dominio propio delante. Sin ella las URL de retorno se deducen de `SUPABASE_URL`, que Supabase inyecta sola.
- `APP_RETORNO_URL` — opcional; adónde rebota `flow-retorno`. Por omisión `futfinder://`.

**Secretos del aviso de solicitudes de recinto** (los lee `_shared/correoSolicitud.ts`; tampoco van en el repo):

- `RESEND_API_KEY` — del proveedor de correo. **No hay cuenta todavía**, igual que con Flow.
- `SOLICITUDES_EMAIL_TO` — a dónde llegan las solicitudes. Admite varias direcciones separadas por coma.
- `SOLICITUDES_EMAIL_FROM` — opcional; el remitente verificado. Por omisión el de prueba del proveedor.

**Sin esos dos primeros nada explota**: la solicitud igual queda escrita en `solicitudes_recinto` y la función contesta `ok: true` con `avisada: false`. El correo es el aviso, no el registro, así que encender los secretos después no pierde ninguna solicitud anterior — se leen de la tabla.

**`verify_jwt: true` NO garantiza que haya sesión**, y esto se descubrió probando `solicitud-recinto` en el navegador sin cuenta: la clave anónima es un JWT válido, así que la función corre igual y choca con el `grant ... to authenticated` de la RPC que llama. Vale para cualquier función futura: si necesita una sesión de verdad, tiene que comprobarla ella —o traducir el 42501 a un mensaje honesto, que es lo que hace esta— en vez de confiar en `verify_jwt`.

**Sin `FLOW_API_KEY`/`FLOW_SECRET_KEY` nada explota**: `pagar-reserva` contesta `configurada: false` y la app deja el botón de pago apagado diciendo que el medio de pago todavía no está conectado. Comprobado contra producción el 2026-09-10, con las tres funciones desplegadas y sin credenciales cargadas.
