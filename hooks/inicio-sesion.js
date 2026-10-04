#!/usr/bin/env node
// Hook SessionStart: lo que se imprime aquí entra al contexto de Claude al iniciar, reanudar o tras compactar.
import { abrir, recientes } from '../db.js';
import { leerEntrada } from './leer-entrada.js';

try {
  const { cwd = process.cwd() } = leerEntrada();
  const db = abrir();
  const rs = recientes(db, { proyecto: cwd, limite: 15 });
  const lineas = [
    '# Memoria persistente (servidor MCP "memoria")',
    'Herramientas: memoria_buscar (memorias + conversaciones pasadas, incluso compactadas), memoria_guardar, memoria_recientes, memoria_olvidar.',
    'Antes de preguntar algo que pudo tratarse en otra sesión, búscalo. Guarda decisiones, hechos y preferencias que valga la pena recordar.',
  ];
  if (rs.length) {
    lineas.push('', `## Memorias recientes de ${cwd}`);
    for (const m of rs) lineas.push(`- #${m.id} [${m.tipo}] ${m.creado.slice(0, 10)}: ${m.texto.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  process.stdout.write(lineas.join('\n') + '\n');
} catch {}
