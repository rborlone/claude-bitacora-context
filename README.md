# Bitácora

Memoria persistente entre sesiones para [Claude Code](https://claude.com/claude-code).

Claude Code compacta la conversación cuando se llena el contexto, y en ese resumen se pierde detalle. Bitácora
guarda cada conversación y las memorias importantes (decisiones, hechos, preferencias) en una base SQLite local
con búsqueda de texto completo. Así Claude puede recuperar lo que salió del contexto, también en sesiones futuras.

- **Sin dependencias:** usa `node:sqlite`, que viene con Node. No hay `npm install`.
- **Local:** todo queda en `~/.bitacora/bitacora.db`; nada sale de tu máquina.
- **Rápida:** 70 MB de transcripts quedan en una base de ~3 MB; una búsqueda tarda unos 60 ms.
- **Un proyecto = un repo git:** las memorias se separan por la raíz del repositorio, aunque abras Claude en una subcarpeta.

## Requisitos

- Claude Code
- Node.js ≥ 22.13 (en el `PATH`)

## Instalación

Dentro de Claude Code:

```
/plugin marketplace add rborlone/claude-bitacora-context
/plugin install bitacora@bitacora-context
```

Reinicia Claude Code. En la primera sesión, Bitácora importa en segundo plano tu historial de conversaciones
(`~/.claude/projects`), así que las sesiones anteriores también quedan disponibles para buscar.

Para desinstalar: `/plugin uninstall bitacora@bitacora-context`. La base en `~/.bitacora/` no se borra; elimínala a mano si quieres.

## Uso

Casi todo es automático:

| Cuándo | Qué pasa |
|---|---|
| Inicias, reanudas o compactas una sesión | Claude recibe las memorias recientes del proyecto |
| Claude termina cada respuesta | Los mensajes nuevos se guardan en la base |
| Antes de compactar | Se guarda todo lo pendiente |

Y le hablas a Claude en lenguaje normal:

- *"Busca en la bitácora qué decidimos sobre el merge de PDFs"*
- *"Recuerda que los deploys a preprod son solo los jueves"*
- *"¿Qué memorias tienes de este proyecto?"*
- *"Busca en todos los proyectos cómo configuramos Serilog"*
- *"Olvida la memoria #12, ya no aplica"*

### Herramientas MCP

| Herramienta | Qué hace |
|---|---|
| `bitacora_guardar` | Guarda una memoria: `hecho`, `decision`, `tarea`, `nota`, `resumen` o `preferencia` |
| `bitacora_buscar` | Busca en las memorias y en el historial de conversaciones. Ignora tildes y mayúsculas |
| `bitacora_recientes` | Lista las memorias más recientes del proyecto |
| `bitacora_olvidar` | Borra una memoria por id |

Por defecto todas trabajan sobre el proyecto actual; con `proyecto: "*"` abarcan todos.

### Consultas directas

```sh
sqlite3 ~/.bitacora/bitacora.db "SELECT rowid, tipo, texto FROM memorias WHERE memorias MATCH 'contrato' ORDER BY bm25(memorias)"
```

## Qué se guarda

- **Memorias:** lo que Claude guarda explícitamente con `bitacora_guardar`.
- **Historial:** los mensajes de texto del usuario y de Claude, más una línea por cada herramienta usada
  (por ejemplo `[Bash] Listar tablas`). No se guarda el razonamiento interno ni la salida de las herramientas.

> El historial incluye lo que escribes en las conversaciones. Si alguna vez pegaste credenciales en un prompt,
> también quedan en la base: trátala como tratas `~/.claude/projects`.

La ruta de la base se puede cambiar con la variable de entorno `BITACORA_DB`.

## Estructura

| Archivo | Qué hace |
|---|---|
| `.claude-plugin/plugin.json` | Manifiesto del plugin |
| `.claude-plugin/marketplace.json` | Permite instalar el repo con `/plugin marketplace add` |
| `.mcp.json` | Registra el servidor MCP |
| `hooks/hooks.json` | Registra los hooks `SessionStart`, `Stop` y `PreCompact` |
| `server.js` | Servidor MCP (stdio, JSON-RPC), sin SDK |
| `hooks/inicio-sesion.js` | Inyecta las memorias recientes y lanza la importación inicial |
| `hooks/guardar-transcript.js` | Copia los mensajes nuevos de la sesión a la base |
| `importar-historial.js` | Importa todos los transcripts existentes (incremental, se puede repetir) |
| `db.js`, `transcript.js` | Esquema, búsqueda e importación |

## Desarrollo

```sh
npm test                         # pruebas (base en memoria + servidor MCP real)
claude --plugin-dir .            # probar el plugin local sin instalarlo
claude plugin validate .         # validar los manifiestos
npm run importar-historial       # reimportar el historial a mano
```

## Ideas para más adelante

- Búsqueda semántica con embeddings locales (Ollama) y la extensión `sqlite-vec`
- Resumen automático de cada sesión al compactar
- Memoria compartida entre varios agentes (PO, DBA, arquitecto…)
