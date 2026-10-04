#!/usr/bin/env node
// Hook Stop / PreCompact: copia a la base las líneas nuevas del transcript de la sesión.
// Nunca debe romper la sesión: cualquier error se ignora en silencio.
import { abrir } from '../db.js';
import { importarTranscript } from '../transcript.js';
import { leerEntrada } from './leer-entrada.js';

try {
  const { transcript_path } = leerEntrada();
  if (transcript_path) importarTranscript(abrir(), transcript_path);
} catch {}
