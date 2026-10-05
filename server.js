#!/usr/bin/env node
// Servidor MCP mínimo (stdio, JSON-RPC 2.0 por líneas) que expone la bitácora a Claude Code.
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { abrir, guardar, buscar, recientes, olvidar, raizProyecto } from './db.js';
import { indexarFuente, quitarFuente, listarFuentes, reindexarTodo } from './documentos.js';

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
    description: 'Busca por palabras en las memorias guardadas, en el historial de conversaciones pasadas ' +
      '(incluidas las ya compactadas) y en la documentación indexada (wikis, docs, ADRs). ' +
      'Úsala antes de suponer que algo no se sabe. Para leer un documento completo, abre su ruta.',
    inputSchema: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Palabras a buscar (se ignoran tildes y mayúsculas).' },
        proyecto: pProyecto,
        limite: { type: 'number', description: 'Máximo de resultados por tabla (por defecto 10).' },
        incluir_historial: { type: 'boolean', description: 'Buscar también en conversaciones pasadas (por defecto true).' },
        incluir_documentos: { type: 'boolean', description: 'Buscar también en la documentación indexada, de todas las fuentes (por defecto true).' },
      },
      required: ['consulta'],
    },
    run: a => {
      const incluirHistorial = a.incluir_historial ?? true;
      const incluirDocumentos = a.incluir_documentos ?? true;
      const r = buscar(db, {
        consulta: a.consulta, proyecto: resolverProyecto(a.proyecto), limite: a.limite ?? 10, incluirHistorial, incluirDocumentos,
      });
      const mem = r.memorias.map(m => `#${m.id} [${m.tipo}] ${m.creado.slice(0, 10)} ${m.tags ? `(${m.tags}) ` : ''}${m.texto}`);
      const msj = r.mensajes.map(m => `${m.ts.slice(0, 16)} ${m.rol} · sesión ${m.sesion.slice(0, 8)} · ${m.proyecto}\n  ${m.fragmento}`);
      const salida = [`## Memorias (${mem.length})`, ...(mem.length ? mem : ['—'])];
      if (incluirHistorial) salida.push(`\n## Historial (${msj.length})`, ...(msj.length ? msj : ['—']));
      if (incluirDocumentos) {
        const docs = r.documentos.map(d => `${d.titulo} · ${d.nombre ?? d.fuente}\n  ${d.ruta}\n  ${d.fragmento}`);
        salida.push(`\n## Documentos (${docs.length})`, ...(docs.length ? docs : ['—']));
      }
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
    name: 'bitacora_indexar',
    description: 'Indexa documentación en markdown (una carpeta de wiki, docs, ADRs o un archivo .md) para que bitacora_buscar la encuentre. ' +
      'La fuente queda registrada y se reindexa sola, de forma incremental, al iniciar cada sesión. ' +
      'Sin ruta: reindexa todas las fuentes y las lista. Con quitar=true: la quita del índice.',
    inputSchema: {
      type: 'object',
      properties: {
        ruta: { type: 'string', description: 'Carpeta o archivo .md (ruta absoluta o relativa al proyecto).' },
        nombre: { type: 'string', description: 'Nombre corto de la fuente, p. ej. "wiki DRP". Por defecto, el nombre de la carpeta.' },
        quitar: { type: 'boolean', description: 'Quitar la fuente y todo lo indexado de ella.' },
      },
    },
    run: a => {
      if (a.ruta && a.quitar) {
        return quitarFuente(db, resolve(proyectoActual, a.ruta)) ? 'Fuente quitada del índice.' : 'Esa fuente no estaba registrada.';
      }
      const resultados = a.ruta ? [indexarFuente(db, resolve(proyectoActual, a.ruta), a.nombre)] : reindexarTodo(db);
      const cambios = resultados.map(r => r.error
        ? `✗ ${r.fuente}: ${r.error}`
        : `✓ ${r.nombre}: ${r.archivos} archivos, ${r.actualizados} indexados (${r.fragmentos} fragmentos), ${r.eliminados} quitados`);
      const fuentes = listarFuentes(db).map(f => `- ${f.nombre} · ${f.archivos} archivos, ${f.fragmentos} fragmentos · ${f.ruta}`);
      return [...cambios, '', `## Fuentes registradas (${fuentes.length})`, ...(fuentes.length ? fuentes : ['—'])].join('\n');
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
        serverInfo: { name: 'bitacora', version: '0.3.0' },
        instructions: 'Memoria persistente entre sesiones. Busca con bitacora_buscar antes de preguntar al usuario algo ' +
          'que pudo tratarse antes (también busca en la documentación indexada); guarda con bitacora_guardar las decisiones, ' +
          'hechos y preferencias que valga la pena recordar; indexa con bitacora_indexar la documentación en markdown que se consulte seguido.',
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
