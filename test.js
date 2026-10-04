// Pruebas: base en memoria + servidor MCP real por stdio (con una base temporal).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrir, guardar, buscar, recientes, olvidar, consultaFts, raizProyecto } from './db.js';
import { importarTranscript } from './transcript.js';

// --- db ---
const db = abrir(':memory:');
const id = guardar(db, { texto: 'Decidimos usar SQLite con FTS5 en vez de MongoDB', tipo: 'decision', proyecto: '/p', tags: 'bd' });
guardar(db, { texto: 'El índice IX_Contrato está fragmentado', tipo: 'hecho', proyecto: '/otro' });
assert.equal(buscar(db, { consulta: 'mongodb', proyecto: '/p' }).memorias[0].id, id);
assert.equal(buscar(db, { consulta: 'indice', proyecto: '/otro' }).memorias.length, 1, 'ignora tildes');
assert.equal(buscar(db, { consulta: 'indice', proyecto: '/p' }).memorias.length, 0, 'filtra por proyecto');
assert.equal(buscar(db, { consulta: 'índice' }).memorias.length, 1, 'sin proyecto busca en todos');
assert.equal(consultaFts('a"b) OR *'), '"a" OR "b" OR "OR"', 'escapa sintaxis FTS5');
assert.equal(recientes(db, { proyecto: '/p' }).length, 1);
assert.equal(olvidar(db, id), 1);

// --- transcript incremental ---
const tmp = mkdtempSync(join(tmpdir(), 'bitacora-'));
const t = join(tmp, 's.jsonl');
const l = o => JSON.stringify({ sessionId: 's1', cwd: '/p', timestamp: '2026-10-04T10:00:00Z', ...o }) + '\n';
writeFileSync(t, l({ type: 'user', message: { content: 'cómo particionar la tabla Ventas' } }) +
  l({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'Por rango de fecha.' },
    { type: 'tool_use', name: 'Bash', input: { description: 'Listar tablas' } }] } }) +
  l({ type: 'user', isMeta: true, message: { content: 'meta' } }));
assert.equal(importarTranscript(db, t), 2);
assert.equal(importarTranscript(db, t), 0, 'no duplica');
appendFileSync(t, l({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ruido' }] } }) +
  l({ type: 'user', message: { content: 'gracias' } }));
assert.equal(importarTranscript(db, t), 1, 'solo líneas nuevas, sin tool_result');
const h = buscar(db, { consulta: 'particionar', proyecto: '/p' }).mensajes;
assert.equal(h.length, 1);
assert.match(buscar(db, { consulta: 'listar tablas' }).mensajes[0].fragmento, /\[Bash\]/);

// --- raíz de proyecto: una subcarpeta de un repo git comparte memoria con la raíz ---
const repo = join(tmp, 'repo');
mkdirSync(join(repo, '.git'), { recursive: true });
mkdirSync(join(repo, 'src', 'api'), { recursive: true });
assert.equal(raizProyecto(join(repo, 'src', 'api')), repo);
assert.equal(raizProyecto(repo), repo);
assert.equal(raizProyecto(join(tmp, 'suelto')), join(tmp, 'suelto'), 'fuera de git usa la carpeta');

// --- servidor MCP por stdio ---
const env = { ...process.env, BITACORA_DB: join(tmp, 'm.db'), CLAUDE_PROJECT_DIR: join(repo, 'src') };
const srv = spawn(process.execPath, ['--no-warnings', 'server.js'], { env });
const pendientes = new Map();
let buf = '';
srv.stdout.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    pendientes.get(m.id)?.(m); pendientes.delete(m.id);
  }
});
let n = 0;
const rpc = (method, params) => new Promise(r => { const id = ++n; pendientes.set(id, r);
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const llamar = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result.content[0].text;

const ini = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
assert.equal(ini.result.serverInfo.name, 'bitacora');
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
assert.equal((await rpc('tools/list')).result.tools.length, 4);
assert.match(await llamar('bitacora_guardar', { texto: 'El PO prioriza el módulo de contratos', tipo: 'decision' }), /#1 guardada/);
assert.match(await llamar('bitacora_buscar', { consulta: 'contratos' }), /\[decision\].*módulo de contratos/);
assert.match(await llamar('bitacora_buscar', { consulta: 'contratos', proyecto: '/otro' }), /Memorias \(0\)/);
assert.match(await llamar('bitacora_recientes', {}), /#1/);
assert.match(await llamar('bitacora_recientes', { proyecto: join(repo, 'src', 'api') }), /#1/, 'subcarpeta resuelve a la raíz');
assert.match(await llamar('bitacora_buscar', { consulta: 'contratos', proyecto: '*', incluir_historial: false }), /Memorias \(1\)(?![\s\S]*Historial)/);
assert.equal((await rpc('tools/call', { name: 'nada' })).error.code, -32602);
srv.kill();
rmSync(tmp, { recursive: true });
console.log('✔ todas las pruebas pasaron');
