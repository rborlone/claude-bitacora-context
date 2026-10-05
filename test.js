// Pruebas: base en memoria + servidor MCP real por stdio (con una base temporal).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrir, guardar, buscar, recientes, olvidar, consultaFts, raizProyecto } from './db.js';
import { importarTranscript } from './transcript.js';
import { trocear, tituloDeArchivo, indexarFuente, quitarFuente, listarFuentes } from './documentos.js';

// --- db ---
const db = abrir(':memory:');
const id = guardar(db, { texto: 'Decidimos usar SQLite con FTS5 en vez de MongoDB', tipo: 'decision', proyecto: '/p', tags: 'bd' });
guardar(db, { texto: 'El índice IX_Contrato está fragmentado', tipo: 'hecho', proyecto: '/otro' });
assert.equal(buscar(db, { consulta: 'mongodb', proyecto: '/p' }).memorias[0].id, id);
assert.equal(buscar(db, { consulta: 'indice', proyecto: '/otro' }).memorias.length, 1, 'ignora tildes');
assert.equal(buscar(db, { consulta: 'indice', proyecto: '/p' }).memorias.length, 0, 'filtra por proyecto');
assert.equal(buscar(db, { consulta: 'índice' }).memorias.length, 1, 'sin proyecto busca en todos');
assert.equal(consultaFts('x"b) NEAR *'), '"x" OR "b" OR "NEAR"', 'escapa sintaxis FTS5');
assert.equal(consultaFts('recuperación de la base de datos'), '"recuperación" OR "base" OR "datos"', 'quita palabras vacías');
assert.equal(consultaFts('de la'), '"de" OR "la"', 'si solo hay palabras vacías, las usa');
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

// --- documentos: troceo por sección ---
assert.equal(tituloDeArchivo('/w/Plan-de-Recuperaci%C3%B3n.md'), 'Plan de Recuperación', 'decodifica nombres de wiki de Azure DevOps');
const frag = trocear('Intro sin título\n# Plan DRP\nTexto\n## RTO y RPO\nRTO 4 horas\n\`\`\`sh\n# esto no es un título\n\`\`\`\n## Vacío\n', 'Plan DRP');
assert.deepEqual(frag.map(f => f.titulo), ['Plan DRP', 'Plan DRP', 'Plan DRP › RTO y RPO', 'Plan DRP › Vacío']);
assert.match(frag[2].texto, /esto no es un título/, 'los # dentro de bloques de código no cortan');
const largo = trocear(Array.from({ length: 30 }, (_, i) => `Párrafo ${i} ` + 'x'.repeat(300)).join('\n\n'), 'Largo');
assert.ok(largo.length > 1 && largo.every(f => f.texto.length <= 4000), 'secciones largas se cortan por párrafo');

// --- documentos: indexado incremental ---
const wiki = join(tmp, 'wiki');
mkdirSync(join(wiki, '03-Operacional'), { recursive: true });
mkdirSync(join(wiki, '.attachments'));
writeFileSync(join(wiki, 'Home.md'), '# Inicio\nBienvenida a la wiki');
writeFileSync(join(wiki, '03-Operacional', 'Recuperaci%C3%B3n-de-base-de-datos.md'),
  '# Restaurar SQL Server\nUsar el backup geo-redundante.\n## Tiempos\nEl RTO objetivo es de 4 horas.');
writeFileSync(join(wiki, '.attachments', 'oculto.md'), 'no indexar');
let r = indexarFuente(db, wiki, 'wiki DRP');
assert.deepEqual([r.archivos, r.actualizados, r.eliminados], [2, 2, 0]);
const d = buscar(db, { consulta: 'rto objetivo', proyecto: '/cualquiera' }).documentos;
assert.equal(d.length, 1, 'los documentos no se filtran por proyecto');
assert.equal(d[0].titulo, '03 Operacional / Recuperación de base de datos › Tiempos');
assert.equal(d[0].nombre, 'wiki DRP');
assert.equal(buscar(db, { consulta: 'oculto' }).documentos.length, 0, 'ignora carpetas ocultas');
assert.equal(buscar(db, { consulta: 'rto', incluirDocumentos: false }).documentos.length, 0);

r = indexarFuente(db, wiki);
assert.equal(r.actualizados, 0, 'sin cambios no reindexa');
assert.equal(r.nombre, 'wiki DRP', 'conserva el nombre registrado');
writeFileSync(join(wiki, 'Home.md'), '# Inicio\nContactos de escalamiento');
utimesSync(join(wiki, 'Home.md'), new Date(), new Date(Date.now() + 5000));
rmSync(join(wiki, '03-Operacional'), { recursive: true });
r = indexarFuente(db, wiki);
assert.deepEqual([r.actualizados, r.eliminados], [1, 1]);
assert.equal(buscar(db, { consulta: 'bienvenida' }).documentos.length, 0, 'reemplaza el contenido modificado');
assert.equal(buscar(db, { consulta: 'escalamiento' }).documentos.length, 1);
assert.equal(buscar(db, { consulta: 'rto' }).documentos.length, 0, 'quita los archivos borrados');
assert.equal(listarFuentes(db)[0].archivos, 1);
assert.equal(quitarFuente(db, wiki), 1);
assert.equal(buscar(db, { consulta: 'escalamiento' }).documentos.length, 0);
assert.equal(listarFuentes(db).length, 0);

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
assert.equal((await rpc('tools/list')).result.tools.length, 5);
assert.match(await llamar('bitacora_guardar', { texto: 'El PO prioriza el módulo de contratos', tipo: 'decision' }), /#1 guardada/);
assert.match(await llamar('bitacora_buscar', { consulta: 'contratos' }), /\[decision\].*módulo de contratos/);
assert.match(await llamar('bitacora_buscar', { consulta: 'contratos', proyecto: '/otro' }), /Memorias \(0\)/);
assert.match(await llamar('bitacora_recientes', {}), /#1/);
assert.match(await llamar('bitacora_recientes', { proyecto: join(repo, 'src', 'api') }), /#1/, 'subcarpeta resuelve a la raíz');
assert.match(await llamar('bitacora_buscar', { consulta: 'contratos', proyecto: '*', incluir_historial: false }), /Memorias \(1\)(?![\s\S]*Historial)/);
writeFileSync(join(wiki, 'Arquitectura.md'), '# Arquitectura\nLos backends usan Serilog.');
assert.match(await llamar('bitacora_indexar', { ruta: wiki, nombre: 'wiki' }), /✓ wiki: 2 archivos, 2 indexados[\s\S]*Fuentes registradas \(1\)/);
assert.match(await llamar('bitacora_buscar', { consulta: 'serilog' }), /## Documentos \(1\)\nArquitectura · wiki/);
assert.match(await llamar('bitacora_indexar', {}), /✓ wiki: 2 archivos, 0 indexados/);
assert.match(await llamar('bitacora_indexar', { ruta: join(tmp, 'no-existe') }), /^Error: /);
assert.match(await llamar('bitacora_indexar', { ruta: wiki, quitar: true }), /quitada/);
assert.equal((await rpc('tools/call', { name: 'nada' })).error.code, -32602);
srv.kill();
rmSync(tmp, { recursive: true });
console.log('✔ todas las pruebas pasaron');
