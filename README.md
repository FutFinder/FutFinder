# FutFinder

Aplicación móvil y web para descubrir, crear, organizar y completar partidos de fútbol amateur en Chile.

La documentación vigente de producto, arquitectura, diseño, operación y decisiones está en la [memoria de FutFinder](docs/memoria/00-inicio.md). Empieza allí: el índice indica la única nota principal que corresponde a cada tipo de cambio.

## Estado del repositorio

- Expo SDK 54, React Native 0.81 y React 19, con soporte web.
- React Navigation 7, Supabase y Edge Functions para los dominios de la aplicación.
- Módulos de partidos, clubes, chat, avisos, perfil, amistades, privacidad y configuración.
- Exportación web para Vercel y perfiles de build nativo con EAS.

## Comandos

```bash
# Instalar dependencias (solo la primera vez)
npm install

# Levantar en navegador (desarrollo)
npm run web

# Build para producción (lo usa Vercel)
npm run build:web
```

Consulta [Despliegue y entornos](docs/memoria/arquitectura/despliegue-y-entornos.md) antes de configurar variables, servicios de Firebase o builds remotos.
