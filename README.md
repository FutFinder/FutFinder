# FutFinder

App para buscar y completar partidos de fútbol amateur en Santiago, Chile.

## Stack

- **Expo SDK 52** (React Native + web)
- **React Navigation v7** (navegación entre pantallas)
- **Lucide React Native** (íconos)
- **react-native-svg** (logo vectorial)
- **Vercel** (hosting de la versión web)

## Estructura

```
FutFinder/
├── App.js                       # Raíz: SafeAreaProvider + navegador
├── index.js                     # Entry point de Expo
├── app.json                     # Configuración de Expo (nombre, splash, web…)
├── vercel.json                  # Configuración de deploy en Vercel
├── package.json                 # Dependencias
└── src/
    ├── components/              # Componentes reutilizables
    │   ├── Logo.js              # Logo SVG (pin + balón + texto)
    │   ├── Button.js            # Botón corporativo
    │   └── FeatureCard.js       # Card de feature (Welcome)
    ├── navigation/
    │   └── AppNavigator.js      # Stack: Welcome → Login → Home
    ├── screens/
    │   ├── WelcomeScreen.js     # Pantalla de bienvenida
    │   ├── LoginScreen.js       # Login / registro
    │   └── HomeScreen.js        # Home con partidos cercanos
    ├── services/
    │   └── auth.js              # Placeholder para Supabase (Fase 2)
    └── theme/
        └── colors.js            # Paleta y tokens de diseño
```

## Comandos

```bash
# Instalar dependencias (solo la primera vez)
npm install

# Levantar en navegador (desarrollo)
npm run web

# Build para producción (lo usa Vercel)
npm run build:web
```

## Paleta

- Fondo: `#201F1D`
- Verde principal: `#71B533`
- Verde secundario: `#3F762F`
