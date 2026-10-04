#!/usr/bin/env node
// Servidor MCP mínimo (stdio, JSON-RPC 2.0 por líneas) que expone la bitácora a Claude Code.
import { createInterface } from 'node:readline';
import { abrir, guardar, buscar, recientes, olvidar, raizProyecto } from './db.js';

const db = abrir();
const proyectoActual = raizProyecto(process.env.CLAUDE_PROJECT_DIR || process.cwd());

const TIPOS = ['hecho', 'decision', 'tarea', 'nota', 'resumen', 'preferencia'];
const pProyecto = { type: 'string', description: 'Ruta del proyecto. Por defecto, el proyecto actual. Usa "*" para todos.' };

const herramientas = [
  {
    name: 'bitacora_guardar',
    description: 'Guarda una memoria duradera: un hecho del proyecto, una decisión con su motivo, una tarea pendiente, ' +
      'una preferencia del usuario o un resumen de trabajo. Escribe el texto autocontenido, para entenderlo sin la conversación.',
    inputSchema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Contenido de la memoria.' },
        tipo: { type: 'string', enum: TIPOS, description: 'Clase de memoria (por defecto "nota").' },
        tags: { type: 'string', description: 'Palabras clave separadas por espacios.' },
        proyecto: pProyecto,
      },
      required: ['texto'],
    },
    run: a => {
      const id = guardar(db, { texto: a.texto, tipo: a.tipo, tags: a.tags, proyecto: resolverProyecto(a.proyecto) ?? '' });
      return `Memoria #${id} guardada.`;
    },
  },
  {
    name: 'bitacora_buscar',
    description: 'Busca por palabras en las memorias guardadas y en el historial de conversaciones pasadas ' +
      '(incluidas las ya compactadas). Úsala antes de suponer que algo no se sabe.',
    inputSchema: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Palabras a buscar (se ignoran tildes y mayúsculas).' },
        proyecto: pProyecto,
        limite: { type: 'number', description: 'Máximo de resultados por tabla (por defecto 10).' },
        incluir_historial: { type: 'boolean', description: 'Buscar también en conversaciones pasadas (por defecto true).' },
      },
      required: ['consulta'],
    },
    run: a => {
      const incluirHistorial = a.incluir_historial ?? true;
      const r = buscar(db, { consulta: a.consulta, proyecto: resolverProyecto(a.proyecto), limite: a.limite ?? 10, incluirHistorial });
      const mem = r.memorias.map(m => `#${m.id} [${m.tipo}] ${m.creado.slice(0, 10)} ${m.tags ? `(${m.tags}) ` : ''}${m.texto}`);
      const msj = r.mensajes.map(m => `${m.ts.slice(0, 16)} ${m.rol} · sesión ${m.sesion.slice(0, 8)} · ${m.proyecto}\n  ${m.fragmento}`);
      const salida = [`## Memorias (${mem.length})`, ...(mem.length ? mem : ['—'])];
      if (incluirHistorial) salida.push(`\n## Historial (${msj.length})`, ...(msj.length ? msj : ['—']));
      return salida.join('\n');
    },
  },
  {
    name: 'bitacora_recientes',
    description: 'Lista las memorias más recientes del proyecto.',
    inputSchema: {
      type: 'object',
      properties: { proyecto: pProyecto, limite: { type: 'number', description: 'Por defecto 15.' } },
    },
    run: a => {
      const rs = recientes(db, { proyecto: resolverProyecto(a.proyecto), limite: a.limite ?? 15 });
      return rs.length ? rs.map(m => `#${m.id} [${m.tipo}] ${m.creado.slice(0, 10)} ${m.texto}`).join('\n') : 'Sin memorias.';
    },
  },
  {
    name: 'bitacora_olvidar',
    description: 'Borra una memoria por su id, cuando quedó obsoleta o era incorrecta.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    run: a => (olvidar(db, a.id) ? `Memoria #${a.id} borrada.` : `No existe la memoria #${a.id}.`),
  },
];

// undefined = sin filtro (todos los proyectos).
function resolverProyecto(p) {
  if (p === '*') return undefined;
  return p ? raizProyecto(p) : proyectoActual;
}

function responder(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function error(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'); }

function atender(msg) {
  const { id, method, params = {} } = msg;
  if (id === undefined) return; // notificaciones (p. ej. notifications/initialized): no se responden
  switch (method) {
    case 'initialize':
      return responder(id, {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'bitacora', version: '0.2.0' },
        instructions: 'Memoria persistente entre sesiones. Busca con bitacora_buscar antes de preguntar al usuario algo ' +
          'que pudo tratarse antes; guarda con bitacora_guardar las decisiones, hechos y preferencias que valga la pena recordar.',
      });
    case 'ping':
      return responder(id, {});
    case 'tools/list':
      return responder(id, { tools: herramientas.map(({ run, ...h }) => h) });
    case 'tools/call': {
      const h = herramientas.find(t => t.name === params.name);
      if (!h) return error(id, -32602, `Herramienta desconocida: ${params.name}`);
      try {
        return responder(id, { content: [{ type: 'text', text: h.run(params.arguments || {}) }] });
      } catch (e) {
        return responder(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
    }
    default:
      return error(id, -32601, `Método no soportado: ${method}`);
  }
}

createInterface({ input: process.stdin }).on('line', linea => {
  if (!linea.trim()) return;
  let msg;
  try { msg = JSON.parse(linea); } catch { return error(null, -32700, 'JSON inválido'); }
  for (const m of Array.isArray(msg) ? msg : [msg]) atender(m);
});
