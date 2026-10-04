// Lee el JSON que Claude Code envía a los hooks por stdin.
import { readFileSync } from 'node:fs';

export function leerEntrada() {
  try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}
