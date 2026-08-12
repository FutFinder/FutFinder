# FutFinder — instrucciones para Claude Code

## Proyecto
FutFinder es una aplicación de fútbol amateur construida con React Native/Expo y Supabase. Incluye partidos, clubes, chat, perfiles, amistades, reputación y avisos. Todo texto visible para usuarios debe escribirse en español de Chile.

## Antes de editar
Este repositorio se trabaja desde dos Macs. Ejecuta `git pull` antes de tocar archivos. Si aparecen conflictos o cambios ajenos, detente y comunícalos; no los resuelvas automáticamente, no descartes trabajo y nunca uses push forzado sin autorización explícita.

## Memoria selectiva
Consulta `docs/memoria/00-inicio.md`, clasifica la tarea y lee únicamente la nota principal del dominio y las dependencias directas indicadas. No leas toda la bóveda por defecto. Verifica contra el código y las migraciones cualquier dato sensible al tiempo.

## Al terminar
Ejecuta `npm run verify` (lint + pruebas) y revisa `git status`.
`npm run lint` tiene que salir con **cero errores**: la configuración es corta
a propósito y solo marca fallos reales, así que un error es un fallo de verdad.
Los avisos son deuda conocida y no bloquean. Si tocaste la interfaz, `no-undef`
es la regla que atrapa el typo que Babel no ve y que deja la pantalla en blanco. Conserva cambios ajenos. Añade solo los archivos de la tarea, crea un commit descriptivo y ejecuta `git push` de inmediato. Si el cambio fue material, actualiza en el mismo commit únicamente las notas de memoria afectadas.

## Comandos esenciales
```bash
npm install
npm run web
npm run ios
npm run android
npm test
npm run lint
npm run verify      # lint + pruebas: lo mínimo antes de dar algo por terminado
npm run build:web
```

## Seguridad y documentación
No guardes `.env`, tokens, claves, credenciales ni datos personales en documentación o commits. Si una nota contradice el código vigente, comprueba el comportamiento y corrige solo la nota afectada. No actualices la memoria por formato, ortografía o refactorizaciones sin cambio de comportamiento.
