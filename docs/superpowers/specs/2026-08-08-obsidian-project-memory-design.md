# Diseño: memoria modular de FutFinder en Obsidian

Fecha: 2026-08-08

## Objetivo

Crear una memoria completa, modular y versionada dentro del repositorio FutFinder. La memoria debe servir a la vez como documentación humana en Obsidian y como contexto selectivo para Claude Code y Codex, reduciendo la cantidad de información cargada en cada sesión.

## Problema actual

`CLAUDE.md` contiene reglas esenciales junto con una descripción extensa de producto, arquitectura, navegación, servicios, base de datos y funcionalidades. Claude Code carga ese archivo en todas las sesiones, incluso cuando una tarea solo afecta un área. `AGENTS.md` también indica a Codex que lea `CLAUDE.md` completo. Esto repite contexto innecesario y aumenta el consumo de tokens.

## Decisión

Usar una memoria modular con un índice de enrutamiento. `CLAUDE.md` y `AGENTS.md` conservarán únicamente las reglas automáticas esenciales y dirigirán al agente hacia los documentos relevantes para la tarea. La memoria vivirá en `docs/memoria/` y esa carpeta se podrá abrir directamente como una bóveda de Obsidian.

No se incluirán capturas, videos ni otros recursos visuales. Las referencias visuales se adjuntarán solamente cuando una tarea las necesite.

## Estructura

```text
docs/
├── memoria/
│   ├── 00-inicio.md
│   ├── producto/
│   │   ├── vision-y-alcance.md
│   │   └── reglas-de-negocio.md
│   ├── arquitectura/
│   │   ├── stack-y-estructura.md
│   │   ├── navegacion.md
│   │   ├── base-de-datos.md
│   │   ├── seguridad-y-privacidad.md
│   │   └── despliegue-y-entornos.md
│   ├── funcionalidades/
│   │   ├── autenticacion.md
│   │   ├── partidos.md
│   │   ├── clubes.md
│   │   ├── chat.md
│   │   ├── perfil-y-amigos.md
│   │   ├── avisos-y-push.md
│   │   └── configuracion.md
│   ├── diseno/
│   │   └── sistema-visual.md
│   ├── operacion/
│   │   ├── estado-actual.md
│   │   ├── pendientes.md
│   │   └── pruebas.md
│   └── decisiones/
│       ├── README.md
│       └── AAAA-MM-DD-titulo.md
└── superpowers/
    └── specs/
```

## Responsabilidad de cada área

- `00-inicio.md`: portada, reglas de lectura selectiva y tabla que relaciona tipos de tarea con documentos.
- `producto/`: propósito de FutFinder y reglas que describen el comportamiento esperado, sin detalles de implementación.
- `arquitectura/`: stack, estructura, navegación, datos, seguridad, entornos y despliegue.
- `funcionalidades/`: estado vigente de cada dominio, flujos principales, servicios implicados y restricciones.
- `diseno/`: identidad visual escrita, tokens, componentes compartidos y convenciones de interfaz; no almacena imágenes.
- `operacion/`: estado comprobado, problemas vigentes, trabajo pendiente y formas de verificar el proyecto.
- `decisiones/`: decisiones duraderas con fecha, contexto, decisión y consecuencias. No se crea una entrada por cada tarea.

## Flujo de lectura para agentes

1. Claude Code carga `CLAUDE.md`; Codex carga `AGENTS.md`.
2. El archivo automático ordena consultar `docs/memoria/00-inicio.md`.
3. El agente clasifica la tarea por dominio.
4. Lee únicamente los documentos indicados por la tabla de enrutamiento.
5. Consulta otros documentos solo cuando encuentre una dependencia concreta.
6. Verifica la información relevante contra el código y las migraciones antes de actuar.

Ejemplos:

- Una corrección del chat lee `funcionalidades/chat.md` y, si cambia permisos, `arquitectura/seguridad-y-privacidad.md` y `arquitectura/base-de-datos.md`.
- Un ajuste visual de Clubes lee `funcionalidades/clubes.md` y `diseno/sistema-visual.md`.
- Una corrección de navegación autenticada lee `funcionalidades/autenticacion.md` y `arquitectura/navegacion.md`.

El agente no debe leer toda la bóveda por defecto.

## Contenido automático mínimo

`CLAUDE.md` y `AGENTS.md` conservarán:

- Una descripción de FutFinder en un párrafo.
- La regla obligatoria de sincronización Git entre los dos Macs.
- Los comandos esenciales de instalación, ejecución y verificación.
- La instrucción de usar `00-inicio.md` como enrutador y leer solo los documentos necesarios.
- La política de actualización selectiva de la memoria.
- La prohibición de guardar secretos o credenciales en la documentación.

La descripción extensa actual de `CLAUDE.md` se migrará a la memoria modular antes de ser retirada. No se perderá información vigente.

## Política de actualización selectiva

La memoria se actualiza en la misma tarea cuando cambia alguno de estos elementos:

- Comportamiento visible o flujo importante para el usuario.
- Regla de negocio.
- Navegación o arquitectura.
- Esquema, RPC, trigger, RLS o Edge Function de Supabase.
- Interfaz pública de un servicio o componente compartido.
- Convención visual global.
- Dependencia, entorno, compilación o despliegue.
- Estado de un problema importante o trabajo pendiente.
- Decisión técnica duradera y su motivo.

No se actualiza por:

- Correcciones ortográficas.
- Cambios de formato.
- Refactorizaciones internas sin cambio de comportamiento.
- Ajustes menores que no alteran cómo se usa o mantiene el sistema.
- Resultados temporales de una sesión que no representan el estado final.

## Formato de los documentos

Cada documento temático incluirá, cuando corresponda:

- Propósito y alcance.
- Estado vigente.
- Flujos y reglas.
- Archivos, servicios, tablas o RPC relacionados.
- Decisiones vigentes.
- Problemas conocidos.
- Enlaces a documentos relacionados.
- Fecha de última revisión.

Se usarán enlaces Markdown estándar en lugar de enlaces exclusivos de Obsidian. Así funcionan también en GitHub, Claude Code y Codex.

## Fuente de verdad y documentación desactualizada

La memoria explica el sistema, pero no reemplaza al código ejecutable ni a la base de datos desplegada.

Orden de autoridad:

1. Estado real desplegado, cuando pueda comprobarse de forma segura.
2. Código, migraciones y configuración versionados.
3. Memoria modular.
4. Diagnósticos e historiales antiguos.

Si el agente detecta una contradicción material, debe verificar el comportamiento, aplicar el cambio solicitado y actualizar el documento afectado durante la misma tarea. No debe copiar información dudosa a otros documentos.

## Uso con Obsidian

El usuario abrirá `FutFinder/docs/memoria` mediante **Open folder as vault**. Obsidian se usará como visor y editor de los mismos archivos Markdown que consumen los agentes.

La carpeta `.obsidian/` contiene preferencias personales y no forma parte de la memoria compartida. Debe excluirse de Git dentro de `docs/memoria/` para evitar ruido y conflictos entre Macs.

No se requieren plugins de Obsidian para la primera versión.

## Migración inicial

1. Extraer y clasificar toda la información vigente de `CLAUDE.md`.
2. Contrastar datos sensibles al tiempo con el repositorio actual: comandos, dependencias, migraciones, tests y estructura.
3. Crear la estructura modular y el índice de enrutamiento.
4. Distribuir la información sin duplicaciones sustanciales.
5. Convertir `CLAUDE.md` y `AGENTS.md` en archivos breves de entrada.
6. Añadir la exclusión de `.obsidian/` sin afectar otras reglas de `.gitignore`.
7. Revisar enlaces, rutas mencionadas y coherencia entre documentos.

## Manejo de errores y seguridad

- Ningún documento debe contener `.env`, tokens, claves privadas, credenciales o datos personales de usuarios.
- Las rutas y nombres de servicios deben comprobarse antes de documentarse.
- Los problemas no verificados se etiquetan como pendientes de confirmar; no se presentan como hechos.
- Una actualización fallida de memoria no debe ocultar ni revertir cambios funcionales ya verificados.
- Los cambios de memoria se incluyen en el mismo commit funcional cuando resultan de una tarea; la migración inicial tendrá su propio commit.

## Verificación

La implementación se considera correcta cuando:

- Todos los archivos y enlaces mencionados existen.
- `CLAUDE.md` y `AGENTS.md` son breves y suficientes para enrutar tareas.
- La información vigente del archivo original está representada en la memoria o se elimina con una justificación verificable por estar obsoleta.
- No existe una instrucción que obligue a leer toda la bóveda en cada sesión.
- Una tarea de ejemplo de Chat, Clubes y Perfil puede resolverse identificando como máximo los documentos de su dominio y dependencias directas.
- `.obsidian/` queda excluida de Git.
- No se agregan imágenes, videos ni secretos.
- Los tests y la compilación del proyecto no se ven afectados por cambios exclusivamente documentales.

## Resultado esperado

La memoria completa queda disponible para el usuario en Obsidian y para los agentes dentro del repositorio. Cada sesión carga un contexto automático pequeño y recupera información adicional solo según la tarea, reduciendo tokens repetidos sin sacrificar continuidad ni explicaciones del proyecto.
