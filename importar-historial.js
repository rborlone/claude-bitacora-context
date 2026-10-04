#!/usr/bin/env node
// Importa los transcripts de ~/.claude/projects (incremental: se puede repetir).
// Solo revisa los archivos modificados desde la última ejecución; con --todo, los revisa todos.
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { abrir, RUTA_DB } from './db.js';
import { importarTranscript } from './transcript.js';

const todo = process.argv.includes('--todo');
const raiz = process.argv.slice(2).find(a => !a.startsWith('--')) || join(homedir(), '.claude', 'projects');
const db = abrir();
db.exec('CREATE TABLE IF NOT EXISTS estado (clave TEXT PRIMARY KEY, valor TEXT)');
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
