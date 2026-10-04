# memoria-claude

Memoria persistente para Claude Code. Guarda las conversaciones y las memorias curadas en SQLite con
búsqueda de texto completo (FTS5), para recuperar lo que la compactación sacó del contexto.

- **Sin dependencias:** usa `node:sqlite`, incluido en Node ≥ 22.13. No hay `npm install`.
- **Base:** `~/.memoria/memoria.db` (se puede cambiar con la variable `MEMORIA_DB`).

## Piezas

| Archivo | Qué hace |
|---|---|
| `server.js` | Servidor MCP (stdio). Herramientas: `memoria_guardar`, `memoria_buscar`, `memoria_recientes`, `memoria_olvidar` |
| `hooks/inicio-sesion.js` | Hook `SessionStart`: inyecta las memorias recientes del proyecto al iniciar, reanudar o compactar |
| `hooks/guardar-transcript.js` | Hooks `Stop` y `PreCompact`: copia a la base los mensajes nuevos de la sesión |
| `importar-historial.js` | Importa todos los transcripts de `~/.claude/projects` (incremental, se puede repetir) |
| `db.js`, `transcript.js` | Esquema, búsqueda e importación |

Qué se guarda del historial: los mensajes de texto del usuario y del asistente, más una línea por cada
herramienta usada (`[Bash] descripción`). No se guarda el razonamiento interno ni las salidas de las herramientas.

## Instalación

```sh
# 1. Registrar el servidor MCP para todos los proyectos
claude mcp add memoria --scope user -- "$(which node)" --no-warnings ~/Proyectos/memoria-claude/server.js

# 2. Importar el historial existente
npm run importar-historial
```

3. Agregar los hooks a `~/.claude/settings.json` (reemplazar `/ruta/a/node` por la salida de `which node`):

```json
"hooks": {
  "SessionStart": [{ "hooks": [{ "type": "command", "timeout": 10,
    "command": "/ruta/a/node --no-warnings /Users/rborlone/Proyectos/memoria-claude/hooks/inicio-sesion.js" }] }],
  "Stop": [{ "hooks": [{ "type": "command", "timeout": 10,
    "command": "/ruta/a/node --no-warnings /Users/rborlone/Proyectos/memoria-claude/hooks/guardar-transcript.js" }] }],
  "PreCompact": [{ "hooks": [{ "type": "command", "timeout": 10,
    "command": "/ruta/a/node --no-warnings /Users/rborlone/Proyectos/memoria-claude/hooks/guardar-transcript.js" }] }]
}
```

Para desinstalar: `claude mcp remove memoria --scope user` y quitar el bloque `hooks`.

## Pruebas

```sh
npm test
```

## Consultas directas

```sh
sqlite3 ~/.memoria/memoria.db "SELECT rowid, tipo, texto FROM memorias WHERE memorias MATCH 'contrato' ORDER BY bm25(memorias)"
```

## Próximos pasos posibles

- Búsqueda semántica: embeddings locales (Ollama) + extensión `sqlite-vec`
- Resumen automático por sesión al compactar
- Memoria compartida entre los agentes del equipo (PO, DBA, arquitecto…)
