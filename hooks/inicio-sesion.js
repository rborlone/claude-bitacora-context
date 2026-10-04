#!/usr/bin/env node
// Hook SessionStart: lo que se imprime aquí entra al contexto de Claude al iniciar, reanudar o tras compactar.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { abrir, recientes, raizProyecto } from '../db.js';
import { leerEntrada } from './leer-entrada.js';

try {
  const { cwd = process.cwd() } = leerEntrada();
  const db = abrir();

  // Importa en segundo plano los transcripts que cambiaron desde la última vez (la primera vez, todo el historial).
  // Recoge también la respuesta final de sesiones anteriores, que el hook Stop puede no alcanzar a leer.
  const script = fileURLToPath(new URL('../importar-historial.js', import.meta.url));
  spawn(process.execPath, ['--no-warnings', script], { detached: true, stdio: 'ignore' }).unref();

  const proyecto = raizProyecto(cwd);
  const rs = recientes(db, { proyecto, limite: 15 });
  const lineas = [
    '# Bitácora: memoria persistente (servidor MCP "bitacora")',
    'Herramientas: bitacora_buscar (memorias + conversaciones pasadas, incluso compactadas), bitacora_guardar, bitacora_recientes, bitacora_olvidar.',
    'Antes de preguntar algo que pudo tratarse en otra sesión, búscalo. Guarda decisiones, hechos y preferencias que valga la pena recordar.',
  ];
  if (rs.length) {
    lineas.push('', `## Memorias recientes de ${proyecto}`);
    for (const m of rs) lineas.push(`- #${m.id} [${m.tipo}] ${m.creado.slice(0, 10)}: ${m.texto.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  process.stdout.write(lineas.join('\n') + '\n');
} catch {}
