#!/usr/bin/env node
// Importa todos los transcripts existentes en ~/.claude/projects (es incremental: se puede repetir).
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { abrir, RUTA_DB } from './db.js';
import { importarTranscript } from './transcript.js';

const raiz = process.argv[2] || join(homedir(), '.claude', 'projects');
const db = abrir();
let archivos = 0, mensajes = 0;
for (const dir of readdirSync(raiz, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const f of readdirSync(join(raiz, dir.name))) {
    if (!f.endsWith('.jsonl')) continue;
    mensajes += importarTranscript(db, join(raiz, dir.name, f));
    archivos++;
  }
}
console.log(`${archivos} transcripts revisados, ${mensajes} mensajes nuevos → ${RUTA_DB}`);
