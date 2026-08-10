# Stack y estructura

Última revisión: 2026-08-08

## Propósito

Describir el stack y los límites entre capas para orientar cambios técnicos sin sustituir la lectura del código afectado.

## Estado verificado

FutFinder usa Expo SDK 54 (`expo` `~54.0.36`) sobre React Native `0.81.5` y React `19.1.0`; Expo exporta también la web mediante Metro. La navegación es React Navigation 7 y la aplicación usa Supabase para Auth, Postgres, Realtime, Storage y Edge Functions.

## Dependencias de aplicación

- Navegación e interfaz: `@react-navigation/native`, `@react-navigation/native-stack`, `@react-navigation/bottom-tabs`, `react-native-screens`, `react-native-safe-area-context`, `react-native-gesture-handler`, `@expo/react-native-action-sheet`, `expo-status-bar`, `lucide-react-native` y `rn-emoji-keyboard`.
- Capacidades Expo: `expo-constants`, `expo-device`, `expo-image-manipulator`, `expo-image-picker`, `expo-linear-gradient`, `expo-location` y `expo-notifications`.
- Datos y persistencia local: `@supabase/supabase-js`, `@react-native-async-storage/async-storage` y `react-native-url-polyfill`.
- Plataforma, estilos y mapas: `react-native-web`, `react-dom`, `react-native-maps`, `react-native-reanimated`, `react-native-worklets`, `nativewind`, `tailwindcss`, `react-native-css-interop`, `react-native-svg` y `@expo/metro-runtime`.

Los scripts versionados son `start`, `android`, `ios`, `web`, `build:web` y `test`; consulta `package.json` para sus comandos exactos.

## Estructura actual

| Ruta | Responsabilidad |
|---|---|
| `src/screens/` | Pantallas de onboarding, partidos, clubes, chat, avisos, perfil y ajustes. |
| `src/components/` | Componentes compartidos y por dominio: `chat`, `club`, `ds`, `home`, `notifications`, `partidos` y `player`. |
| `src/services/` | Frontera del cliente con Supabase, ubicación, almacenamiento local y datos de demostración. |
| `src/navigation/` | Stack principal, pestañas, enlaces profundos y guardas de sesión. |
| `src/contexts/` | Estado compartido de autenticación. |
| `src/data/` | Datos estáticos, incluidos regiones y comunas chilenas. |
| `src/theme/` | Tokens visuales compartidos. |
| `src/utils/` | Transformaciones y utilidades; sus pruebas de Node están en `src/utils/__tests__/`. |
| `supabase/` | Esquema, 40 migraciones numeradas, pruebas SQL y la Edge Function `send-push`. |

## Resolución por plataforma

Metro selecciona `MatchMap.native.js` o `MatchMap.web.js` al importar `MatchMap`, según la plataforma. La versión nativa usa `react-native-maps`; la versión web actúa como alternativa compatible. Metro se configura en `metro.config.js` y NativeWind toma `global.css` como entrada.

## Límites de servicios

- Las pantallas y componentes consumen funciones asíncronas de `src/services/`; esa capa no debe repartirse en llamadas directas a Supabase desde la UI.
- `src/services/supabase.js` crea el cliente y determina `isSupabaseConfigured`; Auth persiste con AsyncStorage en nativo y usa el comportamiento web de Supabase en web.
- Los servicios de partidos, clubes, mensajes, avisos, amistades, perfil, almacenamiento, galerías, calificaciones y ajustes encapsulan consultas, RPC y sus retornos de demostración.
- PostgreSQL y las migraciones imponen integridad, RLS y RPC; `supabase/functions/send-push/` separa el envío de push del cliente.

## Rutas de código relacionadas

- `package.json`, `App.js`, `metro.config.js`, `babel.config.js` y `tailwind.config.js`
- `src/navigation/AppNavigator.js`, `src/navigation/MainTabs.js` y `src/contexts/AuthContext.js`
- `src/components/MatchMap.native.js`, `src/components/MatchMap.web.js` y `src/services/supabase.js`
- `supabase/schema.sql`, `supabase/migrations/` y `supabase/functions/send-push/`

## Limitaciones conocidas

El repositorio prueba utilidades y la lógica de push, pero la disponibilidad de servicios remotos depende de Supabase y de las variables de entorno del entorno que se ejecute.

## Notas relacionadas

- [Despliegue y entornos](despliegue-y-entornos.md)
- [Reglas de negocio](../producto/reglas-de-negocio.md)
- [Inicio de la memoria](../00-inicio.md)
