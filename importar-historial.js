#!/usr/bin/env node
// Importa los transcripts de ~/.claude/projects y reindexa la documentación registrada (incremental: se puede repetir).
// Solo revisa los archivos modificados desde la última ejecución; con --todo, los revisa todos.
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { abrir, RUTA_DB } from './db.js';
import { importarTranscript } from './transcript.js';
import { reindexarTodo } from './documentos.js';

const todo = process.argv.includes('--todo');
const raiz = process.argv.slice(2).find(a => !a.startsWith('--')) || join(homedir(), '.claude', 'projects');
const db = abrir();
const inicio = Date.now();
// Margen de 1 minuto por si un archivo se escribió mientras corría la importación anterior.
const desde = todo ? 0 : Number(db.prepare("SELECT valor FROM estado WHERE clave = 'ultima_importacion'").get()?.valor ?? 0) - 60_000;

let archivos = 0, mensajes = 0;
for (const dir of readdirSync(raiz, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const f of readdirSync(join(raiz, dir.name))) {
    if (!f.endsWith('.jsonl')) continue;
    const ruta = join(raiz, dir.name, f);
    if (statSync(ruta).mtimeMs < desde) continue;
    mensajes += importarTranscript(db, ruta);
    archivos++;
  }
}
db.prepare("INSERT INTO estado (clave, valor) VALUES ('ultima_importacion', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor")
  .run(String(inicio));
console.log(`${archivos} transcripts revisados, ${mensajes} mensajes nuevos → ${RUTA_DB}`);

// También pone al día la documentación de las fuentes registradas (solo lo que cambió).
for (const r of reindexarTodo(db)) {
  console.log(r.error ? `✗ ${r.fuente}: ${r.error}` : `${r.nombre}: ${r.actualizados} archivos reindexados, ${r.eliminados} quitados`);
}
